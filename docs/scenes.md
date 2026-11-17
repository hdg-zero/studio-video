# Écrire des scènes

## Anatomie

```ts
// scenes/regard.ts
import { clamp, defineScene, lerp, smooth } from '@studio/runtime';
import { buildPanopticon } from './shared.js';

export default defineScene('regard', ({ group, camera, bloom, fog, rng }) => {
  // 1. construction : une seule fois, au chargement
  const pan = buildPanopticon(group);

  // 2. mise à jour : à chaque image, fonction pure du temps
  return ({ u, len, t, voiceAt, seg }) => {
    pan.pose({ phi: -1.15 + u * 0.42 });
    camera.position.set(0, 4.4, lerp(6.6, 5.4, smooth(0, len, u)));
    camera.lookAt(-1.5, 4.8, 0);
    bloom.strength = 0.9;
  };
});
```

Puis dans `scenes/index.ts` :

```ts
export default defineCapsule({
  fonts: ['600 64px "Space Grotesk"'], // polices à charger avant de dessiner sur un canvas
  setup({ scene }) {
    /* lumières, ciel, éléments communs */
  },
  everyFrame(t) {
    /* animation commune, ex. rotation du ciel */
  },
  scenes: [intro, bentham, regard /* … dans l'ordre */],
  creditsScene: 'outro', // scène prolongée sous le générique (défaut : celle du dernier segment)
});
```

## Contexte de construction

| Champ                     | Description                                                              |
| ------------------------- | ------------------------------------------------------------------------ |
| `group`                   | groupe Three.js de la scène, visible seulement pendant son segment       |
| `camera`                  | caméra perspective partagée (45°) : chaque scène la place à chaque image |
| `portrait`, `layout`      | vidéo verticale (hauteur > largeur) et taille du cadre en px CSS         |
| `bloom`                   | `UnrealBloomPass` : `strength` remis à `look.bloom` avant chaque image   |
| `fog`                     | `FogExp2` : `density` et `color` remis par défaut avant chaque image     |
| `background`              | couleur de fond, remise par défaut avant chaque image                    |
| `scene`, `renderer`       | accès direct si nécessaire                                               |
| `rng`                     | générateur aléatoire dont la graine est l'id de la scène                 |
| `timeline`, `segment(id)` | toute la timeline, ou un segment par id                                  |

## Informations d'image

| Champ     | Description                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `u`       | secondes depuis le début du segment                                                                                 |
| `len`     | durée du segment                                                                                                    |
| `t`       | temps global                                                                                                        |
| `voiceAt` | instant local où la voix commence : synchroniser un événement avec un mot = `smooth(voiceAt + 2.5, voiceAt + 3, u)` |
| `seg`     | le segment (`dur` = durée de la voix, `text`, `key`…)                                                               |

**Vidéo verticale.** En 9:16 (`portrait` vrai), la caméra garde un champ horizontal de 45° : son champ vertical s'élargit (environ 73°), le centre d'une scène cadrée pour le 16:9 reste visible et les bords sortent du cadre. Pour recadrer, reculer la caméra ou rapprocher les éléments quand `portrait` est vrai, en le lisant à la construction : `defineScene('x', ({ camera, portrait }) => { const recul = portrait ? 1.4 : 1; … })`. Voir [vertical.md](vertical.md).

Sous le générique, la scène de `creditsScene` reçoit un `u` qui continue au-delà de `len` : un mouvement de caméra écrit avec `smooth(0, len + 6, u)` se poursuit naturellement.

## Règles

**Une scène est une fonction pure du temps.** Les images sont rendues dans le désordre par plusieurs navigateurs en parallèle.

