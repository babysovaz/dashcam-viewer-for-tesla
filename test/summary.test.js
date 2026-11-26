// Unit test of renderer/summary.js with the real French and English sentences: node test/summary.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const S = require("../renderer/summary.js");
global.localStorage = { getItem: () => null };   // i18n.js reads it (Node 22 already has navigator)
const I18N = new Function(fs.readFileSync(__dirname + "/../renderer/i18n.js", "utf8") + "; return I18N;")();

const full = {
  date: "jeudi 17 avril 2026", time: "15:08:53", reason: "Enregistré (klaxon)", street: "Rue du Grand Pré", city: "Juilly",
  gps: "49.01234° N, 2.70123° E", heading: 45, hasTelemetry: true, speed: 43, gear: "marche avant (D)", ap: null, manual: true,
  brake: true, blink: "gauche", maxSpeed: 72, peakG: "0,55",
  moments: [{ kind: "brake", time: "15:08:52", g: "0,55" }, { kind: "apOff", time: "15:08:54", ap: "FSD (supervisé)" }],
};
const fr = S.buildSummary(I18N.fr, full);
console.log(fr.join("\n"));
assert.ok(fr[0].startsWith("Le jeudi 17 avril 2026 à 15:08:53") && fr[0].includes("klaxon"));
assert.ok(fr.some(l => l.includes("« Rue du Grand Pré », à Juilly")));
assert.ok(fr.some(l => l.includes("43 km/h, en marche avant (D)")));
assert.ok(fr.some(l => l.includes("conduit manuellement")) && fr.some(l => l.includes("frein")) && fr.some(l => l.includes("clignotant gauche")));
assert.ok(fr.some(l => l.startsWith("À 15:08:52, freinage brusque (0,55 g)")) && fr.some(l => l.includes("« FSD (supervisé) » s'est désactivée")));
assert.ok(!fr.some(l => /\{\w+\}/.test(l)), "no blank left unfilled");

// Speed hidden: every sentence that needs it disappears or falls back to its speed-free form
const noSpeed = S.buildSummary(I18N.fr, { ...full, speed: null, maxSpeed: null });
assert.ok(!noSpeed.some(l => l.includes("km/h")), "no speed anywhere");
assert.ok(noSpeed.some(l => l === "Il était en marche avant (D)."), "speed-free alternative used");

// Place hidden
const noPlace = S.buildSummary(I18N.fr, { ...full, street: null, city: null, gps: null, heading: null });
assert.ok(!noPlace.some(l => /Juilly|Grand Pré|GPS/.test(l)), "no place anywhere");

// Only the town known, GPS hidden
assert.ok(S.buildSummary(I18N.fr, { ...full, street: null, gps: null }).includes("Le véhicule se trouvait à Juilly."));

// Parked (no telemetry), no reason
const parked = S.buildSummary(I18N.fr, { date: "lundi 1 juin 2026", time: "02:10:00", hasTelemetry: false, moments: [] });
console.log("---\n" + parked.join("\n"));
assert.ok(parked[0].endsWith("a enregistré la scène.") && parked.some(l => l.startsWith("Aucune donnée de conduite")));

// English
const en = S.buildSummary(I18N.en, { ...full, reason: "Saved (horn)", gear: "drive (D)", blink: "left", peakG: "0.55",
  moments: [{ kind: "jolt", time: "3:08:53 PM", g: "1.63" }] });
console.log("---\n" + en.join("\n"));
assert.ok(en[0].startsWith("On jeudi") || en[0].startsWith("On "), "English intro");
assert.ok(en.some(l => l === "At 3:08:53 PM, jolt or impact (1.63 g).") && en.some(l => l.includes("Its speed was 43 km/h, in drive (D).")));

// Every sentence key exists in both languages with the same blanks
for (const k of Object.keys(I18N.fr).filter(k => k.startsWith("sum_"))) {
  const blanks = v => JSON.stringify([].concat(v).map(x => [...x.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()));
  assert.ok(k in I18N.en, "missing in English: " + k);
  assert.strictEqual(blanks(I18N.fr[k]), blanks(I18N.en[k]), "same blanks in both languages: " + k);
}
console.log("summary: all checks passed");
