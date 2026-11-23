// Video export, entirely inside the app (no ffmpeg): Mediabunny reads the clips through
// tcam:// (so encrypted clips are decrypted on the fly, never written in clear), and the MP4
// is streamed chunk by chunk to the file the user picked.
//  - one camera  → its segments are joined into one MP4 without re-encoding (lossless, fast,
//                  and Tesla's telemetry stays embedded in the frames);
//  - grid / fb   → the six cameras are composed in that layout on a canvas, with the date and,
//                  if wanted, the telemetry HUD, then encoded in H.264 (WebCodecs).
// Uses globals from index.html: CAMS, cur, segIdx, mainCam, url, t, locale, telAt, apName,
// loadTelemetry, hudOn, playing, togglePlay.
"use strict";
const MB = window.Mediabunny;
const TILE_RATIO = 938 / 1448;               // every Tesla camera is 3:2-ish (1448×938, front 2896×1876)
const even = n => Math.max(2, Math.round(n / 2) * 2);

/** Tiles {cam, x, y, w, h} of a layout at output width W, mirroring the on-screen layouts. */
function exportGeometry(layout, W) {
  const tiles = [];
  if (layout === "fb") {
    const tw = even(W / 2), th = even(tw * TILE_RATIO), bw = even(W / 4), bh = even(bw * TILE_RATIO);
    tiles.push({ cam: "front", x: 0, y: 0, w: tw, h: th }, { cam: "back", x: tw, y: 0, w: tw, h: th });
    ["left_pillar", "left_repeater", "right_repeater", "right_pillar"].forEach((cam, i) => tiles.push({ cam, x: i * bw, y: th, w: bw, h: bh }));
    return { W: 2 * tw, H: th + bh, tiles };
  }
  if (layout === "grid") {
    const tw = even(W / 3), th = even(tw * TILE_RATIO);
    CAMS.forEach((c, i) => tiles.push({ cam: c.id, x: (i % 3) * tw, y: Math.floor(i / 3) * th, w: tw, h: th }));
    return { W: 3 * tw, H: 2 * th, tiles };
  }
  // A single camera (fallback when its segments cannot be joined losslessly).
  const w = even(W), h = even(w * TILE_RATIO);
  return { W: w, H: h, tiles: [{ cam: layout, x: 0, y: 0, w, h }] };
}

/** A WritableStream that sends Mediabunny's output to the file opened by the main process. */
function fileSink(id, onBytes) {
  return new WritableStream({
    async write(chunk) { await window.api.saveWrite(id, chunk.position, chunk.data); onBytes(chunk.position + chunk.data.byteLength); },
  });
}
const openInput = p => new MB.Input({ source: new MB.UrlSource(url(p), { maxCacheSize: 32 * 1024 * 1024 }), formats: MB.ALL_FORMATS });
const sameBytes = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const x = new Uint8Array(a.buffer || a, a.byteOffset || 0, a.byteLength), y = new Uint8Array(b.buffer || b, b.byteOffset || 0, b.byteLength);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * Join one camera's segments into one MP4 by copying the compressed frames (no quality loss).
 * Returns false, before writing anything, if the segments were encoded with different
 * settings (they then cannot share one track): the caller re-encodes instead.
 */
async function remuxCamera(cam, segs, target, job) {
  const parts = [];
  try {
    for (const s of segs) {
      if (!s.files[cam]) continue;
      const input = openInput(s.files[cam]);
      const track = await input.getPrimaryVideoTrack();
      if (!track) { input.dispose(); continue; }
      parts.push({ input, track, cfg: await track.getDecoderConfig(), t0: await track.getFirstTimestamp(), dur: await track.computeDuration() });
    }
    if (!parts.length) throw new Error(t("exp_nothing"));
    const c0 = parts[0].cfg;
    if (!parts.every(p => p.cfg && p.cfg.codec === c0.codec && p.cfg.codedWidth === c0.codedWidth && sameBytes(p.cfg.description, c0.description))) return false;
    if (!c0.codec.startsWith("avc")) return false;

    const output = new MB.Output({ format: new MB.Mp4OutputFormat(), target });
    const src = new MB.EncodedVideoPacketSource("avc");
    output.addVideoTrack(src);
    await output.start();
    job.output = output;
    const total = parts.reduce((a, p) => a + p.dur, 0);
    let base = 0, done = 0, first = true;
    for (const p of parts) {
      let end = base;
      for await (const pk of new MB.EncodedPacketSink(p.track).packets()) {
        if (job.cancelled) throw new Error("cancelled");
        const ts = base + pk.timestamp - p.t0;
        await src.add(pk.clone({ timestamp: ts }), first ? { decoderConfig: p.cfg } : undefined);
        first = false;
        end = Math.max(end, ts + pk.duration);
        job.progress((done + (ts - base)) / total);
      }
      done += p.dur; base = end;
    }
    await output.finalize();
    return true;
  } finally { for (const p of parts) p.input.dispose(); }
}

