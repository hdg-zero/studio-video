# Performance

## Où passe le temps

Mesure sur le projet panoptique, image 1920×1080 avec bloom, Chromium sans GPU (SwiftShader, 4 vCPU) :

| Étape d'une image                                                    | Temps   |
| -------------------------------------------------------------------- | ------- |
| `renderAt(t)` côté JavaScript (scène, incrustations)                 | ~25 ms  |
| Exécution WebGL (émulée sur CPU par SwiftShader)                     | ~700 ms |
| Capture JPEG via CDP                                                 | ~115 ms |
| Encodage x264 (processus ffmpeg séparé, pendant la capture suivante) | masqué  |

**Sur CPU, 85 % du temps est l'émulation du GPU.** Optimiser la capture ou l'encodage n'y change presque rien : à configuration égale (311 images 1080p, 2 processus), l'ancien pipeline et le nouveau prennent tous deux ~142 s. Les leviers qui comptent sont donc, dans l'ordre :

1. **Rendre sur le GPU** : l'étape à ~700 ms tombe à quelques millisecondes ; la capture (~100 ms, CPU) devient la limite, soit de l'ordre de 5 à 10 images/s par worker au lieu de ~1,1. _Estimation à confirmer sur votre machine : `studio render` affiche le débit réel._
2. **Ne pas re-rendre** ce qui n'a pas changé (cache incrémental).
3. **Rendre moins de pixels** pendant la mise au point (`--draft`, `--only`).
4. Occuper tous les cœurs (workers, file partagée) et faire travailler navigateur et encodeur en même temps : dans un worker, l'image suivante est capturée pendant que ffmpeg encode la précédente. Sur CPU ça ne change rien (mesuré : 330 images 720p, 58 s avant, 61 s après, au bruit près, images identiques) ; ça compte sur GPU, quand l'encodage devient comparable à la capture.

## Cache incrémental : mesure

Projet de démonstration (804 images, 720p, CPU) :

| Action                                               | Images rendues                   | Durée             |
| ---------------------------------------------------- | -------------------------------- | ----------------- |
| premier rendu                                        | 804                              | 1 min 49          |
| une scène modifiée (`scenes/idee.ts`), nouveau rendu | 226 (7 morceaux sur 10 en cache) | 35 s              |
| rien de modifié                                      | 0                                | ~2 s (assemblage) |

Même logique pour la voix (`tts` ne régénère que les textes modifiés) et pour une interruption (Ctrl+C) : relancer reprend avec les morceaux déjà finis.

## Activer le GPU sous Arch Linux

`studio doctor` essaie dans l'ordre ANGLE/Vulkan, ANGLE/OpenGL et EGL, et garde le premier qui n'est pas un rasteriseur logiciel (le résultat est mis en cache dans `~/.cache/studio-video/gpu.json`).

```bash
# pilotes Vulkan selon le GPU
sudo pacman -S --needed vulkan-icd-loader mesa vulkan-radeon     # AMD
sudo pacman -S --needed vulkan-icd-loader mesa vulkan-intel      # Intel
sudo pacman -S --needed vulkan-icd-loader nvidia-utils           # NVIDIA (pilote propriétaire)
vulkaninfo --summary                                             # (paquet vulkan-tools) doit lister le GPU

studio doctor --refresh-gpu      # refaire la détection après un changement de pilote
```

Si le Chromium de Playwright ne voit pas le GPU, essayer celui du système : `sudo pacman -S chromium` puis `export CHROME_PATH=/usr/bin/chromium`.

`--gpu gpu` fait échouer le rendu plutôt que de basculer en silence sur le CPU ; `--gpu cpu` force SwiftShader.

## Réglages

| Option                    | Effet                          | Conseil                                                                                        |
| ------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `-j, --workers N`         | navigateurs en parallèle       | défaut : moitié des threads CPU (max 8). Sur GPU, monter tant que le débit total augmente      |
| `--chunk-frames N`        | taille max d'un morceau        | 90 (3 s) : bon compromis entre granularité du cache et nombre de fichiers                      |
| `--draft`                 | 1280×720, x264 `veryfast`      | pour le rythme et le cadrage                                                                   |
| `--only a,b`              | quelques segments, son compris | pour mettre au point une scène                                                                 |
| `--codec vaapi` / `nvenc` | encodage sur le GPU            | soulage le CPU quand il est le facteur limitant ; x264 reste la meilleure qualité à débit égal |
| `look.msaa` (capsule)     | anticrénelage du rendu 3D      | 4 par défaut, appliqué seulement sur GPU (sur CPU il double le temps de rendu)                 |

Qualité finale : x264 CRF 16, preset `medium`, JPEG 95 en entrée, couleurs balisées BT.709. Un fichier final de ~2 min 30 pèse ~110 Mo ; pour l'envoyer, réencoder en CRF 23.

## Audio

`studio music` traite ~2 min 30 en ~25 s : tout est vectorisé (numpy), filtres et réverbération par FFT, les sons courts répétés (cordes pincées, cloches) sont synthétisés une fois par hauteur puis réutilisés, l'autocorrélation du contrôle de voix est calculée par FFT pour toutes les trames d'un coup.
