// Unit test of renderer/analysis.js on a synthetic drive (no clips needed): node test/analysis.test.js
"use strict";
const assert = require("assert");
const A = require("../renderer/analysis.js");

// 60 s at 36 fps. Accelerometer with gravity on z (+ small noise), like a real sensor might be.
const fps = 36, s = [];
let heading = 90;
for (let i = 0; i < 60 * fps; i++) {
  const t = i / fps;
  let speed = 20, ap = t < 30 ? 1 : 0;                       // FSD on, then off at 30 s
  if (t >= 10 && t < 12) speed = 20 - 5 * (t - 10);           // braking 5 m/s² (≈ 0.51 g) 10–12 s
  else if (t >= 12 && t < 20) speed = 10;
  if (t >= 40 && t < 42) heading += 30 / fps;                 // 30°/s at 20 m/s → ≈ 1.07 g lateral
  const noise = Math.sin(i * 1.7) * 0.15;
  const knock = t >= 50 && t < 50.15 ? 18 : 0;                // ≈ 1.8 g knock at 50 s
  s.push({ t, speed, heading, ap, gear: 1, ax: 0.3 + noise, ay: -0.2 + knock, az: 9.81 + noise });
}

assert.ok(A.addGForce(s), "g-force computed");
const steady = s.filter(x => x.t > 2 && x.t < 9).map(x => x.g);
assert.ok(Math.max(...steady) < 0.1, "steady driving reads ~0 g, gravity removed: " + Math.max(...steady));

const m = A.findMoments(s);
console.log(m.map(x => `${x.kind}@${x.t.toFixed(2)}s=${x.value.toFixed(2)}`).join("  "));
const one = kind => m.filter(x => x.kind === kind);
assert.strictEqual(one("brake").length, 1, "one braking moment");
assert.ok(one("brake")[0].t >= 9.5 && one("brake")[0].t <= 12, "braking at 10–12 s");
assert.ok(Math.abs(one("brake")[0].value - 0.51) < 0.05, "braking ≈ 0.51 g");
assert.strictEqual(one("turn").length, 1, "one turn");
assert.ok(one("turn")[0].t >= 39 && one("turn")[0].t <= 42, "turn at 40–42 s");
assert.strictEqual(one("jolt").length, 1, "one jolt");
assert.ok(Math.abs(one("jolt")[0].t - 50) < 0.3, "jolt at 50 s");
assert.strictEqual(one("apOff").length, 1, "assistance off once");
assert.ok(Math.abs(one("apOff")[0].t - 30) < 0.1, "assistance off at 30 s");

const sum = A.summarize(s, 11);
assert.ok(Math.abs(sum.near.t - 11) < 0.05 && sum.maxSpeed === 20, "summary near 11 s, max speed 20 m/s");

// No accelerometer (older firmware): no g, no jolt, but braking still found from the speed.
const old = s.map(({ ax, ay, az, g, ...rest }) => rest);
assert.ok(!A.addGForce(old), "no g without accelerometer");
assert.ok(A.findMoments(old).some(x => x.kind === "brake") && !A.findMoments(old).some(x => x.kind === "jolt"), "braking without accelerometer");

// Parked Sentry clip: no telemetry at all.
assert.deepStrictEqual(A.findMoments([]), []);
console.log("analysis: all checks passed");
