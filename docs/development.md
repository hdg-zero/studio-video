# Développement

## Installation de développement

```bash
npm run setup        # Node, Chromium, .venv Python avec les outils de dev
npm run check        # tout ce qui doit passer avant de livrer
```

`npm run check` enchaîne :

| Script              | Vérifie                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `npm run typecheck` | `tsc` strict sur le moteur, la CLI, l'interface, les projets et le modèle                     |
| `npm run lint`      | ESLint (`strictTypeChecked` + règles de déterminisme des scènes) et Prettier                  |
| `npm test`          | tests Vitest (planification, cache, timeline, configuration, assistant, serveur, sous-titres) |
| `npm run lint:py`   | Ruff (lint + format) et mypy `--strict` sur le paquet audio                                   |
| `npm run test:py`   | tests pytest (synthèse, mixage, side-chain, détection de voix)                                |

`npm run format` corrige la mise en forme. Après une modification de la CLI ou de l'interface : `npm run build`.

Pour travailler sur l'interface : `node packages/ui/build.mjs --watch` dans un terminal, `studio ui` dans un autre, puis recharger la page.

**Projets des utilisateurs.** Les vérifications s'appliquent pleinement au moteur, à la CLI, à l'interface, au modèle `templates/capsule` et au projet de référence `projects/panoptique`. Les autres projets sont écrits avec l'assistant, qui ne passe pas Prettier : Prettier les ignore (reformater une scène invaliderait aussi son rendu en cache), ESLint n'y garde que le déterminisme et les vraies erreurs, et `tsc` y accepte les noms inutilisés, comme la vérification de l'assistant.

## Standards

**TypeScript**

- `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` : un accès à un tableau peut être `undefined`, les imports de types sont explicites (`import type`).
- Pas d'assertion non nulle (`!`) ; préférer une vérification ou `?? valeur`.
- Les modules de `core/` ne lisent ni `process.argv` ni la console : les commandes (`commands/`) et le serveur de l'interface (`ui/`) font le lien avec l'utilisateur. Ils écrivent par `log` (événements), jamais directement sur stdout.
- Toute étape longue accepte un `AbortSignal` et le vérifie entre deux unités de travail.
- Une commande renvoie un résultat sérialisable : c'est ce que `--json` imprime, et ce sur quoi un script ou un agent s'appuie.
- La logique pure (planification, timeline, clés, sous-titres) est isolée dans des fonctions sans effet de bord et testée.
- Un fichier, une responsabilité : quand un module dépasse ~300 lignes ou mêle deux sujets (orchestration et workers, routes et utilitaires HTTP), le scinder. Exception : `runtime/` ; tout changement de ses sources invalide le cache de rendu de tous les projets (empreinte partagée), il ne se réorganise donc qu'avec un vrai changement du moteur.
- Les erreurs destinées à l'utilisateur disent quoi faire (« run `studio timeline` first »), et gardent leur cause (`{ cause }`).
- Écritures de fichiers atomiques (`writeFileAtomic`) dès qu'un autre processus peut lire le fichier.

**Python**

- Typage complet, `mypy --strict`, Ruff (`E F W I N UP B SIM RUF NPY PERF`).
- Tout calcul sur la piste entière est vectorisé ; filtres et réverbération passent par la FFT, les moyennes glissantes par sommes cumulées (une convolution directe de 0,25 s sur 7 M d'échantillons a pris plus de 30 min dans la version d'origine).

**Commentaires** en anglais dans le code, documentation en français. Un commentaire explique _pourquoi_, pas _quoi_.

## Organisation des tests

```
packages/runtime/test/   math, sous-titres
packages/cli/test/       config, timeline, plan (découpage, clés de cache, sélection, tranche de son),
                         status (prochaine étape), server (chemins, plages d'octets), util (processus et
                         annulation), media (plans tout prêts), assistant : blocks (format, opérations,
                         retouches), ai (tolérance), check (vérification), chat (flux, corrections)
packages/audio/tests/    synthèse, ambiances, mixage, hauteur de voix
```

Les tests de rendu de bout en bout demandent Chromium et prennent du temps : ils se font à la main, sur le projet de référence :

```bash
studio stills panoptique                    # planche contact à comparer
studio render panoptique --only regard --draft
```

## Recettes d'extension

**Nouvelle ambiance musicale**

1. Écrire `def ma_mood(s: Synth, t0, t1, v, seg) -> None` dans `moods.py` avec les instruments de `Synth` (`pad`, `progression_pads`, `arpeggio`, `pluck`, `bell`, `sub`, `riser`, `boom`, `kick`, `tick`).
2. L'ajouter à `MOODS` (Python) et à `MOODS` dans `packages/cli/src/core/config.ts`.
3. `npm run build && studio schema`.

**Nouvelle commande** : créer un `Command` dans `packages/cli/src/commands/`, l'ajouter à `COMMANDS` dans `main.ts`.

**Nouvelle source de recherche web** (`cli/src/ai/search.ts`) : l'ajouter à `SEARCH_PROVIDERS`, lire sa clé dans l'environnement (`searchProviders`), traduire sa réponse en `SearchResult[]` dans `webSearch`, puis lui donner un libellé et une aide dans `SEARCH` (`ui/src/assistantPrefs.ts`).

**Nouveau réglage de capsule** : l'ajouter au schéma zod (`config.ts`) avec une valeur par défaut et un commentaire, l'utiliser, puis `studio schema` pour régénérer `schemas/capsule.schema.json`. Si le réglage change les pixels, l'inclure dans `settings` de `render.ts` (clé de cache).

**Changement du pipeline de rendu** (capture, encodage, moteur) qui modifie les pixels sans changer le code des scènes : incrémenter `PIPELINE_VERSION` dans `plan.ts` pour invalider les caches existants.

## Variables d'environnement

| Variable                                | Effet                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`                    | clé pour la voix et l'assistant (aussi `OR_KEY`, `key_or`)                   |
| `STUDIO_AI_MODEL`                       | modèle par défaut de l'assistant (ex. `anthropic/claude-sonnet-4.5`)         |
| `OPENROUTER_BASE_URL`                   | autre adresse de l'API OpenRouter (tests avec un faux serveur)               |
| `BRAVE_API_KEY`                         | recherche web de l'assistant par Brave Search (aussi `BRAVE_SEARCH_API_KEY`) |
| `TAVILY_API_KEY`                        | recherche web de l'assistant par Tavily                                      |
| `BRAVE_SEARCH_URL`, `TAVILY_SEARCH_URL` | autres adresses de ces API (tests)                                           |
| `CHROME_PATH`                           | utiliser un Chromium/Chrome du système au lieu de celui de Playwright        |
| `STUDIO_PYTHON`                         | interpréteur Python (défaut : `.venv/bin/python`, sinon `python3`)           |
| `STUDIO_PROJECTS`                       | dossier des projets (recherche par nom, `studio new`, `studio ui`)           |
| `STUDIO_DEBUG=1`                        | traces détaillées (aussi `--verbose`)                                        |
| `NO_COLOR`                              | sortie sans couleurs                                                         |
