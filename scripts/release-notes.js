// Prints the CHANGELOG.md section of a version (bilingual FR/EN), followed by install notes.
// Usage: node scripts/release-notes.js 0.4.0
"use strict";
const fs = require("fs");
const path = require("path");

const version = process.argv[2];
// Normalise line endings: on the Windows runner, Git checks files out with CRLF.
const log = fs.readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
const start = log.search(new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m"));
let section = "";
if (start >= 0) {
  const rest = log.slice(start);
  const next = rest.slice(3).search(/^## \[/m);
  section = (next >= 0 ? rest.slice(0, next + 3) : rest).replace(/^## .*\n/, "").trim();
}
process.stdout.write(`${section || "_Voir / see CHANGELOG.md_"}

---

**Installation (FR)** — Télécharger le zip ci-dessous, le dézipper, lancer \`TeslaCam Viewer.exe\`. L'exécutable n'est pas signé : au premier lancement, Windows SmartScreen → *Informations complémentaires* → *Exécuter quand même*.

**Installation (EN)** — Download the zip below, extract it, run \`TeslaCam Viewer.exe\`. The executable is unsigned: on first launch, Windows SmartScreen → *More info* → *Run anyway*.

*Non affilié à Tesla, Inc. · Not affiliated with Tesla, Inc.*
`);
