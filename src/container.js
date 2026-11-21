// Tesla 2026.20+ encrypted dashcam container (eCryptfs-style).
// Layout, cross-checked against two independent open-source decryptors:
//   page 0 (0x0000): u64 BE plaintext size, magic pair at 8..16 (m1 ^ m2 = 0x3C81B7F5),
//                    u32 version/flags = 0x03000002 at 16, u32 page size = 4096 at 20,
//                    16-byte correlation id at 4..20 (overlaps the size field).
//   page 1 (0x1000): key-escrow metadata: u32 key_id, EC public key (~65 B, starts 0x04),
//                    17-byte VIN, u64 timestamp, 44-byte wrapped key.
//   0x2000+        : AES-128-CBC payload in independent 4096-byte pages.
// Per-page IV = MD5( MD5(fileKey) || ascii(pageIndex) zero-padded to 32 bytes ), pages
// numbered from 0 after the header. Pages being independent is what lets us decrypt any
// byte range on demand, so video seeking never needs the whole file in clear.
"use strict";
const fs = require("fs");
const crypto = require("crypto");

const PAGE = 4096;
const HEADER = 2 * PAGE;
const MAGIC = 0x3c81b7f5;
const VERSION_FLAGS = 0x03000002;
const FULL_PUBKEY_LEN = 65;
const VIN_LEN = 17;
const WRAPPED_KEY_LEN = 44;

