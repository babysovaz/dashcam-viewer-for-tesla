# Changelog

Chaque version est décrite en français puis en anglais. Les notes de release GitHub sont générées à partir de ce fichier.
Each version is described in French, then in English. GitHub release notes are generated from this file.

## [0.4.0] - 2026-11-22

### 🇫🇷 Français
- **Interface bilingue français / anglais** : la langue de Windows est choisie automatiquement, un sélecteur 🇫🇷 / 🇬🇧 en haut à droite permet de changer à tout moment (choix mémorisé). Dates, raisons d'événement, télémétrie et messages d'erreur suivent la langue.
- Notes de release : correction de la ligne de titre en trop.

### 🇬🇧 English
- **Bilingual French / English interface**: the Windows language is picked automatically, a 🇫🇷 / 🇬🇧 selector at the top right switches at any time (choice remembered). Dates, event reasons, telemetry and error messages follow the language.
- Release notes: removed the stray title line.

## [0.3.0] - 2026-11-22

### 🇫🇷 Français
- **Clips chiffrés** (logiciel Tesla 2026.20+) : connexion au compte Tesla via la vraie page dashcam.tesla.com, puis déchiffrement **local et à la volée**. Les clés sont conservées chiffrées par Windows : un clip déverrouillé une fois se relit hors connexion.
- **Dispositions** : *comme dans la voiture* (par défaut), *avant + arrière en grand*, *une caméra en grand*, *grille 3×2*. Le choix est mémorisé.
- **Télémétrie** : vitesse, rapport, angle du volant, accélérateur, frein, clignotants, Autosteer / régulateur / FSD (touche `T`).
- **Repère de l'événement** (⚑) sur la timeline, cliquable (touche `E`).
- **Vignettes** générées depuis la caméra avant quand la voiture ne les rend pas lisibles (clips chiffrés).

### 🇬🇧 English
- **Encrypted clips** (Tesla software 2026.20+): sign in to your Tesla account on the real dashcam.tesla.com page, then **local, on-the-fly** decryption. Keys are kept encrypted by Windows: a clip unlocked once replays offline.
- **Layouts**: *like in the car* (default), *front + rear large*, *one large camera*, *3×2 grid*. The choice is remembered.
- **Telemetry**: speed, gear, steering angle, accelerator, brake, turn signals, Autosteer / cruise / FSD (`T` key).
- **Event marker** (⚑) on the timeline, clickable (`E` key).
- **Thumbnails** grabbed from the front camera when the car keeps them unreadable (encrypted clips).
