# Changelog

Chaque version est décrite en français puis en anglais. Les notes de release GitHub sont générées à partir de ce fichier.
Each version is described in French, then in English. GitHub release notes are generated from this file.

## [0.5.1] - 2026-11-23

### 🇫🇷 Français
- **Installateur Windows** (`…-Setup.exe`) : double-clic, l'application s'installe pour ton compte sans droits administrateur, avec raccourcis Bureau et menu Démarrer, et se désinstalle depuis *Paramètres → Applications*. Le zip reste disponible pour une utilisation sans installation.
- **Nouvelle icône** pour l'application (caméra sur fond rouge, sans marque).
- Les clés enregistrées, la connexion Tesla et les réglages sont conservés.

### 🇬🇧 English
- **Windows installer** (`…-Setup.exe`): double-click, the app installs for your account with no admin rights, with Desktop and Start menu shortcuts, and uninstalls from *Settings → Apps*. The zip is still there for a no-install use.
- **New app icon** (camera on a red background, no branding).
- Saved keys, the Tesla sign-in and settings are kept.

## [0.5.0] - 2026-11-23

### 🇫🇷 Français
- **Export vidéo**, selon la vue affichée (bouton à côté de « ⚑ Événement ») :
  - vue *une caméra en grand* → **💾 Enregistrer la caméra** : la caméra principale en un seul MP4 pour tout l'événement (ou la minute en cours), **sans réencodage** : qualité d'origine, quelques secondes, déchiffrée si le clip l'était. La télémétrie de Tesla reste dans la vidéo ;
  - vues *grille 3×2* et *avant + arrière* → **🎞️ Exporter la vue** : une seule vidéo avec les 6 caméras disposées comme à l'écran, date et heure incrustées, télémétrie en option, en Full HD (idéal téléphone) ou 4K.
  - Barre de progression avec temps restant, bouton Arrêter (le fichier incomplet est supprimé), clic sur le message final pour ouvrir le dossier.
- **La vue « comme dans la voiture » est fusionnée avec la grille 3×2**, qui devient la vue par défaut (c'était la même disposition).
- Correction : la télémétrie pouvait planter l'affichage en conduite manuelle.
- Correction : en fin d'événement, les caméras dont la vidéo dure un peu plus que la caméra principale continuaient de tourner en boucle sur la dernière image ; tout s'arrête maintenant, et Lecture relance l'événement depuis le début.

### 🇬🇧 English
- **Video export**, depending on the current view (button next to “⚑ Event”):
  - *one large camera* view → **💾 Save this camera**: the main camera as one MP4 for the whole event (or the current minute), **with no re-encoding**: original quality, takes seconds, decrypted if the clip was encrypted. Tesla's telemetry stays in the video;
  - *3×2 grid* and *front + rear* views → **🎞️ Export this view**: one video with the 6 cameras laid out as on screen, date and time burned in, optional telemetry, in Full HD (phone-friendly) or 4K.
  - Progress bar with time left, Stop button (the partial file is deleted), click the final message to open the folder.
- **The “like in the car” view is merged into the 3×2 grid**, now the default view (it was the same layout).
- Fix: telemetry could break the display while driving manually.
- Fix: at the end of an event, cameras whose file runs slightly longer than the main camera kept looping on the last frame; everything now stops, and Play starts the event over.

## [0.4.1] - 2026-11-22

### 🇫🇷 Français
- **Nouveau nom : « Dashcam Viewer for Tesla »** (anciennement « TeslaCam Viewer »), pour ne plus commencer par une marque de Tesla. Le logo « T » est remplacé par une icône neutre.
- Les clés déjà enregistrées, la connexion Tesla et les réglages sont conservés.

### 🇬🇧 English
- **New name: “Dashcam Viewer for Tesla”** (formerly “TeslaCam Viewer”), so the name no longer starts with a Tesla trademark. The “T” logo is replaced by a neutral icon.
- Saved keys, the Tesla sign-in and settings are kept.

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
