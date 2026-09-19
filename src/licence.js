/*!
 * Media Grab — permissive licence check-in.
 *
 * Mirrors the WESC check-in protocol (src/main/licenceCheckin.js in the wesc
 * repo) and talks to the same server:
 *
 *   POST https://whiteleyevents.co.uk/welm-api.php?action=checkin
 *   { uuid, name, email, machine_name, app, version }
 *
 * The server keys records on uuid alone and stores `app` alongside, so this
 * app shares the endpoint with WESC without colliding. New records are
 * created as `granted`; an admin can flip one to `denied`, which this client
 * honours on the next launch.
 *
 * If the server is unreachable we trust the cached `granted` state for 30
 * days from the last successful check-in, warning in the final 7. Being
 * offline should never lock someone out mid-use.
 *
 * State lives in userData/licence-checkin.json.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { app } = require('electron');

const LICENCE_SERVER = process.env.WEMG_LICENCE_SERVER || 'https://whiteleyevents.co.uk';
const API_PATH = '/welm-api.php';
const APP_KEY = 'wemg';

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const GRACE_WARN_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

// ── State ──────────────────────────────────────────────────────────

function statePath() {
  return path.join(app.getPath('userData'), 'licence-checkin.json');
}

function defaultState() {
  return {
    uuid: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
    name: '',
    email: '',
    machineName: os.hostname() || 'unknown',
    status: 'unknown',
    deniedReason: null,
    lastCheckinAt: null,
    graceUntil: null,
    lastError: null
  };
}

function loadState() {
  try {
    const obj = JSON.parse(fs.readFileSync(statePath(), 'utf-8'));
    if (obj && typeof obj === 'object') return { ...defaultState(), ...obj };
  } catch {
    // No state yet, or it is unreadable — start fresh.
  }
  return null;
}

function saveState(state) {
  // Atomic write: a half-written file would cost the cached grant and force
  // a network round-trip that may not be available.
  const target = statePath();
  const tmp = `${target}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, JSON.stringify(state, null, 2));
    try {
      fs.fsyncSync(fd);
    } catch {
      // fsync is best-effort; the rename below still gives us atomicity.
    }
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, target);
  } catch (err) {
    if (fd) {
      try {
        fs.closeSync(fd);
      } catch {
        // Nothing useful to do if the handle will not close.
      }
    }
    console.warn('[licence] could not persist state:', err && err.message);
  }
}

function getState() {
  let state = loadState();
  if (!state) {
    state = defaultState();
    saveState(state);
  }
  return state;
}

// ── Server ─────────────────────────────────────────────────────────

function postJson(action, params) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_PATH}?action=${encodeURIComponent(action)}`, LICENCE_SERVER);
    const transport = url.protocol === 'http:' ? http : https;
    const body = JSON.stringify(params || {});

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: url.pathname + url.search,
        method: 'POST',
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': `WEMG/${app.getVersion()}`
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
          } catch (err) {
            reject(new Error(`Bad JSON from licence server (HTTP ${res.statusCode}): ${err.message}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Licence server timeout')));
    req.write(body);
    req.end();
  });
}

function setIdentity({ name, email }) {
  const state = getState();
  state.name = String(name || '').trim();
  state.email = String(email || '').trim();
  saveState(state);
  return state;
}

async function checkin() {
  const state = getState();

  try {
    const { body } = await postJson('checkin', {
      uuid: state.uuid,
      name: state.name,
      email: state.email,
      machine_name: state.machineName,
      app: APP_KEY,
      version: app.getVersion()
    });

    // The server rejects a missing name or invalid email as `denied` too, so
    // treat anything that is not an explicit denial as a grant.
    const remote = body && body.status === 'denied' ? 'denied' : 'granted';
    const now = Date.now();

    state.status = remote;
    state.deniedReason =
      remote === 'denied' ? (body && (body.denied_reason || body.message)) || null : null;
    state.lastCheckinAt = new Date(now).toISOString();
    state.graceUntil = new Date(now + GRACE_MS).toISOString();
    state.lastError = null;
    saveState(state);

    return { ok: remote === 'granted', status: remote, state };
  } catch (err) {
    state.lastError = err && err.message ? err.message : String(err);

    // First run with no connectivity: start the grace clock anyway, so an
    // offline install gets its 30 days rather than being dead on arrival.
    if (!state.graceUntil) {
      state.graceUntil = new Date(Date.now() + GRACE_MS).toISOString();
    }
    saveState(state);

    return { ok: false, status: state.status, offline: true, error: state.lastError, state };
  }
}

/**
 * Decide whether the app may be used right now.
 * reason: 'granted' | 'denied' | 'unregistered' | 'grace-expired'
 */
function evaluate() {
  const state = getState();

  if (!state.name || !state.email) {
    return { allowed: false, reason: 'unregistered', warning: null, graceMsRemaining: 0, state };
  }

  if (state.status === 'denied') {
    return { allowed: false, reason: 'denied', warning: null, graceMsRemaining: 0, state };
  }

  const graceUntil = state.graceUntil ? Date.parse(state.graceUntil) : 0;
  const remaining = graceUntil - Date.now();

  if (!graceUntil || remaining <= 0) {
    return { allowed: false, reason: 'grace-expired', warning: null, graceMsRemaining: 0, state };
  }

  const warning =
    remaining <= GRACE_WARN_MS
      ? `Could not reach the licence server. This copy stops working in ${Math.ceil(
          remaining / (24 * 60 * 60 * 1000)
        )} day(s) unless it checks in.`
      : null;

  return { allowed: true, reason: 'granted', warning, graceMsRemaining: remaining, state };
}

function reset() {
  try {
    fs.unlinkSync(statePath());
  } catch {
    // Already gone — nothing to undo.
  }
}

module.exports = { GRACE_MS, GRACE_WARN_MS, getState, setIdentity, checkin, evaluate, reset };
