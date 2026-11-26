// End-to-end test of the export presets (insurance / social), run by src/main.js when
// TCV_TEST_SCRIPT=e2e-modes.js. Fixture: node test/make-synthetic.js (clips with Tesla-like
// telemetry). Exported files land in TCV_TEST_OUT (no dialogs); geocoding is mocked.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const tel = require("../src/telemetry");
module.exports = async (win, entries, app) => {
  const run = js => win.webContents.executeJavaScript(js);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log("[e2e-modes]", ...a);
  const OUT = process.env.TCV_TEST_OUT;
  const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const newest = () => fs.readdirSync(OUT).map(f => path.join(OUT, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const check = (label, cond) => log((cond ? "PASS " : "FAIL ") + label);
  const exp = async (view, mode, extra = "") => {
    await run(view);
    await run(`openExportDialog(); applyMode(${JSON.stringify(mode)}); ${extra}`);
    const ok = await run("runExport()");
    return { ok, toast: await run('document.querySelector("#toast").textContent'), file: newest() };
  };
  try {
    win.webContents.on("console-message", (_e, level, msg) => { if (level >= 2) log("console:", msg); });
    await run(`loadFolder(${JSON.stringify(entries)}, "SYNTH")`);
    await sleep(1500);

    // Moments on the timeline and g in the HUD
    await run('openEvent(events.find(e => !e.encrypted))'); await sleep(2500);
    await run("loadEventMoments(cur)");
    const mo = JSON.parse(await run('JSON.stringify(cur.moments.map(m => [m.kind, +m.t.toFixed(2)]))'));
    log("moments:", JSON.stringify(mo), "| markers:", await run('document.querySelectorAll("#moments .mo").length'));
    check("brake, jolt and FSD-off found", ["brake", "jolt", "apOff"].every(k => mo.some(m => m[0] === k)));
    await run("seekGlobal(4.58)"); await sleep(800);
    log("HUD g:", await run('JSON.stringify([document.querySelector("#hGf").hidden, document.querySelector("#hG").textContent])'));
    log("tooltip:", await run('document.querySelector("#moments .mo").title'));

    // 1. Social, one camera: telemetry (GPS) stripped, picture intact
    let r = await exp('setLayout("focus"); setMain("front")', "social", 'document.querySelector("input[value=all]").checked = true');
    const src = cur => tel.extract(cur);
    const plainFront = entries.find(e => !e.parts.includes("EncryptedClips") && e.abs.endsWith("15-08-49-front.mp4")).abs;
    const social = tel.extract(r.file);
    log("social camera:", r.ok, path.basename(r.file), "| telemetry frames in original:", src(plainFront).length, "in export:", social.length);
    check("social camera export has no telemetry/GPS", r.ok && social.length === 0 && fs.statSync(r.file).size > 1e6);

    // 2. Insurance, one camera: telemetry kept + package
    r = await exp('setLayout("focus"); setMain("front")', "insurance");
    const pk1 = r.file;
    const files1 = fs.readdirSync(pk1, { recursive: true });
    log("insurance camera package:", path.basename(pk1), JSON.stringify(files1));
    const vid1 = files1.find(f => f.endsWith(".mp4") && !f.includes(path.sep) && !f.includes("/"));
    check("insurance camera video keeps telemetry", tel.extract(path.join(pk1, vid1)).length > 0);
    check("12 original clips + event.json + thumb-less", files1.filter(f => /[\\/]/.test(f) && f.endsWith(".mp4")).length === 12 && files1.some(f => f.endsWith("event.json")));
    const pdf1 = files1.find(f => f.endsWith(".pdf"));
    check("PDF report written", pdf1 && fs.readFileSync(path.join(pk1, pdf1)).subarray(0, 5).toString() === "%PDF-");
    const sums = fs.readFileSync(path.join(pk1, "SHA256SUMS.txt"), "utf8").trim().split(/\r\n/);
    const bad = sums.filter(l => { const [h, f] = l.split(" *"); return sha(path.join(pk1, f)) !== h; });
    check(`SHA256SUMS: ${sums.length} lines all match`, sums.length === files1.filter(f => fs.statSync(path.join(pk1, f)).isFile()).length - 1 && !bad.length);
    const orig = files1.find(f => f.endsWith("15-08-49-front.mp4") && /[\\/]/.test(f));
    check("plain original copied byte for byte", sha(path.join(pk1, orig)) === sha(plainFront));

    // 3. Insurance, grid mosaic, encrypted event: band, decrypted originals identical to plain twin
    await run('openEvent(events.find(e => e.encrypted))'); await sleep(2500);
    r = await exp('setLayout("grid")', "insurance");
    const pk2 = r.file;
    const files2 = fs.readdirSync(pk2, { recursive: true });
    log("insurance grid package:", path.basename(pk2), JSON.stringify(files2), "| toast:", r.toast);
    const encFront = files2.find(f => f.endsWith("15-38-49-front.mp4") && /[\\/]/.test(f));
    check("encrypted original decrypted = plain twin", sha(path.join(pk2, encFront)) === sha(plainFront));
    check("no event.json for encrypted event", !files2.some(f => f.endsWith("event.json")));
    const vid2 = path.join(pk2, files2.find(f => f.endsWith(".mp4") && !/[\\/]/.test(f)));
    fs.copyFileSync(vid2, "/tmp/tcv-ins-grid.mp4");
    fs.copyFileSync(path.join(pk2, files2.find(f => f.endsWith(".pdf"))), "/tmp/tcv-report-enc.pdf");
    fs.copyFileSync(path.join(pk1, pdf1), "/tmp/tcv-report-plain.pdf");

    // 4. Social grid mosaic: plain date label, no band
    r = await exp('setLayout("grid")', "social", 'document.querySelector("input[value=seg]").checked = true');
    fs.copyFileSync(r.file, "/tmp/tcv-soc-grid.mp4");
    log("social grid:", r.ok, path.basename(r.file));

    // 5. Cancel an insurance export mid-way: the whole folder disappears
    const before = fs.readdirSync(OUT).length;
    await run('setLayout("grid"); openExportDialog(); applyMode("insurance"); void (window.__p = runExport())');
    await sleep(2500);
    await run('document.querySelector("#expStop").click()');
    log("cancel returned:", await run("window.__p"));
    check("cancelled package folder removed", fs.readdirSync(OUT).length === before);

    // Dialog screenshots
    await run('openExportDialog(); applyMode("insurance")'); await sleep(300);
    fs.writeFileSync("/tmp/tcv-dlg-ins.png", (await win.webContents.capturePage()).toPNG());
    await run('document.querySelector("#expCustom").open = true; applyMode("social")'); await sleep(300);
    fs.writeFileSync("/tmp/tcv-dlg-soc.png", (await win.webContents.capturePage()).toPNG());
    await run('document.querySelector("#expDlg").close(); openEvent(events.find(e => !e.encrypted))'); await sleep(2000);
    await run('setLayout("grid"); seekGlobal(4.58)'); await sleep(1200);
    fs.writeFileSync("/tmp/tcv-timeline.png", (await win.webContents.capturePage()).toPNG());
  } catch (e) { log("ERROR", e.stack || e.message); }
  app.quit();
};
