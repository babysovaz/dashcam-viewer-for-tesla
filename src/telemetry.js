// Telemetry ("SEI") embedded by Tesla in each video frame (firmware 2025.44.25+, HW3+).
// Format published by Tesla: github.com/teslamotors/dashcam (dashcam.proto, dashcam-mp4.js).
// Instead of walking the whole mdat like Tesla's sample code, we read the MP4 sample table
// and only fetch the first bytes of each frame, where the SEI NAL sits — a few pages per
// frame instead of decrypting ~80 MB per minute of video.
"use strict";
const fs = require("fs");
const { readRange } = require("./container");

/** Random-access reader over a plain or encrypted clip. */
function reader(p, key, plainSize) {
  const fd = fs.openSync(p, "r");
  const size = key ? plainSize : fs.fstatSync(fd).size;
  const read = (off, len) => {
    len = Math.max(0, Math.min(len, size - off));
    if (!len) return Buffer.alloc(0);
    if (key) return readRange(fd, key, size, off, off + len - 1);
    const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); return b;
  };
  return { size, read, close: () => fs.closeSync(fd) };
}

function* boxes(buf, start, end) {
  for (let pos = start; pos + 8 <= end;) {
    let size = buf.readUInt32BE(pos), hdr = 8;
    const type = buf.toString("latin1", pos + 4, pos + 8);
    if (size === 1) { size = Number(buf.readBigUInt64BE(pos + 8)); hdr = 16; }
    else if (size === 0) size = end - pos;
    if (size < hdr) return;
    yield { type, start: pos + hdr, end: Math.min(pos + size, end) };
    pos += size;
  }
}
const find = (buf, s, e, type) => { for (const b of boxes(buf, s, e)) if (b.type === type) return b; return null; };

/** Locate the moov box via top-level headers only (it is often after the huge mdat). */
function readMoov(r) {
  for (let pos = 0; pos + 8 <= r.size;) {
    const h = r.read(pos, 16);
    let size = h.readUInt32BE(0);
    const type = h.toString("latin1", 4, 8);
    if (size === 1) size = Number(h.readBigUInt64BE(8));
    else if (size === 0) size = r.size - pos;
    if (type === "moov") return r.read(pos, size);
    if (size < 8) break;
    pos += size;
  }
  return null;
}

/** Sample offsets and timestamps of the first video track. */
function sampleTable(moov) {
  const m = find(moov, 8, moov.length, "trak") && moov;
  if (!m) return null;
  for (const trak of boxes(moov, 8, moov.length)) {
    if (trak.type !== "trak") continue;
    const mdia = find(moov, trak.start, trak.end, "mdia"); if (!mdia) continue;
    const hdlr = find(moov, mdia.start, mdia.end, "hdlr");
    if (!hdlr || moov.toString("latin1", hdlr.start + 8, hdlr.start + 12) !== "vide") continue;
    const mdhd = find(moov, mdia.start, mdia.end, "mdhd");
    const timescale = moov[mdhd.start] === 1 ? moov.readUInt32BE(mdhd.start + 20) : moov.readUInt32BE(mdhd.start + 12);
    const minf = find(moov, mdia.start, mdia.end, "minf");
    const stbl = find(moov, minf.start, minf.end, "stbl");
    const get = t => find(moov, stbl.start, stbl.end, t);
    const stsz = get("stsz"), stsc = get("stsc"), stts = get("stts"), stco = get("stco"), co64 = get("co64");
    // sizes
    const fixed = moov.readUInt32BE(stsz.start + 4), n = moov.readUInt32BE(stsz.start + 8);
    const sizes = new Array(n);
    for (let i = 0; i < n; i++) sizes[i] = fixed || moov.readUInt32BE(stsz.start + 12 + 4 * i);
    // chunk offsets
    const co = stco || co64, nc = moov.readUInt32BE(co.start + 4), chunks = new Array(nc);
    for (let i = 0; i < nc; i++) chunks[i] = stco ? moov.readUInt32BE(co.start + 8 + 4 * i) : Number(moov.readBigUInt64BE(co.start + 8 + 8 * i));
    // samples per chunk
    const ne = moov.readUInt32BE(stsc.start + 4), runs = [];
    for (let i = 0; i < ne; i++) { const o = stsc.start + 8 + 12 * i; runs.push([moov.readUInt32BE(o) - 1, moov.readUInt32BE(o + 4)]); }
    const offsets = new Array(n);
    let s = 0;
    for (let r = 0; r < runs.length && s < n; r++) {
      const [first, per] = runs[r], last = r + 1 < runs.length ? runs[r + 1][0] : nc;
      for (let ch = first; ch < last && s < n; ch++) {
        let off = chunks[ch];
        for (let k = 0; k < per && s < n; k++, s++) { offsets[s] = off; off += sizes[s]; }
      }
    }
    // timestamps
    const times = new Array(n);
    let t = 0, i = 0;
    const nt = moov.readUInt32BE(stts.start + 4);
    for (let e = 0; e < nt; e++) {
      const count = moov.readUInt32BE(stts.start + 8 + 8 * e), delta = moov.readUInt32BE(stts.start + 12 + 8 * e);
      for (let k = 0; k < count && i < n; k++, i++) { times[i] = t / timescale; t += delta; }
    }
    return { offsets, sizes, times, n };
  }
  return null;
}

