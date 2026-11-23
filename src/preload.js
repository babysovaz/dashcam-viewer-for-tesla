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
  saveOpen: name => ipcRenderer.invoke("save-open", name),
  saveWrite: (id, pos, data) => ipcRenderer.invoke("save-write", id, pos, data),
  saveClose: (id, ok) => ipcRenderer.invoke("save-close", id, ok),
  showFile: p => ipcRenderer.invoke("show-file", p),
  onAuth: cb => ipcRenderer.on("auth-changed", (_e, s) => cb(s)),
});
