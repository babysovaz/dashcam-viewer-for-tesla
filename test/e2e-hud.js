// The telemetry panel is centred: its width must not change with the values shown, or it
// jumps sideways several times a second (flicker reported on v0.7.1).
"use strict";
module.exports = async (win, entries, app) => {
  const run = js => win.webContents.executeJavaScript(js), sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log("[e2e-hud]", ...a);
  try {
    await run(`loadFolder(${JSON.stringify(entries)}, "HUD")`); await sleep(1200);
    await run("openEvent(events.find(e => !e.encrypted))"); await sleep(1500);
    await run("setHud(true); togglePlay(); togglePlay()");
    const cases = [[0, 3, 0.01, 0, true], [9 / 3.6, -3, 0.08, 1, false], [10 / 3.6, -10, 0.1, 2, false], [130 / 3.6, -125, 1.23, 3, true], [4 / 3.6, 45, 0.5, 0, false]];
    const widths = [];
    for (const [speed, steer, g, ap, brake] of cases) {
      widths.push(await run(`(() => { const seg = { tel: [{ t: 0, speed: ${speed}, gear: 1, steer: ${steer}, accel: 20, brake: ${brake}, blinkL: false, blinkR: false, ap: ${ap}, g: ${g} }], accScale: 1 };
        updateHud(seg, 0); return Math.round(document.querySelector("#hud").getBoundingClientRect().width * 10) / 10; })()`));
    }
    log("panel widths:", JSON.stringify(widths));
    log((new Set(widths).size === 1 ? "PASS" : "FAIL") + " width stays the same whatever the values");
  } catch (e) { log("ERROR", e.stack); }
  app.quit();
};
