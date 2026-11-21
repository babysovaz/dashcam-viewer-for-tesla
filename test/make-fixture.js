// Builds a fake TeslaCam folder from the user's real (plain) clips: one plain event, one
// encrypted event whose key we know, and one encrypted event whose key we don't.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const c = require("../src/container");

// Point TCV_SAMPLES at a TeslaCam folder holding the sample clips used by the tests.
const U = process.env.TCV_SAMPLES || "samples/TeslaCam";
const OUT = "/tmp/tcv-fixture/TeslaCam";
fs.rmSync("/tmp/tcv-fixture", { recursive: true, force: true });
const realEnc = execSync(`ls ${U}/EncryptedClips/SavedClips/*/*.mp4`).toString().trim().split("\n")[0];
const escrow = c.readHead(realEnc).subarray(4096, 8192);
const src = `${U}/SavedClips/2026-04-17_15-09-02`;

const plainDir = path.join(OUT, "SavedClips/2026-04-17_15-09-02");
fs.mkdirSync(plainDir, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(plainDir, f));

const keys = {};
function encEvent(folder, stamp, escrowPage, key) {
  const d = path.join(OUT, "EncryptedClips/SavedClips", folder);
  fs.mkdirSync(d, { recursive: true });
  for (const cam of ["front", "back"]) {
    const p = path.join(d, `${stamp}-${cam}.mp4`);
    fs.writeFileSync(p, c.encryptForTest(fs.readFileSync(`${src}/2026-04-17_15-08-49-${cam}.mp4`), key, escrowPage));
    if (key.known) keys[p] = key.toString("hex");
  }
  const j = path.join(d, "event.json");
  fs.writeFileSync(j, c.encryptForTest(Buffer.from(JSON.stringify({ timestamp: stamp.replace(/_(\d\d)-(\d\d)-(\d\d)$/, "T$1:$2:$3"), city: "Testville", street: "Rue du Test", reason: "sentry_aware_object_detection" })), key, escrowPage));
  if (key.known) keys[j] = key.toString("hex");
}
// Same escrow page => same cache id for every file of the event, so one known key unlocks it.
const k1 = crypto.randomBytes(16); k1.known = true;
encEvent("2026-11-07_15-30-21", "2026-11-07_15-30-03", escrow, k1);
// Different wrapped key => different cache id => stays locked.
const other = Buffer.from(escrow); other[0x5e] ^= 0xff;
encEvent("2026-11-08_10-00-00", "2026-11-08_09-59-50", other, crypto.randomBytes(16));
// A real driving clip (with telemetry), plain and encrypted with a known key.
const drive = `${U}/SavedClips/2026-04-25_18-40-49`;
const pd = path.join(OUT, "SavedClips/2026-04-25_18-40-49"); fs.mkdirSync(pd, { recursive: true });
fs.copyFileSync(`${drive}/2026-04-25_18-39-40-front.mp4`, `${pd}/2026-04-25_18-39-40-front.mp4`);
fs.copyFileSync(`${drive}/event.json`, `${pd}/event.json`);
const ed = path.join(OUT, "EncryptedClips/SentryClips/2026-11-18_16-40-44"); fs.mkdirSync(ed, { recursive: true });
const k3 = crypto.randomBytes(16);
const esc3 = Buffer.from(escrow); esc3[0x5e] ^= 0x0f;
const ef = `${ed}/2026-11-18_16-39-40-front.mp4`;
fs.writeFileSync(ef, c.encryptForTest(fs.readFileSync(`${drive}/2026-04-25_18-39-40-front.mp4`), k3, esc3));
keys[ef] = k3.toString("hex");
fs.writeFileSync("/tmp/tcv-fixture/keys.json", JSON.stringify(keys));
console.log("fixture ready:", Object.keys(keys).length, "known-key files");
