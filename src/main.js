"use strict";
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require("electron");
const crypto = require("crypto");
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

// The app was first called "TeslaCam Viewer": keep its data folder so saved keys, the
// Tesla sign-in and the user's settings survive the rename.
app.setPath("userData", path.join(app.getPath("appData"), "TeslaCam Viewer"));

let mainWin = null;
let root = null;          // folder chosen by the user: nothing outside it is ever served
let sampleFile = null;
// UI language, set by the renderer; only used for the few texts drawn by this process.
let lang = "fr";
const TXT = {
  fr: { pick: "Choisir le dossier TeslaCam", login: "Connexion Tesla — dashcam.tesla.com", save: "Enregistrer la vidéo", video: "Vidéo MP4", packDir: "Où créer le dossier pour l'assurance ?" },
  en: { pick: "Choose the TeslaCam folder", login: "Tesla sign-in — dashcam.tesla.com", save: "Save the video", video: "MP4 video", packDir: "Where should the insurance folder be created?" },
};
const tx = k => (TXT[lang] || TXT.fr)[k];    // one encrypted clip, used to trigger the sign-in token capture

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
      const ok = await auth.connect({ sampleFile, silent: attempt === 0, parent: mainWin, title: tx("login") });
      if (!ok) return { cancelled: true };
    }
    try { return await fn(auth.getToken()); }
    catch (e) {
      if (e.status === 401) { auth.invalidate(); continue; }
      // Codes, not sentences: the renderer words them in the user's language.
      return e.code === "status" ? { error: "status", status: e.httpStatus } : { error: "other", message: e.message };
    }
  }
  return { error: "refused" };
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1000, minHeight: 640, backgroundColor: "#0e0f11",
    title: "Dashcam Viewer for Tesla", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  mainWin.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWin.on("closed", () => { mainWin = null; });
}

