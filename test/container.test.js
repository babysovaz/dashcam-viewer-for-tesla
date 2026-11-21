// Offline checks for src/container.js — no network, no Tesla account involved.
"use strict";
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");
const c = require("../src/container.js");

// Point TCV_SAMPLES at a TeslaCam folder holding the sample clips used by the tests.
const U = process.env.TCV_SAMPLES || "samples/TeslaCam";
const encPath = execSync(`ls ${U}/EncryptedClips/SavedClips/*/*.mp4`).toString().trim().split("\n")[0];
const plainPath = `${U}/SavedClips/2026-04-17_15-09-02/2026-04-17_15-08-49-back.mp4`;

// 1. The real encrypted clip from the user's drive parses as a container with escrow metadata.
const head = c.readHead(encPath);
const e = c.parseEscrow(head);
console.log("real clip:", c.classify(head, fs.statSync(encPath).size),
  "| keyId", e.keyId, "| pubkey", Buffer.from(e.publicKey, "base64").length, "B",
  "| vin length", e.vin.length, "| timestamp", e.timestamp.toString(),
  "| wrapped", Buffer.from(e.wrappedKey, "base64").length, "B");

// 2. A plain MP4 is recognised as plain.
console.log("plain clip:", c.classify(c.readHead(plainPath), fs.statSync(plainPath).size));

// 3. Round trip: encrypt a real MP4 with a random key, then decrypt arbitrary ranges.
const plain = fs.readFileSync(plainPath);
const key = crypto.randomBytes(16);
const ct = c.encryptForTest(plain, key, head.subarray(4096, 8192));
const synth = "/tmp/tcv-synth.mp4";
fs.writeFileSync(synth, ct);
console.log("synthetic:", c.classify(c.readHead(synth), ct.length),
  "| right key", c.keyLooksRight(synth, key, "mp4"),
  "| wrong key rejected", !c.keyLooksRight(synth, Buffer.alloc(16), "mp4"));
const fd = fs.openSync(synth, "r");
let ok = true;
for (const [s, t] of [[0, 99], [4090, 4200], [123456, 1234567], [plain.length - 5000, plain.length + 999]]) {
  ok = ok && c.readRange(fd, key, plain.length, s, t).equals(plain.subarray(s, Math.min(t, plain.length - 1) + 1));
}
fs.closeSync(fd);
console.log("range decryption matches original:", ok);
