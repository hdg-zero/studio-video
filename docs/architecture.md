# Architecture

## Vue d'ensemble

```
studio/
├── bin/studio.mjs            point d'entrée de la commande `studio`
├── packages/
│   ├── runtime/              moteur côté navigateur (TypeScript, Three.js)
│   │   └── src/              engine · overlays · visuals · subtitles · helpers · math · types · styles.css
│   ├── cli/                  orchestration côté Node (TypeScript)
│   │   └── src/
│   │       ├── main.ts       analyse des arguments, aiguillage
│   │       ├── commands/     une commande = un objet { name, usage, options, run } → résultat
│   │       ├── core/         config · project · timeline · steps · tts · audio · bundle · page
│   │       │                 server · browser · capture · encoder · plan · render · render-workers
│   │       │                 stills · preview · actions · status · doctor · scaffold · log
│   │       │                 scenes · media
│   │       ├── ai/           assistant : openrouter · search · prompt · chat · blocks · edits · patch
│   │       │                 normalize · check · compile · apply
│   │       └── ui/           serveur de l'interface : server (routes) · http · files · watch · jobs
│   │                         · protocol (contrat typé)
│   ├── ui/                   front-end de l'interface (Preact + TSX, esbuild ; styles/ : une feuille par zone)
│   └── audio/                synthèse et mixage (Python + numpy)
│       └── src/studio_audio/ synth · moods · mix · pitch · timeline · cli
├── projects/<nom>/           une capsule : capsule.json, scenes/, media/, voice/, .studio/ (cache), out/
├── templates/capsule/        modèle copié par `studio new`
├── schemas/                  JSON Schema de capsule.json (généré)
└── docs/
```

Trois paquets, trois responsabilités, des interfaces étroites entre eux :

| Paquet    | Tourne dans | Reçoit                                                       | Produit                     |
| --------- | ----------- | ------------------------------------------------------------ | --------------------------- |
| `runtime` | Chromium    | `BootConfig` (timeline, textes, format) injecté dans la page | `window.studio.renderAt(t)` |
| `cli`     | Node        | `capsule.json`, `scenes/`                                    | voix, timeline, bundle, MP4 |
| `audio`   | Python      | `timeline.json`, `voice/*.pcm`                               | `music.wav`, `mix_norm.wav` |
| `ui`      | navigateur  | API JSON + flux d'événements de `studio ui`                  | actions de l'utilisateur    |

## Flux de données

1. **`capsule.json`** est l'unique source de vérité d'une vidéo : textes, ambiances, voix, format, timing, musique. Il est validé par un schéma zod (`core/config.ts`) qui signale chaque erreur avec son chemin JSON ; `schemas/capsule.schema.json` en est dérivé pour la complétion dans l'éditeur.
2. **`tts`** envoie chaque segment à OpenRouter (en parallèle) et écrit `voice/<id>.pcm`. `voice/manifest.json` mémorise `sha256(modèle, voix, texte)` et la durée de chaque clip : un clip n'est régénéré que si l'une de ces trois choses change.
3. **`timeline`** calcule `t0 / voice / t1` de chaque segment (`amorce + voix + respiration`) et ajoute le segment muet `credits`. Une voix manquante ou périmée est une erreur, sauf avec `--estimate`.
4. **`music`** (Python) génère une piste par blocs d'ambiance, ajoute la réverbération, abaisse la musique sous la voix (side-chain), normalise à −16 LUFS.
5. **`render`** empaquette les scènes, découpe la vidéo en morceaux, rend ceux qui manquent au cache, les concatène sans ré-encodage et ajoute le son.

## Le moteur (runtime)

`boot(capsule, config)` crée le renderer WebGL, la chaîne de post-traitement (rendu, bloom, sortie ACES) et les incrustations DOM, puis expose `window.studio.renderAt(t)`.

Pour chaque image, `renderAt(t)` :

