// Driving moments found in Tesla's telemetry: hard braking, sharp turn, jolt, and the moments
// the driver assistance switched off. Tesla does not document its accelerometer axes, so the
// detection does not rely on them:
//  - braking  = how fast the speed drops (speed is a documented, signed value);
//  - turning  = speed × how fast the heading changes (the lateral acceleration of a curve);
//  - jolt     = how far the accelerometer moves away from its usual value (whatever the axes
//               and whether gravity is included, a knock or a pothole shows up as a spike).
// Loaded by index.html (browser globals) and by the unit tests (CommonJS).
"use strict";
(function (root) {
  const G = 9.80665;
  const LIMITS = {
    brake: 4.0,      // m/s² of deceleration (≈ 0.4 g): firmer than any normal stop
    turn: 4.5,       // m/s² of lateral acceleration (≈ 0.45 g): a fast roundabout or a swerve
    turnMinSpeed: 5, // m/s: below that, GPS heading is too noisy to trust
    jolt: 1.2,       // g of deviation from the usual accelerometer value
    merge: 3,        // s: detections of the same kind closer than this are one moment
  };

  const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const hasAcc = s => Number.isFinite(s.ax) && Number.isFinite(s.ay) && Number.isFinite(s.az);

  /**
   * Adds `g` (dynamic acceleration, in g, 0 when steady) to each sample of one clip.
   * The reference is the clip's median, which removes gravity and any mounting tilt.
   */
  function addGForce(samples) {
    const acc = samples.filter(hasAcc);
    if (acc.length < 10) return false;
    const bx = median(acc.map(s => s.ax)), by = median(acc.map(s => s.ay)), bz = median(acc.map(s => s.az));
    // A 4-frame moving average (~0.1 s at 36 fps) removes sensor noise without hiding a knock.
    const raw = samples.map(s => hasAcc(s) ? Math.hypot(s.ax - bx, s.ay - by, s.az - bz) / G : null);
    samples.forEach((s, i) => {
      if (raw[i] === null) return;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - 3); k <= i; k++) if (raw[k] !== null) { sum += raw[k]; n++; }
      s.g = sum / n;
    });
    return true;
  }

  /** Index of the first sample at least `dt` seconds after sample i (or -1). */
  function ahead(samples, i, dt) {
    for (let j = i + 1; j < samples.length; j++) if (samples[j].t - samples[i].t >= dt) return j;
    return -1;
  }
  const wrap = d => ((d + 540) % 360) - 180;   // heading difference in -180…180

  /**
   * Moments of interest over a whole event. `samples` are sorted by `t` (seconds from the
   * start of the event) and may span several clips. Returns [{t, kind, value}] sorted by time:
   * kind = "brake" (value in g), "turn" (g), "jolt" (g) or "apOff" (the assistance that stopped).
   */
  function findMoments(samples) {
    const found = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      // Hard braking: speed drop over half a second.
      const j = ahead(samples, i, 0.5);
      if (j > 0 && s.speed > 3 && samples[j].t - s.t < 1.5) {
        const dec = (samples[j].speed - s.speed) / (samples[j].t - s.t);
        if (dec <= -LIMITS.brake) found.push({ t: s.t, kind: "brake", value: -dec / G });
      }
      // Sharp turn: v × heading rate over one second (GPS heading updates slowly).
      const k = ahead(samples, i, 1);
      if (k > 0 && samples[k].t - s.t < 2 && Number.isFinite(s.heading) && Number.isFinite(samples[k].heading)) {
        const v = (s.speed + samples[k].speed) / 2;
        if (v > LIMITS.turnMinSpeed) {
          const rate = wrap(samples[k].heading - s.heading) * Math.PI / 180 / (samples[k].t - s.t);
          const lat = Math.abs(v * rate);
          if (lat >= LIMITS.turn) found.push({ t: s.t, kind: "turn", value: lat / G });
        }
      }
      // Jolt: the accelerometer spikes away from its usual value.
      if (Number.isFinite(s.g) && s.g >= LIMITS.jolt) found.push({ t: s.t, kind: "jolt", value: s.g });
      // Driver assistance switched off while driving.
      const p = samples[i - 1];
      if (p && p.ap >= 1 && p.ap <= 3 && !(s.ap >= 1 && s.ap <= 3) && s.speed > 2) found.push({ t: s.t, kind: "apOff", value: p.ap });
    }
    // One moment per burst: keep the strongest detection of each kind within LIMITS.merge.
    const out = [];
    for (const kind of ["brake", "turn", "jolt", "apOff"]) {
      let group = null;
      for (const m of found.filter(f => f.kind === kind)) {
        if (group && m.t - group.last <= LIMITS.merge) {
          group.last = m.t;
          if (kind !== "apOff" && m.value > group.best.value) group.best = m;
        } else { if (group) out.push(group.best); group = { last: m.t, best: m }; }
      }
      if (group) out.push(group.best);
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /** Vehicle state around time `at` (seconds): nearest sample, and max speed / peak g within ±`win`. */
  function summarize(samples, at, win = 10) {
    if (!samples.length) return null;
    let near = samples[0];
    for (const s of samples) if (Math.abs(s.t - at) < Math.abs(near.t - at)) near = s;
    const around = samples.filter(s => Math.abs(s.t - at) <= win);
    const maxSpeed = around.reduce((m, s) => Math.max(m, Math.abs(s.speed || 0)), 0);
    const gs = around.filter(s => Number.isFinite(s.g));
    return { near, maxSpeed, peakG: gs.length ? Math.max(...gs.map(s => s.g)) : null, gap: Math.abs(near.t - at) };
  }

  const api = { addGForce, findMoments, summarize, LIMITS, G };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Analysis = api;
})(typeof window !== "undefined" ? window : globalThis);
