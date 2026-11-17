# Plans sans code

Un segment n'a pas besoin d'une scène 3D programmée : son champ `visual` décrit un **plan tout prêt** que le moteur dessine lui-même. Dans l'interface, on le choisit sous le texte de chaque segment (rangée « À l'écran ») ; l'assistant sait aussi en proposer (menu Assistant d'un segment → « Choisir un plan sans code »).

```json
{ "id": "babel", "text": "…", "visual": { "type": "image", "src": "tour.jpg", "motion": "zoom-in" } }
```

| `type`  | Ce qu'on voit                                             | Champs (défaut)                                                                                         |
| ------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `image` | une image qui bouge doucement (effet « Ken Burns »)       | `src`, `motion` (`zoom-in`), `focus` (`[0.5, 0.5]`), `fit` (`cover`), `dim` (0,35), `caption`, `credit` |
| `video` | un extrait vidéo, muet, image par image                   | `src`, `start` (0 s), `loop` (true), `fit`, `dim`, `caption`, `credit`                                  |
| `title` | un grand titre centré, mot après mot, et un sous-titre    | `text`, `sub`                                                                                           |
| `quote` | une citation et son auteur                                | `text`, `author`                                                                                        |
| `stat`  | un chiffre clé qui défile jusqu'à sa valeur               | `value`, `prefix`, `suffix`, `decimals` (0), `label`                                                    |
| `list`  | des points qui apparaissent au fil de la voix (7 au plus) | `items`, `numbered` (false)                                                                             |
| `chart` | un graphique en barres ou en courbe (12 valeurs au plus)  | `kind` (`bar` ou `line`), `data` (`[{label, value}]`), `unit`, `title`                                  |
| `dates` | une frise : des dates sur une ligne du temps (6 au plus)  | `events` (`[{date, text}]`)                                                                             |

- **Mouvements d'image** : `zoom-in`, `zoom-out`, `pan-left`, `pan-right`, `pan-up`, `pan-down`, `still`. `focus` est le point gardé en vue pendant le zoom (fractions de la largeur et de la hauteur).
- **Cadrage** : `cover` remplit l'écran (l'image est rognée) ; `contain` montre l'image entière sur une copie floutée d'elle-même. `dim` assombrit l'image pour que les textes restent lisibles.
- **Synchronisation** : les éléments suivent la voix du segment. Une liste ou une frise répartit ses entrées sur le temps de parole, un chiffre défile quand la voix commence, une courbe se trace pendant qu'elle parle.
- **Titre à l'écran** : `title` et `quote` affichent eux-mêmes le texte principal, le titre du segment (`key`) n'est donc pas montré. Pour les autres, il reste en haut à gauche ; les sous-titres restent en bas.
- **Avec une scène** : si `scenes/<id>.ts` existe, le plan s'affiche par-dessus (un chiffre sur une scène 3D, par exemple). Sinon, derrière un plan qui ne couvre pas l'écran, le moteur anime un fond discret (poussière dans la couleur d'accent, caméra qui dérive).
- **Générique** : le plan du dernier segment continue sous le générique, comme une scène (en vidéo verticale, il s'efface sous le texte).
- **Vidéo verticale** : chaque plan a sa mise en page 9:16 et la frise se lit de haut en bas ; garder les textes courts (voir [vertical.md](vertical.md)).

## Images et vidéos

Les fichiers vont dans le dossier `media/` du projet : bouton « Importer… » dans l'interface, ou simple copie. `src` est le nom du fichier dans ce dossier.

- Images : JPEG, PNG, WebP, GIF, AVIF, SVG. Vidéos : MP4, MOV, WebM, MKV, M4V, AVI (512 Mo au plus par import).
- Une vidéo est découpée une fois en images numérotées à la cadence de la capsule (`ffmpeg`, cache dans `.studio/frames/`) : le rendu montre exactement l'image voulue à chaque instant, sans dépendre des codecs du navigateur. 120 s au plus à partir de `start`. Le son du clip n'est pas utilisé.
- Le cache du rendu suit le contenu des fichiers : remplacer une image re-rend seulement son segment.
- Un fichier manquant fait échouer le rendu avec le nom du segment ; l'aperçu, lui, laisse le plan de côté et le signale dans le journal.
- **Droits** : utiliser des images dont on a le droit (les siennes, domaine public, licences libres) et créditer la source dans `credit` et dans le générique.
