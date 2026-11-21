# TeslaCam Viewer

Lecteur Windows pour les clips **Dashcam / Sentinelle** enregistrés par une Tesla sur clé USB : les 6 caméras synchronisées, comme dans la voiture, y compris les **clips chiffrés** (logiciel Tesla 2026.20+).

> Projet personnel, **non affilié à Tesla, Inc.** « Tesla », « TeslaCam » et « Sentry Mode » sont des marques de Tesla, Inc.

## Fonctionnalités

- **6 caméras synchronisées** (avant, arrière, montants, répétiteurs), plusieurs dispositions : *comme dans la voiture*, *avant + arrière*, *une caméra en grand*, *grille 3×2*.
- **Clips chiffrés** : déchiffrement **local et à la volée** (seul ce qui est regardé est déchiffré, rien n'est écrit en clair sur le disque).
- **Télémétrie** embarquée par Tesla dans la vidéo : vitesse, rapport, angle du volant, accélérateur, frein, clignotants, Autosteer / FSD.
- **Repère de l'événement** sur la timeline, vignettes, filtres Enregistrés / Sentinelle / Récents, raccourcis clavier.

## Confidentialité

- Les vidéos **ne quittent jamais le PC**.
- Pour un clip chiffré, seules ses **métadonnées de clé** (en-tête de ~200 octets) sont envoyées à `dashcam.tesla.com`, qui renvoie la clé du clip — exactement ce que fait le lecteur officiel de Tesla.
- La connexion se fait sur la **vraie page Tesla**, dans une fenêtre de l'appli : le mot de passe ne va qu'à Tesla. Le jeton de session reste en mémoire.
- Les clés reçues sont conservées **chiffrées par Windows (DPAPI)** : un clip déverrouillé une fois se relit hors connexion.

## Limites connues

- Le déchiffrement repose sur l'**API non documentée** du lecteur web de Tesla : une évolution côté Tesla peut le casser.
- Dans `EncryptedClips`, `event.json` et `thumb.png` ne contiennent pas de métadonnées de clé : seule la voiture peut les lire. Le moment de l'événement est alors déduit du nom du dossier (≈ quelques secondes près) et la vignette est prise dans la vidéo.
- La télémétrie n'existe que sur les clips récents (logiciel 2025.44.25+, HW3+) et pas quand la voiture est garée.
- L'exécutable n'est pas signé : Windows SmartScreen demande une confirmation au premier lancement.

## Utilisation

```bash
npm install
npm start          # lancer en développement
npm run package    # construire l'application Windows (dist/)
npm test           # tests du déchiffrement (TCV_SAMPLES=chemin/vers/TeslaCam)
```

Raccourcis : `Espace` lecture · `←/→` ±5 s (`Maj` ±1 s) · `1`–`6` caméra · `G` disposition · `T` télémétrie · `E` événement · `↑/↓` événement précédent/suivant · `F` plein écran · `Échap` vue par défaut.

## Crédits

- Format du conteneur chiffré et de l'appel de clés : travaux de rétro-ingénierie publiés par [steiner-dominik/tesla-dashcam-decrypt](https://github.com/steiner-dominik/tesla-dashcam-decrypt), [crstian19/tesla-dashcam-decrypt-go](https://github.com/crstian19/tesla-dashcam-decrypt-go) et [pieczorx/tesla-manager](https://github.com/pieczorx/tesla-manager).
- Format de la télémétrie : [`dashcam.proto`](https://github.com/teslamotors/dashcam) publié par Tesla.

## Licence

MIT — voir [LICENSE](LICENSE).
