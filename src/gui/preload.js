'use strict';

// Bridge between the sandboxed renderer and the privileged main process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: profile => ipcRenderer.invoke('profiles:save', profile),
  deleteProfile: id => ipcRenderer.invoke('profiles:delete', id),
  exportProfiles: () => ipcRenderer.invoke('profiles:export'),
  importProfiles: () => ipcRenderer.invoke('profiles:import'),

  startCheck: opts => ipcRenderer.invoke('check:start', opts),
  sshTest: opts => ipcRenderer.invoke('ssh:test', opts),
  runTrial: req => ipcRenderer.invoke('trial:run', req),
  onProgress: cb => ipcRenderer.on('check:progress', (_e, msg) => cb(msg)),

  historyList: () => ipcRenderer.invoke('history:list'),
  historyGet: id => ipcRenderer.invoke('history:get', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),

  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickKeyFile: () => ipcRenderer.invoke('dialog:pickKeyFile'),
  saveReport: req => ipcRenderer.invoke('report:save', req),
  openExternal: url => ipcRenderer.invoke('shell:openExternal', url),
  version: () => ipcRenderer.invoke('app:version'),

  onUpdateStatus: cb => ipcRenderer.on('update:status', (_e, msg) => cb(msg)),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
});
