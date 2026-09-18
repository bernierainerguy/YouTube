'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const { app } = require('electron');

const YTDLP_URL =
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';

function binDir() {
  return path.join(app.getPath('userData'), 'bin');
}

function ytDlpPath() {
  return path.join(binDir(), 'yt-dlp');
}

function ffmpegPath() {
  // ffmpeg-static ships the binary inside node_modules; when packaged it lives
  // in app.asar.unpacked (see asarUnpack in package.json).
  const p = require('ffmpeg-static');
  return p ? p.replace('app.asar', 'app.asar.unpacked') : null;
}

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects'));

    https
      .get(url, { headers: { 'User-Agent': 'YT-Grab' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(
            download(res.headers.location, dest, onProgress, redirects + 1)
          );
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }

        const total = Number(res.headers['content-length']) || 0;
        let done = 0;
        const out = fs.createWriteStream(dest);

        res.on('data', (chunk) => {
          done += chunk.length;
          if (onProgress && total) onProgress(Math.round((done / total) * 100));
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve()));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

// Fetches yt-dlp on first run (and on demand for updates).
async function ensureYtDlp(onProgress, force = false) {
  const target = ytDlpPath();
  if (!force && fs.existsSync(target)) return target;

  await fsp.mkdir(binDir(), { recursive: true });
  const tmp = `${target}.download`;
  await download(YTDLP_URL, tmp, onProgress);
  await fsp.rename(tmp, target);
  await fsp.chmod(target, 0o755);
  return target;
}

module.exports = { ensureYtDlp, ytDlpPath, ffmpegPath };
