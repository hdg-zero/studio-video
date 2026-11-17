/**
 * What the assistant knows: its role, the narration rules, the scene API, the project as it is
 * now, and the answer format that lets the interface apply its proposals in one click.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isPortrait, MOODS } from '../core/config.js';
import { STUDIO_HOME } from '../core/home.js';
import { listMedia } from '../core/media.js';
import type { Project } from '../core/project.js';
import { readScene } from '../core/scenes.js';
import { computeTimeline } from '../core/steps.js';

export interface Focus {
  /** Screen the user is on (ecrire, voix, musique, verifier, exporter, reglages). */
  readonly step?: string | undefined;
  /** Segment the request is about, if any. */
  readonly segment?: string | undefined;
  /** Other segments named in the request. */
  readonly mentions?: readonly string[];
}

const MOOD_HINTS: Record<(typeof MOODS)[number], string> = {
  intro: 'ouverture, nappe qui s’installe',
  calm: 'calme, exposé posé',
  pulse: 'pulsation régulière, récit qui avance',
  build: 'montée, construction progressive',
  explosion: 'choc, révélation, impact',
  suspense: 'tension, mystère',
  bright: 'lumineux, espoir, découverte',
  dark: 'sombre, gravité',
  minimal: 'dépouillé, presque rien',
  finale: 'conclusion ample',
};

const PROTOCOL = `## Format des réponses

Réponds en français, brièvement : une ou deux phrases, puis les blocs. Ne recopie jamais ce qui ne change pas et ne réexplique pas le code.

Le studio vérifie tes blocs (capsule.json validé, scènes compilées et typées) ; s'il trouve une erreur, il te la renvoie pour correction. Ensuite l'utilisateur valide d'un clic : les fichiers sont modifiés et la vidéo est mise à jour.

Modifier capsule.json : UN bloc \`studio-edits\` (JSON) :

\`\`\`studio-edits
{"edits": [
  {"op": "update", "id": "intro", "fields": {"text": "…"}},
  {"op": "insert", "after": "intro", "segment": {"id": "nouveau", "mood": "pulse", "label": "", "key": "", "text": "…"}},
  {"op": "remove", "id": "ancien"},
  {"op": "move", "id": "outro", "after": "idee"},
  {"op": "set", "path": "title", "value": "…"}
]}
\`\`\`

- \`update\` : seulement les champs qui changent (text, key, label, mood, id). \`after: null\` = en tête.
- Pour écrire toute la narration (nouvelle capsule, sujet donné) : UNE seule opération \`replace\`, qui remplace tous les segments, plutôt que des remove/insert :
  \`{"op": "replace", "segments": [{"id": "accroche", "mood": "intro", "label": "", "key": "…", "text": "…"}, …]}\`
- JSON strict : guillemets droits doublés à l'intérieur des textes interdits (utilise « » ou ’), pas de virgule finale, pas de commentaire.
- \`set\` : title, kicker, closingLine, credits, music.root (MIDI 36-72), music.major (booléen), music.gain (0-2), music.duck (0-1), look.accent, look.background (#rrggbb), look.bloom.

Plan tout prêt, sans code (champ \`visual\` d'un segment, dans \`update\`, \`insert\` ou \`replace\`) : à préférer quand une image, un chiffre, une citation, une liste, un graphique ou des dates disent mieux le propos qu'une scène 3D, et pour aller vite. \`"visual": null\` revient à la scène 3D.

- \`{"type": "image", "src": "tour.jpg", "motion": "zoom-in", "caption": "…", "credit": "…"}\` : fichier du dossier media/ (seulement ceux listés dans le projet) ; motion : zoom-in, zoom-out, pan-left, pan-right, pan-up, pan-down, still ; \`"fit": "contain"\` pour l'image entière.
- \`{"type": "video", "src": "clip.mp4", "start": 12, "loop": true}\` : extrait muet d'un fichier de media/.
- \`{"type": "title", "text": "…", "sub": "…"}\` · \`{"type": "quote", "text": "…", "author": "…"}\` (le titre à l'écran \`key\` n'est pas affiché pour ces deux-là).
- \`{"type": "stat", "value": 8100000000, "suffix": " habitants", "label": "…", "decimals": 0, "prefix": ""}\` : le chiffre défile quand la voix commence.
- \`{"type": "list", "items": ["…", "…"], "numbered": false}\` : 7 points au plus, ils apparaissent au fil de la voix.
- \`{"type": "chart", "kind": "bar", "title": "…", "unit": "%", "data": [{"label": "1900", "value": 12}, …]}\` : bar ou line, 12 valeurs au plus.
- \`{"type": "dates", "events": [{"date": "1563", "text": "…"}, …]}\` : 6 dates au plus.

Textes des plans courts (ils se lisent pendant que la voix parle) ; les nombres y sont en chiffres. Un plan s'affiche par-dessus la scène 3D du segment si elle existe, sinon sur un fond animé discret.

Nouvelle scène, ou scène réécrite en grande partie : le fichier complet.

\`\`\`scene:<id>
import * as THREE from 'three';
import { defineScene, smooth } from '@studio/runtime';
export default defineScene('<id>', ({ group, camera, bloom }) => { …; return ({ u, len }) => { … }; });
\`\`\`

Petite modification d'une scène existante : seulement les lignes changées, en paires recherche/remplacement. SEARCH recopie exactement des lignes actuelles du fichier (assez pour être unique) :

\`\`\`scene-patch:<id>
<<<<<<< SEARCH
    bloom.strength = 0.9;
=======
    bloom.strength = 1.4;
>>>>>>> REPLACE
\`\`\`

N'invente pas de fonction du moteur : n'utilise que celles de la documentation ci-dessous.`;

