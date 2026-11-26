// Video export, entirely inside the app (no ffmpeg): Mediabunny reads the clips through
// tcam:// (so encrypted clips are decrypted on the fly, never written in clear), and the MP4
// is streamed chunk by chunk to the file the user picked.
//  - one camera  → its segments are joined into one MP4 without re-encoding (lossless, fast,
//                  and Tesla's telemetry stays embedded in the frames);
//  - grid / fb   → the six cameras are composed in that layout on a canvas, with the date and,
//                  if wanted, the telemetry HUD, then encoded in H.264 (WebCodecs).
// Two presets decide what the file reveals:
//  - insurance → date, place, GPS and vehicle data burned in under the video, Tesla's telemetry
//                kept in single-camera files, plus a folder with the untouched original clips,
//                a PDF report and SHA-256 fingerprints;
//  - social    → no place, speed hidden, Tesla's telemetry (with GPS) stripped from the file.
// Uses globals from index.html: CAMS, cur, segIdx, mainCam, url, t, locale, telAt, apName,
// loadTelemetry, eventSamples, loadEventMoments, eventTime, eventOffset, typeName, reasonName,
// fmtTime, hudOn, playing, togglePlay, Analysis.
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
 * Removes the "user data" SEI messages from one H.264 frame (AVCC, length-prefixed NAL units).
 * That is where Tesla stores its telemetry, GPS position included; the picture is untouched.
 */
function stripSei(data, lenSize = 4) {
  const keep = [];
  let out = 0;
  for (let p = 0; p + lenSize <= data.length;) {
    let len = 0;
    for (let k = 0; k < lenSize; k++) len = len * 256 + data[p + k];
    const nal = p + lenSize, end = Math.min(data.length, nal + len);
    const isUserData = (data[nal] & 0x1f) === 6 && data[nal + 1] === 5;
    if (!isUserData) { keep.push([p, end]); out += end - p; }
    p = end;
  }
  if (out === data.length) return data;
  const r = new Uint8Array(out);
  let o = 0;
  for (const [a, b] of keep) { r.set(data.subarray(a, b), o); o += b - a; }
  return r;
}
const avccLenSize = desc => { const d = desc && new Uint8Array(desc.buffer || desc, desc.byteOffset || 0, desc.byteLength); return d && d.length > 4 ? (d[4] & 3) + 1 : 4; };

/**
 * Join one camera's segments into one MP4 by copying the compressed frames (no quality loss).
 * Returns false, before writing anything, if the segments were encoded with different
 * settings (they then cannot share one track): the caller re-encodes instead.
 * With `strip`, Tesla's telemetry (and GPS) is removed from every frame.
 */
