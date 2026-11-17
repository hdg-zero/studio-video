# Historique

## À venir

- **Publication open source** : licence Apache 2.0 (`LICENSE`, `NOTICE`, champ `license` des paquets), `.gitignore` complet (secrets, builds, caches, voix, rendus, projets personnels : seul `projects/panoptique` est publié, sans ses voix), `.gitattributes`, `CONTRIBUTING.md`, `SECURITY.md`. Dépôt git initialisé, rien n'est encore commité.

## 1.8.1 — 2026-11-10

- **Voix à une autre fréquence** : les clips renvoyés par OpenRouter à une autre fréquence que 44,1 kHz (Voxtral de Mistral : 24 kHz) sont rééchantillonnés à l'arrivée avec ffmpeg. Avant, ils étaient lus 1,8 fois trop vite et trop aigus, et la timeline était trop courte.

## 1.8.0 — 2026-11-08

- **Vidéos verticales courtes** (9:16, 1080×1920, pour Shorts, Reels, TikTok), documentées dans `docs/vertical.md` :
  - `studio short <projet> --segments a,b,c` tire une vidéo courte de quelques segments d'une capsule, dans l'ordre choisi, avec ses scènes, ses médias et ses voix déjà générées (rien à régénérer) ; sans `--segments`, liste les segments et leur durée ; avertit au-delà de 60 s.
  - `studio new <nom> --vertical` et, dans l'interface, « Nouveau projet » → Format « Vertical court » : format 1080×1920 et timing resserré (amorce 1,2 s, générique 2,5 s).
  - Mise en page portrait des titres, sous-titres, générique et de chaque plan tout prêt (frise de haut en bas), hors des zones recouvertes par les applications ; le plan du dernier segment s'efface sous le générique.
  - Caméra : champ horizontal de 45° en portrait, une scène cadrée pour le 16:9 montre son centre au lieu d'une tranche ; les scènes reçoivent `portrait` et `layout` pour se recadrer.
  - Aperçu et lecteur de l'interface en 9:16 ; planche contact en 4 colonnes ; l'assistant connaît les règles du format.
