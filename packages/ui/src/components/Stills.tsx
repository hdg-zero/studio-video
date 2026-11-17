/** Contact sheet: one frame per segment, to check framing before spending time on a render. */
import type { JSX } from 'preact';
import { fileUrl, relativeTo } from '../api.js';
import { ago } from '../format.js';
import type { ProjectContext } from './ProjectView.js';
import { Empty, Status } from './ui.js';

export function Stills({ ctx }: { ctx: ProjectContext }): JSX.Element {
  const { stills, root } = ctx.detail.status;
  const segments = ctx.detail.timeline.segments;
  const rows = Math.ceil(segments.length / 2);
  return (
    <div class="stills">
      <div class="toolbar">
        <h3>Planche contact</h3>
        <Status state={stills.state} />
        {stills.mtime !== null && (
          <span class="small muted">faite {ago(stills.mtime)} · cliquer une image ouvre l’aperçu à cet instant</span>
        )}
      </div>
      {stills.mtime === null ? (
        <Empty icon="image" title="Pas encore de planche contact">
          <p>
            Une image au milieu de chaque segment, en pleine résolution : le moyen le plus rapide de vérifier le
            cadrage.
          </p>
        </Empty>
      ) : (
        <div class="sheet">
          <img src={fileUrl(ctx.name, relativeTo(root, stills.file), stills.mtime)} alt="Planche contact" />
          {stills.state === 'fresh' && (
            <div class="sheet-grid" style={{ gridTemplateRows: `repeat(${rows}, 1fr)` }}>
              {segments.map((s) => {
                const t = s.voice === null ? (s.t0 + s.t1) / 2 : s.voice + s.dur / 2;
                return (
                  <button
                    key={s.id}
                    type="button"
                    class="sheet-tile"
                    title="Ouvrir l’aperçu à cet instant"
                    onClick={() => ctx.seek(t)}
                  >
                    <span>{s.id}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
