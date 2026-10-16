// Bridge exposed to the game page as window.inkwaveNative (desktop app only; the web build never sees it).
const { contextBridge, ipcRenderer } = require('electron');
const config = ipcRenderer.sendSync('desktop:get-config');

contextBridge.exposeInMainWorld('inkwaveNative', {
  platform: process.platform,
  language: config.language,
  relay: config.relay,
  isFullScreen: () => ipcRenderer.sendSync('fs:get'),
  setFullScreen: (on) => ipcRenderer.send('fs:set', !!on),
  onFullScreenChange: (cb) => { ipcRenderer.on('fs:changed', (_e, on) => cb(!!on)); },
});