async function remuxCamera(cam, segs, target, job, strip = false) {
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
    const lenSize = avccLenSize(c0.description);
    for (const p of parts) {
      let end = base;
      for await (const pk of new MB.EncodedPacketSink(p.track).packets()) {
        if (job.cancelled) throw new Error("cancelled");
        const ts = base + pk.timestamp - p.t0;
        await src.add(pk.clone(strip ? { timestamp: ts, data: stripSei(pk.data, lenSize) } : { timestamp: ts }), first ? { decoderConfig: p.cfg } : undefined);
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
function drawHud(g, d, accScale, W, time, centerX, showSpeed = true) {
  const s = W / 1920, h = 64 * s, w = 580 * s, x = Math.max(0, Math.min(W - w, centerX - w / 2)), y = 12 * s;
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
  if (showSpeed) {
    g.fillStyle = "#fff"; g.font = `700 ${32 * s}px "Segoe UI", sans-serif`; g.fillText(String(Math.round(Math.abs(d.speed) * 3.6)), x + 162 * s, cy - 6 * s);
    g.fillStyle = "#8b9099"; g.font = `${10 * s}px "Segoe UI", sans-serif`; g.fillText("km/h", x + 162 * s, cy + 20 * s);
  } else { g.fillStyle = "#555"; g.font = `700 ${22 * s}px "Segoe UI", sans-serif`; g.fillText("—", x + 162 * s, cy); }
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
  // Dynamic acceleration (g), when the clip carries the accelerometer
  if (Number.isFinite(d.g)) {
    g.fillStyle = d.g >= 0.4 ? "#ffcc00" : "#fff"; g.font = `700 ${17 * s}px "Segoe UI", sans-serif`; g.fillText(fmtG(d.g), x + 368 * s, cy - 5 * s);
    g.fillStyle = "#8b9099"; g.font = `${9 * s}px "Segoe UI", sans-serif`; g.fillText("g", x + 368 * s, cy + 14 * s);
  }
  const bw = pill(t("brake"), d.brake, "#c62828", x + 400 * s);
  pill(apName(d.ap) || t("manual"), !!apName(d.ap), "#1565c0", x + 400 * s + bw + 8 * s);
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

// ---------- Licence plates: found by a local AI model, pixelated before encoding ----------
// The model sees 640×640 pictures. Tesla's front camera is 2896 px wide, where a plate shrinks
// to ~15 px at that scale and is often missed, so its road band is read as three overlapping
// tiles; the other cameras (1448 px) are read whole. Measured on real clips (a car park, front
// camera, one frame every 2 s): this finds up to three times more plates than the whole frame,
// with no false alarm on plate-free frames. The confidence threshold is low (0.15, in main.js)
// on purpose: an extra blurred patch costs nothing, a missed plate does. Detection runs every
// few frames and each box covers the plate's previous and current position, with a margin.
const PLATE_EVERY = 4;                       // frames between detections (~9 per second at 36 fps)
function plateTiles(w, h) {
  if (w <= 1600) return [[0, 0, w, h]];
  const tw = Math.round(w * 0.4), th = Math.min(h, Math.round(tw * 938 / 1448)), y0 = Math.round(h * 0.3);
  return [0, 0.3, 0.6].map(f => [Math.round(w * f), y0, tw, th]);
}
let detCanvas = null;
/** Plate boxes [x, y, w, h] in the frame's own pixels. */
async function detectPlates(frame) {
  const W = frame.displayWidth, H = frame.displayHeight, S = 640;
  if (!detCanvas) { detCanvas = document.createElement("canvas"); detCanvas.width = detCanvas.height = S; }
  const c = detCanvas.getContext("2d", { willReadFrequently: true });
  const found = [];
  for (const [tx, ty, tw, th] of plateTiles(W, H)) {
    const r = Math.min(S / tw, S / th), nw = Math.round(tw * r), nh = Math.round(th * r), dw = (S - nw) / 2, dh = (S - nh) / 2;
    c.fillStyle = "rgb(114,114,114)"; c.fillRect(0, 0, S, S);   // the letterbox grey the model was trained with
    frame.draw(c, tx, ty, tw, th, dw, dh, nw, nh);
    const boxes = await window.api.plateDetect(c.getImageData(0, 0, S, S).data);
    for (const [x1, y1, x2, y2] of boxes) found.push([tx + (x1 - dw) / r, ty + (y1 - dh) / r, (x2 - x1) / r, (y2 - y1) / r]);
  }
  return found;
}
/** Wider and taller than the plate: it moves between two detections and must stay covered. */
function grow([x, y, w, h], W, H) {
  const nx = Math.max(0, x - w * 0.35), ny = Math.max(0, y - h * 0.6);
  return [nx, ny, Math.min(W, x + w * 1.35) - nx, Math.min(H, y + h * 1.6) - ny];
}
let pixCanvas = null;
/**
 * Pixelate a rectangle of the output canvas. The rectangle is the grown box (~1.7 × the plate's
 * width, 2.2 × its height), cut into 2 rows of up to 10 blocks: a block spans about two
 * characters, so nothing stays readable.
 */
function pixelate(g, x, y, w, h) {
  if (w < 2 || h < 2) return;
  if (!pixCanvas) pixCanvas = document.createElement("canvas");
  pixCanvas.width = Math.max(2, Math.min(10, Math.round((w / h) * 2)));
  pixCanvas.height = 2;
  const p = pixCanvas.getContext("2d");
  p.drawImage(g.canvas, x, y, w, h, 0, 0, pixCanvas.width, pixCanvas.height);
  g.save(); g.imageSmoothingEnabled = false;
  g.drawImage(pixCanvas, 0, 0, pixCanvas.width, pixCanvas.height, x, y, w, h);
  g.restore();
}
/** Download (once) and load the plate model, reporting progress in the export window. */
async function preparePlates(step) {
  const st = await window.api.plateStatus();
  if (!st.ready && !st.loaded) {
    step(t("st_model"), 0, 0.02);
    const r = await window.api.plateDownload();
    if (r.error) throw new Error(t("plate_dl_failed", { why: r.status || r.message || r.error }));
  }
  const l = await window.api.plateLoad();
  if (l.error) throw new Error(t("plate_load_failed", { why: l.message || l.error }));
  return l.ep;
}

// ---------- Information band under the video (insurance mode) ----------
const gpsOk = d => d && Number.isFinite(d.lat) && Number.isFinite(d.lon) && (Math.abs(d.lat) > 1e-3 || Math.abs(d.lon) > 1e-3);
const fmtGps = d => `${Math.abs(d.lat).toFixed(5)}° ${d.lat >= 0 ? "N" : "S"}, ${Math.abs(d.lon).toFixed(5)}° ${d.lon >= 0 ? "E" : "W"}`;
const GEARS = { 0: "P", 1: "D", 2: "R", 3: "N" };
const bandHeight = W => even(W / 24);
/** Two lines in three columns: when · where · what the car was doing. */
function drawBand(g, W, y, H, when, place, d, showSpeed) {
  const s = H / 80, f1 = Math.round(22 * s), f2 = Math.round(17 * s), pad = 18 * s;
  g.save();
  g.fillStyle = "#101114"; g.fillRect(0, y, W, H);
  g.fillStyle = "#e82127"; g.fillRect(0, y, W, Math.max(2, 3 * s));
  g.textBaseline = "alphabetic";
  const l1 = y + H * 0.45, l2 = y + H * 0.82;
  const text = (str, x, yy, size, color, weight = 400, align = "left") => {
    g.font = `${weight} ${size}px "Segoe UI", sans-serif`; g.fillStyle = color; g.textAlign = align; g.fillText(str, x, yy);
  };
  // when
  text(when.toLocaleDateString(locale(), { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }), pad, l1, f1, "#fff", 600);
  text(when.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }), pad, l2, f2, "#c9ccd1");
  // where
  const cx = W * 0.27;
  const where = place && [place.street, place.city].filter(Boolean).join(", ");
  text(where || t("band_noplace"), cx, l1, f1, where ? "#fff" : "#8b9099", 600);
  text(gpsOk(d) ? fmtGps(d) + (Number.isFinite(d.heading) ? ` · ${t("band_heading")} ${Math.round(((d.heading % 360) + 360) % 360)}°` : "") : t("band_nogps"), cx, l2, f2, "#c9ccd1");
  // what the car was doing
  const rx = W - pad;
  if (d) {
    const speed = showSpeed ? `${Math.round(Math.abs(d.speed) * 3.6)} km/h · ` : "";
    text(speed + (GEARS[d.gear] || "?"), rx, l1, f1, "#fff", 600, "right");
    const bits = [d.brake ? t("brake") : null, d.blinkL ? "◀ " + t("band_blink") : null, d.blinkR ? t("band_blink") + " ▶" : null,
      apName(d.ap) || t("manual"), Number.isFinite(d.g) ? `${fmtG(d.g)} g` : null].filter(Boolean);
    text(bits.join(" · "), rx, l2, f2, "#c9ccd1", 400, "right");
  } else text(t("band_notel"), rx, l1, f2, "#8b9099", 400, "right");
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

/**
 * Compose the cameras of `layout` and encode them in H.264 (fallbacks: VP9, AV1).
 * opts: hud (telemetry over the front camera), speed (show it), band (insurance information
 * band under the video: { place }), blur (pixelate licence plates found by the local model).
 */
async function encodeMosaic(layout, width, opts, segs, target, job) {
  const geo = exportGeometry(layout, width);
  const withHud = !!opts.hud, showSpeed = opts.speed !== false;
  const bandH = opts.band ? bandHeight(geo.W) : 0, outH = geo.H + bandH;
  const codec = await MB.getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: geo.W, height: outH });
  if (!codec) throw new Error(t("exp_nocodec"));
  const canvas = document.createElement("canvas");
  canvas.width = geo.W; canvas.height = outH;
  const g = canvas.getContext("2d", { alpha: false });
  const output = new MB.Output({ format: new MB.Mp4OutputFormat(), target });
  const src = new MB.CanvasSource(canvas, { codec, bitrate: Math.round(geo.W * outH * 4.5) });   // ≈ 7 Mb/s at 1920×828
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
      if (withHud || bandH) await loadTelemetry(p.seg);
      const n = Math.max(1, Math.floor(p.dur * fps));
      const steps = geo.tiles.map(tl => p.cams[tl.cam] ? frameStepper(p.cams[tl.cam].track) : null);
      const plates = geo.tiles.map(() => ({ prev: [], cur: [] }));   // per tile, in source pixels
      try {
       for (let k = 0; k < n; k++) {
        if (job.cancelled) throw new Error("cancelled");
        const frames = await Promise.all(geo.tiles.map((tl, i) => steps[i] ? steps[i].at(p.cams[tl.cam].t0 + k / fps) : null));
        g.fillStyle = "#000"; g.fillRect(0, 0, geo.W, outH);
        if (opts.blur && k % PLATE_EVERY === 0)
          for (let i = 0; i < geo.tiles.length; i++) if (frames[i]) { plates[i].prev = plates[i].cur; plates[i].cur = await detectPlates(frames[i]); job.plates = (job.plates || 0) + plates[i].cur.length; window.__plates = job.plates; }
        geo.tiles.forEach((tl, i) => {
          const f = frames[i];
          if (f) f.draw(g, tl.x, tl.y, tl.w, tl.h);
          if (f && opts.blur) {
            const sx = tl.w / f.displayWidth, sy = tl.h / f.displayHeight;
            for (const b of [...plates[i].prev, ...plates[i].cur]) {
              const [x, y, w, h] = grow(b, f.displayWidth, f.displayHeight);
              pixelate(g, tl.x + x * sx, tl.y + y * sy, w * sx, h * sy);
            }
          }
          if (label) drawLabel(g, t("cam_" + tl.cam) + (f ? "" : " — " + t("no_image")), tl.x + 6, tl.y + 5, labelSize);
        });
        const tIn = k / fps;
        const d = Array.isArray(p.seg.tel) && p.seg.tel.length ? telAt(p.seg.tel, tIn) : null;
        // A sample more than 2 s away is not "now" (gaps happen when the car stops).
        const live = d && Math.abs(d.t - tIn) <= 2 ? d : null;
        if (withHud && live) drawHud(g, live, p.seg.accScale, geo.W, tIn, hudX, showSpeed);
        const when = new Date(p.seg.start.getTime() + tIn * 1000);
        if (bandH) drawBand(g, geo.W, geo.H, bandH, when, opts.band.place, live, showSpeed);
        else drawLabel(g, when.toLocaleString(locale(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
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

// ---------- Insurance report: snapshot, place, PDF content ----------
/** The six cameras at event time `g` (seconds), as a JPEG data URL for the report. */
async function snapshotAt(segs, g) {
  let si = 0;
  segs.forEach((x, k) => { if (x.offset <= g + 0.01) si = k; });
  const seg = segs[si], tIn = Math.max(0, g - seg.offset);
  const geo = exportGeometry("grid", 1200);
  const canvas = document.createElement("canvas");
  canvas.width = geo.W; canvas.height = geo.H;
  const c = canvas.getContext("2d", { alpha: false });
  c.fillStyle = "#000"; c.fillRect(0, 0, geo.W, geo.H);
  for (const tl of geo.tiles) {
    const file = seg.files[tl.cam];
    if (file) {
      const input = openInput(file);
      try {
        const track = await input.getPrimaryVideoTrack();
        if (track) {
          const sample = await new MB.VideoSampleSink(track).getSample((await track.getFirstTimestamp()) + tIn);
          if (sample) { sample.draw(c, tl.x, tl.y, tl.w, tl.h); sample.close(); }
        }
      } catch { /* missing camera: black tile */ } finally { input.dispose(); }
    }
    drawLabel(c, t("cam_" + tl.cam), tl.x + 5, tl.y + 4, 12);
  }
  return canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * Where the car was: the street and town the car wrote in event.json when it is readable;
 * otherwise, only if allowed, one OpenStreetMap lookup of the GPS position.
 */
async function resolvePlace(ev, samples, at, allowOnline) {
  let near = null;
  for (const x of samples) if (gpsOk(x) && (!near || Math.abs(x.t - at) < Math.abs(near.t - at))) near = x;
  const place = { street: ev.meta && ev.meta.street, city: ev.meta && ev.meta.city, gps: near, source: null };
  if (place.street || place.city) place.source = "car";
  else if (near && allowOnline) {
    const r = await window.api.geocode(near.lat, near.lon, LANG);
    if (r && !r.error) { place.street = r.road; place.city = [r.postcode, r.city].filter(Boolean).join(" "); place.source = "osm"; }
    else place.onlineFailed = true;
  }
  return place;
}

/**
 * Blanks for the factual summary (renderer/summary.js), formatted for the current language.
 * `show.place` / `show.speed` false → those blanks stay empty, so their sentences disappear.
 */
function summaryData(ev, segs, moment, place, show) {
  const samples = eventSamples(ev, segs);
  const st = Analysis.summarize(samples, moment.at);
  const d = st && st.gap <= 2 ? st.near : null;
  const gps = show.place && place && place.gps ? place.gps : null;
  const endOff = segs[segs.length - 1].offset + segs[segs.length - 1].dur;
  const near = (ev.moments || []).filter(m => m.t >= segs[0].offset && m.t <= endOff && Math.abs(m.t - moment.at) <= 15);
  const timeOf = t => fmtTime(new Date(ev.start.getTime() + t * 1000));
  return {
    date: moment.date.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    time: fmtTime(moment.date),
    reason: ev.meta && ev.meta.reason ? reasonName(ev.meta.reason) : null,
    street: show.place && place ? place.street : null,
    city: show.place && place ? place.city : null,
    gps: gps ? fmtGps(gps) : null,
    heading: gps && Number.isFinite(gps.heading) ? Math.round(((gps.heading % 360) + 360) % 360) : null,
    hasTelemetry: !!d,
    speed: d && show.speed ? Math.round(Math.abs(d.speed) * 3.6) : null,
    gear: d ? t("gear_" + d.gear) : null,
    ap: d ? apName(d.ap) : null,
    manual: !!d && !apName(d.ap),
    brake: !!d && d.brake,
    blink: d ? (d.blinkL && d.blinkR ? t("blink_lr") : d.blinkL ? t("blink_l") : d.blinkR ? t("blink_r") : null) : null,
    maxSpeed: d && show.speed ? Math.round(st.maxSpeed * 3.6) : null,
    peakG: d && st.peakG !== null ? fmtG(st.peakG) : null,
    moments: near.map(m => ({ kind: m.kind, time: timeOf(m.t), g: m.kind === "apOff" ? null : fmtG(m.value), ap: m.kind === "apOff" ? apName(m.value) : null })),
  };
}
const summaryLines = (ev, segs, moment, place, show) => Summary.buildSummary(I18N[LANG], summaryData(ev, segs, moment, place, show));

const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtSize = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} ${t("unit_mb")}` : `${Math.max(1, Math.round(n / 1024))} ${t("unit_kb")}`;
const fmtWhen = d => d.toLocaleString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Self-contained HTML page turned into the PDF report by the main process. */
function reportHtml(r) {
  const row = (k, v) => v === null || v === undefined || v === "" ? "" : `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const st = r.state, d = st && st.gap <= 2 ? st.near : null;
  const gps = r.show.place ? r.place.gps : null;
  const osm = gps ? `https://www.openstreetmap.org/?mlat=${gps.lat.toFixed(6)}&mlon=${gps.lon.toFixed(6)}#map=18/${gps.lat.toFixed(6)}/${gps.lon.toFixed(6)}` : null;
  const srcTxt = { car: t("rep_src_car"), osm: t("rep_src_osm") }[r.place.source] || (r.place.onlineFailed ? t("rep_src_failed") : t("rep_src_none"));
  const blink = d ? [d.blinkL && t("rep_left"), d.blinkR && t("rep_right")].filter(Boolean).join(", ") || t("rep_none") : null;
  const moments = r.moments.map(m => `<li>${esc(momentText(m))}</li>`).join("");
  const files = r.files.map(f => `<tr><td class="f">${esc(f.rel)}</td><td class="n">${esc(fmtSize(f.size))}</td><td class="h">${esc(f.sha256)}</td></tr>`).join("");
  return `<!doctype html><html lang="${LANG}"><head><meta charset="utf-8"><title>${esc(t("rep_title"))}</title>
<style>
  @page { size: A4; margin: 14mm 13mm; }
  body { font: 10.5pt/1.4 "Segoe UI", Arial, sans-serif; color: #1b1d21; margin: 0; }
  h1 { font-size: 17pt; margin: 0 0 2mm; } h2 { font-size: 11.5pt; margin: 6mm 0 2mm; padding-bottom: 1mm; border-bottom: 1.5px solid #e82127; }
  .sub { color: #5b616b; font-size: 9pt; margin-bottom: 4mm; }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; vertical-align: top; padding: 1.2mm 2mm; border-bottom: 0.5px solid #dde0e4; }
  th { width: 42%; color: #5b616b; font-weight: 600; }
  img { width: 100%; border-radius: 2mm; margin-top: 2mm; }
  .blk { break-inside: avoid; }
  .files th { width: auto; } .files th:nth-child(1) { width: 44%; } .files th:nth-child(3) { width: 42%; } .files tr { break-inside: avoid; }
  .files td { font-size: 8pt; } .files .h { font-family: Consolas, "Courier New", monospace; font-size: 7pt; word-break: break-all; } .files .n { white-space: nowrap; }
  .note { font-size: 8.5pt; color: #4a4f57; background: #f4f5f7; border-radius: 2mm; padding: 2.5mm 3.5mm; margin-top: 3mm; }
  ul { margin: 1mm 0; padding-left: 5mm; } a { color: #0b57d0; }
  .foot { margin-top: 6mm; font-size: 8pt; color: #7a808a; }
</style></head><body>
<h1>${esc(t("rep_title"))}</h1>
<div class="sub">${esc(t("rep_generated", { when: fmtWhen(r.generated), ver: r.version }))}</div>

<h2>${esc(t("rep_h_summary"))}</h2>
${r.summary.map(l => `<p style="margin:0 0 1.6mm">${esc(l)}</p>`).join("")}

<h2>${esc(t("rep_h_event"))}</h2>
<table>
${row(t("rep_type"), esc(r.ev.meta && r.ev.meta.reason ? reasonName(r.ev.meta.reason) : typeName(r.ev.type)))}
${row(t(r.moment.kind === "event" ? (r.moment.approx ? "rep_moment_approx" : "rep_moment_event") : "rep_moment_screen"), esc(fmtWhen(r.moment.date)))}
${row(t("rep_range"), esc(t("rep_range_v", { from: fmtTime(r.range.from), to: fmtTime(r.range.to) })))}
${row(t("rep_encrypted"), esc(t(r.ev.encrypted ? "rep_yes_enc" : "rep_no_enc")))}
</table>

<h2>${esc(t("rep_h_place"))}</h2>
${!r.show.place ? `<p>${esc(t("rep_excluded"))}</p>` : `<table>
${row(t("rep_address"), esc([r.place.street, r.place.city].filter(Boolean).join(", ") || "—"))}
${row(t("rep_address_src"), esc(srcTxt))}
${row(t("rep_gps"), gps ? esc(fmtGps(gps)) + ` — <a href="${osm}">${esc(t("rep_map"))}</a>` : esc(t("band_nogps")))}
${row(t("rep_heading"), gps && Number.isFinite(gps.heading) ? esc(Math.round(((gps.heading % 360) + 360) % 360) + "°") : null)}
</table>`}

<h2>${esc(t("rep_h_car"))}</h2>
${d ? `<table>
${row(t("rep_speed"), r.show.speed ? esc(`${Math.round(Math.abs(d.speed) * 3.6)} km/h`) : esc(t("rep_excluded")))}
${row(t("rep_gear"), esc(GEARS[d.gear] || "?"))}
${row(t("rep_brake"), esc(t(d.brake ? "rep_yes" : "rep_no")))}
${row(t("rep_accel"), esc(`${Math.round(Math.max(0, Math.min(100, d.accel * r.accScale)))} %`))}
${row(t("rep_steer"), esc(`${Math.round(d.steer)}°`))}
${row(t("rep_blink"), esc(blink))}
${row(t("rep_ap"), esc(apName(d.ap) || t("manual")))}
${row(t("rep_maxspeed"), r.show.speed ? esc(`${Math.round(st.maxSpeed * 3.6)} km/h`) : null)}
${row(t("rep_peakg"), st.peakG === null ? null : esc(`${fmtG(st.peakG)} g`))}
</table>` : `<p>${esc(t("rep_notel"))}</p>`}
${moments ? `<p style="margin:3mm 0 0"><b>${esc(t("rep_moments"))}</b></p><ul>${moments}</ul>` : ""}
<div class="note">${esc(t("rep_tel_note"))}</div>

${r.snapshot ? `<div class="blk"><h2>${esc(t("rep_h_snap"))}</h2><img src="${r.snapshot}"></div>` : ""}

<h2>${esc(t("rep_h_files"))}</h2>
<table class="files"><tr><th>${esc(t("rep_file"))}</th><th>${esc(t("rep_size"))}</th><th>SHA-256</th></tr>${files}</table>
<div class="note">${esc(t("rep_files_note"))}<br>${esc(t("rep_verify"))}</div>

<div class="foot">${esc(t("rep_foot", { ver: r.version }))}</div>
</body></html>`;
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

// What each preset sets. Every option stays editable under "Customize".
const PRESETS = {
  // Insurance keeps the plates: the other party's plate is part of the evidence.
  insurance: { range: "all", res: "1920", hud: true, place: true, speed: true, gps: true, pack: true, geo: true, blur: false },
  social: { hud: false, place: false, speed: false, gps: false, pack: false, geo: false, blur: true },
};
const OPT_IDS = { hud: "#expHud", place: "#expPlace", speed: "#expSpeed", gps: "#expGps", pack: "#expPack", geo: "#expGeo", blur: "#expBlur" };
let expMode = (() => { try { return localStorage.getItem("tcv.expMode") || "social"; } catch { return "social"; } })();
const $e = s => document.querySelector(s);

function applyMode(mode) {
  expMode = mode;
  try { localStorage.setItem("tcv.expMode", mode); } catch {}
  const p = PRESETS[mode];
  if (p) {
    for (const [k, id] of Object.entries(OPT_IDS)) if (k in p) $e(id).checked = p[k];
    if (p.range) $e(`input[name=expRange][value=${p.range}]`).checked = true;
    if (p.res) $e("#expRes").value = p.res;
  }
  for (const b of document.querySelectorAll(".modes button")) b.classList.toggle("on", b.dataset.mode === mode);
  refreshModeNote();
}
function refreshModeNote() {
  const n = $e("#expModeNote"), cam = exportKind() === "camera";
  const key = { insurance: cam ? "mode_ins_note_cam" : "mode_ins_note", social: cam ? "mode_soc_note_cam" : "mode_soc_note" }[expMode];
  n.hidden = !key;
  if (key) n.textContent = t(key);
}

// "🚗 Grille 3×2 (comme dans la voiture)" → "Grille 3×2": the menu label is too long for a title.
const shortLayoutName = l => t("lay_" + l).replace(/^\p{Extended_Pictographic}️?\s*/u, "").replace(/\s*\(.*\)\s*$/, "");
function openExportDialog() {
  if (!cur || exportJob) return;
  const d = $e("#expDlg"), cam = exportKind() === "camera";
  d.querySelector("#expTitle").textContent = cam ? t("exp_title_cam", { cam: t("cam_" + mainCam) }) : t("exp_title_mosaic", { layout: shortLayoutName($e("#stage").className) });
  d.querySelector("#expMosaicOpts").hidden = cam;
  d.querySelector("#expGpsLbl").hidden = !cam;      // a re-encoded mosaic never carries Tesla's telemetry
  d.querySelector("#expHint").textContent = t(cam ? "exp_hint_cam" : "exp_hint_mosaic");
  const mins = Math.max(1, Math.round((cur.segs[cur.segs.length - 1].offset + cur.segs[cur.segs.length - 1].dur) / 60));
  d.querySelector("#expAllLbl").textContent = t("exp_all", { n: mins });
  $e("#expHud").checked = hudOn;
  applyMode(PRESETS[expMode] ? expMode : "social");
  d.querySelector("#expForm").hidden = false; d.querySelector("#expRun").hidden = true;
  d.showModal();
}
function readOptions() {
  const o = { range: $e("input[name=expRange]:checked").value, width: +$e("#expRes").value, mode: expMode };
  for (const [k, id] of Object.entries(OPT_IDS)) o[k] = $e(id).checked;
  return o;
}

/** The moment the report describes: the event moment if it is in the export, else what is on screen. */
function reportMoment(segs) {
  const from = segs[0].offset, to = segs[segs.length - 1].offset + segs[segs.length - 1].dur;
  const eo = eventOffset(cur), et = eventTime(cur);
  if (eo !== null && eo >= from && eo <= to) return { at: eo, kind: "event", approx: et.approx, date: et.d };
  const g = cur.segs[segIdx].offset + (vids[masterId()].currentTime || 0);
  const at = Math.max(from, Math.min(to, g));
  return { at, kind: "screen", date: new Date(cur.start.getTime() + at * 1000) };
}

async function runExport() {
  const d = $e("#expDlg"), cam = exportKind() === "camera";
  const o = readOptions();
  const segs = o.range === "seg" ? [cur.segs[segIdx]] : cur.segs;
  const layout = $e("#stage").className, camId = mainCam;
  const start = segs[0].start, ev = cur;
  const name = `Tesla_${fileStamp(start)}_${cam ? camId : layout}${!cam && o.hud ? "_hud" : ""}.mp4`;
  if (playing) togglePlay();
  // Insurance package: everything goes into one new folder.
  let pack = null;
  if (o.pack) {
    pack = await window.api.packOpen(`Tesla_${fileStamp(start)}_${t("pack_dir")}`);
    if (!pack) return;
  }
  const f = await window.api.saveOpen(name, pack && pack.id);
  if (!f) { if (pack) await window.api.packClose(pack.id, false); return; }
  d.querySelector("#expForm").hidden = true; d.querySelector("#expRun").hidden = false;
  const bar = d.querySelector("#expBar"), txt = d.querySelector("#expTxt");
  const t0 = performance.now();
  let stage = "", share = [0, 1];     // progress of the current step mapped into [a, b]
  const job = exportJob = {
    cancelled: false, output: null,
    progress(x) {
      x = share[0] + (share[1] - share[0]) * Math.max(0, Math.min(1, x));
      bar.value = x;
      const el = (performance.now() - t0) / 1000, left = x > 0.02 ? el / x - el : null;
      txt.textContent = (stage ? stage + " — " : "") + t("exp_progress", { pct: Math.round(x * 100), left: left === null ? "…" : fmtDur(left) });
    },
  };
  const step = (label, a, b) => { stage = label; share = [a, b]; job.progress(0); };
  step(pack ? t("st_video") : "", 0, pack ? 0.7 : 1);
  let ok = false, videoOk = false, place = null;
  try {
    // Telemetry and place first: the information band and the report need them.
    if (o.place || pack) {
      await loadEventMoments(ev);
      const m = reportMoment(segs);
      place = await resolvePlace(ev, eventSamples(ev, segs), m.at, o.geo);
    }
    if (o.blur) await preparePlates(step);
    step(pack ? t("st_video") : (o.blur ? t("st_video_blur") : ""), o.blur ? 0.02 : 0, pack ? 0.7 : 1);
    const target = () => new MB.StreamTarget(fileSink(f.id, () => {}), { chunked: true, chunkSize: 8 * 1024 * 1024 });
    if (cam && o.blur) {
      // Blurring changes the picture, so this camera has to be re-encoded (no lossless copy).
      await encodeMosaic(camId, camId === "front" ? 1920 : 1448, { blur: true }, segs, target(), job);
    } else if (cam) {
      // Lossless first; re-encode only if the segments cannot be joined as they are.
      if (!(await remuxCamera(camId, segs, target(), job, !o.gps))) await encodeMosaic(camId, 1448, {}, segs, target(), job);
    } else await encodeMosaic(layout, o.width, { hud: o.hud, speed: o.speed, band: o.place ? { place } : null, blur: o.blur }, segs, target(), job);
    videoOk = true;
    const r = lastVideo = await window.api.saveClose(f.id, true);
    if (pack) await buildPackage(pack, ev, segs, place, r, job, step, o);
    ok = true;
  } catch (e) {
    if (job.output) { try { await job.output.cancel(); } catch {} }
    if (!job.cancelled) toast(t("exp_failed", { msg: e.message || String(e) }), 9000);
  } finally {
    exportJob = null;
    if (!videoOk) await window.api.saveClose(f.id, false);
    const done = pack ? await window.api.packClose(pack.id, ok) : (ok ? { path: lastVideo.path, size: lastVideo.size } : null);
    d.close();
    if (ok && done) {
      lastExport = done.path;   // the toast then becomes a link to the file or folder
      toast((pack ? t("exp_done_pack", { name: pack.name }) + (place && place.onlineFailed ? " " + t("exp_geo_failed") : "")
        : t("exp_done", { name: f.name, size: (done.size / 1048576).toFixed(done.size > 1048576 * 10 ? 0 : 1) }))
        + (o.blur ? " " + t("plate_done") : ""), 14000);
      clearTimeout(runExport.h); runExport.h = setTimeout(() => { lastExport = null; }, 14000);
    } else if (job.cancelled) toast(t("exp_cancelled"));
  }
  return ok;
}
let lastExport = null, lastVideo = null;

/** Originals, report and fingerprints, next to the exported video. */
async function buildPackage(pack, ev, segs, place, video, job, step, o) {
  const files = segs.flatMap(s => CAMS.map(c => s.files[c.id]).filter(Boolean));
  if (!ev.encrypted) for (const p of [ev.json, ev.thumb]) if (p) files.push(p);   // only the car can read encrypted ones
  step(t("st_originals"), 0.7, 0.93);
  for (let i = 0; i < files.length; i++) {
    if (job.cancelled) throw new Error("cancelled");
    await window.api.packOriginal(pack.id, files[i], t("pack_sub"));
    job.progress((i + 1) / files.length);
  }
  step(t("st_report"), 0.93, 1);
  const m = reportMoment(segs);
  const samples = eventSamples(ev, segs);
  const range = { from: new Date(ev.start.getTime() + segs[0].offset * 1000), to: new Date(ev.start.getTime() + (segs[segs.length - 1].offset + segs[segs.length - 1].dur) * 1000) };
  const endOff = segs[segs.length - 1].offset + segs[segs.length - 1].dur;
  const inRange = (ev.moments || []).filter(x => x.t >= segs[0].offset && x.t <= endOff);
  let snapshot = null;
  try { snapshot = await snapshotAt(segs, m.at); } catch { /* the report works without it */ }
  job.progress(0.4);
  const show = { place: o.place, speed: o.speed };
  const summary = summaryLines(ev, segs, m, place, show);
  await window.api.packText(pack.id, t("sum_file"), summary.join("\r\n") + "\r\n");
  const html = reportHtml({
    ev, moment: m, range, place: place || { gps: null }, state: Analysis.summarize(samples, m.at), accScale: (segs[0].accScale || 100), show, summary,
    moments: inRange, snapshot, files: await window.api.packFiles(pack.id), generated: new Date(), version: await window.api.appVersion(),
  });
  await window.api.packPdf(pack.id, html, t("pdf_name"));
  job.progress(0.8);
  await window.api.packSums(pack.id);
  job.progress(1);
}

// ---------- Factual summary dialog ----------
let sumPlace = null;
async function refreshSummary() {
  const d = $e("#sumDlg");
  if (!cur || !d.open) return;
  const m = reportMoment(cur.segs);
  if (!sumPlace || sumPlace.ev !== cur) sumPlace = { ev: cur, place: await resolvePlace(cur, eventSamples(cur), m.at, false) };   // no online lookup here
  $e("#sumText").value = summaryLines(cur, cur.segs, m, sumPlace.place, { place: $e("#sumPlace").checked, speed: $e("#sumSpeed").checked }).join("\n");
}
async function openSummary() {
  if (!cur) return;
  $e("#sumText").value = "…";
  $e("#sumDlg").showModal();
  sumPlace = null;
  await loadEventMoments(cur);
  await refreshSummary();
}
document.querySelector("#sumBtn").onclick = openSummary;
document.querySelector("#sumPlace").onchange = refreshSummary;
document.querySelector("#sumSpeed").onchange = refreshSummary;
document.querySelector("#sumClose").onclick = () => document.querySelector("#sumDlg").close();
document.querySelector("#sumCopy").onclick = async () => {
  const ta = $e("#sumText");
  try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand("copy"); }
  toast(t("sum_copied"));
};

document.querySelector("#exportBtn").onclick = openExportDialog;
document.querySelector("#expGo").onclick = e => { e.preventDefault(); runExport(); };
document.querySelector("#expCancel").onclick = () => document.querySelector("#expDlg").close();
document.querySelector("#expStop").onclick = () => { if (exportJob) exportJob.cancelled = true; };
document.querySelector("#expDlg").addEventListener("cancel", e => { if (exportJob) e.preventDefault(); });
for (const b of document.querySelectorAll(".modes button")) b.onclick = () => applyMode(b.dataset.mode);
// Changing any option by hand leaves the preset: the cards then show no selection.
for (const id of [...Object.values(OPT_IDS), "#expRes"]) document.querySelector(id).addEventListener("change", () => {
  expMode = "custom";
  for (const b of document.querySelectorAll(".modes button")) b.classList.remove("on");
  refreshModeNote();
});
document.querySelector("#toast").addEventListener("click", () => { if (lastExport) window.api.showFile(lastExport); });
refreshExportButton();
