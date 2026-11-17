/**
 * The shot of a segment, chosen without code: a 3D scene (coded file), or a ready-made shot the
 * engine draws from a few fields (image that moves, video clip, title, quote, key figure, list,
 * chart, dates). Pictures and clips are imported into the project's `media/` folder.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { fileUrl } from '../api.js';
import { attempt, notify } from '../toast.js';
import type { Issues, ProjectContext } from './ProjectView.js';
import { Icon, type IconName } from './ui.js';

type Visual = Record<string, unknown> & { type?: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

const TYPES: readonly { type: string; label: string; icon: IconName; hint: string }[] = [
  { type: '', label: 'Scène 3D', icon: 'cpu', hint: 'Scène programmée (scenes/<id>.ts), écrite par l’assistant' },
  { type: 'image', label: 'Image', icon: 'image', hint: 'Une photo ou une illustration qui bouge doucement' },
  { type: 'video', label: 'Vidéo', icon: 'film', hint: 'Un extrait vidéo, sans son' },
  { type: 'title', label: 'Titre', icon: 'text', hint: 'Un grand titre au centre' },
  { type: 'quote', label: 'Citation', icon: 'text', hint: 'Une citation et son auteur' },
  { type: 'stat', label: 'Chiffre', icon: 'bolt', hint: 'Un chiffre clé qui défile jusqu’à sa valeur' },
  { type: 'list', label: 'Liste', icon: 'more', hint: 'Des points qui apparaissent avec la voix' },
  { type: 'chart', label: 'Graphique', icon: 'timeline', hint: 'Barres ou courbe' },
  { type: 'dates', label: 'Frise', icon: 'timeline', hint: 'Des dates sur une ligne du temps' },
];

const MOTIONS: Record<string, string> = {
  'zoom-in': 'Zoom avant',
  'zoom-out': 'Zoom arrière',
  'pan-left': 'Glisse vers la gauche',
  'pan-right': 'Glisse vers la droite',
  'pan-up': 'Monte',
  'pan-down': 'Descend',
  still: 'Fixe',
};

/** A new shot of `type`, prefilled from what the segment already says. */
function starter(type: string, seg: Record<string, unknown>, media: readonly { name: string; kind: string }[]): Visual {
  const key = str(seg.key)
    .replace(/<small>.*$/s, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  switch (type) {
    case 'image':
    case 'video':
      return { type, src: media.find((m) => m.kind === type)?.name ?? '' };
    case 'title':
      return { type, text: key || str(seg.id) };
    case 'quote':
      return { type, text: '', author: '' };
    case 'stat':
      return { type, value: 0, label: key };
    case 'list':
      return { type, items: [] };
    case 'chart':
      return { type, kind: 'bar', data: [] };
    default:
      return { type, events: [] };
  }
}

export function VisualEditor({
  ctx,
  index,
  segment,
  issues,
}: {
  ctx: ProjectContext;
  index: number;
  segment: Record<string, unknown>;
  issues: Issues;
}): JSX.Element {
  const visual = (segment.visual && typeof segment.visual === 'object' ? segment.visual : null) as Visual | null;
  const type = str(visual?.type);
  const media = ctx.detail.media;
  const set = (next: Visual | null): void =>
    ctx.setDraft((c) => ({
      ...c,
      segments: (c.segments as Record<string, unknown>[]).map((s, k) => {
        if (k !== index) return s;
        const copy = { ...s };
        if (next) copy.visual = next;
        else delete copy.visual;
        return copy;
      }),
    }));
  const field = (name: string, value: unknown): void => {
    if (!visual) return;
    // an emptied field goes back to its default
    const rest = Object.fromEntries(Object.entries(visual).filter(([k]) => k !== name)) as Visual;
    set(value === undefined || value === '' ? rest : { ...rest, [name]: value });
  };

  const problems = issues.filter((x) => x.path.startsWith(`segments.${index}.visual`));

  return (
    <section class="visual-editor">
      <div class="visual-types" role="radiogroup" aria-label="Image à l’écran">
        <span class="visual-caption">À l’écran</span>
        {TYPES.map((t) => (
          <button
            key={t.type}
            type="button"
            role="radio"
            aria-checked={type === t.type}
            class={`chip${type === t.type ? ' chip-on' : ''}`}
            title={t.hint}
            onClick={() => set(t.type ? (type === t.type ? visual : starter(t.type, segment, media)) : null)}
          >
            <Icon name={t.icon} size={13} /> {t.label}
          </button>
        ))}
      </div>
      {visual && (
        <div class="visual-fields">
          {(type === 'image' || type === 'video') && (
            <MediaFields ctx={ctx} kind={type} visual={visual} field={field} />
          )}
          {type === 'title' && (
            <>
              <Text label="Titre" value={str(visual.text)} onInput={(v) => field('text', v)} wide />
              <Text label="Sous-titre" value={str(visual.sub)} onInput={(v) => field('sub', v)} wide />
            </>
          )}
          {type === 'quote' && (
            <>
              <Text label="Citation" value={str(visual.text)} onInput={(v) => field('text', v)} wide area />
              <Text label="Auteur" value={str(visual.author)} onInput={(v) => field('author', v)} />
            </>
          )}
          {type === 'stat' && (
            <>
              <NumberField label="Valeur" value={visual.value} onInput={(v) => field('value', v)} />
              <Text label="Avant" value={str(visual.prefix)} placeholder="ex. +" onInput={(v) => field('prefix', v)} />
              <Text label="Après" value={str(visual.suffix)} placeholder="ex. %" onInput={(v) => field('suffix', v)} />
              <NumberField label="Décimales" value={visual.decimals} onInput={(v) => field('decimals', v)} />
              <Text label="Légende" value={str(visual.label)} onInput={(v) => field('label', v)} wide />
            </>
          )}
          {type === 'list' && (
            <>
              <Lines
                key={`${index}-list`}
                label="Points (un par ligne, 7 au plus)"
                lines={((visual.items as unknown[] | undefined) ?? []).map(str)}
                onChange={(items) => field('items', items)}
              />
              <Check label="Numérotés" value={visual.numbered === true} onChange={(v) => field('numbered', v)} />
            </>
          )}
          {type === 'chart' && (
            <>
              <Choice
                label="Forme"
                value={str(visual.kind) || 'bar'}
                options={{ bar: 'Barres', line: 'Courbe' }}
                onChange={(v) => field('kind', v)}
              />
              <Text label="Titre" value={str(visual.title)} onInput={(v) => field('title', v)} />
              <Text label="Unité" value={str(visual.unit)} placeholder="ex. %" onInput={(v) => field('unit', v)} />
              <Lines
                key={`${index}-chart`}
                label="Données (« étiquette : valeur », une par ligne)"
                lines={((visual.data as { label?: unknown; value?: unknown }[] | undefined) ?? []).map(
                  (d) => `${str(d.label)} : ${num(d.value)}`,
                )}
                onChange={(lines) => field('data', lines.map(parsePoint))}
              />
            </>
          )}
          {type === 'dates' && (
            <Lines
              key={`${index}-dates`}
              label="Dates (« date : texte », une par ligne, 6 au plus)"
              lines={((visual.events as { date?: unknown; text?: unknown }[] | undefined) ?? []).map(
                (e) => `${str(e.date)} : ${str(e.text)}`,
              )}
              onChange={(lines) =>
                field(
                  'events',
                  lines.map((l) => {
                    const [date = '', ...rest] = l.split(':');
                    return { date: date.trim(), text: rest.join(':').trim() };
                  }),
                )
              }
            />
          )}
        </div>
      )}
      {problems.map((p) => (
        <p key={p.path} class="field-msg">
          {p.path.replace(`segments.${index}.visual`, '').replace(/^\./, '') || 'plan'} : {p.message}
        </p>
      ))}
    </section>
  );
}

/** « Afrique : 2 140 » → { label, value } (spaces and decimal comma accepted). */
function parsePoint(line: string): { label: string; value: number } {
  const i = line.lastIndexOf(':');
  const label = (i < 0 ? '' : line.slice(0, i)).trim();
  const raw = (i < 0 ? line : line.slice(i + 1)).replace(/[\s  ]/g, '').replace(',', '.');
  return { label, value: Number.parseFloat(raw) };
}

function MediaFields({
  ctx,
  kind,
  visual,
  field,
}: {
  ctx: ProjectContext;
  kind: 'image' | 'video';
  visual: Visual;
  field: (name: string, value: unknown) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const files = ctx.detail.media.filter((m) => m.kind === kind);
  const src = str(visual.src);
  const upload = async (file: File): Promise<void> => {
    setBusy(true);
    const res = await attempt(async () => {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(ctx.name)}/media?name=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: file,
        },
      );
      const body = (await r.json()) as { name?: string; error?: string };
      if (!r.ok || !body.name) throw new Error(body.error ?? `import impossible (HTTP ${r.status})`);
      return body.name;
    });
    setBusy(false);
    if (res) {
      field('src', res);
      notify(`${res} ajouté au dossier media/`);
    }
  };
  return (
    <>
      <div class="media-pick wide">
        {kind === 'image' && src && files.some((f) => f.name === src) && (
          <img class="media-thumb" src={fileUrl(ctx.name, `media/${src}`)} alt="" />
        )}
        <label>
          <span>{kind === 'image' ? 'Image' : 'Vidéo'} (dossier media/)</span>
          <select value={src} onChange={(e) => field('src', e.currentTarget.value)}>
            {!files.some((f) => f.name === src) && <option value={src}>{src || '— choisir —'}</option>}
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label class="btn btn-ghost btn-sm upload">
          <Icon name="folder" size={14} />
          <span>{busy ? 'Import…' : 'Importer…'}</span>
          <input
            type="file"
            accept={kind === 'image' ? 'image/*' : 'video/*'}
            disabled={busy}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) void upload(f);
            }}
          />
        </label>
      </div>
      {kind === 'image' ? (
        <Choice
          label="Mouvement"
          value={str(visual.motion) || 'zoom-in'}
          options={MOTIONS}
          onChange={(v) => field('motion', v)}
        />
      ) : (
        <>
          <NumberField label="Début (s)" value={visual.start} onInput={(v) => field('start', v)} />
          <Check label="En boucle" value={visual.loop !== false} onChange={(v) => field('loop', v)} />
        </>
      )}
      <Choice
        label="Cadrage"
        value={str(visual.fit) || 'cover'}
        options={{ cover: 'Plein cadre', contain: 'Image entière' }}
        onChange={(v) => field('fit', v)}
      />
      <Text label="Légende" value={str(visual.caption)} onInput={(v) => field('caption', v)} />
      <Text
        label="Source / crédit"
        value={str(visual.credit)}
        placeholder="ex. Wikimedia, CC BY-SA"
        onInput={(v) => field('credit', v)}
      />
    </>
  );
}