- **Sous-titres mot par mot** : nouveau réglage `subtitles.style` (`auto`, `line`, `words`) ; `words`, défaut des vidéos verticales, montre quelques mots à la fois et surligne le mot prononcé (moment estimé d'après la longueur des mots).
- **Générique** : par défaut, il prolonge la scène (ou le plan) du dernier segment de la narration, même si `scenes/index.ts` liste les scènes dans un autre ordre. Corrige `la-tour-de-babel-2`, dont le générique montrait la scène `outro` restée du modèle.
- Le moteur (`runtime/`) change : le prochain rendu de chaque projet existant est complet (une fois). Les vidéos horizontales sont identiques à la 1.7.1, vérifié image par image sur quatre projets (sauf le générique corrigé ci-dessus).

## 1.7.1 — 2026-10-30

Tour de nettoyage, sans changement de comportement (vidéos rendues identiques, image pour image).

- **Rendu** : dans chaque worker, l'image suivante est capturée pendant que ffmpeg encode la précédente. Sans effet mesurable sur CPU ; gain attendu sur GPU, où l'encodage pèse autant que la capture.
- **Fichiers scindés** : `core/render.ts` (orchestration) et `core/render-workers.ts` (workers) ; serveur de l'interface en `ui/server.ts` (routes), `http.ts`, `files.ts`, `watch.ts` ; assistant en `ai/blocks.ts` (format), `edits.ts` (opérations), `patch.ts` (retouches), `check.ts` et `compile.ts` (esbuild, TypeScript) ; panneau Assistant en `Assistant.tsx`, `AssistantMessage.tsx`, `PlanCard.tsx`, `assistantPrefs.ts` ; feuille de style de l'interface en `styles/` (une par zone, CSS produit identique). Le moteur (`runtime/`) n'est pas touché : le modifier aurait invalidé tous les rendus en cache.
- **Code mort retiré** : anciens écrans `Narration.tsx` et `Pipeline.tsx` et leur test (ils cassaient `npm run check`), `setConsole`, `VISUAL_TYPES`, règles CSS inutilisées, exports internes rendus privés. Sélection des segments et tranche de son du rendu déplacées dans `plan.ts`, avec leurs tests.
- **Correctif** : le temps restant affiché pendant un rendu pouvait indiquer « 1min60 » ; il suit maintenant le même format que les autres durées.
- **`npm run check` repasse au vert** : les projets des utilisateurs (écrits avec l'assistant) ne sont plus reformatés par Prettier ni soumis aux règles de style d'ESLint, et `tsc` y accepte les noms inutilisés comme la vérification de l'assistant ; le déterminisme des scènes reste vérifié partout, le projet de référence et le modèle restent vérifiés en entier. Scripts `projects/*/tools/` reconnus comme scripts Node.
- Documentation mise à jour : arborescence et responsabilités des fichiers, rendu, serveur de l'interface, tests, portée des vérifications, commandes `voicecheck`, `clean` et `schema` dans le README.

## 1.7.0 — 2026-10-30

- Recherche web de l'assistant au choix : OpenRouter, **Brave Search** (`BRAVE_API_KEY`) ou **Tavily** (`TAVILY_API_KEY`) ; menu « Web » à côté du modèle, sources sans clé grisées. Une recherche qui échoue n'empêche pas la réponse.

## 1.6.0 — 2026-10-30

- Assistant : case **Recherche web** (greffon web d'OpenRouter) pour vérifier dates, chiffres et citations avec sources ; une recherche par question, désactivée par défaut.

## 1.5.1 — 2026-10-30

- Assistant : plus de bascule automatique vers Claude Sonnet quand le modèle choisi échoue ; seul le modèle choisi répond, et une erreur indique d'en choisir un autre.

## 1.5.0 — 2026-10-30

- **Plans sans code** : chaque segment peut montrer, au lieu d'une scène 3D programmée (ou par-dessus), une image qui bouge (zoom ou glissement), un extrait vidéo, un grand titre, une citation, un chiffre clé qui défile, une liste qui apparaît avec la voix, un graphique (barres ou courbe) ou une frise de dates. Champ `visual` des segments, documenté dans `docs/plans.md`.
- Écran Écrire : rangée « À l'écran » sous chaque segment pour choisir le plan et le régler ; import d'images et de vidéos dans le dossier `media/` du projet.
- L'assistant connaît ces plans et les fichiers de `media/` (« Choisir un plan sans code ») ; un plan invalide ou un fichier absent est écarté sans perdre le texte du segment.
- Vidéos découpées une fois en images à la cadence de la capsule (rendu exact, sans dépendre des codecs du navigateur) ; le cache du rendu suit le contenu des images et des vidéos.
- Fond animé discret derrière les plans sans scène.

## 1.4.0 — 2026-10-29

- **Assistant plus robuste, surtout pour le pré-remplissage** : JSON abîmé réparé, blocs et opérations mal nommés reconnus, ambiances en français acceptées, identifiants corrigés, conflits résolus (ajout d'un segment existant, suppression d'un absent) ; chaque opération est vérifiée seule.
- **Rien n'est perdu** : la partie valide d'une proposition est gardée d'un tour de correction à l'autre et proposée même si des erreurs restent (listées à part) ; une scène fautive ne bloque plus les autres.
- Nouvelle opération `replace` pour écrire toute la narration d'un coup (utilisée par « Écrire »).
- Connexion perdue en cours de réponse : le studio fait continuer le modèle ; page fermée pendant une réponse : réponse gardée avec un bouton « Reprendre ».
- Annulation conservée sur disque (survit au redémarrage de l'interface) ; une proposition devenue obsolète est refusée au lieu d'être appliquée de travers.

## 1.3.0 — 2026-10-29

- **L'assistant modifie la vidéo** : ses propositions sont vérifiées par le studio (capsule validée, scènes compilées et typées), corrigées automatiquement par le modèle en cas d'erreur, puis appliquées d'un clic sur « Valider », avec mise à jour de la vidéo (voix, musique, brouillon) et annulation possible.
- Retouches de scène (`scene-patch`, lignes cherchées et remplacées) au lieu de fichiers complets.
- Moins de jetons : instructions fixes mises en cache chez le fournisseur, projet décrit de façon compacte, historique sans code, contexte de scène limité aux segments cités ; jetons lus en cache affichés.
- Pannes gérées : nouveaux essais sur erreur passagère, modèle de secours, réponse coupée poursuivie, délai d'inactivité, messages d'erreur explicites.
- Bouton « Corriger avec l'assistant » sur les erreurs de l'aperçu et les tâches en échec.
- TypeScript n'est plus inclus dans le bundle de la CLI : chargé à la demande.

## 1.2.0 — 2026-10-29

- **Interface repensée en parcours guidé** : cinq étapes (Écrire, Voix, Musique, Vérifier, Exporter) avec leur état, un écran par étape qui explique son rôle et porte son bouton principal, progression et arrêt de la tâche sur place, lien vers l'étape suivante. Réglages à part.
- Éditeur de narration plus lisible : le texte dit en premier, ambiance en pastille, menus d'actions par segment, insertion entre deux blocs, état de la voix et écoute dans chaque bloc.
- **Enregistrement automatique** (Ctrl+S reste possible) avec indicateur d'état.
- **Assistant IA intégré (OpenRouter)** : discussion qui connaît le projet (narration, durées, scènes), suggestions par étape, choix du modèle, coût affiché. Ses propositions (modifications de la capsule, fichiers de scène) s'appliquent en un clic ; une nouvelle scène est ajoutée à `scenes/index.ts`.
- Nouveaux modules `cli/src/ai/` et `core/scenes.ts`, routes `/api/ai/*` et `/api/projects/<projet>/scenes/<id>`.

## 1.1.0 — 2026-10-29

- **Interface web** `studio ui` (Preact) : projets, éditeur de narration avec validation par champ, chaîne de production avec l'état de chaque étape, aperçu en direct calé sur la musique avec frise des segments, planche contact cliquable, lecteur des rendus, réglages de la capsule, file de tâches avec progression, annulation et journal. Se met à jour quand les fichiers changent ailleurs.
- **Pilotage par les agents** : `--json` sur toutes les commandes (résultat sur stdout, messages sur stderr), codes de sortie 0/1/130, `studio status` (état de chaque étape calculé sur le contenu, prochaine commande) et `studio projects`. Guide `AGENTS.md`.
- Annulation propre partout (Ctrl+C, SIGTERM, bouton ■) : requêtes de voix, Python, encodeurs puis navigateurs ; le travail fini reste en cache.
- Journal structuré (événements `log` et `progress`) ; la sortie de Python passe par le journal.
- L'aperçu calcule la timeline à la volée et a son propre bundle ; il s'adapte à la taille de la fenêtre.
- Messages de validation de `capsule.json` en français.
- Les étapes de production sont des fonctions partagées (`core/actions.ts`) entre la CLI et l'interface.

## 1.0.0 — 2026-10-29

Première version du studio, construite à partir de l'exemple « Le panoptique » et du skill `video-capsule`.

- Monorepo : moteur navigateur (`@studio/runtime`), CLI `studio` (`@studio/cli`), audio Python (`studio_audio`).
- `capsule.json` validé (zod) avec JSON Schema pour l'éditeur ; une scène TypeScript par segment.
- Rendu parallèle par file de travail, capture CDP directe, détection du GPU (Vulkan / EGL, repli SwiftShader), encodeurs x264 / VAAPI / NVENC.
- Cache incrémental par morceau de segment, clé dérivée du graphe d'imports : seules les scènes modifiées sont re-rendues.
- Modes `--draft` (720p) et `--only <segments>` avec le son correspondant ; reprise après interruption.
- Voix OpenRouter en parallèle avec cache par texte ; contrôle d'homogénéité de la voix.
- Musique par ambiances vectorisée (instruments mis en cache, autocorrélation par FFT), side-chain, −16 LUFS.
- Aperçu temps réel avec rechargement automatique ; planches contact ; `studio doctor`.
- Anticrénelage MSAA du rendu 3D sur GPU ; polices locales ; couleurs BT.709 balisées.
- Projet de référence `projects/panoptique` porté (12 scènes), timeline identique à l'original.