app.whenReady().then(() => {
  protocol.handle("tcam", req => serve(req).catch(e => new Response(String(e.message), { status: 500 })));

  ipcMain.handle("pick-folder", async () => {
    const r = await dialog.showOpenDialog(mainWin, { title: tx("pick"), properties: ["openDirectory"] });
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
  ipcMain.handle("auth-connect", async () => ({ ok: await auth.connect({ sampleFile, parent: mainWin, title: tx("login") }) }));
  ipcMain.handle("set-lang", (_e, l) => { if (TXT[l]) lang = l; });
  ipcMain.handle("auth-manual", (_e, raw) => auth.setManual(raw));
  ipcMain.handle("auth-signout", async () => { await auth.signOut(); return auth.status(); });
  ipcMain.handle("forget-keys", () => { keys.clearCache(); return true; });

  // ---- Video export: the renderer builds the MP4 and streams it here, chunk by chunk, into
  // a file the user picked. Nothing can be written anywhere else.
  const outs = new Map();   // id -> { fd, path }
  let outSeq = 0;
  ipcMain.handle("save-open", async (_e, name, packId) => {
    const safe = String(name || "video.mp4").replace(/[\\/:*?"<>|]/g, "_");
    const pack = packId && packs.get(packId);
    let target = pack ? path.join(pack.dir, safe) : process.env.TCV_TEST_OUT ? path.join(process.env.TCV_TEST_OUT, safe) : null;
    if (!target) {
      const r = await dialog.showSaveDialog(mainWin, { title: tx("save"), defaultPath: path.join(app.getPath("videos"), safe), filters: [{ name: tx("video"), extensions: ["mp4"] }] });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    const id = ++outSeq;
    outs.set(id, { fd: fs.openSync(target, "w"), path: target, pack });
    return { id, name: path.basename(target) };
  });
  ipcMain.handle("save-write", (_e, id, pos, data) => {
    const o = outs.get(id);
    if (!o) throw new Error("closed");
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    let done = 0;
    while (done < buf.length) done += fs.writeSync(o.fd, buf, done, buf.length - done, pos + done);
  });
  const written = new Set();   // finished files, the only ones "show in folder" may reveal
  ipcMain.handle("save-close", async (_e, id, ok) => {
    const o = outs.get(id);
    if (!o) return null;
    outs.delete(id);
    try { fs.closeSync(o.fd); } catch {}
    if (!ok) { try { fs.unlinkSync(o.path); } catch {} return null; }
    written.add(o.path);
    if (o.pack) await hashInto(o.pack, o.path);
    return { path: o.path, size: fs.statSync(o.path).size };
  });
  ipcMain.handle("show-file", (_e, p) => { if (written.has(p)) shell.showItemInFolder(p); });

  // ---- Insurance package: one new folder holding the video, the untouched original clips
  // (decrypted, not re-encoded), a PDF report and SHA-256 fingerprints. Only this folder is
  // ever written, and only clips from the opened TeslaCam folder are copied into it.
  const packs = new Map();   // id -> { dir, hashes: Map(rel -> { size, sha256 }) }
  let packSeq = 0;
  const rel = (pack, p) => path.relative(pack.dir, p).split(path.sep).join("/");
  async function hashInto(pack, p) {
    const h = crypto.createHash("sha256");
    await new Promise((res, rej) => fs.createReadStream(p).on("data", c => h.update(c)).on("end", res).on("error", rej));
    pack.hashes.set(rel(pack, p), { size: fs.statSync(p).size, sha256: h.digest("hex") });
  }
  ipcMain.handle("pack-open", async (_e, name) => {
    let parent = process.env.TCV_TEST_OUT || null;
    if (!parent) {
      const r = await dialog.showOpenDialog(mainWin, { title: tx("packDir"), defaultPath: app.getPath("videos"), properties: ["openDirectory", "createDirectory"] });
      if (r.canceled || !r.filePaths[0]) return null;
      parent = r.filePaths[0];
    }
    const base = String(name || "Tesla").replace(/[\\/:*?"<>|]/g, "_");
    let dir = path.join(parent, base);
    for (let n = 2; fs.existsSync(dir); n++) dir = path.join(parent, `${base} (${n})`);
    fs.mkdirSync(dir);
    const id = ++packSeq;
    packs.set(id, { dir, hashes: new Map() });
    return { id, dir, name: path.basename(dir) };
  });
  // Copy one original clip, decrypting it if needed, and fingerprint it on the way.
  ipcMain.handle("pack-original", async (_e, id, p, sub) => {
    const pack = packs.get(id);
    if (!pack || !inRoot(p)) throw new Error("forbidden");
    const destDir = path.join(pack.dir, String(sub || "originals").replace(/[\\/:*?"<>|.]/g, "_"));
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, path.basename(p));
    const inf = keys.info(p);
    const key = inf.kind === "container" ? keys.keyFor(p) : null;
    if (inf.kind === "container" && !key) throw new Error("locked");
    const total = key ? inf.plainSize : inf.size;
    const h = crypto.createHash("sha256");
    const src = fs.openSync(p, "r"), out = fs.openSync(dest, "w");
    try {
      for (let pos = 0; pos < total;) {
        const e = Math.min(total - 1, pos + 4 * CHUNK - 1);
        let buf;
        if (key) buf = readRange(src, key, total, pos, e);
        else { buf = Buffer.alloc(e - pos + 1); fs.readSync(src, buf, 0, buf.length, pos); }
        fs.writeSync(out, buf); h.update(buf);
        pos = e + 1;
        await new Promise(r => setImmediate(r));   // keep the window responsive
      }
    } finally { fs.closeSync(src); fs.closeSync(out); }
    pack.hashes.set(rel(pack, dest), { size: total, sha256: h.digest("hex") });
    return rel(pack, dest);
  });
  ipcMain.handle("pack-files", (_e, id) => {
    const pack = packs.get(id);
    return pack ? [...pack.hashes].map(([r, v]) => ({ rel: r, ...v })).sort((a, b) => a.rel.localeCompare(b.rel)) : [];
  });
  // The report: an HTML page from the renderer, printed to PDF in a hidden, script-less window.
  ipcMain.handle("pack-pdf", async (_e, id, html, name) => {
    const pack = packs.get(id);
    if (!pack) throw new Error("closed");
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
    try {
      await win.loadURL("data:text/html;charset=utf-8;base64," + Buffer.from(String(html), "utf8").toString("base64"));
      const pdf = await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, margins: { marginType: "none" } });
      const dest = path.join(pack.dir, String(name || "report.pdf").replace(/[\\/:*?"<>|]/g, "_"));
      fs.writeFileSync(dest, pdf);
      await hashInto(pack, dest);
      return rel(pack, dest);
    } finally { win.destroy(); }
  });
  // A small text file in the package (the factual summary), fingerprinted like the rest.
  ipcMain.handle("pack-text", async (_e, id, name, text) => {
    const pack = packs.get(id);
    if (!pack) throw new Error("closed");
    const dest = path.join(pack.dir, String(name || "summary.txt").replace(/[\\/:*?"<>|]/g, "_"));
    fs.writeFileSync(dest, "\ufeff" + String(text), "utf8");   // BOM: Notepad shows the accents right
    await hashInto(pack, dest);
    return rel(pack, dest);
  });
  // SHA256SUMS.txt, in the usual "hash *file" format (checkable with sha256sum -c or certutil).
  ipcMain.handle("pack-sums", (_e, id) => {
    const pack = packs.get(id);
    if (!pack) throw new Error("closed");
    const lines = [...pack.hashes].sort(([a], [b]) => a.localeCompare(b)).map(([r, v]) => `${v.sha256} *${r}`);
    fs.writeFileSync(path.join(pack.dir, "SHA256SUMS.txt"), lines.join("\r\n") + "\r\n");
  });
  ipcMain.handle("pack-close", (_e, id, ok) => {
    const pack = packs.get(id);
    if (!pack) return null;
    packs.delete(id);
    if (!ok) { fs.rmSync(pack.dir, { recursive: true, force: true }); return null; }   // only the folder created above
    written.add(pack.dir);
    return { path: pack.dir };
  });

  // ---- Street and town for a GPS position (insurance mode only, when the car's event.json is
  // not readable): one request to OpenStreetMap's Nominatim, as its usage policy asks
  // (identified app, one call at a time). Nothing else is sent.
  ipcMain.handle("geocode", async (_e, lat, lon, l) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: "bad" };
    if (process.env.TCV_TEST_GEOCODE) return JSON.parse(process.env.TCV_TEST_GEOCODE);
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await net.fetch(u, { signal: ctl.signal, headers: {
        "User-Agent": `DashcamViewerForTesla/${app.getVersion()} (+https://github.com/babysovaz/dashcam-viewer-for-tesla)`,
        "Accept-Language": l === "en" ? "en" : "fr" } });
      if (!r.ok) return { error: "status", status: r.status };
      const a = (await r.json()).address || {};
      return { road: a.road || a.pedestrian || a.path || a.square || null,
        city: a.city || a.town || a.village || a.municipality || a.hamlet || null, postcode: a.postcode || null };
    } catch (e) { return { error: "network" }; }
    finally { clearTimeout(timer); }
  });
  ipcMain.handle("app-version", () => app.getVersion());

  // ---- Licence-plate blurring, fully on this PC. The detector is the MIT-licensed YOLOv9 plate
  // model from github.com/ankandrew/open-image-models: not shipped with the app, downloaded once
  // on first use (8 MB) and checked against its SHA-256. Frames never leave the PC: the renderer
  // sends one 640×640 picture at a time and gets the plate boxes back.
  const PLATE_MODEL = {
    file: "yolo-v9-t-640-license-plates-end2end.onnx",
    url: "https://github.com/ankandrew/open-image-models/releases/download/assets/yolo-v9-t-640-license-plates-end2end.onnx",
    sha256: "c3c1026ca7d0585dd88084d68182dd897113712fa734ae1557ca70174440c076",
  };
  const modelPath = () => path.join(app.getPath("userData"), "models", PLATE_MODEL.file);
  const sha256File = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  let plateSession = null, plateEp = null, plateOrt = null;
  ipcMain.handle("plate-status", () => {
    let ready = false;
    try { ready = fs.existsSync(modelPath()) && sha256File(modelPath()) === PLATE_MODEL.sha256; } catch {}
    return { ready, loaded: !!plateSession, ep: plateEp };
  });
  ipcMain.handle("plate-download", async () => {
    try {
      const r = await net.fetch(PLATE_MODEL.url);
      if (!r.ok) return { error: "status", status: r.status };
      const buf = Buffer.from(await r.arrayBuffer());
      if (crypto.createHash("sha256").update(buf).digest("hex") !== PLATE_MODEL.sha256) return { error: "checksum" };
      fs.mkdirSync(path.dirname(modelPath()), { recursive: true });
      fs.writeFileSync(modelPath(), buf);
      return { ok: true };
    } catch (e) { return { error: "network", message: e.message }; }
  });
  ipcMain.handle("plate-load", async () => {
    if (plateSession) return { ok: true, ep: plateEp };
    if (process.env.TCV_TEST_PLATES) { plateEp = "mock"; plateSession = "mock"; return { ok: true, ep: plateEp }; }
    let ort;
    try { ort = require("onnxruntime-node"); } catch (e) { return { error: "runtime", message: e.message }; }
    // The graphics card through DirectML when Windows offers it, else the processor.
    const tries = process.platform === "win32" ? [["dml"], ["cpu"]] : [["cpu"]];
    for (const executionProviders of tries) {
      try {
        plateSession = await ort.InferenceSession.create(modelPath(), { executionProviders, graphOptimizationLevel: "all" });
        plateEp = executionProviders[0];
        plateOrt = ort;
        return { ok: true, ep: plateEp };
      } catch (e) { if (executionProviders[0] === "cpu") return { error: "load", message: e.message }; }
    }
  });
  // One 640×640 RGBA picture in, plate boxes out ([x1, y1, x2, y2, score] in that picture). The
  // threshold is low on purpose: an extra blurred patch costs nothing, a missed plate does.
  ipcMain.handle("plate-detect", async (_e, rgba) => {
    if (!plateSession) throw new Error("model not loaded");
    if (process.env.TCV_TEST_PLATES) return JSON.parse(process.env.TCV_TEST_PLATES);
    const n = 640 * 640, px = new Uint8Array(rgba.buffer || rgba, rgba.byteOffset || 0, n * 4);
    const x = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { x[i] = px[4 * i] / 255; x[n + i] = px[4 * i + 1] / 255; x[2 * n + i] = px[4 * i + 2] / 255; }
    const out = await plateSession.run({ [plateSession.inputNames[0]]: new plateOrt.Tensor("float32", x, [1, 3, 640, 640]) });
    const o = out[plateSession.outputNames[0]], d = o.data, rows = o.dims[0], cols = o.dims[1];
    const boxes = [];
    for (let r = 0; r < rows; r++) { const b = r * cols; if (d[b + 6] >= 0.15) boxes.push([d[b + 1], d[b + 2], d[b + 3], d[b + 4], d[b + 6]]); }
    return boxes;
  });
  auth.onChange(s => mainWin && mainWin.webContents.send("auth-changed", s));

  createWindow();

  // Automated end-to-end test only (never set in normal use): open a folder, inject known
  // keys for synthetic encrypted clips, and let test/e2e.js drive the UI.
  if (process.env.TCV_TEST_DIR) {
    root = path.resolve(process.env.TCV_TEST_DIR);
    const testKeys = JSON.parse(process.env.TCV_TEST_KEYS || "{}");
    for (const [p, hex] of Object.entries(testKeys)) keys.loadCache().set(keys.info(p).cid, Buffer.from(hex, "hex").toString("base64"));
    mainWin.webContents.once("did-finish-load", () => require(path.join(__dirname, "..", "test", path.basename(process.env.TCV_TEST_SCRIPT || "e2e.js")))(mainWin, scan(root), app));
  }
});
app.on("window-all-closed", () => app.quit());
