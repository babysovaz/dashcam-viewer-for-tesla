// End-to-end test of video export, run by src/main.js when TCV_TEST_SCRIPT=e2e-export.js.
// Fixture: node test/make-synthetic.js. Exported files land in TCV_TEST_OUT (no save dialog).
"use strict";
const fs = require("fs");
module.exports = async (win, entries, app) => {
  const run = js => win.webContents.executeJavaScript(js);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log("[e2e-export]", ...a);
  // view = layout/camera to show, form = dialog choices (set after the dialog opened).
  const exp = async (label, view, form) => {
    const t0 = Date.now();
    await run(view);
    await run('openExportDialog()');
    await run(form);
    const ok = await run('runExport()');
    log(label, "ok:", ok, "in", ((Date.now() - t0) / 1000).toFixed(1), "s | toast:", await run('document.querySelector("#toast").textContent'));
  };
  try {
    win.webContents.on("console-message", (_e, level, msg) => { if (level >= 2) log("console:", msg); });
    await run(`loadFolder(${JSON.stringify(entries)}, "SYNTH")`);
    await sleep(1500);
    log("layouts:", await run('JSON.stringify([...document.querySelectorAll("#layoutSel option")].map(o => o.value + "=" + o.textContent))'));
    log("button in grid:", await run('document.querySelector("#exportBtn").textContent'));

    // 1. Plain event, one camera: lossless join of the two segments.
    await run('openEvent(events.find(e => !e.encrypted))'); await sleep(2000);
    await exp("focus/front plain all", 'setLayout("focus"); setMain("front")', 'document.querySelector("input[value=all]").checked = true');
    log("button in focus:", await run('document.querySelector("#exportBtn").textContent'));

    // 2. Encrypted event, rear camera: decrypted on the fly while joining.
    await run('openEvent(events.find(e => e.encrypted))'); await sleep(2500);
    await exp("focus/back encrypted all", 'setLayout("focus"); setMain("back")', 'document.querySelector("input[value=all]").checked = true');

    // 3. Grid mosaic of the encrypted event with a fake telemetry track for the HUD.
    await run(`cur.segs.forEach(s => { s.tel = Array.from({length: 200}, (_, i) => ({ t: i * 0.05, speed: 10 + i * 0.1, gear: 1, steer: Math.sin(i / 20) * 90, accel: (i % 50) / 50, brake: i % 60 > 50, blinkL: i < 80, blinkR: false, ap: i > 100 ? 1 : 0 })); s.accScale = 100; })`);
    await exp("grid hud HD all", 'setLayout("grid")', 'document.querySelector("input[value=all]").checked = true; document.querySelector("#expRes").value = "1920"; document.querySelector("#expHud").checked = true');

    // 4. Front+rear layout in 4K, current minute only, no HUD.
    await exp("fb hud 4K seg", 'setLayout("fb")', 'document.querySelector("input[value=seg]").checked = true; document.querySelector("#expRes").value = "3840"; document.querySelector("#expHud").checked = true');

    // 5. Cancel mid-way: the partial file must be removed.
    await run('setLayout("grid"); openExportDialog(); document.querySelector("input[value=all]").checked = true; document.querySelector("#expRes").value = "1920"; document.querySelector("#expHud").checked = false; void (window.__p = runExport())');
    await sleep(2500);
    log("before stop:", await run('JSON.stringify({job: !!exportJob, txt: document.querySelector("#expTxt").textContent, run: !document.querySelector("#expRun").hidden})'));
    await run('document.querySelector("#expStop").click()');
    log("cancelled run returned:", await run('window.__p'), "| toast:", await run('document.querySelector("#toast").textContent'));
    log("files:", JSON.stringify(fs.readdirSync(process.env.TCV_TEST_OUT).map(f => [f, fs.statSync(process.env.TCV_TEST_OUT + "/" + f).size])));
    fs.writeFileSync("/tmp/tcv-export-ui.png", (await win.webContents.capturePage()).toPNG());
    await run('setLayout("focus"); openExportDialog()'); await sleep(300);
    fs.writeFileSync("/tmp/tcv-export-dlg.png", (await win.webContents.capturePage()).toPNG());
  } catch (e) { log("ERROR", e.message); }
  app.quit();
};
