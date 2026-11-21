"use strict";
const { app, BrowserWindow, dialog, ipcMain, protocol } = require("electron");
const fs = require("fs");
const path = require("path");
const keys = require("./keys");
const auth = require("./auth");
const { readRange } = require("./container");
const telemetry = require("./telemetry");

// tcam://f/?p=<absolute path>  — serves clips to the <video> elements, decrypting on the fly.
protocol.registerSchemesAsPrivileged([{
  scheme: "tcam", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true },
}]);

let mainWin = null;
let root = null;          // folder chosen by the user: nothing outside it is ever served
let sampleFile = null;    // one encrypted clip, used to trigger the sign-in token capture

const SKIP = /^(Photobooth|Sketchpad|TeslaTrackMode|\$RECYCLE\.BIN|System Volume Information|\.)/i;
const MIME = { mp4: "video/mp4", json: "application/json", png: "image/png" };
const CHUNK = 1024 * 1024;   // decryption step while streaming

function inRoot(p) {
  if (!root) return false;
  const rel = path.relative(root, path.resolve(p));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function scan(dir) {
  const out = [];
  let smallest = null;
  const walk = (d, parts, depth) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 4 && !SKIP.test(e.name)) walk(abs, [...parts, e.name], depth + 1); }
      else if (/\.(mp4|json|png)$/i.test(e.name)) {
        out.push({ parts: [...parts, e.name], abs });
        if (parts.includes("EncryptedClips") && /\.mp4$/i.test(e.name)) {
          try { const s = fs.statSync(abs).size; if (!smallest || s < smallest.s) smallest = { s, abs }; } catch {}
        }
      }
    }
  };
  walk(dir, [], 0);
  sampleFile = smallest && smallest.abs;
  return out;
}

async function serve(req) {
  const p = new URL(req.url).searchParams.get("p");
  if (!p || !inRoot(p)) return new Response("forbidden", { status: 403 });
  let inf;
  try { inf = keys.info(p); } catch { return new Response("not found", { status: 404 }); }
  let total, key = null;
  if (inf.kind === "plain") total = inf.size;
  else if (inf.kind === "container") {
    key = keys.keyFor(p);
    if (!key) return new Response("locked", { status: 423 });
    total = inf.plainSize;
  } else return new Response("corrupt", { status: 422 });

  const type = MIME[path.extname(p).slice(1).toLowerCase()] || "application/octet-stream";
  const range = req.headers.get("range");
  let start = 0, end = total - 1, partial = false;
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    partial = true;
    if (m[1] === "") start = Math.max(0, total - Number(m[2]));
    else { start = Number(m[1]); if (m[2] !== "") end = Math.min(Number(m[2]), total - 1); }
    if (start >= total) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  }
  // Chromium rejects a short 206 on custom schemes, so answer the full range — but as a
  // stream decrypted chunk by chunk while the player reads. A seek cancels the stream, so
  // only what is actually watched gets decrypted, and nothing is ever written to disk.
  const fd = fs.openSync(p, "r");
  let pos = start, closed = false;
  const close = () => { if (!closed) { closed = true; try { fs.closeSync(fd); } catch {} } };
  const body = new ReadableStream({
    pull(ctrl) {
      try {
        if (pos > end) { close(); ctrl.close(); return; }
        const e = Math.min(end, pos + CHUNK - 1);
        let buf;
        if (key) buf = readRange(fd, key, total, pos, e);
        else { buf = Buffer.alloc(e - pos + 1); fs.readSync(fd, buf, 0, buf.length, pos); }
        pos = e + 1;
        ctrl.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
      } catch (err) { close(); ctrl.error(err); }
    },
    cancel: close,
  });
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), "Cache-Control": "no-store" };
  if (partial) headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
  return new Response(body, { status: partial ? 206 : 200, headers });
}

async function withToken(fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!auth.getToken()) {
      const ok = await auth.connect({ sampleFile, silent: attempt === 0, parent: mainWin });
      if (!ok) return { cancelled: true };
    }
    try { return await fn(auth.getToken()); }
    catch (e) { if (e.status === 401) { auth.invalidate(); continue; } return { error: e.message }; }
  }
  return { error: "Connexion Tesla refusée" };
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1000, minHeight: 640, backgroundColor: "#0e0f11",
    title: "TeslaCam Viewer", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  mainWin.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWin.on("closed", () => { mainWin = null; });
}

app.whenReady().then(() => {
  protocol.handle("tcam", req => serve(req).catch(e => new Response(String(e.message), { status: 500 })));

  ipcMain.handle("pick-folder", async () => {
    const r = await dialog.showOpenDialog(mainWin, { title: "Choisir le dossier TeslaCam", properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    root = path.resolve(r.filePaths[0]);
    return { name: path.basename(root) || root, entries: scan(root) };
  });
  // Decryption works on keys already cached: tells the UI which files are readable now.
  ipcMain.handle("key-status", (_e, paths) => paths.map(p => { try { const i = keys.info(p); return i.kind !== "container" || !!keys.keyFor(p); } catch { return false; } }));
  ipcMain.handle("unlock", (_e, paths) => withToken(t => keys.fetchKeys(paths.filter(inRoot), t)));
  // Telemetry of one clip (speed, pedals, steering…), cached: it never changes.
  const telCache = new Map();
  ipcMain.handle("telemetry", (_e, p) => {
    if (!inRoot(p)) return null;
    if (telCache.has(p)) return telCache.get(p);
    try {
      const i = keys.info(p);
      const key = i.kind === "container" ? keys.keyFor(p) : null;
      if (i.kind === "container" && !key) return null;
      const data = telemetry.extract(p, key, i.plainSize);
      telCache.set(p, data);
      return data;
    } catch { return null; }
  });
  ipcMain.handle("auth-status", () => auth.status());
  ipcMain.handle("auth-connect", async () => ({ ok: await auth.connect({ sampleFile, parent: mainWin }) }));
  ipcMain.handle("auth-manual", (_e, raw) => auth.setManual(raw));
  ipcMain.handle("auth-signout", async () => { await auth.signOut(); return auth.status(); });
  ipcMain.handle("forget-keys", () => { keys.clearCache(); return true; });
  auth.onChange(s => mainWin && mainWin.webContents.send("auth-changed", s));

  createWindow();

  // Automated end-to-end test only (never set in normal use): open a folder, inject known
  // keys for synthetic encrypted clips, and let test/e2e.js drive the UI.
  if (process.env.TCV_TEST_DIR) {
    root = path.resolve(process.env.TCV_TEST_DIR);
    const testKeys = JSON.parse(process.env.TCV_TEST_KEYS || "{}");
    for (const [p, hex] of Object.entries(testKeys)) keys.loadCache().set(keys.info(p).cid, Buffer.from(hex, "hex").toString("base64"));
    mainWin.webContents.once("did-finish-load", () => require(path.join(__dirname, "..", "test", "e2e.js"))(mainWin, scan(root), app));
  }
});
app.on("window-all-closed", () => app.quit());
