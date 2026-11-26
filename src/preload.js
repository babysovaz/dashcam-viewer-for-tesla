"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  keyStatus: paths => ipcRenderer.invoke("key-status", paths),
  unlock: paths => ipcRenderer.invoke("unlock", paths),
  telemetry: p => ipcRenderer.invoke("telemetry", p),
  authStatus: () => ipcRenderer.invoke("auth-status"),
  connect: () => ipcRenderer.invoke("auth-connect"),
  manualToken: raw => ipcRenderer.invoke("auth-manual", raw),
  signOut: () => ipcRenderer.invoke("auth-signout"),
  forgetKeys: () => ipcRenderer.invoke("forget-keys"),
  setLang: lang => ipcRenderer.invoke("set-lang", lang),
  saveOpen: (name, packId) => ipcRenderer.invoke("save-open", name, packId),
  saveWrite: (id, pos, data) => ipcRenderer.invoke("save-write", id, pos, data),
  saveClose: (id, ok) => ipcRenderer.invoke("save-close", id, ok),
  showFile: p => ipcRenderer.invoke("show-file", p),
  packOpen: name => ipcRenderer.invoke("pack-open", name),
  packOriginal: (id, p, sub) => ipcRenderer.invoke("pack-original", id, p, sub),
  packFiles: id => ipcRenderer.invoke("pack-files", id),
  packPdf: (id, html, name) => ipcRenderer.invoke("pack-pdf", id, html, name),
  packSums: id => ipcRenderer.invoke("pack-sums", id),
  packClose: (id, ok) => ipcRenderer.invoke("pack-close", id, ok),
  geocode: (lat, lon, lang) => ipcRenderer.invoke("geocode", lat, lon, lang),
  appVersion: () => ipcRenderer.invoke("app-version"),
  onAuth: cb => ipcRenderer.on("auth-changed", (_e, s) => cb(s)),
});
