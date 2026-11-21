// Offline check of src/telemetry.js on a real plain clip and on its synthetic encrypted twin.
"use strict";
const fs = require("fs");
const crypto = require("crypto");
const tel = require("../src/telemetry.js");
const c = require("../src/container.js");

const P = (process.env.TCV_SAMPLES || "samples/TeslaCam") + "/SavedClips/2026-04-25_18-40-49/2026-04-25_18-39-40-front.mp4";
let t0 = Date.now();
const a = tel.extract(P);
console.log("plain clip: frames with telemetry", a.length, "in", Date.now() - t0, "ms");
if (a.length) {
  console.log("first:", JSON.stringify(a[0]));
  console.log("last:", JSON.stringify(a[a.length - 1]));
  const sp = a.map(x => x.speed * 3.6);
  console.log("speed km/h min/max:", Math.min(...sp).toFixed(1), Math.max(...sp).toFixed(1), "| gears seen:", [...new Set(a.map(x => x.gear))]);
}
const buf = fs.readFileSync(P);
const key = crypto.randomBytes(16);
fs.writeFileSync("/tmp/tcv-enc-front.mp4", c.encryptForTest(buf, key, null));
t0 = Date.now();
const b = tel.extract("/tmp/tcv-enc-front.mp4", key, buf.length);
console.log("encrypted twin:", b.length, "frames in", Date.now() - t0, "ms | identical:", JSON.stringify(a) === JSON.stringify(b));