// ---------- Telemetry HUD and labels, drawn on the canvas (same look as the on-screen HUD) ----------
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function drawHud(g, d, accScale, W, time, centerX) {
  const s = W / 1920, h = 64 * s, w = 520 * s, x = Math.max(0, Math.min(W - w, centerX - w / 2)), y = 12 * s;
  g.save();
  g.fillStyle = "rgba(10,11,13,.72)"; roundRect(g, x, y, w, h, 14 * s); g.fill();
  g.textBaseline = "middle"; g.textAlign = "center";
  const cy = y + h / 2;
  let cx = x + 22 * s;
  g.font = `700 ${15 * s}px "Segoe UI", sans-serif`;
  for (const [l, v] of [["P", 0], ["R", 2], ["N", 3], ["D", 1]]) { g.fillStyle = d.gear === v ? "#fff" : "#555"; g.fillText(l, cx, cy); cx += 16 * s; }
  const blinkOn = Math.floor(time / 0.35) % 2 === 0;
  g.font = `${20 * s}px "Segoe UI", sans-serif`;
  g.fillStyle = d.blinkL && blinkOn ? "#3fb950" : "#333"; g.fillText("◀", x + 112 * s, cy);
  g.fillStyle = "#fff"; g.font = `700 ${32 * s}px "Segoe UI", sans-serif`; g.fillText(String(Math.round(Math.abs(d.speed) * 3.6)), x + 162 * s, cy - 6 * s);
  g.fillStyle = "#8b9099"; g.font = `${10 * s}px "Segoe UI", sans-serif`; g.fillText("km/h", x + 162 * s, cy + 20 * s);
  g.font = `${20 * s}px "Segoe UI", sans-serif`;
  g.fillStyle = d.blinkR && blinkOn ? "#3fb950" : "#333"; g.fillText("▶", x + 212 * s, cy);
  // Steering wheel
  g.save(); g.translate(x + 252 * s, cy); g.rotate(d.steer * Math.PI / 180);
  g.strokeStyle = "#ddd"; g.lineWidth = 2.6 * s; g.beginPath(); g.arc(0, 0, 13 * s, 0, 2 * Math.PI); g.stroke();
  g.beginPath(); g.moveTo(-13 * s, 0); g.lineTo(13 * s, 0); g.moveTo(0, 0); g.lineTo(0, 13 * s); g.stroke(); g.restore();
  g.fillStyle = "#8b9099"; g.font = `${12 * s}px "Segoe UI", sans-serif`; g.fillText(`${Math.round(d.steer)}°`, x + 290 * s, cy);
  // Accelerator bar
  const bx = x + 320 * s, bh = 34 * s, by = cy - bh / 2 - 4 * s;
  g.fillStyle = "#2a2d33"; roundRect(g, bx, by, 10 * s, bh, 3 * s); g.fill();
  const a = Math.max(0, Math.min(100, d.accel * accScale)) / 100;
  g.fillStyle = "#3fb950"; g.fillRect(bx, by + bh * (1 - a), 10 * s, bh * a);
  g.fillStyle = "#8b9099"; g.font = `${9 * s}px "Segoe UI", sans-serif`; g.fillText(t("accel"), bx + 5 * s, by + bh + 8 * s);
  // Brake and driver-assist pills
  const pill = (label, on, color, px) => {
    g.font = `700 ${12 * s}px "Segoe UI", sans-serif`;
    const pw = g.measureText(label).width + 14 * s;
    g.fillStyle = on ? color : "#2a2d33"; roundRect(g, px, cy - 11 * s, pw, 22 * s, 6 * s); g.fill();
    g.fillStyle = on ? "#fff" : "#555"; g.textAlign = "left"; g.fillText(label, px + 7 * s, cy + 1 * s); g.textAlign = "center";
    return pw;
  };
  const bw = pill(t("brake"), d.brake, "#c62828", x + 346 * s);
  pill(apName(d.ap) || t("manual"), !!apName(d.ap), "#1565c0", x + 346 * s + bw + 8 * s);
  g.restore();
}
function drawLabel(g, text, x, y, size, align = "left") {
  g.save();
  g.font = `${size}px "Segoe UI", sans-serif`; g.textBaseline = "top";
  const w = g.measureText(text).width, pad = size * 0.35;
  const bx = align === "left" ? x : x - w - 2 * pad;
  g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(bx, y, w + 2 * pad, size * 1.4);
  g.textAlign = "left"; g.fillStyle = "#fff"; g.fillText(text, bx + pad, y + size * 0.2);
  g.restore();
}