function stripEmulation(b) {
  const out = []; let zeros = 0;
  for (const x of b) { if (zeros >= 2 && x === 3) { zeros = 0; continue; } out.push(x); zeros = x === 0 ? zeros + 1 : 0; }
  return Buffer.from(out);
}

/** Minimal protobuf decoder for SeiMetadata (dashcam.proto). */
function decodeSei(buf) {
  const o = {}; let i = 0;
  const varint = () => { let r = 0n, sh = 0n; for (;;) { const b = buf[i++]; r |= BigInt(b & 0x7f) << sh; if (!(b & 0x80)) return r; sh += 7n; } };
  while (i < buf.length) {
    const tag = Number(varint()), f = tag >>> 3, w = tag & 7;
    if (w === 0) o[f] = Number(varint());
    else if (w === 5) { o[f] = buf.readFloatLE(i); i += 4; }
    else if (w === 1) { o[f] = buf.readDoubleLE(i); i += 8; }
    else if (w === 2) { const l = Number(varint()); i += l; }
    else break;
  }
  return {
    gear: o[2] ?? 0, speed: o[4] ?? 0, accel: o[5] ?? 0, steer: o[6] ?? 0,
    blinkL: !!o[7], blinkR: !!o[8], brake: !!o[9], ap: o[10] ?? 0,
    lat: o[11], lon: o[12], heading: o[13],
    // Linear acceleration in m/s² (fields 14-16). Tesla does not document the axes or whether
    // gravity is included, so the app only uses deviations from each clip's usual value.
    ax: o[14], ay: o[15], az: o[16],
  };
}

/** Find Tesla's SEI (NAL type 6, payload 5, 0x42…0x69 marker) among the frame's first NALs. */
function seiInSample(head) {
  for (let p = 0; p + 5 <= head.length;) {
    const len = head.readUInt32BE(p), nal = p + 4;
    if (len < 2) return null;
    const type = head[nal] & 0x1f;
    if (type === 6 && head[nal + 1] === 5) {
      const n = head.subarray(nal, Math.min(head.length, nal + len));
      let i = 3;
      while (i < n.length && n[i] === 0x42) i++;
      if (i <= 3 || i + 1 >= n.length || n[i] !== 0x69) return null;
      try { return decodeSei(stripEmulation(n.subarray(i + 1, n.length - 1))); } catch { return null; }
    }
    if (type === 1 || type === 5) return null;   // reached the picture itself: no SEI for this frame
    p = nal + len;
  }
  return null;
}

/** Telemetry samples [{t, ...}] for a clip, or [] if the clip carries none. */
function extract(p, key, plainSize) {
  const r = reader(p, key, plainSize);
  try {
    const moov = readMoov(r);
    if (!moov) return [];
    const st = sampleTable(moov);
    if (!st) return [];
    const out = [];
    for (let i = 0; i < st.n; i++) {
      const sei = seiInSample(r.read(st.offsets[i], Math.min(st.sizes[i], 1024)));
      if (sei) { sei.t = st.times[i]; out.push(sei); }
    }
    return out;
  } finally { r.close(); }
}

module.exports = { extract, decodeSei };