1. trouve le segment de `t` et n'affiche que le groupe Three.js de sa scène ;
2. remet l'apparence par défaut (bloom, brouillard, fond), qu'une scène peut modifier pour ses propres images ;
3. appelle la mise à jour de la scène avec `{ u, len, t, voiceAt, seg }` (sans scène mais avec un plan tout prêt : un fond de poussière animé) ;
4. pose le plan tout prêt du segment s'il en a un (`visuals.ts`) ;
5. met à jour les incrustations (titres, sous-titres, fondus) puis rend.

`renderAt` rend une promesse quand une image doit d'abord être décodée (image d'un extrait vidéo) : la capture l'attend (`awaitPromise`) avant la copie d'écran.

**Plans tout prêts** (`visuals.ts`, `cli/core/media.ts`). Le champ `visual` d'un segment (image, vidéo, titre, citation, chiffre, liste, graphique, frise ; voir [plans.md](plans.md)) est résolu par la CLI dans `BootConfig.visuals` : les images sont servies depuis `media/` sous `media/<fichier>?v=<empreinte>`, les vidéos sont découpées une fois par ffmpeg en JPEG numérotés (`.studio/frames/<empreinte>/`) servis sous `frames/`. Chaque plan est une couche DOM entre le canvas et les textes, animée comme une scène, en fonction pure du temps local et de la voix du segment. L'empreinte d'un plan (description + contenu des fichiers) entre dans la clé de cache des morceaux de son segment.

**Déterminisme.** Les images sont rendues dans le désordre par plusieurs navigateurs. Une scène est donc une fonction pure du temps : pas de `Math.random` (chaque scène reçoit un `rng` dont la graine est son identifiant), pas d'horloge, pas d'état accumulé d'une image à l'autre. ESLint fait respecter ces règles dans `projects/*/scenes`.

**Isolation des scènes.** La graine aléatoire d'une scène dérive de son id : ajouter ou réordonner des scènes ne change pas le hasard des autres. Chaque scène vit dans son fichier `scenes/<id>.ts`, ce que le cache exploite.

## Le rendu (cli/core/render.ts, render-workers.ts)

```
plan (pur)                 cache                      workers (N navigateurs + N ffmpeg)
segments → morceaux ≤ 90 i → clé de contenu → .mp4 ? ─non─▶ file partagée (plus longs d'abord)
                                               │oui                 │
                                               └──────────┬─────────┘
                                         concat -c copy + audio AAC ─▶ out/<Titre>.mp4
```