function Text({
  label,
  value,
  onInput,
  placeholder,
  wide,
  area,
}: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
  area?: boolean;
}): JSX.Element {
  return (
    <label class={wide ? 'wide' : ''}>
      <span>{label}</span>
      {area ? (
        <textarea rows={2} value={value} placeholder={placeholder} onInput={(e) => onInput(e.currentTarget.value)} />
      ) : (
        <input value={value} placeholder={placeholder} onInput={(e) => onInput(e.currentTarget.value)} />
      )}
    </label>
  );
}

function NumberField({
  label,
  value,
  onInput,
}: {
  label: string;
  value: unknown;
  onInput: (v: number | undefined) => void;
}): JSX.Element {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        step="any"
        value={num(value)}
        onInput={(e) => {
          const n = e.currentTarget.valueAsNumber;
          onInput(Number.isFinite(n) ? n : undefined);
        }}
      />
    </label>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** One entry per line; the text is kept as typed (empty lines while typing), entries without them. */
function Lines({
  label,
  lines,
  onChange,
}: {
  label: string;
  lines: readonly string[];
  onChange: (lines: string[]) => void;
}): JSX.Element {
  const [text, setText] = useState(lines.join('\n'));
  return (
    <label class="wide">
      <span>{label}</span>
      <textarea
        rows={Math.max(3, text.split('\n').length)}
        value={text}
        onInput={(e) => {
          setText(e.currentTarget.value);
          onChange(
            e.currentTarget.value
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean),
          );
        }}
      />
    </label>
  );
}