/** Message sent back to the model when parts of its answer fail the checks. */
export function repairPrompt(errors: readonly string[]): string {
  return `Le studio a gardé ce qui est valide dans ta proposition, mais pas ceci :
${errors.map((e) => `- ${e}`).join('\n')}

Renvoie seulement de quoi corriger ces points : un bloc studio-edits avec uniquement les opérations en cause, corrigées (les autres sont déjà gardées) ; pour une scène, un scene-patch si quelques lignes suffisent. Une phrase au plus.`;
}

/** Message sent when an answer was cut by the token limit. */
export const CONTINUE_PROMPT =
  'Ta réponse a été coupée. Continue exactement là où elle s’arrête (au milieu d’un bloc si besoin), sans rien répéter.';

const NARRATION_RULES = `## Écrire la narration

- Un segment = une idée, une à trois phrases courtes (15 à 45 mots), dites par une voix de synthèse : le texte est exactement ce qui sera prononcé.
- Nombres, dates et sigles en toutes lettres (« mille sept cent quatre-vingt-six »), pas de parenthèses ni d'abréviations, pas de listes.
- Le premier segment accroche (question, image forte) ; le dernier répond à l'accroche. Ton : clair, concret, sans emphase.
- \`key\` est le titre affiché à l'écran (court ; HTML permis, \`<small>\` pour une deuxième ligne), \`label\` un petit repère de chapitre (lieu, date), souvent vide pour l'ouverture et la fin.
- \`id\` : minuscules, chiffres, - et _ ; il nomme aussi le fichier de la scène (\`scenes/<id>.ts\`). « credits » est réservé.
- Ambiances (\`mood\`), qui pilotent la musique : ${MOODS.map((m) => `${m} (${MOOD_HINTS[m]})`).join(', ')}.
- Une capsule dure en général deux à quatre minutes : huit à quatorze segments.`;

const SHOT_DEFAULTS: Record<string, unknown> = {
  fit: 'cover',
  dim: 0.35,
  loop: true,
  start: 0,
  decimals: 0,
  numbered: false,
  motion: 'zoom-in',
  focus: [0.5, 0.5],
  kind: 'bar',
};

/** A shot as the model would write it: default values and empty texts left out. */
const withoutDefaults = (v: object): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(v).filter(
      ([k, x]) => x !== '' && JSON.stringify(x) !== JSON.stringify(k === 'type' ? undefined : SHOT_DEFAULTS[k]),
    ),
  );

let scenesDoc: string | null = null;
async function sceneGuide(): Promise<string> {
  if (scenesDoc === null) {
    const file = path.join(STUDIO_HOME, 'docs', 'scenes.md');
    scenesDoc = existsSync(file) ? await readFile(file, 'utf8') : '';
  }
  return scenesDoc;
}

const ROLE = `Tu es l'assistant du « Studio vidéo », qui fabrique des capsules vidéo narrées : une voix off lit la narration, chaque segment a sa scène 3D (Three.js) rendue image par image, une musique générée suit les ambiances, des sous-titres sont tirés du texte. Tu écris la narration et programmes les scènes.`;

