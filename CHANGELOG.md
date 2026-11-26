# Changelog

Chaque version est décrite en français puis en anglais. Les notes de release GitHub sont générées à partir de ce fichier.
Each version is described in French, then in English. GitHub release notes are generated from this file.

## [0.7.1] - 2026-11-26

### 🇫🇷 Français
- **Correction du floutage des plaques** : sur la caméra avant, seule la bande centrale de l'image (30 à 70 % de la hauteur) était analysée ; les plaques des voitures garées juste devant, plus bas dans l'image, n'étaient pas floutées. L'image entière est maintenant analysée en plus des trois tuiles. Un test vérifie que chaque pixel de chaque caméra est analysé.

### 🇬🇧 English
- **Plate blurring fix**: on the front camera, only the middle band of the picture (30 to 70 % of its height) was analysed; the plates of cars parked right in front, lower in the picture, were not blurred. The whole picture is now analysed as well as the three tiles. A test checks that every pixel of every camera is analysed.

## [0.7.0] - 2026-11-26

### 🇫🇷 Français
- **Floutage des plaques d'immatriculation par une IA locale**, activé par le mode 📱 Réseaux sociaux (réglable dans « Personnaliser »). La détection tourne sur ce PC (carte graphique via DirectML si possible, sinon processeur) ; le modèle (8 Mo, licence MIT) est téléchargé une seule fois depuis GitHub et vérifié. La caméra avant est analysée en trois tuiles pour ne pas rater les petites plaques. Le mode 🛡️ Assurance ne floute pas : la plaque de l'autre véhicule fait partie de la preuve.
- **Résumé factuel** : bouton 📝 Résumé, fichier `Resume_factuel.txt` et section en tête de la fiche PDF. Des phrases à trous remplies avec les données de la voiture ; une phrase n'apparaît que si toutes ses informations sont disponibles et autorisées (lieu et vitesse peuvent être retirés). Français et anglais.
- **Axes de l'accéléromètre mesurés sur de vrais clips** : la fiche distingue maintenant freinage et accélération latérale ; aucune fausse alerte en conduite normale.
- La compilation vérifie sur Windows que la détection des plaques démarre (DirectML ou processeur).

### 🇬🇧 English
- **Licence plate blurring by a local AI**, turned on by the 📱 Social media preset (adjustable under “Customize”). Detection runs on this PC (graphics card through DirectML when possible, else the processor); the model (8 MB, MIT licence) is downloaded once from GitHub and checked. The front camera is read as three tiles so small plates are not missed. The 🛡️ Insurance preset does not blur: the other vehicle's plate is part of the evidence.
- **Factual summary**: 📝 Summary button, `Factual_summary.txt` file and a section at the top of the PDF report. Fill-in-the-blank sentences completed with the car's data; a sentence only appears when all its information is available and allowed (place and speed can be left out). French and English.
- **Accelerometer axes measured on real clips**: the report now tells braking from lateral acceleration; no false alarm in normal driving.
- The build checks on Windows that plate detection starts (DirectML or processor).

## [0.6.0] - 2026-11-26

### 🇫🇷 Français
- **Deux modes d'export**, choisis d'un clic dans la fenêtre d'export :
  - 🛡️ **Assurance / constat** : crée un dossier avec la vidéo (bandeau sous l'image : date et heure à la seconde, commune et route, coordonnées GPS et cap, vitesse, rapport, frein, clignotants, aide à la conduite, G-force), les **clips d'origine non modifiés** de toutes les caméras (déchiffrés, sans réencodage), une **fiche PDF** (lieu, état du véhicule au moment de l'événement, vitesse maximale et G-force maximale à ± 10 s, moments détectés, capture des 6 caméras) et les **empreintes SHA-256** de chaque fichier (aussi dans `SHA256SUMS.txt`).
  - 📱 **Réseaux sociaux** : aucun lieu affiché, vitesse masquée, et **la télémétrie de Tesla, position GPS comprise, est retirée** des vidéos d'une caméra (image intacte, toujours sans réencodage).
  - Chaque réglage reste modifiable dans « Personnaliser ».
- **Adresse en mode assurance** : celle notée par la voiture (`event.json`) quand elle est lisible ; sinon, et seulement si l'option est cochée, la commune et la route sont demandées une fois à OpenStreetMap à partir de la position GPS.
- **G-force** dans la télémétrie (accélération ressentie, à 0 en conduite régulière), à l'écran et dans les vidéos exportées.
- **Moments détectés** sur la timeline : 🛑 freinage brusque, ↪️ virage serré, 💥 secousse ou choc, 🔵 FSD / Autosteer désactivé. Un clic pour y aller.

### 🇬🇧 English
- **Two export presets**, one click in the export window:
  - 🛡️ **Insurance / claim**: creates a folder with the video (band under the picture: date and time to the second, town and road, GPS coordinates and heading, speed, gear, brake, turn signals, driver assistance, g-force), the **untouched original clips** of every camera (decrypted, not re-encoded), a **PDF report** (place, vehicle state at the event, top speed and peak g within ± 10 s, detected moments, snapshot of the 6 cameras) and **SHA-256 fingerprints** of every file (also in `SHA256SUMS.txt`).
  - 📱 **Social media**: no place shown, speed hidden, and **Tesla's telemetry, GPS position included, is removed** from single-camera videos (picture untouched, still no re-encoding).
  - Every setting stays editable under “Customize”.
- **Address in the insurance preset**: the one the car recorded (`event.json`) when readable; otherwise, and only if the option is ticked, the town and road are looked up once on OpenStreetMap from the GPS position.
- **G-force** in the telemetry (felt acceleration, 0 when driving steadily), on screen and in exported videos.
- **Detected moments** on the timeline: 🛑 hard braking, ↪️ sharp turn, 💥 jolt or impact, 🔵 FSD / Autosteer switched off. Click one to jump there.

## [0.5.2] - 2026-11-26

### 🇫🇷 Français
- **Correction : l'export vidéo échouait** dans les versions téléchargées (0.5.0 et 0.5.1) avec le message « Cannot read properties of undefined (reading 'StreamTarget') ». La bibliothèque vidéo n'était pas incluse dans l'application compilée sous Windows ; elle l'est de nouveau.
- La compilation vérifie maintenant que tous les fichiers de l'interface sont bien présents avant de publier une version.

### 🇬🇧 English
- **Fix: video export failed** in the downloaded builds (0.5.0 and 0.5.1) with “Cannot read properties of undefined (reading 'StreamTarget')”. The video library was left out of the app built on Windows; it is back in.
- The build now checks that every file the interface loads is in the app before a release is published.

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
