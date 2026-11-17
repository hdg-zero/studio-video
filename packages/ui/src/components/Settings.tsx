/**
 * Every other field of capsule.json as a form. Only fields the user touches are written, so
 * a capsule keeps relying on the defaults it does not set.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { VoiceSearchResult } from '../../../cli/src/ui/protocol.js';
import { api } from '../api.js';
import { attempt } from '../toast.js';
import type { Capsule, ProjectContext } from './ProjectView.js';
import { StepIntro } from './steps/common.js';
import { Button, Field } from './ui.js';

type Kind =
  | { type: 'text' }
  | { type: 'textarea' }
  | { type: 'number'; step?: number; min?: number; max?: number }
  | { type: 'range'; step: number; min: number; max: number }
  | { type: 'color' }
  | { type: 'bool' }
  | { type: 'select'; options: readonly (readonly [string | number | boolean, string])[] };

interface Def {
  readonly path: string;
  readonly label: string;
  readonly hint?: string;
  readonly kind: Kind;
  readonly wide?: boolean;
}

const NOTES = ['do', 'do♯', 'ré', 'ré♯', 'mi', 'fa', 'fa♯', 'sol', 'sol♯', 'la', 'la♯', 'si'];
const noteName = (midi: number): string => `${NOTES[midi % 12] ?? ''}${Math.floor(midi / 12) - 1}`;
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const SECTIONS: readonly { title: string; intro?: string; fields: readonly Def[] }[] = [
  {
    title: 'Textes',
    fields: [
      { path: 'title', label: 'Titre', kind: { type: 'text' }, hint: 'carton d’ouverture et nom du fichier' },
      { path: 'kicker', label: 'Surtitre', kind: { type: 'text' }, hint: 'petite ligne au-dessus du titre' },
      { path: 'language', label: 'Langue', kind: { type: 'text' }, hint: 'code BCP 47, ex. fr' },
      { path: 'closingLine', label: 'Phrase finale', kind: { type: 'textarea' }, wide: true },
      {
        path: 'credits',
        label: 'Générique',
        kind: { type: 'textarea' },
        hint: 'HTML ; <b>…</b> pour la ligne de titre. Doit citer la voix réellement utilisée.',
        wide: true,
      },
    ],
  },
  {
    title: 'Voix',
    intro: 'Changer de modèle ou de voix invalide tous les clips (ils seront régénérés).',
    fields: [
      { path: 'voice.model', label: 'Modèle (OpenRouter)', kind: { type: 'text' }, wide: true },
      {
        path: 'voice.voice',
        label: 'Voix fixe',
        kind: { type: 'text' },
        hint: 'reference_id Fish Audio, nom de voix…',
        wide: true,
      },
      { path: 'voice.credit', label: 'Crédit', kind: { type: 'text' }, wide: true },
      { path: 'voice.concurrency', label: 'Requêtes en parallèle', kind: { type: 'number', min: 1, max: 16 } },
    ],
  },
  {
    title: 'Musique',
    fields: [
      { path: 'music.enabled', label: 'Musique', kind: { type: 'bool' } },
      {
        path: 'music.root',
        label: 'Tonique',
        kind: { type: 'select', options: range(36, 72).map((m) => [m, `${noteName(m)} (${m})`] as const) },
      },
      {
        path: 'music.major',
        label: 'Mode',
        kind: {
          type: 'select',
          options: [
            [false, 'mineur'],
            [true, 'majeur'],
          ],
        },
      },
      { path: 'music.gain', label: 'Volume de la musique', kind: { type: 'range', min: 0, max: 2, step: 0.05 } },
      { path: 'music.duck', label: 'Retrait sous la voix', kind: { type: 'range', min: 0, max: 1, step: 0.05 } },
      { path: 'music.seed', label: 'Graine', kind: { type: 'number', step: 1 }, hint: 'change les motifs' },
    ],
  },
  {
    title: 'Apparence',
    fields: [
      { path: 'look.background', label: 'Fond', kind: { type: 'color' } },
      { path: 'look.accent', label: 'Accent', kind: { type: 'color' } },
      { path: 'look.bloom', label: 'Halo (bloom)', kind: { type: 'range', min: 0, max: 2, step: 0.05 } },
      { path: 'look.exposure', label: 'Exposition', kind: { type: 'range', min: 0.3, max: 2, step: 0.05 } },
      { path: 'look.fogDensity', label: 'Brouillard', kind: { type: 'range', min: 0, max: 0.08, step: 0.001 } },
      {
        path: 'look.msaa',
        label: 'Anticrénelage',
        kind: {
          type: 'select',
          options: [
            [0, 'aucun'],
            [2, '2×'],
            [4, '4×'],
            [8, '8×'],
          ],
        },
        hint: 'appliqué seulement sur GPU',
      },
    ],
  },
  {
    title: 'Rythme',
    intro: 'Chaque segment dure amorce + voix + respiration.',
    fields: [
      { path: 'timing.introLead', label: 'Amorce du premier segment (s)', kind: { type: 'number', step: 0.1, min: 0 } },
      { path: 'timing.lead', label: 'Amorce (s)', kind: { type: 'number', step: 0.1, min: 0 } },
      { path: 'timing.tail', label: 'Respiration (s)', kind: { type: 'number', step: 0.1, min: 0 } },
      { path: 'timing.outroTail', label: 'Respiration finale (s)', kind: { type: 'number', step: 0.1, min: 0 } },
      {
        path: 'timing.credits',
        label: 'Générique (s)',
        kind: { type: 'number', step: 0.5, min: 0 },
        hint: '0 : pas de générique',
      },
      { path: 'timing.readingSpeed', label: 'Lecture estimée (car./s)', kind: { type: 'number', step: 0.5, min: 1 } },
    ],
  },
  {
    title: 'Format',
    fields: [
      { path: 'format.width', label: 'Largeur (px)', kind: { type: 'number', step: 2, min: 2 } },
      { path: 'format.height', label: 'Hauteur (px)', kind: { type: 'number', step: 2, min: 2 } },
      { path: 'format.fps', label: 'Images/s', kind: { type: 'number', step: 1, min: 1, max: 120 } },
      {
        path: 'format.pixelRatio',
        label: 'Densité',
        kind: { type: 'number', step: 0.25, min: 0.5 },
        hint: 'pixels de sortie par pixel CSS (1,5 : mise en page 1280×720 rendue en 1080p)',
      },
    ],
  },
];

function getPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: Capsule, path: string, value: unknown): Capsule {
  const [head, ...rest] = path.split('.');
  if (!head) return obj;
  if (rest.length === 0) {
    // an emptied field goes back to the default
    if (value === undefined) return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== head));
    return { ...obj, [head]: value };
  }
  const child = obj[head];
  return {
    ...obj,
    [head]: setPath(child && typeof child === 'object' ? (child as Capsule) : {}, rest.join('.'), value),
  };
}

/** The fields of one section as a grid (also used by the Voix and Musique steps). */
export function SectionFields({ ctx, title }: { ctx: ProjectContext; title: string }): JSX.Element | null {
  const section = SECTIONS.find((x) => x.title === title);
  if (!section) return null;
  const { draft, detail, issues } = ctx;
  const set = (path: string, value: unknown): void => ctx.setDraft((c) => setPath(c, path, value));
  return (
    <div class="form-grid">
      {section.fields.map((def) => {
        const raw = getPath(draft, def.path);
        const value = raw ?? getPath(detail.resolved, def.path);
        const error = issues.find((i) => i.path === def.path)?.message;
        return (
          <Field key={def.path} label={def.label} hint={def.hint} error={error} wide={def.wide}>
            <Input def={def} value={value} isDefault={raw === undefined} onChange={(v) => set(def.path, v)} />
          </Field>
        );
      })}
    </div>
  );
}

