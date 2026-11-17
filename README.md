# Studio vidéo

> [!WARNING]
> **Preuve de concept expérimentale.** Ce studio est un prototype, pas un outil éprouvé : il n'a été testé que sur quelques machines Linux et quelques projets, son interface, ses commandes et le format de `capsule.json` peuvent changer sans préavis, et des bogues sont à prévoir. Ne comptez pas dessus pour un usage en production.

Fabrique de **capsules vidéo narrées** : des scènes 3D Three.js rendues image par image dans Chromium sans écran, une voix off (TTS OpenRouter), une musique synthétisée qui suit les ambiances et passe sous la voix, des sous-titres et des cartons, en MP4 Full HD.

La voix pilote la timeline : chaque segment dure _amorce + voix + respiration_, donc image, sous-titres et musique tombent juste sans calage manuel.

```
capsule.json ─ tts ─▶ voice/*.pcm ─ timeline ─▶ .studio/timeline.json ─ music ─▶ .studio/audio/mix_norm.wav
scenes/*.ts ──────────── esbuild ─▶ bundle ─ stills (planche contact) ─ render (parallèle, cache) ─▶ out/<Titre>.mp4
```

## Démarrage rapide

```bash
git clone <url-du-dépôt> studio && cd studio
npm run setup                     # dépendances Node + Chromium + .venv Python, puis diagnostic
npm link                          # commande `studio` disponible partout (optionnel)

studio ui                         # interface web : http://127.0.0.1:8123
# ou, en ligne de commande :
studio new ma-capsule --title "Ma capsule"
# écrire projects/ma-capsule/capsule.json (texte, ambiances) et projects/ma-capsule/scenes/*.ts
export OPENROUTER_API_KEY=…       # jamais dans un fichier du projet
studio make ma-capsule --draft    # voix → timeline → musique → brouillon 720p
studio stills ma-capsule          # planche contact : une image par segment
studio render ma-capsule          # rendu final 1080p
```

Sans clé OpenRouter, `studio make` estime les durées depuis le texte et produit une vidéo sans voix.

L'exemple complet est [`projects/panoptique`](projects/panoptique). Ses voix off ne sont pas incluses dans le dépôt : `studio make panoptique` les génère si `OPENROUTER_API_KEY` est définie, sinon il estime les durées et rend la vidéo sans voix.

## Ce qui le rend rapide

| Levier                                                                       | Effet                                                    |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| WebGL sur le **GPU** (Vulkan/EGL détecté automatiquement, repli SwiftShader) | sur CPU, 85 % du temps d'une image est l'émulation WebGL |
| **Cache incrémental** par morceau de segment                                 | modifier une scène ne re-rend que cette scène            |
| File de travail partagée, plus longs morceaux d'abord                        | tous les cœurs occupés jusqu'à la fin                    |
| `--draft` (720p, x264 veryfast) et `--only <segments>`                       | itérations courtes, son compris                          |
| Voix générées en parallèle, en cache par texte                               | changer une phrase coûte une requête                     |
| esbuild (~100 ms), serveur HTTP intégré, polices locales                     | aucun téléchargement pendant un rendu, rendu hors ligne  |

Mesures et réglages : [docs/performance.md](docs/performance.md).

## Commandes

| Commande                                                               | Rôle                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `studio ui [--port 8123]`                                              | interface web guidée, avec assistant IA (OpenRouter)        |
| `studio new <nom> [--vertical]`                                        | crée un projet depuis le modèle (vertical : 9:16 court)     |
| `studio short <projet> --segments a,b,c`                               | tire une vidéo verticale courte de quelques segments        |
| `studio projects`                                                      | liste les projets                                           |
| `studio status <projet>`                                               | étapes à jour ou à refaire, rendus, prochaine commande      |
| `studio voices --query narrat`                                         | cherche une voix fixe (Fish Audio)                          |
| `studio tts <projet> [--only id] [--check]`                            | voix off, en parallèle et en cache                          |
| `studio timeline <projet> [--estimate]`                                | timeline pilotée par la voix                                |
| `studio music <projet>`                                                | musique selon les ambiances, mixée et normalisée à −16 LUFS |
| `studio stills <projet> [t…]`                                          | planche contact pour vérifier le cadrage                    |
| `studio preview <projet>`                                              | aperçu temps réel, rechargé à chaque sauvegarde             |
| `studio render <projet> [--draft] [--only ids] [-j N] [--codec vaapi]` | rendu MP4                                                   |
| `studio make <projet>`                                                 | toute la chaîne                                             |
| `studio check <video> t…`                                              | images extraites du MP4 final                               |
| `studio voicecheck <projet>`                                           | détecte un clip prononcé par une autre voix                 |
| `studio clean <projet>`                                                | supprime le cache (`.studio`) d'un projet                   |
| `studio schema`                                                        | régénère `schemas/capsule.schema.json`                      |
| `studio doctor`                                                        | diagnostic (ffmpeg, Chromium, GPU, Python)                  |

`studio help <commande>` donne toutes les options. `--json` sur n'importe quelle commande écrit son résultat en JSON sur la sortie standard (pour les scripts et les agents, voir [AGENTS.md](AGENTS.md)) ; Ctrl+C arrête proprement l'étape en cours.

## Documentation

- [Guide : faire une capsule](docs/guide.md), de l'idée au MP4
- [Interface web](docs/ui.md)
- [Plans sans code](docs/plans.md) : image, vidéo, titre, citation, chiffre, liste, graphique, frise
- [Écrire des scènes](docs/scenes.md) : API du moteur, règles, recettes
- [Architecture](docs/architecture.md) : composants, flux de données, choix techniques justifiés
- [Performance](docs/performance.md) : mesures, GPU sous Arch Linux, réglages
- [Développement](docs/development.md) : standards de code, tests, étendre le studio
- [Agents](AGENTS.md) : piloter le studio depuis Claude ou un script

## Prérequis

Linux, Node.js ≥ 22, ffmpeg, Python ≥ 3.11. Sous Arch : `sudo pacman -S --needed nodejs npm ffmpeg python` (+ `vulkan-icd-loader` et le pilote Vulkan de votre GPU pour le rendu GPU).

## Contribuer

Les contributions sont les bienvenues : voir [CONTRIBUTING.md](CONTRIBUTING.md). Une faille de sécurité se signale en privé ([SECURITY.md](SECURITY.md)).

## Licence

Distribué sous la [licence Apache 2.0](LICENSE). Voir aussi [NOTICE](NOTICE).

Les dépendances gardent leurs propres licences (three.js : MIT ; polices Space Grotesk et JetBrains Mono : SIL OFL 1.1 ; Playwright, esbuild, Preact, zod, numpy…). Les voix générées par un service de synthèse vocale sont soumises aux conditions de ce service.
