// Builds a synthetic TeslaCam folder with ffmpeg (no real clips needed): one plain Saved
// event and its encrypted twin, each with 6 cameras × 2 short segments at Tesla's sizes,
// carrying Tesla-like telemetry (SEI) in every frame.
// Used by the export end-to-end test.  Usage: node test/make-synthetic.js [seconds per segment]
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const c = require("../src/container");

const SEG = Number(process.argv[2] || 6);
const OUT = "/tmp/tcv-synth/TeslaCam";
fs.rmSync("/tmp/tcv-synth", { recursive: true, force: true });

const CAMS = { front: [2896, 1876], back: [1448, 938], left_pillar: [1448, 938], right_pillar: [1448, 938], left_repeater: [1448, 938], right_repeater: [1448, 938] };
const COLORS = { front: "red", back: "blue", left_pillar: "green", right_pillar: "yellow", left_repeater: "magenta", right_repeater: "cyan" };

function clip(file, cam, segNo) {
  const [w, h] = CAMS[cam];
  // A moving test pattern with the camera name and a big frame counter, so tile placement
  // and synchronisation can be checked on the exported video.
  const txt = `drawtext=text='${cam} s${segNo} %{frame_num}':fontcolor=white:fontsize=${Math.round(h / 8)}:box=1:boxcolor=${COLORS[cam]}@0.8:x=(w-tw)/2:y=(h-th)/2`;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=36:duration=${SEG}`,
    "-vf", txt, "-c:v", "libx264", "-profile:v", "high", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "36", file]);
}

// ---- Tesla-like telemetry: one SEI "user data" NAL before the picture of every frame, holding
// the dashcam.proto message, exactly where the car puts it. ffmpeg cannot place it there, so the
// MP4 is rewritten here: new sample sizes (stsz) and chunk offsets (stco), same everything else.
function protobuf(m) {
  const out = [];
  const varint = v => { v = BigInt(v); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v); };
  const tag = (f, w) => varint((f << 3) | w);
  const f32 = (f, v) => { tag(f, 5); const b = Buffer.alloc(4); b.writeFloatLE(v); out.push(...b); };
  const f64 = (f, v) => { tag(f, 1); const b = Buffer.alloc(8); b.writeDoubleLE(v); out.push(...b); };
  tag(1, 0); varint(1); tag(2, 0); varint(m.gear); tag(3, 0); varint(m.seq);
  f32(4, m.speed); f32(5, m.accel); f32(6, m.steer);
  tag(7, 0); varint(m.blinkL ? 1 : 0); tag(8, 0); varint(m.blinkR ? 1 : 0); tag(9, 0); varint(m.brake ? 1 : 0);
  tag(10, 0); varint(m.ap);
  f64(11, m.lat); f64(12, m.lon); f64(13, m.heading); f64(14, m.ax); f64(15, m.ay); f64(16, m.az);
  return Buffer.from(out);
}
function seiNal(m) {
  const payload = Buffer.concat([Buffer.from([0x42, 0x42, 0x42, 0x69]), protobuf(m)]);
  const raw = Buffer.concat([Buffer.from([0x05, payload.length]), payload, Buffer.from([0x80])]);
  const rbsp = [0x06];   // NAL header: SEI, then the payload with emulation prevention bytes
  let zeros = 0;
  for (const b of raw) { if (zeros >= 2 && b <= 3) { rbsp.push(3); zeros = 0; } rbsp.push(b); zeros = b === 0 ? zeros + 1 : 0; }
  const n = Buffer.from(rbsp), len = Buffer.alloc(4);
  len.writeUInt32BE(n.length);
  return Buffer.concat([len, n]);
}
function boxesOf(buf, start, end) {
  const out = [];
  for (let p = start; p + 8 <= end;) { const size = buf.readUInt32BE(p); out.push({ type: buf.toString("latin1", p + 4, p + 8), p, size }); if (size < 8) break; p += size; }
  return out;
}
const child = (buf, box, type) => boxesOf(buf, box.p + 8, box.p + box.size).find(b => b.type === type);
function addTelemetry(file, frameData) {
  const buf = fs.readFileSync(file);
  const top = boxesOf(buf, 0, buf.length), mdat = top.find(b => b.type === "mdat"), moovBox = top.find(b => b.type === "moov");
  const moov = Buffer.from(buf.subarray(moovBox.p, moovBox.p + moovBox.size));
  const mv = { p: 0, size: moov.length };
  const stbl = ["trak", "mdia", "minf", "stbl"].reduce((b, t) => child(moov, b, t), mv);
  const stsz = child(moov, stbl, "stsz"), stco = child(moov, stbl, "stco"), stsc = child(moov, stbl, "stsc");
  const n = moov.readUInt32BE(stsz.p + 16), fixed = moov.readUInt32BE(stsz.p + 12);
  if (fixed) throw new Error("fixed sample size: not handled");
  const sizes = Array.from({ length: n }, (_, i) => moov.readUInt32BE(stsz.p + 20 + 4 * i));
  const nc = moov.readUInt32BE(stco.p + 12), chunks = Array.from({ length: nc }, (_, i) => moov.readUInt32BE(stco.p + 16 + 4 * i));
  const ne = moov.readUInt32BE(stsc.p + 12), runs = Array.from({ length: ne }, (_, i) => [moov.readUInt32BE(stsc.p + 16 + 12 * i) - 1, moov.readUInt32BE(stsc.p + 20 + 12 * i)]);
  const firstOfChunk = [];   // sample index that starts each chunk
  let sIdx = 0;
  runs.forEach(([first, per], r) => { const last = r + 1 < runs.length ? runs[r + 1][0] : nc; for (let ch = first; ch < last; ch++) { firstOfChunk[ch] = sIdx; sIdx += per; } });
  const offsets = []; // original sample offsets
  for (let ch = 0, s = 0; ch < nc; ch++) { let off = chunks[ch]; const end = ch + 1 < nc ? firstOfChunk[ch + 1] : n; for (; s < end; s++) { offsets[s] = off; off += sizes[s]; } }
  const parts = [], newStart = [];
  let pos = mdat.p + 8;
  for (let i = 0; i < n; i++) {
    const sample = Buffer.concat([seiNal(frameData(i)), buf.subarray(offsets[i], offsets[i] + sizes[i])]);
    newStart[i] = pos; pos += sample.length; parts.push(sample);
    moov.writeUInt32BE(sample.length, stsz.p + 20 + 4 * i);
  }
  for (let ch = 0; ch < nc; ch++) moov.writeUInt32BE(newStart[firstOfChunk[ch]], stco.p + 16 + 4 * ch);
  const body = Buffer.concat(parts), hdr = Buffer.alloc(8);
  hdr.writeUInt32BE(body.length + 8); hdr.write("mdat", 4, "latin1");
  // moov keeps its size, so whether it sits before or after mdat the new offsets hold.
  const before = Buffer.from(buf.subarray(0, mdat.p)), after = Buffer.from(buf.subarray(mdat.p + mdat.size));
  if (moovBox.p < mdat.p) moov.copy(before, moovBox.p); else moov.copy(after, moovBox.p - mdat.p - mdat.size);
  fs.writeFileSync(file, Buffer.concat([before, hdr, body, after]));
}
// A short drive: 72 km/h, FSD on; hard braking at 2–3.5 s of the first clip, a knock at 4.5 s,
// FSD switched off at 5 s. Accelerometer with gravity on z, as a real sensor may report it.
function drive(segNo) {
  return i => {
    const t = i / 36 + (segNo - 1) * SEG;
    let speed = 20;
    if (t >= 2 && t < 3.5) speed = 20 - 5.3 * (t - 2); else if (t >= 3.5) speed = 12;
    const knock = t >= 4.5 && t < 4.6 ? 16 : 0;
    return { seq: i, gear: 1, speed, accel: t < 2 ? 0.2 : 0, steer: 3, blinkL: false, blinkR: t > 5, brake: t >= 2 && t < 3.5,
      ap: t < 5 ? 1 : 0, lat: 48.9876 + t * 1e-4, lon: 2.7123 + t * 1e-4, heading: 45, ax: 0.1, ay: knock, az: 9.81 };
  };
}

const stamps = ["2026-04-17_15-08-49", `2026-04-17_15-0${8 + 1}-49`];   // two consecutive "minutes"
const plainDir = path.join(OUT, "SavedClips/2026-04-17_15-09-02");
fs.mkdirSync(plainDir, { recursive: true });
stamps.forEach((s, i) => { for (const cam of Object.keys(CAMS)) {
  const f = path.join(plainDir, `${s}-${cam}.mp4`);
  clip(f, cam, i + 1);
  addTelemetry(f, drive(i + 1));
} });
fs.writeFileSync(path.join(plainDir, "event.json"), JSON.stringify({ timestamp: "2026-04-17T15:08:53", city: "Testville", street: "Rue du Test", reason: "user_interaction_honk" }));

// Encrypted twin with a synthetic key-escrow page (same layout as the car's) and a known key.
const esc = Buffer.alloc(4096);
let o = 0;
esc.writeUInt32BE(7, o); o += 4;
esc[o] = 0x04; crypto.randomBytes(64).map(b => b || 1).forEach((b, i) => { esc[o + 1 + i] = b; }); o += 65;
esc.write("TESTVIN0000000001", o, "latin1"); o += 17;
esc.writeBigUInt64BE(1763000000000n, o); o += 8;
crypto.randomBytes(44).copy(esc, o);
const key = crypto.randomBytes(16);
const encDir = path.join(OUT, "EncryptedClips/SavedClips/2026-11-07_15-39-02");
fs.mkdirSync(encDir, { recursive: true });
const keys = {};
for (const f of fs.readdirSync(plainDir).filter(f => f.endsWith(".mp4"))) {
  const p = path.join(encDir, f.replace("2026-04-17_15-0", "2026-11-07_15-3"));
  fs.writeFileSync(p, c.encryptForTest(fs.readFileSync(path.join(plainDir, f)), key, esc));
  keys[p] = key.toString("hex");
}
fs.writeFileSync("/tmp/tcv-synth/keys.json", JSON.stringify(keys));
console.log("synthetic fixture ready in", OUT);
