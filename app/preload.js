const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  loadProgress: () => ipcRenderer.invoke('progress:load'),
  saveProgress: (text) => ipcRenderer.invoke('progress:save', text),
  info: () => ipcRenderer.invoke('app:info'),
  platform: process.platform,
  electron: process.versions.electron
});
