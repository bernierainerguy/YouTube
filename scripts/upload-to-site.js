#!/usr/bin/env node
/**
 * Upload Media Grab installers to whiteleyevents.co.uk.
 *
 * Ports the WESC uploader's strategy (scripts/upload-to-site.js in the wesc
 * repo). A single 122 MB POST to the direct endpoint can die server-side
 * with an empty 500 — PHP limits, or the host's edge — so there are three
 * tiers, tried in order:
 *
 *   1. direct endpoint, whole file streamed
 *   2. direct endpoint, 4 MB base64 chunks + a finalise call
 *   3. the WordPress media endpoint, which the theme routes into the same
 *      product folder
 *
 * The product must already exist in WP Admin → Software → Products with the
 * key below; the endpoint rejects files it cannot match to a catalogue entry.
 *
 * Credentials come from .env at the repo root (gitignored):
 *   WELM_APP_USER=<WordPress username>
 *   WELM_APP_PASSWORD=<application password, spaces allowed>
 *
 * Usage:
 *   node scripts/upload-to-site.js dist/*.dmg
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = 'https://whiteleyevents.co.uk';
const DIRECT_ENDPOINT = `${HOST}/wp-json/whe/v1/software/upload`;
const MEDIA_ENDPOINT = `${HOST}/wp-json/wp/v2/media`;
const PUBLIC_BASE = `${HOST}/wp-content/uploads/whe-software`;

const TIMEOUT_MS = 20 * 60 * 1000;

function loadDotEnv() {
  const p = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = { ...process.env, ...loadDotEnv() };
const USER = env.WELM_APP_USER;
const PASS = env.WELM_APP_PASSWORD;
const PRODUCT = (env.WEMG_UPLOAD_PRODUCT || 'wemg').toLowerCase().replace(/[^a-z0-9_-]/g, '');
const CHUNK_SIZE = Math.max(1, Math.min(64, Number(env.WEMG_UPLOAD_CHUNK_MB) || 4)) * 1024 * 1024;

if (!USER || !PASS) {
  console.error('✗ Missing WELM_APP_USER or WELM_APP_PASSWORD (put them in .env)');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

function mimeFor(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (n.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

function baseHeaders(name) {
  return {
    Authorization: auth,
    'Content-Disposition': `attachment; filename="${name}"`,
    'X-WHE-Software-Product': PRODUCT,
    'X-WHE-Software-Filename': name
  };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describe(body, status) {
  if (!body) return `HTTP ${status} (empty body)`;
  try {
    const j = JSON.parse(body);
    return `HTTP ${status}: ${j.message || j.error || body.slice(0, 200)}`;
  } catch {
    return `HTTP ${status}: ${body.slice(0, 200).replace(/\s+/g, ' ')}`;
  }
}

function resultUrl(body, name) {
  try {
    const j = JSON.parse(body);
    return j.url || j.source_url || (j.guid && j.guid.rendered) || `${PUBLIC_BASE}/…/${name}`;
  } catch {
    return `${PUBLIC_BASE}/…/${name}`;
  }
}

// ── Tier 1: whole file, streamed ───────────────────────────────────
async function uploadWhole(file, name, size) {
  const res = await fetchWithTimeout(DIRECT_ENDPOINT, {
    method: 'POST',
    headers: {
      ...baseHeaders(name),
      'Content-Type': mimeFor(name),
      'Content-Length': String(size)
    },
    body: fs.createReadStream(file),
    duplex: 'half'
  });

  const body = await res.text();
  return res.ok ? { ok: true, url: resultUrl(body, name) } : { ok: false, why: describe(body, res.status) };
}

// ── Tier 2: base64 chunks, then finalise ───────────────────────────
async function uploadChunked(file, name, size) {
  const uploadId = crypto.randomUUID();
  const chunks = Math.ceil(size / CHUNK_SIZE);
  const fd = fs.openSync(file, 'r');

  try {
    for (let index = 0; index < chunks; index += 1) {
      const start = index * CHUNK_SIZE;
      const chunkSize = Math.min(size, start + CHUNK_SIZE) - start;
      const buf = Buffer.allocUnsafe(chunkSize);
      fs.readSync(fd, buf, 0, chunkSize, start);
      const payload = buf.toString('base64');

      const res = await fetchWithTimeout(DIRECT_ENDPOINT, {
        method: 'POST',
        headers: {
          ...baseHeaders(name),
          'Content-Type': 'text/plain; charset=us-ascii',
          'Content-Length': String(Buffer.byteLength(payload)),
          'X-WHE-Software-Chunk': '1',
          'X-WHE-Software-Chunk-Encoding': 'base64',
          'X-WHE-Software-Chunk-Bytes': String(chunkSize),
          'X-WHE-Software-Upload-Id': uploadId,
          'X-WHE-Software-Chunk-Index': String(index),
          'X-WHE-Software-Chunk-Offset': String(start),
          'X-WHE-Software-Chunk-Count': String(chunks),
          'X-WHE-Software-Total-Size': String(size),
          'X-WHE-Software-Final-Chunk': '0'
        },
        body: payload
      });

      if (!res.ok) {
        return { ok: false, why: `chunk ${index + 1}/${chunks} ${describe(await res.text(), res.status)}` };
      }
      process.stdout.write(`\r    chunk ${index + 1}/${chunks} (${Math.round(((index + 1) / chunks) * 100)}%)   `);
    }
  } finally {
    fs.closeSync(fd);
  }

  const res = await fetchWithTimeout(DIRECT_ENDPOINT, {
    method: 'POST',
    headers: {
      ...baseHeaders(name),
      'Content-Type': mimeFor(name),
      'Content-Length': '0',
      'X-WHE-Software-Chunk': '1',
      'X-WHE-Software-Upload-Id': uploadId,
      'X-WHE-Software-Chunk-Index': String(chunks),
      'X-WHE-Software-Chunk-Offset': String(size),
      'X-WHE-Software-Chunk-Count': String(chunks),
      'X-WHE-Software-Total-Size': String(size),
      'X-WHE-Software-Final-Chunk': '1',
      'X-WHE-Software-Finalise-Only': '1'
    },
    body: ''
  });

  const body = await res.text();
  process.stdout.write('\r');
  return res.ok ? { ok: true, url: resultUrl(body, name) } : { ok: false, why: `finalise ${describe(body, res.status)}` };
}

// ── Tier 3: the WordPress media endpoint ───────────────────────────
async function uploadMedia(file, name) {
  const res = await fetchWithTimeout(MEDIA_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': mimeFor(name),
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-WHE-Software-Upload': '1',
      'X-WHE-Software-Product': PRODUCT
    },
    body: fs.readFileSync(file)
  });

  const body = await res.text();
  return res.ok ? { ok: true, url: resultUrl(body, name) } : { ok: false, why: describe(body, res.status) };
}

(async () => {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node scripts/upload-to-site.js dist/*.dmg');
    process.exit(1);
  }

  console.log(`Uploading to whiteleyevents.co.uk as product "${PRODUCT}"\n`);

  let failed = 0;

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`✗ ${file} — not found`);
      failed += 1;
      continue;
    }

    const name = path.basename(file);
    const size = fs.statSync(file).size;
    console.log(`${name} (${(size / 1024 / 1024).toFixed(0)} MB)`);

    const tiers = [
      ['whole file', () => uploadWhole(file, name, size)],
      ['chunked', () => uploadChunked(file, name, size)],
      ['media endpoint', () => uploadMedia(file, name)]
    ];

    let done = null;
    for (const [label, run] of tiers) {
      process.stdout.write(`  trying ${label}…\n`);
      let res;
      try {
        res = await run();
      } catch (err) {
        res = { ok: false, why: err.message || String(err) };
      }

      if (res.ok) {
        done = res;
        break;
      }

      console.error(`  ✗ ${label}: ${res.why}`);

      // A rejected product is a configuration problem, not a transport one —
      // the other tiers will fail identically.
      if (/match file to a software product|Unknown software product/i.test(res.why)) {
        console.error(`\n  Create the product first: WP Admin → Software → Products, key "${PRODUCT}".`);
        break;
      }
    }

    if (done) {
      console.log(`  ✓ uploaded\n  ${done.url}\n`);
    } else {
      failed += 1;
      console.error('');
    }
  }

  process.exit(failed ? 1 : 0);
})();
