# Le panoptique

Projet de référence : capsule de 2 min 24 sur le panoptique de Bentham et sa relecture par Foucault. Les scènes sont écrites en TypeScript, une par fichier.

Les voix off (`voice/`) ne sont pas publiées dans le dépôt. Avec une clé OpenRouter, `studio tts` les génère (voix réglée dans `capsule.json`) ; sans clé, `--estimate` estime les durées depuis le texte et la vidéo se rend sans voix.

```bash
studio tts panoptique         # avec OPENROUTER_API_KEY (appels payants selon le modèle)
studio timeline panoptique    # ou, sans clé : studio timeline panoptique --estimate
studio music panoptique
studio stills panoptique
studio render panoptique      # → out/Le_panoptique.mp4
```

| Segment    | Scène                                                      |
| ---------- | ---------------------------------------------------------- |
| intro      | le panoptique de nuit vu d'en haut, le regard balaie       |
| bentham    | le plan tracé trait par trait                              |
| plan       | le bâtiment s'élève étage par étage                        |
| regard     | depuis une cellule, le faisceau passe sur nous             |
| interieur  | la tour se vide, chaque détenu porte le regard             |
| projet     | maquette sur une table, l'idée gagne usine, hôpital, école |
| echec      | le plan se dissout en poussière                            |
| heritiers  | travelling le long de trois prisons circulaires            |
| foucault   | une société de panoptiques jusqu'à l'horizon               |
| discipline | une ligne de balayage classe et note une foule             |
| numerique  | des écrans nourrissent un œil unique                       |
| outro      | les lumières s'éteignent, l'anneau devient un œil          |
