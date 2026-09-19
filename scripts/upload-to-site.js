#!/usr/bin/env node
/**
 * Upload YT Grab installers to whiteleyevents.co.uk.
 *
 * Mirrors the WESC uploader (scripts/upload-to-site.js in the wesc repo):
 * it streams the file to the theme's own software endpoint, which files it
 * under /uploads/whe-software/<product>/MAC/ and lists it on the Software
 * page.
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
const https = require('https');

const HOST = 'whiteleyevents.co.uk';
const UPLOAD_PATH = '/wp-json/whe/v1/software/upload';
const PUBLIC_BASE = `https://${HOST}/wp-content/uploads/whe-software`;
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
const PRODUCT = (env.YTGRAB_UPLOAD_PRODUCT || 'ytgrab').toLowerCase().replace(/[^a-z0-9_-]/g, '');

if (!USER || !PASS) {
  console.error('✗ Missing WELM_APP_USER or WELM_APP_PASSWORD (put them in .env)');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

function mimeFor(name) {
  if (name.toLowerCase().endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (name.toLowerCase().endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

function upload(file) {
  return new Promise((resolve, reject) => {
    const name = path.basename(file);
    const size = fs.statSync(file).size;
    let sent = 0;

    const req = https.request(
      {
        hostname: HOST,
        path: UPLOAD_PATH,
        method: 'POST',
        timeout: TIMEOUT_MS,
        headers: {
          Authorization: auth,
          'Content-Type': mimeFor(name),
          'Content-Length': size,
          'Content-Disposition': `attachment; filename="${name}"`,
          'x-whe-software-product': PRODUCT,
          'x-whe-software-filename': name
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            // Non-JSON body: surface the raw text in the error below.
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed || {});
          } else {
            const msg = (parsed && (parsed.message || parsed.error)) || data.slice(0, 300);
            reject(new Error(`HTTP ${res.statusCode}: ${msg}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Upload timed out')));

    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => {
      sent += chunk.length;
      const pct = ((sent / size) * 100).toFixed(1);
      process.stdout.write(`\r  ${name}  ${pct}%   `);
    });
    stream.on('error', reject);
    stream.pipe(req);
  });
}

(async () => {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node scripts/upload-to-site.js dist/*.dmg');
    process.exit(1);
  }

  console.log(`Uploading to ${HOST} as product "${PRODUCT}"\n`);

  let failed = 0;
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`✗ ${file} — not found`);
      failed += 1;
      continue;
    }
    try {
      const res = await upload(file);
      const url = res.url || `${PUBLIC_BASE}/…/${path.basename(file)}`;
      console.log(`\r✓ ${path.basename(file)} uploaded`);
      console.log(`  ${url}`);
    } catch (err) {
      console.error(`\r✗ ${path.basename(file)} — ${err.message}`);
      if (/match file to a software product/i.test(err.message)) {
        console.error(
          `  Create the product first: WP Admin → Software → Products, key "${PRODUCT}".`
        );
      }
      failed += 1;
    }
  }

  process.exit(failed ? 1 : 0);
})();
