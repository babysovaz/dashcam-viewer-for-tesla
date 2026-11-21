// End-to-end UI test, run by src/main.js only when TCV_TEST_DIR is set.
"use strict";
const fs = require("fs");
module.exports = async (win, entries, app) => {
  const run = js => win.webContents.executeJavaScript(js);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log("[e2e]", ...a);
  const state = `JSON.stringify({seg:segIdx, main:mainCam, cams:CAMS.filter(c=>urls[c.id]).map(c=>[c.id, +vids[c.id].currentTime.toFixed(2), vids[c.id].videoWidth, vids[c.id].error && (vids[c.id].error.code + ":" + vids[c.id].error.message)]), info:document.querySelector("#info").textContent})`;
  try {
    // log("canPlay h264:", await run(`document.createElement("video").canPlayType('video/mp4; codecs="avc1.640033"')`));
    const probe = entries.find(e => e.abs.endsWith("back.mp4") && !e.parts.includes("EncryptedClips")).abs;
    log("range probe:", await run(`fetch(url(${JSON.stringify(probe)}), {headers:{Range:"bytes=0-15"}}).then(async r => [r.status, r.headers.get("content-range"), r.headers.get("content-type"), new Uint8Array(await r.arrayBuffer()).length])`));
    await run(`loadFolder(${JSON.stringify(entries)}, "TEST")`);
    await sleep(1500);
    log("status:", await run('document.querySelector("#status").textContent'));
    log("list:", await run('document.querySelector("#list").innerText.replace(/\\n/g, " | ")'));

    await run('openEvent(events.find(e => !e.encrypted && e.type === "SavedClips"))'); await sleep(2500);
    await run("togglePlay()"); await sleep(2500);
    log("plain event:", await run(state));

    await run('openEvent(events.find(e => e.folder === "2026-11-07_15-30-21"))'); await sleep(3000);
    log("encrypted event (cached key):", await run(state));
    await run("seekGlobal(20)"); await sleep(2500);
    await run("setLayout(\"focus\")");
    log("after seek to 20s:", await run(state));
    fs.writeFileSync("/tmp/tcv-e2e.png", (await win.webContents.capturePage()).toPNG());
    log("list after unlock:", await run('document.querySelector("#list").innerText.replace(/\\n/g, " | ")'));

    await run('openEvent(events.find(e => e.folder === "2026-11-18_16-40-44"))'); await sleep(3500);
    log("encrypted drive + HUD:", await run(`JSON.stringify({hud: !document.querySelector("#hud").hidden, speed: document.querySelector("#hSpeed").textContent, ap: document.querySelector("#hAp").textContent, gear: document.querySelector("#hud .gear .on")?.textContent, steer: document.querySelector("#hSteer").textContent, info: document.querySelector("#info").textContent, mark: document.querySelector("#mark").style.left, layout: document.querySelector("#stage").className})`));
    await run("setLayout(\"car\")"); await sleep(800);
    fs.writeFileSync("/tmp/tcv-e2e-car.png", (await win.webContents.capturePage()).toPNG());
    await run('setLayout("fb")'); await sleep(800);
    fs.writeFileSync("/tmp/tcv-e2e-fb.png", (await win.webContents.capturePage()).toPNG());
    await sleep(4000);
    log("thumbs:", await run('JSON.stringify(events.map(e => [e.folder, e.thumbUrl ? (e.thumbUrl.startsWith("data:") ? "generated" : "file") : (e.thumbFailed ? "failed" : "none")]))'));
    log("broken imgs:", await run('[...document.querySelectorAll(".ev img")].filter(i => i.complete && !i.naturalWidth).length'));
    log("FR texts:", await run('JSON.stringify([document.querySelector("#pick").textContent, document.querySelector("#auth").textContent, document.querySelector("#hBrake").textContent, document.querySelector(".cam .lbl").textContent, document.querySelector("#layoutSel").selectedOptions[0].textContent])'));
    await run('document.querySelector("#langSel").value = "en"; document.querySelector("#langSel").dispatchEvent(new Event("change"))'); await sleep(800);
    log("EN texts:", await run('JSON.stringify([document.querySelector("#pick").textContent, document.querySelector("#status").textContent, document.querySelector("#auth").textContent, document.querySelector("#hBrake").textContent, document.querySelector("#hAp").textContent, document.querySelector(".cam .lbl").textContent, document.querySelector("#layoutSel").selectedOptions[0].textContent, document.querySelector("#info").textContent, document.querySelector(".day").textContent, document.querySelector(".ev .s").textContent])'));
    log("untranslated French left in visible UI:", await run('JSON.stringify([...new Set((document.body.innerText.match(/[^\\n]*[éèàêç][^\\n]*/g) || []))].slice(0, 8))'));
    fs.writeFileSync("/tmp/tcv-e2e-en.png", (await win.webContents.capturePage()).toPNG());
    log("locked clip served as:", await run('fetch(url(events.find(e => e.folder === "2026-11-08_10-00-00").segs[0].files.front)).then(r => r.status)'));
    log("file outside folder served as:", await run('fetch(url("/etc/passwd")).then(r => r.status)'));
  } catch (e) { log("ERROR", e.message); }
  app.quit();
};
