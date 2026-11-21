// Per-file key management: header inspection, Tesla key endpoint, encrypted on-disk cache.
// Keys are per clip and never change, so once fetched they are kept (encrypted with Windows
// DPAPI via safeStorage) and the clip plays offline forever after — no new sign-in needed.
"use strict";
const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const c = require("./container");

const API = "https://dashcam.tesla.com/api/1/decrypt/batch";
const BATCH = 20;

let cache = null;          // cacheId -> base64 AES key
const infos = new Map();   // absolute path -> header info

const cacheFile = () => path.join(app.getPath("userData"), "keys.bin");

function loadCache() {
  if (cache) return cache;
  cache = new Map();
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const json = safeStorage.decryptString(fs.readFileSync(cacheFile()));
      for (const [k, v] of Object.entries(JSON.parse(json))) cache.set(k, v);
    }
  } catch { /* no cache yet, or unreadable: start empty */ }
  return cache;
}
function saveCache() {
  // Never write keys in clear: without OS encryption they simply stay in memory.
  if (!safeStorage.isEncryptionAvailable()) return;
  fs.writeFileSync(cacheFile(), safeStorage.encryptString(JSON.stringify(Object.fromEntries(loadCache()))));
}
function clearCache() {
  cache = new Map();
  try { fs.unlinkSync(cacheFile()); } catch {}
}

function info(p) {
  let i = infos.get(p);
  if (i) return i;
  const size = fs.statSync(p).size;
  const head = c.readHead(p);
  const kind = c.classify(head, size);
  i = { kind, size };
  if (kind === "container") {
    i.plainSize = Number(head.readBigUInt64BE(0));
    i.id = c.correlationId(head);
    i.escrow = c.parseEscrow(head);
    i.cid = i.escrow ? c.cacheId(i.escrow) : null;
  }
  infos.set(p, i);
  return i;
}

function keyFor(p) {
  const i = info(p);
  if (i.kind !== "container" || !i.cid) return null;
  const k = loadCache().get(i.cid);
  return k ? Buffer.from(k, "base64") : null;
}

const kindOf = p => /\.mp4$/i.test(p) ? "mp4" : /\.png$/i.test(p) ? "png" : /\.json$/i.test(p) ? "json" : "other";

/** Ask Tesla for the keys of the given clips. Throws {status:401} when the token is dead. */
async function fetchKeys(paths, token) {
  const todo = [];
  const res = { unlocked: 0, already: 0, noEscrow: 0, failed: [] };
  for (const p of paths) {
    let i;
    try { i = info(p); } catch { res.failed.push([p, "unreadable"]); continue; }
    if (i.kind !== "container") continue;
    if (!i.escrow) { res.noEscrow++; continue; }
    if (loadCache().has(i.cid)) { res.already++; continue; }
    todo.push(p);
  }
  // The correlation id is not unique (two clips of the same size share it): never put two
  // equal ids in one batch, defer the duplicate to a later batch instead.
  while (todo.length) {
    const batch = [], ids = new Set();
    for (let k = 0; k < todo.length && batch.length < BATCH; ) {
      const id = info(todo[k]).id;
      if (ids.has(id)) { k++; continue; }
      ids.add(id); batch.push(todo.splice(k, 1)[0]);
    }
    const items = batch.map(p => {
      const { id, escrow: e } = info(p);
      const item = { id, vin: e.vin, key_id: e.keyId, wrapped_key: e.wrappedKey, public_key: e.publicKey };
      if (e.timestamp !== 0n) item.timestamp = `__TS_${e.timestamp}__`;
      return item;
    });
    // The timestamp is a uint64: write it as a raw JSON number without float rounding.
    const body = JSON.stringify({ items }).replace(/"__TS_(\d+)__"/g, "$1");
    const r = await fetch(API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/json",
        "Origin": "https://dashcam.tesla.com", "Referer": "https://dashcam.tesla.com/",
      },
      body,
    });
    if (r.status === 401 || r.status === 403) { const err = new Error("token"); err.status = 401; throw err; }
    if (!r.ok) { const err = new Error(`Tesla replied ${r.status}`); err.code = "status"; err.httpStatus = r.status; throw err; }
    const json = await r.json();
    const byId = new Map((json.results || []).map(x => [x.id, x]));
    for (const p of batch) {
      const i = info(p), out = byId.get(i.id);
      if (!out || out.error || !out.key) { res.failed.push([p, (out && out.error) || "nokey"]); continue; }
      const key = Buffer.from(out.key, "base64");
      if (key.length !== 16 || !c.keyLooksRight(p, key, kindOf(p))) { res.failed.push([p, "badkey"]); continue; }
      loadCache().set(i.cid, key.toString("base64"));
      res.unlocked++;
    }
    saveCache();
  }
  return res;
}

module.exports = { info, keyFor, fetchKeys, clearCache, loadCache };