/** The part of the prompt that never changes: first, so providers can cache it. */
export async function stablePrompt(): Promise<string> {
  return [
    ROLE,
    NARRATION_RULES,
    PROTOCOL,
    `## Écrire des scènes (documentation du moteur)\n\n${await sceneGuide()}`,
  ].join('\n\n');
}

const MAX_SCENES = 3;

const VERTICAL_RULES = `Vidéo VERTICALE courte (9:16, Shorts, Reels, TikTok) : viser 60 s au plus ; accroche dès la première phrase ; phrases courtes ; un segment = une idée. Sous-titres mot par mot au milieu de l'écran. Textes des plans très courts (listes de 4 points au plus, graphiques de 6 valeurs au plus, 4 dates au plus). Scènes : le cadre est étroit, garder le sujet au centre et utiliser la hauteur (\`portrait\` vaut true dans le contexte de la scène).`;

/**
 * The project as it is now, compact: settings the assistant may change, then one entry per
 * segment (no JSON quoting, no defaults). Scene code only for the segments the request is about.
 */
export async function projectPrompt(project: Project, focus: Focus = {}): Promise<string> {
  const c = project.capsule;
  const { timeline, estimated } = await computeTimeline(project);
  const placed = new Map(timeline.segments.map((s) => [s.id, s]));
  const lines = [
    `## Le projet « ${project.name} » (état actuel, fait foi)`,
    '',
    `title : ${c.title} · kicker : ${c.kicker || '—'} · closingLine : ${c.closingLine || '—'} · language : ${c.language}`,
    `credits : ${c.credits || '—'}`,
    `music : root ${c.music.root}, ${c.music.major ? 'majeur' : 'mineur'}, gain ${c.music.gain}, duck ${c.music.duck}${c.music.enabled ? '' : ', désactivée'} · look : accent ${c.look.accent}, background ${c.look.background}, bloom ${c.look.bloom}`,
    `Durée : ${timeline.duration.toFixed(1)} s${estimated.length ? ` (voix estimées pour ${estimated.join(', ')})` : ''}`,
    ...(isPortrait(c.format) ? [VERTICAL_RULES] : []),
    '',
    'Segments — n°. id · mood · durée · scène :',
  ];
  for (const [i, s] of c.segments.entries()) {
    const at = placed.get(s.id);
    const code = await readScene(project, s.id).catch(() => null);
    lines.push(
      `${i + 1}. ${s.id} · ${s.mood} · ${at ? `${(at.t1 - at.t0).toFixed(1)} s` : '?'} · ${code ? `scenes/${s.id}.ts (${code.split('\n').length} lignes)` : 'pas de scène'}`,
      `   text : ${s.text}`,
    );
    if (s.visual) lines.push(`   visual : ${JSON.stringify(withoutDefaults(s.visual))}`);
    if (s.key || s.label) lines.push(`   key : ${s.key || '—'} · label : ${s.label || '—'}`);
  }
  const media = await listMedia(project);
  lines.push(
    '',
    media.length
      ? `Fichiers de media/ : ${media.map((m) => `${m.name} (${m.kind === 'image' ? 'image' : 'vidéo'})`).join(', ')}`
      : 'Dossier media/ vide : pas de plan image ou vidéo possible (l’utilisateur peut en importer depuis l’écran Écrire).',
  );
  if (focus.step) lines.push('', `L'utilisateur est sur l'écran « ${focus.step} ».`);

  const wanted = [...new Set([focus.segment, ...(focus.mentions ?? [])].filter((x): x is string => Boolean(x)))];
  for (const id of wanted.slice(0, MAX_SCENES)) {
    const code = await readScene(project, id).catch(() => null);
    lines.push(
      '',
      code
        ? `Code actuel de scenes/${id}.ts :\n\n\`\`\`ts\n${code.trim()}\n\`\`\``
        : `Le segment « ${id} » n'a pas encore de fichier de scène.`,
    );
  }
  return lines.join('\n');
}

/** Segment ids named in a message (whole words), to include their scene code. */
export function mentionedSegments(project: Project, text: string): string[] {
  return project.capsule.segments
    .map((s) => s.id)
    .filter(
      (id) => id.length >= 3 && new RegExp(`(^|[^\\w-])${id.replace(/[-_]/g, '[-_]')}($|[^\\w-])`, 'i').test(text),
    );
}
