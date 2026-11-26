// Factual summary of an event, written from fill-in-the-blank sentences (French / English, in
// i18n.js under "sum_*"). Each sentence lists alternatives, most detailed first; the first one
// whose blanks can ALL be filled is used, otherwise the sentence is left out. A blank is empty
// when the data does not exist (no telemetry, no GPS…) or when the user chose not to reveal it
// (place, speed): nothing is ever guessed. No AI involved: every word comes from the car's data.
// Loaded by index.html (browser globals) and by the unit tests (CommonJS).
"use strict";
(function (root) {
  const filled = v => v !== null && v !== undefined && v !== "" && !(typeof v === "number" && !Number.isFinite(v));

  /** First alternative of `entry` (string or array) whose {blanks} are all available, filled in. */
  function phrase(entry, vars) {
    if (!entry) return null;
    for (const alt of Array.isArray(entry) ? entry : [entry]) {
      const names = [...alt.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      if (names.every(n => filled(vars[n]))) return alt.replace(/\{(\w+)\}/g, (_, n) => String(vars[n]));
    }
    return null;
  }

  /**
   * dict: the language's strings (I18N.fr / I18N.en). d: data prepared by the caller, already
   * formatted for the language, with null for anything unknown or not to be revealed:
   *   date, time, reason, street, city, gps, heading, speed, gear (word), ap (name or null),
   *   manual (true when driven by hand), brake (bool), blink ("gauche"/"left"…), maxSpeed,
   *   peakG, moments: [{ kind, time, g, ap }], hasTelemetry (bool).
   * Returns the sentences, in order.
   */
  function buildSummary(dict, d) {
    const out = [];
    const add = (key, vars) => { const s = phrase(dict[key], vars); if (s) out.push(s); };
    add("sum_intro", { date: d.date, time: d.time, reason: d.reason });
    add("sum_place", { street: d.street, city: d.city, gps: d.gps });
    add("sum_gps", { gps: d.gps && (d.street || d.city) ? d.gps : null, heading: d.heading });
    if (d.hasTelemetry) {
      add("sum_motion", { speed: d.speed, gear: d.gear });
      if (d.ap) add("sum_ap", { ap: d.ap });
      else if (d.manual) add("sum_manual", { yes: true });
      if (d.brake) add("sum_brake", { yes: true });
      if (d.blink) add("sum_blink", { blink: d.blink });
      add("sum_maxspeed", { maxSpeed: d.maxSpeed });
      add("sum_peakg", { peakG: d.peakG });
    } else add("sum_notel", { yes: true });
    for (const m of d.moments || []) add("sum_mo_" + m.kind, { time: m.time, g: m.g, ap: m.ap });
    add("sum_source", { yes: true });
    return out;
  }

  const api = { phrase, buildSummary };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Summary = api;
})(typeof window !== "undefined" ? window : globalThis);
