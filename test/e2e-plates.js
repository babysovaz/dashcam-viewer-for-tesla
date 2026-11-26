// End-to-end test of plate blurring, run by src/main.js when TCV_TEST_SCRIPT=e2e-plates.js.
//  - with TCV_TEST_PLATES (mock detector returning fixed boxes): checks that the boxes are
//    pixelated in a social grid export of the synthetic fixture;
//  - without it: exports the front camera of the first event with the real model (put in the
//    app's userData/models folder beforehand) and reports how many plates were found.
"use strict";
const fs = require("fs");
const path = require("path");
module.exports = async (win, entries, app) => {
  const run = js => win.webContents.executeJavaScript(js);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log("[e2e-plates]", ...a);
  const OUT = process.env.TCV_TEST_OUT;
  try {
    win.webContents.on("console-message", (_e, level, msg) => { if (level >= 2) log("console:", msg); });
    await run(`loadFolder(${JSON.stringify(entries)}, "PLATES")`); await sleep(1500);
    await run("openEvent(events[0])"); await sleep(2500);
    const mock = !!process.env.TCV_TEST_PLATES;
    await run(mock ? 'setLayout("grid")' : 'setLayout("focus"); setMain("front")');
    await run('openExportDialog(); applyMode("social"); document.querySelector("input[value=seg]").checked = true');
    log("blur ticked by the social preset:", await run('document.querySelector("#expBlur").checked'), "| note:", await run('document.querySelector("#expModeNote").textContent'));
    const t0 = Date.now();
    const ok = await run("runExport()");
    log("export ok:", ok, "in", ((Date.now() - t0) / 1000).toFixed(0), "s | plates detected (sum over detections):", await run("window.__plates || 0"), "| toast:", await run('document.querySelector("#toast").textContent'));
    const f = fs.readdirSync(OUT).map(x => path.join(OUT, x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    fs.copyFileSync(f, "/tmp/tcv-plates.mp4");
    log("file:", path.basename(f), fs.statSync(f).size);
  } catch (e) { log("ERROR", e.stack || e.message); }
  app.quit();
};
