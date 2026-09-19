'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  paths: () => ipcRenderer.invoke('app:paths'),
  ensureYtDlp: (force) => ipcRenderer.invoke('app:ensure-ytdlp', force),
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  info: (url) => ipcRenderer.invoke('media:info', url),
  download: (opts) => ipcRenderer.invoke('media:download', opts),
  cancel: () => ipcRenderer.invoke('media:cancel'),

  onProgress: (cb) => ipcRenderer.on('download:progress', (_e, p) => cb(p)),
  onLog: (cb) => ipcRenderer.on('download:log', (_e, l) => cb(l)),
  onSetupProgress: (cb) => ipcRenderer.on('ytdlp:setup-progress', (_e, p) => cb(p)),
  onFormats: (cb) => ipcRenderer.on('download:formats', (_e, f) => cb(f)),
  onSkipped: (cb) => ipcRenderer.on('download:skipped', (_e, f) => cb(f))
});