- Pas de `Math.random`, `Date.now`, `performance.now`, `setTimeout` (ESLint les refuse dans `scenes/`). Hasard : `rng` (construction) ou `randomTable(n, graine)` (lecture `table(i)` dans les boucles).
- Pas d'état accumulé d'une image à l'autre (vitesse intégrée, simulation pas à pas). Précalculer pendant la construction, puis lire selon `u`.
- Tout ce que la mise à jour modifie doit être reposé à chaque image (positions, opacités, couleurs d'instances).

**Un fichier par scène**, nommé comme le segment : le cache de rendu suit chaque fichier et ses imports. Le code partagé va dans un module (`shared.ts`) ; le modifier n'invalide que les scènes qui l'importent.

**Piège JS** : `Math.exp(-(x/w)**2)` est une erreur de syntaxe, écrire `Math.exp(-((x / w) ** 2))`.

## Briques du moteur (`@studio/runtime`)

| Fonction                                          | Usage                                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `clamp`, `lerp`, `smooth(a, b, x)`                | rampes et fondus ; `smooth(b, a, x)` pour une rampe descendante                                                  |
| `createRng(graine)`, `randomTable(n, graine)`     | hasard reproductible                                                                                             |
| `makePoints(positions, couleur, taille, opacité)` | nuage de points ronds additifs                                                                                   |
| `starfield(n, rng)`                               | points sur une coquille sphérique (ciel étoilé)                                                                  |
| `samplePoints(dessin, n, rng, opts)`              | nuage de points à partir d'un dessin canvas 2D (silhouette, glyphe, logo) ; morpher en interpolant deux tableaux |
| `drawLines(parent, segments, couleur)`            | lignes révélées progressivement : `draw(k)` avec `k ∈ [0, 1]`                                                    |
| `circleSegments(out, r, y)`                       | cercle horizontal en segments, pour `drawLines`                                                                  |
| `textSprite(texte, { font, color, scale })`       | étiquette dans l'espace 3D                                                                                       |

Le texte que le spectateur lit (titres, sous-titres) est en DOM, plus net. Les sprites de texte servent aux étiquettes situées dans la scène.

## Apparence

- Bloom (~0,9, seuil 0,55) + tone mapping ACES + vignette donnent l'aspect « premium ». Monter le bloom seulement pour un flash.
- Attention aux matériaux blancs émissifs avec le bloom : une grille de cellules émissives a blanchi toute l'image. Préférer `MeshBasicMaterial` avec des couleurs d'instance de luminosité modérée (≤ 0,45).
- Un soleil vif + lumière directionnelle forte + bloom brûlent l'image : garder le terme solaire ≲ 0,6 et baisser `bloom.strength` (~0,45) pour cette scène.
- Masquer une instance : échelle ≈ 0,0001 sur les trois axes (écraser seulement Y laisse des tuiles lumineuses au sol).
- Texte et sujet ne se chevauchent pas : sujet à droite quand le titre est en haut à gauche.
- Chaque segment a son mouvement de caméra (travelling, orbite, grue). Une caméra fixe ressemble à une diapositive.
- Le moteur insère un court fondu au noir entre les segments, ce qui masque les changements de scène.
- L'anticrénelage (`look.msaa`, 4 par défaut) n'est appliqué que sur GPU : sur CPU il double le temps de rendu.

## Recettes

Le panoptique (`projects/panoptique/scenes/`) montre : un bâtiment paramétrique en instances (`shared.ts`), un plan tracé trait par trait avec une plume (`bentham.ts`), une construction étage par étage (`plan.ts`), un faisceau de regard qui balaie (`regard.ts`), une maquette sur une table chaude avec mots flottants (`projet.ts`), un plan qui se dissout en poussière (`echec.ts`), un travelling le long de trois bâtiments (`heritiers.ts`), une grille de lumières qui s'étend à l'horizon (`foucault.ts`), une ligne de balayage qui classe une foule (`discipline.ts`), un œil alimenté par des flux de données (`numerique.ts`).

Les exemples du skill d'origine (`.skill-extract/video-capsule/assets/examples/` : trou noir, Jeu de la vie, croissance exponentielle, globe et arcs, violon, mer au crépuscule, personnage sculpté…) se portent de la même façon : la partie construction va dans le corps de `defineScene`, la partie par image dans la fonction retournée.