/**
 * Walks a track's frames in order and hands back, for any increasing time, the frame on
 * screen at that time. Sequential decoding is much cheaper than seeking frame by frame.
 */
function frameStepper(track) {
  const it = new MB.VideoSampleSink(track).samples();
  let shown = null, next = null, ended = false;
  const pull = async () => { const r = await it.next(); if (r.done) { ended = true; next = null; } else next = r.value; };
  return {
    async at(ts) {
      if (!next && !ended) await pull();
      while (next && next.timestamp <= ts + 1e-4) {
        if (shown) shown.close();
        shown = next; next = null;
        if (!ended) await pull();
      }
      return shown;
    },
    async close() { if (shown) shown.close(); if (next) next.close(); await it.return(); },
  };
}

/** Compose the cameras of `layout` and encode them in H.264 (fallbacks: VP9, AV1). */
async function encodeMosaic(layout, width, withHud, segs, target, job) {
  const geo = exportGeometry(layout, width);
  const codec = await MB.getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: geo.W, height: geo.H });
  if (!codec) throw new Error(t("exp_nocodec"));
  const canvas = document.createElement("canvas");
  canvas.width = geo.W; canvas.height = geo.H;
  const g = canvas.getContext("2d", { alpha: false });
  const output = new MB.Output({ format: new MB.Mp4OutputFormat(), target });
  const src = new MB.CanvasSource(canvas, { codec, bitrate: Math.round(geo.W * geo.H * 4.5) });   // ≈ 7 Mb/s at 1920×828
  const main = geo.tiles.length === 1 ? geo.tiles[0].cam : "front";
  // Frame rate of the main camera (Tesla: ~36 fps front); fall back to 30.
  let fps = 30;
  const label = geo.tiles.length > 1 || layout !== main;
  const ft = geo.tiles.find(tl => tl.cam === "front") || geo.tiles[0], hudX = ft.x + ft.w / 2;   // HUD over the front camera
  const labelSize = Math.round(geo.W / 110), dateSize = Math.round(geo.W / 70);

  const plan = [];
  for (const s of segs) {
    const cams = {};
    for (const tl of geo.tiles) {
      if (!s.files[tl.cam]) continue;
      const input = openInput(s.files[tl.cam]);
      const track = await input.getPrimaryVideoTrack();
      if (!track) { input.dispose(); continue; }
      cams[tl.cam] = { input, track, t0: await track.getFirstTimestamp() };
    }
    const m = cams[main] || Object.values(cams)[0];
    if (!m) continue;
    if (!plan.length) { const st = await m.track.computePacketStats(120); if (st.averagePacketRate > 5) fps = Math.min(60, Math.round(st.averagePacketRate)); }
    plan.push({ seg: s, cams, dur: (await m.track.computeDuration()) - m.t0 });
  }
  if (!plan.length) throw new Error(t("exp_nothing"));
  const total = plan.reduce((a, p) => a + p.dur, 0);
  output.addVideoTrack(src, { frameRate: fps });
  await output.start();
  job.output = output;
  let outT = 0;
  try {
    for (const p of plan) {
      if (withHud) await loadTelemetry(p.seg);
      const n = Math.max(1, Math.floor(p.dur * fps));
      const steps = geo.tiles.map(tl => p.cams[tl.cam] ? frameStepper(p.cams[tl.cam].track) : null);
      try {
       for (let k = 0; k < n; k++) {
        if (job.cancelled) throw new Error("cancelled");
        const frames = await Promise.all(geo.tiles.map((tl, i) => steps[i] ? steps[i].at(p.cams[tl.cam].t0 + k / fps) : null));
        g.fillStyle = "#000"; g.fillRect(0, 0, geo.W, geo.H);
        geo.tiles.forEach((tl, i) => {
          const f = frames[i];
          if (f) f.draw(g, tl.x, tl.y, tl.w, tl.h);
          if (label) drawLabel(g, t("cam_" + tl.cam) + (f ? "" : " — " + t("no_image")), tl.x + 6, tl.y + 5, labelSize);
        });
        const tIn = k / fps;
        if (withHud && Array.isArray(p.seg.tel)) { const d = telAt(p.seg.tel, tIn); if (d) drawHud(g, d, p.seg.accScale, geo.W, tIn, hudX); }
        const when = new Date(p.seg.start.getTime() + tIn * 1000);
        drawLabel(g, when.toLocaleString(locale(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          geo.W - 8, geo.H - dateSize * 1.4 - 8, dateSize, "right");
        await src.add(outT, 1 / fps);
        outT += 1 / fps;
        job.progress(outT / total);
       }
      } finally { for (const st of steps) if (st) await st.close(); }
    }
    await output.finalize();
  } finally { for (const p of plan) for (const c of Object.values(p.cams)) c.input.dispose(); }
}

// ---------- Dialog and job control ----------
const pad2 = n => String(n).padStart(2, "0");
const fileStamp = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
let exportJob = null;

function exportKind() { return document.querySelector("#stage").className === "focus" ? "camera" : "mosaic"; }
function refreshExportButton() {
  const b = document.querySelector("#exportBtn");
  if (!b) return;
  const cam = exportKind() === "camera";
  b.textContent = t(cam ? "exp_btn_cam" : "exp_btn_mosaic");
  b.title = t(cam ? "exp_btn_cam_t" : "exp_btn_mosaic_t", { cam: t("cam_" + mainCam) });
}

function openExportDialog() {
  if (!cur || exportJob) return;
  const d = document.querySelector("#expDlg"), cam = exportKind() === "camera";
  d.querySelector("#expTitle").textContent = cam ? t("exp_title_cam", { cam: t("cam_" + mainCam) }) : t("exp_title_mosaic", { layout: t("lay_" + document.querySelector("#stage").className) });
  d.querySelector("#expMosaicOpts").hidden = cam;
  d.querySelector("#expHint").textContent = t(cam ? "exp_hint_cam" : "exp_hint_mosaic");
  const mins = Math.max(1, Math.round((cur.segs[cur.segs.length - 1].offset + cur.segs[cur.segs.length - 1].dur) / 60));
  d.querySelector("#expAllLbl").textContent = t("exp_all", { n: mins });
  d.querySelector("#expHud").checked = hudOn;
  d.querySelector("#expForm").hidden = false; d.querySelector("#expRun").hidden = true;
  d.showModal();
}

async function runExport() {
  const d = document.querySelector("#expDlg"), cam = exportKind() === "camera";
  const range = d.querySelector("input[name=expRange]:checked").value;
  const segs = range === "seg" ? [cur.segs[segIdx]] : cur.segs;
  const layout = document.querySelector("#stage").className, camId = mainCam;
  const width = +d.querySelector("#expRes").value, withHud = d.querySelector("#expHud").checked;
  const start = segs[0].start;
  const name = `Tesla_${fileStamp(start)}_${cam ? camId : layout}${!cam && withHud ? "_hud" : ""}.mp4`;
  if (playing) togglePlay();
  const f = await window.api.saveOpen(name);
  if (!f) return;
  d.querySelector("#expForm").hidden = true; d.querySelector("#expRun").hidden = false;
  const bar = d.querySelector("#expBar"), txt = d.querySelector("#expTxt");
  const t0 = performance.now();
  const job = exportJob = {
    cancelled: false, output: null,
    progress(x) {
      x = Math.max(0, Math.min(1, x));
      bar.value = x;
      const el = (performance.now() - t0) / 1000, left = x > 0.02 ? el / x - el : null;
      txt.textContent = t("exp_progress", { pct: Math.round(x * 100), left: left === null ? "…" : fmtDur(left) });
    },
  };
  job.progress(0);
  let ok = false;
  try {
    const target = () => new MB.StreamTarget(fileSink(f.id, () => {}), { chunked: true, chunkSize: 8 * 1024 * 1024 });
    if (cam) {
      // Lossless first; re-encode only if the segments cannot be joined as they are.
      if (!(await remuxCamera(camId, segs, target(), job))) await encodeMosaic(camId, 1448, false, segs, target(), job);
    } else await encodeMosaic(layout, width, withHud, segs, target(), job);
    ok = true;
  } catch (e) {
    if (job.output) { try { await job.output.cancel(); } catch {} }
    if (!job.cancelled) toast(t("exp_failed", { msg: e.message || String(e) }), 9000);
  } finally {
    exportJob = null;
    const r = await window.api.saveClose(f.id, ok);
    d.close();
    if (ok && r) {
      lastExport = r.path;   // the toast then becomes a link to the file
      toast(t("exp_done", { name: f.name, size: (r.size / 1048576).toFixed(r.size > 1048576 * 10 ? 0 : 1) }), 12000);
      clearTimeout(runExport.h); runExport.h = setTimeout(() => { lastExport = null; }, 12000);
    } else if (job.cancelled) toast(t("exp_cancelled"));
  }
  return ok;
}
let lastExport = null;

document.querySelector("#exportBtn").onclick = openExportDialog;
document.querySelector("#expGo").onclick = e => { e.preventDefault(); runExport(); };
document.querySelector("#expCancel").onclick = () => document.querySelector("#expDlg").close();
document.querySelector("#expStop").onclick = () => { if (exportJob) exportJob.cancelled = true; };
document.querySelector("#expDlg").addEventListener("cancel", e => { if (exportJob) e.preventDefault(); });
document.querySelector("#toast").addEventListener("click", () => { if (lastExport) window.api.showFile(lastExport); });
refreshExportButton();
