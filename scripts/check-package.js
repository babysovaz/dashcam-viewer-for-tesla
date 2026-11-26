// Fails the build if the packaged app is missing a file the UI loads.
// Guards against --ignore rules dropping too much (e.g. cmd.exe stripping the ^ anchor
// on Windows turned --ignore=^/dist into /dist and removed Mediabunny from v0.5.0/0.5.1).
"use strict";
const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");

const archive = path.join("dist", "Dashcam Viewer for Tesla-win32-x64", "resources", "app.asar");
const files = new Set(asar.listPackage(archive).map(f => f.replace(/\\/g, "/")));

// Every <script src> of the UI, resolved from renderer/, plus the app entry points.
const html = fs.readFileSync(path.join("renderer", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
  .map(m => "/" + path.posix.normalize(path.posix.join("renderer", m[1])));
const required = [...new Set([...scripts, "/renderer/index.html", "/src/main.js", "/src/preload.js"])];

// The plate detector's native runtime must sit outside the archive (a DLL cannot load from it).
const unpacked = path.join("dist", "Dashcam Viewer for Tesla-win32-x64", "resources", "app.asar.unpacked", "node_modules", "onnxruntime-node", "bin", "napi-v6", "win32", "x64");
for (const f of ["onnxruntime_binding.node", "onnxruntime.dll", "DirectML.dll"]) {
  const ok = fs.existsSync(path.join(unpacked, f));
  console.log((ok ? "ok      " : "MISSING ") + "app.asar.unpacked/…/win32/x64/" + f);
  if (!ok) required.push("unpacked:" + f);
}
required.push("/node_modules/onnxruntime-node/dist/index.js");
const missing = required.filter(f => !f.startsWith("unpacked:") ? !files.has(f) : true);
for (const f of required.filter(f => !f.startsWith("unpacked:"))) console.log((missing.includes(f) ? "MISSING " : "ok      ") + f);
if (missing.length) {
  console.error(`\n${missing.length} file(s) missing from app.asar - check the --ignore rules in package.json.`);
  process.exit(1);
}
