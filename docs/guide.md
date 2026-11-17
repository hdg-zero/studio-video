# Guide : faire une capsule

De l'idée au MP4, dans l'ordre. Chaque étape se relance seule ; le cache évite de refaire ce qui n'a pas changé.

## 1. Cadrer

À fixer avant d'écrire (valeurs par défaut en gras) :

- sujet et source : si une source est donnée (article, document), le texte s'en tient à ce qu'elle dit et la cite au générique ;
- durée **2 à 3 min** ; langue **français** ; format **16:9 1920×1080** (vidéo verticale courte pour les réseaux : `studio new <nom> --vertical` ou `studio short`, voir [vertical.md](vertical.md)) ;
- voix : **oui** si une clé OpenRouter est disponible, sinon texte à l'écran et musique.

## 2. Créer le projet

```bash
studio new panoptique --title "Le panoptique"
```

Le dossier `projects/panoptique/` contient :

| Fichier           | Rôle                                                     | Versionné |
| ----------------- | -------------------------------------------------------- | --------- |
| `capsule.json`    | textes, ambiances, voix, format, timing, musique         | oui       |
| `scenes/index.ts` | décor commun (lumières, ciel) et liste des scènes        | oui       |
| `scenes/<id>.ts`  | une scène par segment                                    | oui       |
| `voice/`          | clips générés + `manifest.json` (coûtent des appels API) | oui       |
| `.studio/`        | cache : timeline, bundle, morceaux vidéo, mixage         | non       |
| `out/`            | vidéos produites                                         | non       |

## 3. Écrire la narration (`capsule.json`)

```json
{
  "title": "Le panoptique",
  "kicker": "Capsule · Philosophie",
  "closingLine": "Et si la tour était vide ?",
  "credits": "<b>Le panoptique</b>Sources … · Voix : « Le narrateur », Fish Audio S2.1 Pro Free",
  "voice": { "model": "fish-audio/s2.1-pro-free:free", "voice": "4f2a0684dd0247dda68f339738c780e6" },
  "segments": [
    { "id": "intro", "mood": "intro", "text": "Imaginez une prison où vous ne savez jamais si l'on vous regarde." },
    {
      "id": "bentham",
      "mood": "calm",
      "label": "1786 · Russie",
      "key": "Jeremy Bentham<small>philosophe anglais</small>",
      "text": "Mille sept cent quatre-vingt-six. Le philosophe anglais Jeremy Bentham …"
    }
  ]
}
```

- `id` : identifiant court, aussi nom du fichier de scène et du clip. `credits` est réservé.
- `mood` : ambiance musicale (`intro`, `calm`, `pulse`, `build`, `explosion`, `suspense`, `bright`, `dark`, `minimal`, `finale`).
- `label` : petit intertitre en haut à gauche. `key` : titre à l'écran (HTML permis, `<small>` pour la 2ᵉ ligne).
- `text` : exactement ce que dit la voix ; les sous-titres en sont tirés.

L'éditeur complète et valide le fichier grâce à `"$schema"`. Tous les réglages et leurs valeurs par défaut : [`schemas/capsule.schema.json`](../schemas/capsule.schema.json) et `packages/cli/src/core/config.ts`.

**Écrire pour l'oreille**

