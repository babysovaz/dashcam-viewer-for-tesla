// The clock camera freezes part-way through a clip (fixture: its file cut in half while its
// duration still says the whole clip). Before v0.7.3 every camera was pulled back to the frozen
// time and the clip looped; now the clock moves to a camera that still plays and the event ends.
"use strict";
module.exports = async (win, entries, app) => {
  const run = js => win.webContents.executeJavaScript(js), sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log("[e2e-stall]", ...a);
  try {
    await run(`loadFolder(${JSON.stringify(entries)}, "STALL")`); await sleep(1200);
    await run("openEvent(events[0])"); await sleep(1500);
    await run("seekGlobal(cur.segs[1].offset)"); await sleep(1500);
    await run("togglePlay()");
    const samples = [];
    for (let i = 0; i < 14; i++) { await sleep(700); samples.push(JSON.parse(await run('JSON.stringify({clock: masterId(), t: +vids[masterId()].currentTime.toFixed(2), front: +vids.front.currentTime.toFixed(2), back: +vids.back.currentTime.toFixed(2), playing})'))); }
    for (const s of samples) log(JSON.stringify(s));
    const tBack = samples.map(s => s.back);
    const loops = tBack.slice(1).filter((t, i) => t < tBack[i] - 0.3).length;
    log((samples.some(s => s.clock !== "front") ? "PASS" : "FAIL") + " clock handed over from the frozen front camera");
    log((loops === 0 ? "PASS" : "FAIL") + " no camera jumped back (loops: " + loops + ")");
    log((!samples[samples.length - 1].playing ? "PASS" : "FAIL") + " playback reached the end of the event");
  } catch (e) { log("ERROR", e.stack); }
  app.quit();
};
