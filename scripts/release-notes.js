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

**Installation (FR)** — Télécharger **\`Dashcam-Viewer-for-Tesla-…-Setup.exe\`** ci-dessous et le lancer : l'application s'installe pour ton compte (sans droits administrateur), avec un raccourci sur le Bureau et dans le menu Démarrer. Elle se désinstalle depuis *Paramètres → Applications*. Variante sans installation : le **zip**, à dézipper, puis lancer \`Dashcam Viewer for Tesla.exe\`. Le logiciel n'est pas signé : au premier lancement, Windows SmartScreen → *Informations complémentaires* → *Exécuter quand même*.

**Installation (EN)** — Download **\`Dashcam-Viewer-for-Tesla-…-Setup.exe\`** below and run it: the app installs for your account (no admin rights), with Desktop and Start menu shortcuts. Uninstall from *Settings → Apps*. No-install alternative: the **zip** — extract it, run \`Dashcam Viewer for Tesla.exe\`. The software is unsigned: on first launch, Windows SmartScreen → *More info* → *Run anyway*.

*Non affilié à Tesla, Inc. · Not affiliated with Tesla, Inc.*
`);