- 10 à 14 segments pour 2–3 min ; 1 à 3 phrases chacun (6 à 14 s de voix, la TTS dit ~15 caractères/s).
- Écrire en toutes lettres ce que la voix pourrait mal lire : « mille sept cent quatre-vingt-six », pas « 1786 ». Les chiffres vont dans `key` et `label`, pour l'œil.
- Phrases courtes, une idée chacune ; les deux-points et les questions donnent des pauses naturelles.
- Ouvrir sur une question, finir sur une phrase qui y répond (`closingLine` s'affiche après la dernière voix).
- Structure éprouvée : accroche → définition → origine (dates, personnes) → mécanisme → exemples → face claire → face sombre → limites → question finale.
- Ne pas inventer de citations ni de chiffres ; paraphraser et attribuer.

## 4. La voix

```bash
studio voices --lang fr --query narrat     # trouver une voix fixe (reference_id)
export OPENROUTER_API_KEY=…                # jamais dans un fichier
studio tts panoptique --check              # génère en parallèle puis vérifie l'homogénéité
studio tts panoptique --only regard        # régénérer un clip
```

- Fish Audio S2.1 Pro (gratuit) sonne naturel en français, mais **sans `voice.voice` fixe il change de locuteur à chaque appel**. `--check` repère un clip dont la hauteur médiane s'écarte de plus de 30 % des autres.
- Les modèles TTS n'apparaissent pas dans la liste par défaut d'OpenRouter : `curl -s "https://openrouter.ai/api/v1/models?output_modalities=speech"`. Un prix « 0 » peut cacher un coût par requête : lire la description.
- Évitez les voix qui imitent une personne réelle ou un personnage.
- Le générique (`credits`) doit nommer la voix réellement utilisée.

Sans clé : `studio timeline <projet> --estimate` estime les durées et la vidéo se fait sans voix.

## 5. Timeline et musique

```bash
studio timeline panoptique      # affiche le début et la fin de chaque segment
studio music panoptique         # ~30 s pour 2 min 30
```

`music` affiche pour chaque segment le niveau de la voix et celui de la musique seule. Visez une musique seule entre −25 et −35 dB quand la voix est vers −19 dB ; ajustez `music.gain` (et `music.duck`, la baisse sous la voix). `music.root` change la tonalité, `music.major` passe en majeur, `music.seed` donne une autre variation.

## 6. Les scènes

Chaque segment montre soit une **scène 3D** programmée (`scenes/<id>.ts`, déclarée dans `scenes/index.ts`, voir [scenes.md](scenes.md)), soit un **plan tout prêt** décrit dans `capsule.json` : image qui bouge, extrait vidéo, titre, citation, chiffre clé, liste, graphique ou frise (champ `visual`, voir [plans.md](plans.md)). Les deux se combinent : un plan s'affiche par-dessus la scène du segment s'il en a une.

```bash
studio preview panoptique       # http://127.0.0.1:8124, rechargé à chaque sauvegarde
```

## 7. Regarder avant de rendre

```bash
studio stills panoptique            # une image au milieu de chaque segment
studio stills panoptique 12 30.5    # ou des instants précis
```

Ouvrez `.studio/contact_sheet.png` et vérifiez chaque segment : texte sur le sujet, blanc saturé (bloom ou matériaux émissifs), cadrage vide ou décentré, incrustation qui reste affichée, générique périmé. Les erreurs de la page s'affichent dans le terminal.

## 8. Rendre

```bash
studio render panoptique --draft              # 720p rapide pour valider le rythme
studio render panoptique --only regard        # un segment, avec son son
studio render panoptique                      # final 1080p → out/Le_panoptique.mp4
```

Corriger une scène puis relancer ne re-rend que les morceaux touchés. Si le rendu est interrompu, relancer reprend où il en était.

## 9. Vérifier le fichier final

```bash
studio check projects/panoptique/out/Le_panoptique.mp4 5 30 60 90 120
```

Le rendu affiche résolution, durée (comparée à la timeline), taille et présence du son. Au-delà de ~100 Mo, une version plus légère : `ffmpeg -i in.mp4 -c:v libx264 -crf 23 -c:a copy out.mp4`.

## Où en suis-je ?

```bash
studio status panoptique          # chaque étape : à jour, à refaire ou absente, et la commande suivante
```

Toutes ces étapes se font aussi depuis l'interface web (`studio ui`, voir [ui.md](ui.md)).

## Tout d'un coup

```bash
studio make panoptique            # voix (si clé) → timeline → musique → rendu
```
