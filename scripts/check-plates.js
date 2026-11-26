// CI check on the Windows runner: the plate detector's native runtime loads and the model runs
// (DirectML when available, else CPU), exactly as src/main.js does it. Downloads the model.
"use strict";
const crypto = require("crypto");
const ort = require("onnxruntime-node");
const URL = "https://github.com/ankandrew/open-image-models/releases/download/assets/yolo-v9-t-640-license-plates-end2end.onnx";
const SHA = "c3c1026ca7d0585dd88084d68182dd897113712fa734ae1557ca70174440c076";
(async () => {
  const buf = Buffer.from(await (await fetch(URL)).arrayBuffer());
  if (crypto.createHash("sha256").update(buf).digest("hex") !== SHA) throw new Error("model checksum mismatch");
  const x = new ort.Tensor("float32", new Float32Array(3 * 640 * 640).fill(0.5), [1, 3, 640, 640]);
  let worked = false;
  for (const ep of process.platform === "win32" ? ["dml", "cpu"] : ["cpu"]) {
    try {
      const s = await ort.InferenceSession.create(buf, { executionProviders: [ep] });
      const t = Date.now(); const out = await s.run({ [s.inputNames[0]]: x });
      console.log(`${ep}: ok, output ${out[s.outputNames[0]].dims} in ${Date.now() - t} ms`);
      worked = true;
    } catch (e) { console.log(`${ep}: not available (${e.message.split("\n")[0]})`); }
  }
  if (!worked) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
