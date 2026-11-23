// Builds a synthetic TeslaCam folder with ffmpeg (no real clips needed): one plain Saved
// event and its encrypted twin, each with 6 cameras × 2 short segments at Tesla's sizes.
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

const stamps = ["2026-04-17_15-08-49", `2026-04-17_15-0${8 + 1}-49`];   // two consecutive "minutes"
const plainDir = path.join(OUT, "SavedClips/2026-04-17_15-09-02");
fs.mkdirSync(plainDir, { recursive: true });
stamps.forEach((s, i) => { for (const cam of Object.keys(CAMS)) clip(path.join(plainDir, `${s}-${cam}.mp4`), cam, i + 1); });
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
