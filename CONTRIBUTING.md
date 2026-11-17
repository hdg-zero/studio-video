# Contribuer au Studio vidéo

Merci de votre intérêt ! Rapports de bogues, idées, documentation et code sont les bienvenus.

## Signaler un bogue ou proposer une idée

Ouvrez une _issue_ en précisant :

- ce que vous avez lancé (commande complète, ou étape de l'interface) et ce que vous attendiez ;
- la sortie de `studio doctor` (système, ffmpeg, Chromium, GPU, Python) ;
- pour un problème de rendu, la planche contact (`studio stills <projet>`) ou une image extraite (`studio check <video> t`).

**Ne collez jamais de clé d'API** (OpenRouter, Brave, Tavily) dans une _issue_, un journal ou une capture. Une faille de sécurité se signale en privé : voir [SECURITY.md](SECURITY.md).

## Préparer l'environnement

Prérequis : Linux, Node.js ≥ 22.12, ffmpeg, Python ≥ 3.11.

```bash
npm run setup    # dépendances Node, Chromium, .venv Python avec les outils de dev, build, diagnostic
npm run check    # typecheck, ESLint, Prettier, Vitest, Ruff, mypy, pytest
```

Aucune clé n'est nécessaire pour développer : sans `OPENROUTER_API_KEY`, `studio timeline <projet> --estimate` estime les durées depuis le texte et le rendu se fait sans voix. Les tests n'appellent aucune API.

## Proposer une modification

1. Partez de la branche `main` à jour et créez une branche par sujet.
2. Respectez les standards de [docs/development.md](docs/development.md) : TypeScript strict, Python typé (`mypy --strict`), commentaires en anglais dans le code, documentation en français.
3. Ajoutez ou adaptez les tests de la logique que vous touchez.
4. Mettez à jour la documentation (`README.md`, `docs/`, `AGENTS.md`) et ajoutez une entrée à `CHANGELOG.md` dans le même changement.
5. Vérifiez que `npm run check` passe, puis ouvrez une _pull request_ qui explique le _pourquoi_ du changement et comment vous l'avez vérifié.

## Points d'attention

- **Moteur (`packages/runtime`)** : toute modification de ses sources, même un commentaire, change l'empreinte du rendu et force un rendu complet de tous les projets existants. Ne le touchez qu'avec un vrai changement du moteur, et signalez-le dans le CHANGELOG.
- **Pixels** : un changement du pipeline de rendu qui modifie l'image sans toucher aux scènes doit incrémenter `PIPELINE_VERSION` dans `packages/cli/src/core/plan.ts`.
- **Déterminisme des scènes** : pas de `Math.random`, `Date.now`, `performance.now`, `setTimeout` ni d'état accumulé ; les images sont rendues dans le désordre par plusieurs navigateurs (ESLint le vérifie).
- **Fichiers générés** : ne versionnez ni voix (`voice/`), ni cache (`.studio/`), ni rendus (`out/`, `*.mp4`) ; le `.gitignore` les exclut.
- **Projets** : seul `projects/panoptique` est publié, comme exemple de référence. Pour tester avec vos propres projets, gardez-les dans `projects/` (ignorés par git) ou pointez `STUDIO_PROJECTS` vers un autre dossier.

## Licence des contributions

Le projet est sous [licence Apache 2.0](LICENSE). En proposant une contribution, vous acceptez qu'elle soit distribuée sous cette même licence (section 5 de la licence).
