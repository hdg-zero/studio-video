# Guide pour les agents (Claude et autres)

Ce dépôt est un studio de capsules vidéo narrées. Tout se pilote par la commande `studio` : un agent n'a besoin ni de l'interface web ni d'un navigateur. Ce guide dit comment s'en servir sans surprise.

## Démarrer

```bash
npm run setup          # une fois : dépendances, Chromium, .venv Python, build, diagnostic
node bin/studio.mjs …  # ou `studio …` après `npm link`
```

Après toute modification de `packages/cli` ou `packages/ui` : `npm run build`. Avant de livrer : `npm run check`.

## Règles de sortie (contrat stable)

- `--json` sur **n'importe quelle commande** : stdout ne contient qu'un document JSON (le résultat de la commande, ou `{"error": "…"}` en cas d'échec). Les messages pour humains vont sur stderr.
- Codes de sortie : `0` succès, `1` erreur, `130` interrompu (SIGINT/SIGTERM).
- SIGINT ou SIGTERM arrêtent proprement l'étape en cours (navigateurs, ffmpeg, Python) ; le travail déjà fait reste en cache et une relance reprend où elle s'était arrêtée.
- Les messages d'erreur disent quoi faire ensuite (« run `studio timeline` first »).

## Boucle de travail

1. **Où en est le projet ?** `studio status <projet> --json`. Le champ `next` donne la commande à lancer et pourquoi (`null` quand la vidéo finale est à jour). Chaque étape a un état `fresh` (à jour), `stale` (entrées modifiées depuis) ou `missing`.
2. **Écrire** `projects/<projet>/capsule.json` (schéma : `schemas/capsule.schema.json`, erreurs de validation avec leur chemin JSON) et, pour chaque segment, une scène dans `scenes/<id>.ts` (voir [docs/scenes.md](docs/scenes.md)) ou un plan tout prêt dans son champ `visual` : image ou vidéo de `media/`, titre, citation, chiffre, liste, graphique, frise (voir [docs/plans.md](docs/plans.md)).
3. **Voix** : `studio tts <projet>` si `OPENROUTER_API_KEY` est définie. Sans clé : `studio timeline <projet> --estimate` (durées estimées depuis le texte).
4. **Timeline puis musique** : `studio timeline <projet>`, `studio music <projet>`.
5. **Regarder** : `studio stills <projet> --json` renvoie `{"file": ".../contact_sheet.png"}`. Ouvrir ce PNG (lecture d'image) et vérifier chaque segment : texte qui chevauche le sujet, image brûlée par le bloom, cadrage vide, erreurs de page signalées sur stderr. Instants précis : `studio stills <projet> 12 30.5`.
6. **Rendre** : `studio render <projet> --draft --only <id>` pour une scène (avec son), `--draft` pour tout en 720p, sans option pour le final 1080p. Le résultat JSON donne `output`, `frames`, `renderedFrames`, `seconds`, `renderer`.
7. **Vérifier le fichier** : `studio check <video.mp4> 5 30 60 --json` → planche d'images extraites du MP4 lui-même.

`studio make <projet> --draft` enchaîne voix (si clé), timeline, musique et rendu.

**Vidéo verticale courte** (9:16) : `studio short <projet> --segments a,b,c --json` crée `<projet>-court` avec ces segments et leurs voix déjà payées ; `studio new <nom> --vertical` part de zéro. Détails : [docs/vertical.md](docs/vertical.md).

## Durées et longues tâches

Un rendu 1080p sur CPU (SwiftShader) tourne à ~1 image/s par worker ; sur GPU, plusieurs fois plus vite. Pour un rendu long, le lancer en arrière-plan et lire son journal plutôt que bloquer : la progression s'affiche sur stderr toutes les 10 s hors terminal (`  120/4314 images · 1.1/s · reste ~1h03`). `studio status --json` reste juste pendant et après.

Pour itérer sur une scène : `--draft --only <id>` (quelques secondes à une minute), jamais un rendu complet.

## Ce qu'il ne faut pas faire

- Écrire la clé OpenRouter dans un fichier : elle se lit dans l'environnement uniquement.
- Utiliser `Math.random`, `Date.now`, `performance.now`, `setTimeout` ou un état accumulé dans une scène : les images sont rendues dans le désordre par plusieurs navigateurs (ESLint le refuse dans `scenes/`).
- Supprimer `voice/` (les clips coûtent des appels API). `.studio/` est un cache jetable (`studio clean`).
- Lancer `studio ui` ou `studio preview` sans qu'on le demande : ce sont des serveurs qui ne rendent pas la main.

## Repères dans le code

| Besoin                                      | Fichier                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Étapes appelables (CLI et interface)        | `packages/cli/src/core/actions.ts`                                                         |
| État d'un projet, prochaine étape           | `packages/cli/src/core/status.ts`                                                          |
| Schéma de `capsule.json`                    | `packages/cli/src/core/config.ts`                                                          |
| Rendu parallèle et cache                    | `packages/cli/src/core/render.ts`, `render-workers.ts`, `plan.ts`, `bundle.ts`             |
| Moteur des scènes (navigateur)              | `packages/runtime/src/engine.ts`                                                           |
| Interface web : serveur, contrat, front-end | `packages/cli/src/ui/`, `packages/ui/src/`                                                 |
| Assistant de l'interface (OpenRouter)       | `packages/cli/src/ai/` (format, vérification, application), `packages/ui/src/assistant.ts` |
| Vérifications du dépôt (`npm run check`)    | scope et exceptions des projets : [docs/development.md](docs/development.md)               |
| Écriture et enregistrement des scènes       | `packages/cli/src/core/scenes.ts`                                                          |
| Audio (Python)                              | `packages/audio/src/studio_audio/`                                                         |

Conventions : [docs/development.md](docs/development.md). Architecture : [docs/architecture.md](docs/architecture.md).
