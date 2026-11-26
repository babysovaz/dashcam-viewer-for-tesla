// Plate detection must look at every pixel of every camera (v0.7.0 skipped the bottom of the
// front camera, where cars parked right in front show their plates): node test/plates.test.js
"use strict";
const assert = require("assert");
const src = require("fs").readFileSync(__dirname + "/../renderer/export.js", "utf8");
const plateTiles = eval("(" + src.match(/function plateTiles[\s\S]*?\n}\n/)[0] + ")");
for (const [W, H] of [[2896, 1876], [1448, 938], [1920, 1080]]) {
  const tiles = plateTiles(W, H);
  let missed = 0;
  for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4)
    if (!tiles.some(([a, b, w, h]) => x >= a && x < a + w && y >= b && y < b + h)) missed++;
  assert.strictEqual(missed, 0, `${W}×${H}: ${missed} points never analysed`);
  for (const [a, b, w, h] of tiles) assert.ok(a >= 0 && b >= 0 && a + w <= W && b + h <= H, `${W}×${H}: tile inside the frame`);
  console.log(`${W}×${H}: ${tiles.length} tile(s), whole frame covered`);
}
console.log("plates: all checks passed");
