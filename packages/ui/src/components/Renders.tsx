/** Rendered videos (out/*.mp4) with a player, and the render launcher with its options. */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ActionOptions } from '../../../cli/src/ui/protocol.js';
import { fileUrl, relativeTo } from '../api.js';
import { ago, bytes } from '../format.js';
import { moodColor } from '../moods.js';
import type { ProjectContext } from './ProjectView.js';
import { Button, Empty, Field } from './ui.js';

export function Renders({ ctx }: { ctx: ProjectContext }): JSX.Element {
  const { renders, root, outputs } = ctx.detail.status;
  const { width, height } = ctx.detail.resolved.format;
  const [selected, setSelected] = useState<string | null>(null);
  const shown =
    renders.find((r) => r.name === selected) ??
    renders.find((r) => r.name === outputs.final) ??
    renders.find((r) => r.name === outputs.draft) ??
    renders[0];

  return (
    <div class="renders">
      <div class="renders-main">
        {shown ? (
          <>
            <video
              key={`${shown.name}-${shown.mtime}`}
              class={height > width ? 'player portrait' : 'player'}
              controls
              preload="metadata"
              src={fileUrl(ctx.name, relativeTo(root, shown.file), shown.mtime)}
            />
            <div class="small muted">
              {shown.file} · {bytes(shown.size)} · {ago(shown.mtime)}
              {shown.stale && <span class="warn"> · plus ancien que les dernières modifications</span>}
            </div>
          </>
        ) : (
          <Empty icon="film" title="Aucun rendu">
            <p>Lancez un brouillon 720p pour juger du rythme, puis le rendu final.</p>
          </Empty>
        )}
        <ul class="render-list">
          {renders.map((r) => (
            <li key={r.name}>
              <button
                type="button"
                class={`render-item${r === shown ? ' active' : ''}`}
                onClick={() => setSelected(r.name)}
              >
                <b>{r.name}</b>
                <span class="small muted">
                  {r.draft ? 'brouillon · ' : ''}
                  {bytes(r.size)} · {ago(r.mtime)}
                </span>
                {r.stale && (
                  <span class="status status-stale">
                    <i />
                    périmé
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <RenderForm ctx={ctx} />
    </div>
  );
}

function RenderForm({ ctx }: { ctx: ProjectContext }): JSX.Element {
  const [only, setOnly] = useState<readonly string[]>([]);
  const [gpu, setGpu] = useState<NonNullable<ActionOptions['gpu']>>('auto');
  const [workers, setWorkers] = useState('');
  const segments = ctx.detail.timeline.segments;
  const { cache } = ctx.detail.status;
  const options = (draft: boolean): ActionOptions => ({
    draft,
    gpu,
    ...(only.length ? { only } : {}),
    ...(workers ? { workers: Number(workers) } : {}),
  });
  const toggle = (id: string): void => setOnly((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  return (
    <details class="panel render-form">
      <summary>
        <b>Rendu partiel et options</b>
        <span class="small muted">quelques segments seulement, GPU ou CPU, nombre de navigateurs</span>
      </summary>
      <Field
        label="Segments"
        hint={only.length ? 'le son suit si la sélection est contiguë' : 'tous (cliquer pour n’en rendre que certains)'}
      >
        <div class="chips">
          {segments.map((s) => (
            <button
              key={s.id}
              type="button"
              class={`chip${only.includes(s.id) ? ' chip-on' : ''}`}
              style={{ '--mood': moodColor(s.id === 'credits' ? 'credits' : s.mood) }}
              onClick={() => toggle(s.id)}
            >
              {s.id}
            </button>
          ))}
        </div>
      </Field>
      <div class="row">
        <Field label="Rendu WebGL" hint="auto : GPU si disponible">
          <select value={gpu} onChange={(e) => setGpu(e.currentTarget.value as typeof gpu)}>
            <option value="auto">auto</option>
            <option value="gpu">GPU obligatoire</option>
            <option value="cpu">CPU (SwiftShader)</option>
          </select>
        </Field>
        <Field label="Navigateurs en parallèle" hint="vide : moitié des threads">
          <input type="number" min={1} max={32} value={workers} onInput={(e) => setWorkers(e.currentTarget.value)} />
        </Field>
      </div>
      <p class="small muted">
        Cache : {cache.chunks} morceaux ({bytes(cache.bytes)}). Seuls les morceaux dont la scène, le texte ou les
        réglages ont changé sont rendus de nouveau ; un rendu arrêté reprend où il en était.
      </p>
      <div class="row">
        <Button icon="film" variant="accent-soft" onClick={() => void ctx.run(['render', options(true)])}>
          Brouillon avec ces options
        </Button>
        <Button icon="film" onClick={() => void ctx.run(['render', options(false)])}>
          Final avec ces options
        </Button>
      </div>
    </details>
  );
}