- **Planification** (`plan.ts`, pure et testée) : un morceau ne chevauche jamais deux segments. Il ne dépend donc que d'un segment. Le choix des segments (`--only`) et la tranche de son à garder pour une sélection contiguë y sont aussi.
- **Orchestration** (`render.ts`) : bundle, plan, clés, cache, puis assemblage et vérification du MP4. **Workers** dans `render-workers.ts`.
- **Clé de cache** : `sha256(version du pipeline, bornes du morceau, données du segment, réglages de sortie, empreinte du code partagé, empreinte du code de la scène)`. Les empreintes viennent du graphe d'imports d'esbuild (`bundle.ts`) : la fermeture de `scenes/<id>.ts` d'un côté, tout ce qui est partagé (moteur, three.js, `scenes/index.ts`, styles) de l'autre. Modifier `scenes/regard.ts` invalide les morceaux de `regard`, modifier `scenes/shared.ts` invalide les scènes qui l'importent, modifier un titre invalide tout.
- **Workers** : un navigateur par worker (avec SwiftShader, des pages d'un même navigateur partageraient un seul processus GPU). Chaque worker prend le prochain morceau de la file, le rend image par image via CDP et l'envoie dans son propre ffmpeg ; l'image suivante est capturée pendant que ffmpeg prend la précédente (le navigateur et l'encodeur travaillent en même temps, l'ordre des images est garanti). La première erreur arrête tous les workers ; Ctrl+C arrête proprement navigateurs et encodeurs.
- **Écritures atomiques** : un morceau est écrit dans `*.part.mp4` puis renommé ; un rendu interrompu ne laisse jamais de morceau corrompu dans le cache.
- **Assemblage** : les morceaux ont des réglages d'encodage identiques et sont concaténés sans ré-encodage (`-c copy`). Le cache ne garde que les morceaux du dernier rendu complet.

## Interface web et pilotage

**Une seule implémentation des étapes.** `core/actions.ts` expose chaque étape comme `runAction(projet, type, options, signal)`. Les commandes de la CLI et la file de tâches de l'interface appellent cette fonction ; aucune logique de production ne vit dans l'une ou l'autre.

**Annulation.** Chaque étape longue reçoit un `AbortSignal` : les requêtes de voix sont coupées, le processus Python est tué, les workers de rendu ferment encodeurs puis navigateurs. La CLI relie Ctrl+C/SIGTERM à ce signal (un second Ctrl+C force l'arrêt) ; l'interface le relie au bouton ■. Playwright ne gère pas les signaux lui-même, pour que les navigateurs ne soient pas tués avant les encodeurs.

**Événements.** `core/log.ts` publie chaque message (`log`) et chaque avancement (`progress`) comme événement typé. Le terminal en est un abonné ; la file de tâches de l'interface en est un autre, qui attribue les événements à la tâche en cours et les diffuse par SSE (`/api/events`). La sortie de Python est lue ligne à ligne et passe par le même journal.

**État d'un projet** (`core/status.ts`). Chaque étape est `fresh`, `stale` ou `missing`, calculé à partir du contenu, pas seulement des dates :

| Étape    | À jour quand                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------- |
| voix     | le hash `(modèle, voix, texte)` de chaque clip correspond au texte actuel                      |
| timeline | `timeline.json` est identique à la timeline que la capsule et les clips produisent maintenant  |
| musique  | `mix.json` (écrit après le mixage) contient l'empreinte actuelle des réglages, timeline, clips |
| planche  | plus récente que la capsule, la timeline, les scènes et les styles                             |
| rendu    | plus récent que tout cela et que le mixage                                                     |

`nextStep` en déduit la prochaine commande ; `studio status --json` et l'interface l'affichent.

**Interface web.** `studio ui` sert le front-end compilé (`packages/ui/dist`), une API JSON validée par zod, le flux d'événements, les fichiers livrables (vidéos avec requêtes `Range` pour la lecture et le déplacement, planche, mixage, clips PCM convertis en WAV à la volée) et un aperçu par projet. Les types échangés sont définis une fois, dans `cli/src/ui/protocol.ts`, et importés par les deux côtés : un changement d'un côté casse la vérification de types de l'autre.

- **File de tâches** : une tâche à la fois (un rendu occupe déjà tous les cœurs, et deux étapes d'un même projet se marcheraient dessus).
- **Aperçu intégré** : la page de la capsule est chargée dans une `iframe` avec `?embed`. Le moteur ne fait alors plus tourner sa propre horloge : il dessine l'instant que la page parente lui envoie par `postMessage`. La parente prend l'élément `<audio>` du mixage comme horloge, si bien qu'image, sous-titres et son restent calés ; c'est gratuit parce qu'une scène est une fonction pure du temps. L'aperçu a son propre bundle (`.studio/preview/`, esbuild en mode watch) : il ne touche jamais au bundle qu'un rendu en cours utilise.
- **Surveillance** : `fs.watch` récursif sur le dossier des projets (sauf caches) ; tout changement, d'où qu'il vienne, est signalé à l'interface qui recharge le projet concerné.
- **Organisation du serveur** : `ui/server.ts` ne fait qu'aiguiller les routes ; `ui/http.ts` porte les erreurs HTTP, la lecture du JSON et le contrôle d'origine, `ui/files.ts` l'import de médias et les clips WAV, `ui/watch.ts` la surveillance des dossiers.
- **Sécurité** : écoute sur 127.0.0.1 ; les requêtes adressées à un autre nom d'hôte sont refusées (rebinding DNS), ainsi que les requêtes d'écriture venant d'une autre origine. Seuls les livrables d'un projet sont lisibles par `/files`, jamais les sources ni la configuration.

**Assistant** (`cli/src/ai/`). Le serveur appelle l'API de chat d'OpenRouter en flux (SSE) et relaie au navigateur des événements typés ; la clé ne quitte jamais le processus, et une requête est coupée dès que le navigateur ferme la connexion.

```
question ─▶ prompt (stable, mis en cache │ projet compact │ historique sans code) ─▶ OpenRouter ─▶ réponse en flux
                                                                                                    │
                     blocs studio-edits / scene / scene-patch ◀─────────────────────────────────────┘
                                │ absorb : lecture, retouches appliquées
                                ▼
                     verify : capsule.json (zod) · defineScene(id) · bundle esbuild · typage TypeScript
                     │ erreurs ─▶ renvoyées au modèle (2 tours au plus) ─▶ blocs corrigés ─▶ verify
                     ▼ ok
                     plan ─▶ carte « Valider » ─▶ POST /api/ai/apply ─▶ verify (sans typage) ─▶ fichiers écrits ─▶ tâche make --draft
                                                  POST /api/ai/undo  ─▶ fichiers d'avant remis
```

- **Format** (`ai/blocks.ts` pour découper la réponse, `ai/edits.ts` pour les opérations, `ai/patch.ts` pour les retouches ; tous trois purs et partagés avec le navigateur) : ` ```studio-edits ` contient `{"edits": [...]}` (`update`, `insert`, `remove`, `move` sur les segments ; `set` sur une liste fermée de réglages) ; ` ```scene:<id> ` un fichier complet ; ` ```scene-patch:<id> ` des paires `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE` (chaque recherche doit être unique ; les espaces de fin de ligne sont ignorés). Un format en texte plutôt que l'appel d'outils marche avec tous les modèles et s'affiche au fil du flux.
- **Tolérance** (`ai/blocks.ts`, `ai/edits.ts`, `ai/normalize.ts`) : noms de blocs approchés acceptés (` ```json ` contenant `edits`, ` ```ts ` contenant `defineScene`), JSON réparé (commentaires, virgules finales, guillemets et retours à la ligne non échappés, crochets non fermés), puis chaque opération normalisée seule (alias d'opérations, ambiances en français, identifiants, `after` manquant, conflits) ; ce qui ne peut pas l'être devient une erreur pour cette seule opération. L'opération `replace` remplace toute la narration (un segment fautif est écarté, les autres gardés).
- **Vérification** (`ai/check.ts` ; compilateurs dans `ai/compile.ts`) : les opérations valides s'accumulent d'un tour de correction à l'autre (une opération qui casse le schéma de la capsule est retirée, les autres restent) ; une scène qui échoue n'empêche pas les autres ; les opérations sont validées par zod, appliquées à `capsule.json` en mémoire puis au schéma de la capsule (erreur nommée par segment) ; les scènes sont empaquetées par esbuild avec un greffon qui substitue les fichiers proposés (une nouvelle scène est résolue avant d'exister) ; puis TypeScript vérifie les fichiers proposés contre les types du moteur et de three.js (programme réutilisé d'une vérification à l'autre, ≈ 2 s ; ignoré si TypeScript n'est pas installé). Les avertissements « variable inutilisée » ne coûtent pas de tour de correction.
- **Application** (`ai/apply.ts`) : vérifie de nouveau contre le disque (la capsule a pu changer), écrit les scènes et `scenes/index.ts` avant la capsule, refuse un plan que la nouvelle vérification modifierait ; garde le contenu d'avant pour l'annulation dans `.studio/assistant/undo/<id>.json` (30 derniers, survit au redémarrage).
- **Jetons** (`ai/prompt.ts`, `ai/chat.ts`) : instructions fixes d'abord, avec un point de cache `cache_control` pour Anthropic et Google (les autres fournisseurs mettent le préfixe en cache seuls) ; un second point après la description du projet sert aux tours de correction ; projet décrit en lignes plutôt qu'en JSON, code des seules scènes visées (segment ciblé et identifiants cités, trois au plus) ; 12 derniers messages, réponses passées réduites à leur texte et à « [scène x, validée et appliquée] » ; corrections limitées aux blocs fautifs.
- **Pannes** (`ai/openrouter.ts`) : nouvel essai avec attente croissante (ou `Retry-After`) sur erreur réseau, 408, 429 et 5xx ; pas de modèle de secours (seul le modèle choisi répond) ; recherche web sur demande (`ai/search.ts` : `web: 'openrouter'` → greffon `plugins: [{id: 'web'}]` au premier appel de la question ; `'brave'` ou `'tavily'` → le serveur cherche avec la question et place les résultats devant elle) ; réponse coupée (`finish_reason: length`, ou flux terminé sans `finish_reason` : connexion perdue) poursuivie deux fois au plus ; après les corrections, la partie valide est proposée avec la liste de ce qui a été écarté (`plan.dropped`) ; côté navigateur, la réponse en cours est enregistrée au fil du flux et peut être reprise (`resume: true`) ; plus aucune donnée pendant 90 s : abandon ; messages d'erreur qui disent quoi faire (401, 402, 404, 413).

Choix du front-end : **Preact** (API de React, 4 Ko, rendu rapide d'une liste de segments éditables) compilé par **esbuild** comme le reste, sans framework de build supplémentaire. Pas de bibliothèque d'état : un petit magasin alimenté par le flux SSE et des hooks suffisent.

## Choix techniques

| Choix                                 | Pourquoi                                                                                                                                            | Alternatives écartées                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **TypeScript strict** (moteur et CLI) | les scènes sont du JS de toute façon (WebGL) ; un seul langage côté image, typage de Three.js et des messages CDP                                   | Python + Playwright : deux langages pour la même logique                                                      |
| **esbuild**                           | empaquette moteur + three.js + scènes en ~100 ms, fournit le graphe d'imports pour le cache                                                         | importmap + `node_modules` par projet (lourd, aucune empreinte) ; Vite (inutile ici)                          |
| **Chromium headless + CDP**           | rendu WebGL/CSS identique au navigateur d'aperçu ; `Runtime.evaluate` + `Page.captureScreenshot` directs, sans la surcouche par appel de Playwright | WebGL natif via headless-gl (incomplet pour le post-traitement) ; capture vidéo temps réel (non déterministe) |
| **GPU par Vulkan/EGL, détecté**       | l'émulation WebGL (SwiftShader) représente 85 % du temps d'une image sur CPU                                                                        | imposer le GPU (casse sur une machine sans pilote)                                                            |
| **ffmpeg** (x264, VAAPI, NVENC)       | encodeur de référence ; les blocs matériels déchargent le CPU                                                                                       | encodage WebCodecs dans la page (qualité et réglages plus limités)                                            |
| **Python + numpy** pour l'audio       | DSP vectorisé sur ~7 M d'échantillons ; FFT pour filtres et réverbération                                                                           | DSP en JS (pas de FFT native, plus de code)                                                                   |
| **zod** pour la configuration         | erreurs lisibles avec leur chemin, types TypeScript déduits, JSON Schema généré                                                                     | validation manuelle                                                                                           |
| **`node:util.parseArgs`**             | aucune dépendance, démarrage instantané                                                                                                             | commander/yargs                                                                                               |
| **Polices `@fontsource`**             | servies localement : rendu hors ligne et identique d'une machine à l'autre                                                                          | Google Fonts (réseau pendant le rendu)                                                                        |

## Étendre

- **Une ambiance musicale** : une fonction dans `packages/audio/src/studio_audio/moods.py`, ajoutée à `MOODS` et à `MOODS` dans `cli/src/core/config.ts`.
- **Une commande** : un objet `Command` dans `cli/src/commands/`, ajouté à `COMMANDS` dans `main.ts`. Sa fonction `run` renvoie son résultat (imprimé avec `--json`) et reçoit le `signal` d'annulation.
- **Une étape de production** : un cas dans `core/actions.ts` ; elle devient disponible dans la CLI (via une commande) et dans l'interface (`ACTIONS`).
- **Un encodeur** : un cas dans `encoderArgs` (`cli/src/core/encoder.ts`) et dans le type `VideoCodec`.
- **Un fournisseur de voix** : `synthesize` dans `cli/src/core/tts.ts` est le seul point d'appel réseau.
- **Un utilitaire de scène réutilisable** : `packages/runtime/src/helpers.ts`, exporté par `index.ts`.