/** Settings screen: everything that is not part of a production step. */
export function Settings({ ctx }: { ctx: ProjectContext }): JSX.Element {
  return (
    <div class="settings-page">
      <StepIntro
        title="Réglages"
        lead="Textes fixes de la vidéo, apparence, rythme et format. Les champs grisés gardent la valeur par défaut ; seuls les champs modifiés sont écrits dans capsule.json."
      />
      <div class="settings">
        {SECTIONS.filter((x) => x.title !== 'Voix' && x.title !== 'Musique').map((section) => (
          <section key={section.title} class="panel settings-section">
            <h3>{section.title}</h3>
            {section.intro && <p class="small muted">{section.intro}</p>}
            <SectionFields ctx={ctx} title={section.title} />
          </section>
        ))}
      </div>
    </div>
  );
}

function Input({
  def,
  value,
  isDefault,
  onChange,
}: {
  def: Def;
  value: unknown;
  isDefault: boolean;
  onChange: (v: unknown) => void;
}): JSX.Element {
  const k = def.kind;
  const cls = isDefault ? 'is-default' : '';
  switch (k.type) {
    case 'text':
      return (
        <input
          class={cls}
          value={typeof value === 'string' ? value : ''}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      );
    case 'textarea':
      return (
        <textarea
          class={cls}
          rows={3}
          value={typeof value === 'string' ? value : ''}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      );
    case 'number':
      return (
        <input
          class={cls}
          type="number"
          step={k.step ?? 'any'}
          min={k.min}
          max={k.max}
          value={typeof value === 'number' ? value : ''}
          onInput={(e) => {
            const n = e.currentTarget.valueAsNumber;
            onChange(Number.isFinite(n) ? n : undefined);
          }}
        />
      );
    case 'range':
      return (
        <div class="range">
          <input
            type="range"
            min={k.min}
            max={k.max}
            step={k.step}
            value={typeof value === 'number' ? value : 0}
            onInput={(e) => onChange(e.currentTarget.valueAsNumber)}
          />
          <span class="mono small">{typeof value === 'number' ? value.toFixed(k.step < 0.01 ? 3 : 2) : '–'}</span>
        </div>
      );
    case 'color':
      return (
        <div class="color">
          <input
            type="color"
            value={typeof value === 'string' ? value : '#000000'}
            onInput={(e) => onChange(e.currentTarget.value)}
          />
          <span class="mono small">{typeof value === 'string' ? value : ''}</span>
        </div>
      );
    case 'bool':
      return (
        <label class="switch">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.currentTarget.checked)} />
          <span>{value === true ? 'activée' : 'coupée'}</span>
        </label>
      );
    case 'select':
      return (
        <select
          class={cls}
          value={String(value)}
          onChange={(e) => {
            const picked = k.options.find(([v]) => String(v) === e.currentTarget.value);
            if (picked) onChange(picked[0]);
          }}
        >
          {k.options.map(([v, label]) => (
            <option key={String(v)} value={String(v)}>
              {label}
            </option>
          ))}
        </select>
      );
  }
}

export function VoiceSearch({ onPick, lang }: { onPick: (v: VoiceSearchResult) => void; lang: string }): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VoiceSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div class="voice-search">
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void attempt(() => api.voices(lang, query))
            .then((r) => r && setResults(r))
            .finally(() => setBusy(false));
        }}
      >
        <input
          placeholder="Chercher une voix Fish Audio (ex. narrat)"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <Button type="submit" icon="search" disabled={busy}>
          {busy ? 'Recherche…' : 'Chercher'}
        </Button>
      </form>
      {results && (
        <ul class="voice-results">
          {results.length === 0 && <li class="muted">aucun résultat</li>}
          {results.map((v) => (
            <li key={v.id}>
              <div>
                <b>{v.title}</b>{' '}
                <span class="small muted">
                  {v.languages.join(', ')} · {v.uses} usages
                </span>
                <div class="small muted">{v.description}</div>
              </div>
              <Button small onClick={() => onPick(v)}>
                Choisir
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p class="small muted">Évitez les voix qui imitent des personnes réelles ou des personnages.</p>
    </div>
  );
}