function readHead(path) {
  const fd = fs.openSync(path, "r");
  try {
    const buf = Buffer.alloc(HEADER);
    const n = fs.readSync(fd, buf, 0, HEADER, 0);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

/** 'plain' (regular readable file), 'container' (valid encrypted clip) or 'corrupt'. */
function classify(head, fileSize) {
  if (head.length < 24) return "plain";
  if (((head.readUInt32BE(8) ^ head.readUInt32BE(12)) >>> 0) !== MAGIC) return "plain";
  // From here the file claims to be a container: any failed check means damaged, never plain.
  if (fileSize < HEADER || fileSize % PAGE !== 0 || head.length < HEADER) return "corrupt";
  if (head.readUInt32BE(16) !== VERSION_FLAGS || head.readUInt32BE(20) !== PAGE) return "corrupt";
  const size = head.readBigUInt64BE(0);
  if (size <= 0n || size > BigInt(fileSize - HEADER)) return "corrupt";
  return "container";
}

function correlationId(head) {
  const h = head.subarray(4, 20).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Escrow metadata needed by the key endpoint, or null if the car did not escrow this file. */
function parseEscrow(head) {
  const E = PAGE;
  if (head.length < HEADER || head.subarray(E, E + 16).every(b => b === 0)) return null;
  let cur = E;
  const keyId = head.readUInt32BE(cur); cur += 4;
  // Tesla's viewer scans for the public key length: a leading zero byte may be trimmed,
  // so the VIN/timestamp boundary is located (zero byte after the VIN) instead of assumed.
  let tsStart = cur + FULL_PUBKEY_LEN;
  const tsMax = tsStart + VIN_LEN;
  while (tsStart <= tsMax && head[tsStart] !== 0) tsStart++;
  let pubLen = (tsStart <= tsMax && head[tsStart] === 0) ? tsStart - VIN_LEN - cur : FULL_PUBKEY_LEN;
  if (pubLen < FULL_PUBKEY_LEN - 8 || pubLen > FULL_PUBKEY_LEN || head[cur] !== 0x04) pubLen = FULL_PUBKEY_LEN;
  const publicKey = head.subarray(cur, cur + pubLen); cur += pubLen;
  const vin = head.subarray(cur, cur + VIN_LEN).toString("latin1").replace(/\0+$/, ""); cur += VIN_LEN;
  const timestamp = head.readBigUInt64BE(cur); cur += 8;
  const wrappedKey = head.subarray(cur, cur + WRAPPED_KEY_LEN);
  if (!vin || vin[0] === "\0" || publicKey[0] !== 0x04 || wrappedKey.length !== WRAPPED_KEY_LEN) return null;
  return {
    keyId, vin, timestamp,
    publicKey: publicKey.toString("base64"),
    wrappedKey: wrappedKey.toString("base64"),
  };
}

/** Stable cache id for a file's key: the wrapped key is unique per file. */
function cacheId(escrow) {
  return crypto.createHash("sha256").update(escrow.wrappedKey).update("|").update(escrow.publicKey).digest("hex").slice(0, 32);
}

function pageIv(rootIv, n) {
  const material = Buffer.alloc(32);
  rootIv.copy(material, 0);
  material.write(String(n), 16, "ascii");
  return crypto.createHash("md5").update(material).digest();
}

function decryptPage(key, rootIv, n, enc) {
  const d = crypto.createDecipheriv("aes-128-cbc", key, pageIv(rootIv, n));
  d.setAutoPadding(false);
  return Buffer.concat([d.update(enc), d.final()]);
}

/**
 * Decrypt plaintext bytes [start, end] (inclusive) of an encrypted clip.
 * Only the pages covering the range are read and decrypted.
 */
function readRange(fd, key, plainSize, start, end) {
  end = Math.min(end, plainSize - 1);
  if (start > end) return Buffer.alloc(0);
  const rootIv = crypto.createHash("md5").update(key).digest();
  const p0 = Math.floor(start / PAGE), p1 = Math.floor(end / PAGE);
  const enc = Buffer.alloc((p1 - p0 + 1) * PAGE);
  const n = fs.readSync(fd, enc, 0, enc.length, HEADER + p0 * PAGE);
  if (n !== enc.length) throw new Error("truncated encrypted page");
  const out = Buffer.alloc(enc.length);
  for (let p = p0; p <= p1; p++) {
    const o = (p - p0) * PAGE;
    decryptPage(key, rootIv, p, enc.subarray(o, o + PAGE)).copy(out, o);
  }
  return out.subarray(start - p0 * PAGE, end - p0 * PAGE + 1);
}

/** A wrong key decrypts to noise: a real MP4 has 'ftyp' at offset 4 of page 0. */
function keyLooksRight(path, key, kind) {
  const fd = fs.openSync(path, "r");
  try {
    const first = readRange(fd, key, PAGE, 0, 15);
    if (kind === "mp4") return first.subarray(4, 8).toString("latin1") === "ftyp";
    if (kind === "png") return first.subarray(1, 4).toString("latin1") === "PNG";
    if (kind === "json") return /^\s*[{[]/.test(first.toString("latin1"));
    return true;
  } finally { fs.closeSync(fd); }
}

/** Build an encrypted container from plaintext — test helper mirroring the decrypt path. */
function encryptForTest(plain, key, escrowPage) {
  const rootIv = crypto.createHash("md5").update(key).digest();
  const pages = Math.ceil(plain.length / PAGE);
  const out = Buffer.alloc(HEADER + pages * PAGE);
  out.writeBigUInt64BE(BigInt(plain.length), 0);
  out.writeUInt32BE(0x12345678, 8); out.writeUInt32BE((0x12345678 ^ MAGIC) >>> 0, 12);
  out.writeUInt32BE(VERSION_FLAGS, 16); out.writeUInt32BE(PAGE, 20);
  if (escrowPage) escrowPage.copy(out, PAGE);
  for (let p = 0; p < pages; p++) {
    const chunk = Buffer.alloc(PAGE); plain.copy(chunk, 0, p * PAGE, Math.min(plain.length, (p + 1) * PAGE));
    const c = crypto.createCipheriv("aes-128-cbc", key, pageIv(rootIv, p)); c.setAutoPadding(false);
    Buffer.concat([c.update(chunk), c.final()]).copy(out, HEADER + p * PAGE);
  }
  return out;
}

module.exports = { PAGE, HEADER, readHead, classify, correlationId, parseEscrow, cacheId, readRange, keyLooksRight, encryptForTest };
