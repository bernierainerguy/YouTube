'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  url: $('url'),
  paste: $('paste'),
  preview: $('preview'),
  thumb: $('thumb'),
  ptitle: $('ptitle'),
  pmeta: $('pmeta'),
  quality: $('quality'),
  qualityField: $('quality-field'),
  bitrate: $('bitrate'),
  bitrateField: $('bitrate-field'),
  playlist: $('playlist'),
  folder: $('folder'),
  browse: $('browse'),
  go: $('go'),
  stop: $('stop'),
  open: $('open'),
  fill: $('fill'),
  status: $('status'),
  rate: $('rate'),
  log: $('log'),
  consent: $('consent'),
  consentCheck: $('consent-check'),
  consentOk: $('consent-ok')
};

const CONSENT_KEY = 'ytgrab.licence-acknowledged.v1';

let format = 'mp4';
let busy = false;
let infoTimer = null;

// --- helpers ---------------------------------------------------------------

function bytes(n) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function clock(seconds) {
  if (!seconds || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.classList.toggle('error', isError);
}

function log(line) {
  el.log.textContent += `${line}\n`;
  el.log.scrollTop = el.log.scrollHeight;
}

function setProgress(percent) {
  if (percent === null) {
    el.fill.classList.add('indeterminate');
    return;
  }
  el.fill.classList.remove('indeterminate');
  el.fill.style.width = `${percent}%`;
}

function setBusy(state) {
  busy = state;
  el.go.disabled = state;
  el.stop.classList.toggle('hidden', !state);
  el.go.textContent = state ? 'Downloading…' : 'Download';
}

// --- format switch ---------------------------------------------------------

document.querySelectorAll('.seg').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    format = btn.dataset.format;
    el.qualityField.classList.toggle('hidden', format !== 'mp4');
    el.bitrateField.classList.toggle('hidden', format !== 'mp3');
  });
});

// --- url preview -----------------------------------------------------------

async function loadInfo() {
  const url = el.url.value.trim();
  if (!/^https?:\/\//i.test(url)) {
    el.preview.classList.add('hidden');
    return;
  }

  try {
    const info = await window.api.info(url);
    el.thumb.src = info.thumbnail || '';
    el.ptitle.textContent = info.title;
    el.pmeta.textContent = [
      info.uploader,
      clock(info.duration),
      info.maxHeight ? `up to ${info.maxHeight}p` : ''
    ]
      .filter(Boolean)
      .join(' · ');
    el.preview.classList.remove('hidden');
  } catch {
    el.preview.classList.add('hidden');
  }
}

el.url.addEventListener('input', () => {
  clearTimeout(infoTimer);
  infoTimer = setTimeout(loadInfo, 600);
});

el.paste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      el.url.value = text.trim();
      loadInfo();
    }
  } catch {
    setStatus('Could not read the clipboard.', true);
  }
});

// --- folder ----------------------------------------------------------------

el.browse.addEventListener('click', async () => {
  const dir = await window.api.chooseFolder();
  if (dir) el.folder.value = dir;
});

el.open.addEventListener('click', () => window.api.reveal(el.folder.value));

// --- download --------------------------------------------------------------

el.go.addEventListener('click', async () => {
  const url = el.url.value.trim();
  if (!/^https?:\/\//i.test(url)) {
    setStatus('Paste a YouTube link first.', true);
    return;
  }

  setBusy(true);
  el.fill.classList.remove('done');
  setProgress(null);
  el.rate.textContent = '';
  el.log.textContent = '';
  setStatus('Starting…');

  try {
    const res = await window.api.download({
      url,
      format,
      quality: el.quality.value,
      audioBitrate: Number(el.bitrate.value),
      outputDir: el.folder.value,
      playlist: el.playlist.checked
    });

    setProgress(100);
    el.fill.classList.add('done');
    el.rate.textContent = '';
    setStatus(res.file ? `Saved ${res.file.split('/').pop()}` : 'Done.');
  } catch (err) {
    const msg = String(err.message || err).replace(/^Error invoking remote method '.*?': /, '');
    setProgress(0);
    setStatus(/cancel/i.test(msg) ? 'Cancelled.' : msg, !/cancel/i.test(msg));
  } finally {
    setBusy(false);
  }
});

el.stop.addEventListener('click', async () => {
  setStatus('Cancelling…');
  await window.api.cancel();
});

// --- main-process events ---------------------------------------------------

window.api.onProgress((p) => {
  setProgress(p.percent);
  setStatus(
    p.percent === null
      ? 'Working…'
      : `${p.percent.toFixed(1)}% · ${bytes(p.downloaded)} of ${bytes(p.total)}`
  );
  el.rate.textContent = [
    p.speed ? `${bytes(p.speed)}/s` : '',
    p.eta ? `${clock(p.eta)} left` : ''
  ]
    .filter(Boolean)
    .join(' · ');
});

window.api.onLog((line) => {
  log(line);
  if (/^\[(Merger|ExtractAudio|VideoConvertor)\]/.test(line)) {
    setProgress(null);
    setStatus(format === 'mp3' ? 'Converting audio…' : 'Merging video and audio…');
  }
});

window.api.onSetupProgress((pct) => {
  if (!busy) setStatus(`Setting up yt-dlp… ${pct}%`);
});

// --- licence acknowledgement -----------------------------------------------

function hasAcknowledged() {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'yes';
  } catch {
    // Private window or blocked storage: ask again rather than assume consent.
    return false;
  }
}

function showConsent() {
  el.consent.classList.remove('hidden');
  el.go.disabled = true;
  el.consentCheck.focus();
}

el.consentCheck.addEventListener('change', () => {
  el.consentOk.disabled = !el.consentCheck.checked;
});

el.consentOk.addEventListener('click', () => {
  try {
    localStorage.setItem(CONSENT_KEY, 'yes');
  } catch {
    // Not persisting is fine; they will simply be asked again next launch.
  }
  el.consent.classList.add('hidden');
  el.go.disabled = busy;
  el.url.focus();
});

// --- boot ------------------------------------------------------------------

(async () => {
  const paths = await window.api.paths();
  el.folder.value = paths.outputDir;

  if (!hasAcknowledged()) showConsent();

  try {
    setStatus('Checking downloader…');
    await window.api.ensureYtDlp(false);
    setStatus('Ready.');
  } catch (err) {
    setStatus(`yt-dlp setup failed: ${err.message}`, true);
  }
})();
