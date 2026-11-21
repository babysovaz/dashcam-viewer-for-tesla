// Sign-in with Tesla. Tesla offers no public API for dashcam keys, so the app uses the
// official viewer's own session: the user signs in on dashcam.tesla.com inside a window
// owned by the app, and the bearer token is read from that page's own /api/1/ requests.
// - The password only ever goes to Tesla's page.
// - The token lives in memory only; sign-in cookies stay in a dedicated partition so the
//   next connection usually needs no password (and can even happen silently).
"use strict";
const { BrowserWindow, session, shell } = require("electron");

const ORIGIN = "https://dashcam.tesla.com";
const PARTITION = "persist:tesla-dashcam";

let token = null;
let win = null;
let interceptor = false;
const listeners = new Set();

// Tesla's access token is a JWT: its "exp" claim says until when Tesla accepts it.
function expiry(t) {
  try { const exp = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).exp; return exp ? exp * 1000 : null; }
  catch { return null; }
}
const status = () => ({ connected: !!token, windowOpen: !!win && !win.isDestroyed(), expiresAt: token ? expiry(token) : null });
const emit = () => { for (const l of listeners) l(status()); };
const onChange = l => listeners.add(l);
// A token about to expire is dropped up front, so the next unlock reconnects quietly.
const getToken = () => {
  const exp = token && expiry(token);
  if (exp && Date.now() > exp - 60000) { token = null; emit(); }
  return token;
};

function accept(raw) {
  const t = String(raw).trim().replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "").trim();
  if (!t || t === token) return;
  token = t;
  emit();
}
function invalidate() { if (token) { token = null; emit(); } }
function setManual(raw) { accept(raw); return status(); }

async function signOut() {
  token = null;
  if (win && !win.isDestroyed()) win.close();
  const s = session.fromPartition(PARTITION);
  await s.clearStorageData(); await s.clearCache();
  emit();
}

function installInterceptor() {
  if (interceptor) return;
  interceptor = true;
  session.fromPartition(PARTITION).webRequest.onBeforeSendHeaders({ urls: [`${ORIGIN}/api/*`] }, (d, cb) => {
    const h = Object.entries(d.requestHeaders).find(([n]) => n.toLowerCase() === "authorization");
    if (h && /^bearer\s+\S+/i.test(h[1])) accept(h[1]);
    cb({ requestHeaders: d.requestHeaders });
  });
}

// The official viewer only calls its API once a clip is opened. Rather than asking the user
// to drag a file, hand one of their own encrypted clips to the page's file input through the
// DevTools protocol — exactly what picking it in the page would do.
async function handSample(contents, file) {
  const dbg = contents.debugger;
  let attached = false;
  try {
    if (!dbg.isAttached()) { dbg.attach("1.3"); attached = true; }
    const { root } = await dbg.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
    const { nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' });
    if (!nodeId) return false;
    await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: [file] });
    return true;
  } catch { return false; }
  finally { if (attached && dbg.isAttached()) dbg.detach(); }
}

/**
 * Get a token. silent=true first tries in a hidden window using saved cookies; if Tesla asks
 * for a password the window is shown. Resolves with true when connected, false if closed.
 */
function connect({ sampleFile, silent = false, parent, title } = {}) {
  if (token) return Promise.resolve(true);
  installInterceptor();
  if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  else {
    win = new BrowserWindow({
      width: 980, height: 760, show: !silent, parent, title: title || "Tesla — dashcam.tesla.com",
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
    win.on("closed", () => { win = null; emit(); });
    win.loadURL(ORIGIN);
  }
  emit();
  const w = win;
  return new Promise(resolve => {
    let tries = 0, done = false;
    const finish = ok => {
      if (done) return; done = true;
      clearInterval(timer); listeners.delete(watch);
      if (ok && w && !w.isDestroyed()) setTimeout(() => !w.isDestroyed() && w.close(), 800);
      resolve(ok);
    };
    const watch = s => { if (s.connected) finish(true); };
    listeners.add(watch);
    w.on("closed", () => finish(!!token));
    const timer = setInterval(async () => {
      if (done || w.isDestroyed()) return;
      const url = w.webContents.getURL();
      const onViewer = url.startsWith(ORIGIN) && !w.webContents.isLoading();
      if (onViewer && sampleFile) await handSample(w.webContents, sampleFile);
      tries++;
      // Silent attempt failed (password needed): show the window to the user.
      if (silent && !w.isVisible() && (tries > 6 || !url.startsWith(ORIGIN))) w.show();
    }, 2000);
  });
}

module.exports = { connect, getToken, invalidate, setManual, signOut, onChange, status };
