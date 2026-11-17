# Vidéos verticales courtes

Le studio produit aussi des vidéos **verticales** (9:16, 1080×1920) pour YouTube Shorts, Instagram Reels et TikTok. C'est le même pipeline que pour une capsule : la voix fait le rythme, la musique est générée, les scènes et les plans tout prêts sont les mêmes. Seuls changent le cadre, la mise en page des textes et les sous-titres.

## Deux façons de commencer

**À partir d'une capsule existante** (le plus rapide) :

```bash
studio short panoptique                                     # liste les segments et leur durée
studio short panoptique --segments intro,regard,numerique,outro
studio stills panoptique-court                              # vérifier le cadrage
studio make panoptique-court                                # musique + rendu (voix déjà là)
```

`studio short` crée `projects/<projet>-court` (ou `--name <nom>`) avec les segments choisis, **dans l'ordre donné**. Il copie les scènes, `media/` et le reste du projet, mais seulement les voix des segments choisis : même modèle, même voix, même texte, donc rien à régénérer ni à payer. Il prévient quand la vidéo dépasse 60 s. `--title` change le titre (et son nom dans le générique). Tous les fichiers de scènes sont copiés, même ceux des segments écartés : ils sont sans effet et peuvent être supprimés de `scenes/index.ts`.

**De zéro** : `studio new mon-court --vertical`, ou « Nouveau projet » → Format « Vertical court (9:16) » dans l'interface.

Dans les deux cas, le projet reçoit :

```json
{
  "format": { "width": 1080, "height": 1920, "pixelRatio": 1.5, "fps": 30 },
  "timing": { "introLead": 1.2, "lead": 0.4, "tail": 0.5, "outroTail": 1.2, "credits": 2.5 }
}
```

Une capsule existante passe en vertical en changeant seulement `format` : tout ce qui suit dépend de l'orientation, pas d'un réglage à part.

## Ce qui change en vertical

Le moteur reconnaît une vidéo verticale dès que la hauteur dépasse la largeur.

- **Mise en page.** Les textes sont placés pour un cadre de 720×1280 px CSS (1080×1920 à `pixelRatio` 1,5) et restent hors des zones que les applications recouvrent : environ 100 px en haut, 280 px en bas, les boutons à droite. Titres, citations, chiffres, listes et graphiques ont leur propre mise en page ; la frise se lit de haut en bas.
- **Sous-titres mot par mot.** Quatre mots au plus à la fois, gros, aux trois cinquièmes de la hauteur, le mot prononcé dans la couleur d'accent. Le moment de chaque mot est estimé d'après sa longueur (la voix ne fournit pas l'horodatage des mots) : le surlignage suit bien le débit, sans être exact à la syllabe.
- **Caméra.** Le champ de vision horizontal reste de 45° (le champ vertical d'une capsule 16:9) : une scène cadrée pour l'horizontal montre son centre, avec plus de place au-dessus et en dessous, au lieu d'une tranche étroite. Ce qui était sur les bords sort du cadre ; une scène peut se recadrer avec `portrait` (voir [scenes.md](scenes.md)).
- **Générique.** Court (2,5 s), et le plan tout prêt du dernier segment s'efface dessous pour que le texte reste lisible.

## Sous-titres

Le style se règle dans `capsule.json`, en horizontal comme en vertical :

```json
{ "subtitles": { "style": "auto" } }
```

| `style` | Rendu                                                         |
| ------- | ------------------------------------------------------------- |
| `auto`  | `words` en vertical, `line` en horizontal (défaut)            |
| `line`  | une phrase à la fois, en bas de l'écran (capsules classiques) |
| `words` | quelques mots à la fois, le mot prononcé surligné             |

## Conseils d'écriture

- 60 s au plus, une idée par segment, des phrases courtes ; la première phrase sert d'accroche.
- Plans tout prêts : listes de 4 points, graphiques de 6 valeurs, frises de 4 dates au plus ; au-delà, les textes deviennent petits.
- Images : `"fit": "cover"` rogne beaucoup une photo horizontale ; régler `focus` sur le sujet, ou `"fit": "contain"`.
- Toujours regarder la planche (`studio stills`) : en vertical elle a 4 colonnes de 360 px.

L'assistant de l'interface connaît ces règles quand le projet est vertical.
