/** The validation card of a checked proposal: what will change, then apply (and update the video) or undo. */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { describeEdit } from '../../../cli/src/ai/edits.js';
import type { Plan, StudioEdit } from '../../../cli/src/ui/protocol.js';
import { applyPlan, undoPlan, type Message } from '../assistant.js';
import { attempt, notify } from '../toast.js';
import type { ProjectContext } from './ProjectView.js';
import { Button, Icon } from './ui.js';

export function PlanCard({
  plan,
  message,
  index,
  ctx,
}: {
  plan: Plan;
  message: Message;
  index: number;
  ctx: ProjectContext;
}): JSX.Element {
  const [update, setUpdate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const applied = message.applied;
  const segmentText = (e: StudioEdit): string | undefined =>
    e.op === 'update' ? e.fields.text : e.op === 'insert' ? e.segment.text : undefined;
  const [showAll, setShowAll] = useState(false);

  const validate = async (): Promise<void> => {
    setBusy(true);
    try {
      // edits typed in the editor must be on disk first: the plan applies to capsule.json
      if (!(await ctx.save())) return;
      const result = await attempt(() => applyPlan(ctx.name, index, plan, update));
      if (!result) return;
      notify(result.job ? 'modifications appliquées : mise à jour de la vidéo lancée' : 'modifications appliquées');
      const first = plan.scenes[0];
      const at = first && ctx.detail.timeline.segments.find((s) => s.id === first.id);
      if (at) ctx.seek(at.t0);
    } finally {
      setBusy(false);
    }
  };
  const undoKey = typeof applied === 'object' ? applied.undo : null;
  const undo = async (key: string): Promise<void> => {
    setBusy(true);
    const done = await attempt(async () => {
      await undoPlan(ctx.name, index, key);
      return true;
    });
    if (done) notify('modifications annulées');
    setBusy(false);
  };

  return (
    <div class={`proposal${applied ? ' proposal-done' : ''}`}>
      <div class="proposal-head">
        <Icon name={applied ? 'check' : 'sparkle'} size={14} />
        <b>{applied === 'undone' ? 'Annulé' : applied ? 'Appliqué' : 'Prêt à appliquer'}</b>
        {!applied && (
          <span class="small muted">vérifié : capsule valide{plan.scenes.length ? ', scènes compilées' : ''}</span>
        )}
      </div>
      {plan.dropped.length > 0 && (
        <details class="proposal-dropped">
          <summary>
            <Icon name="alert" size={13} /> {plan.dropped.length} point{plan.dropped.length > 1 ? 's' : ''} laissé
            {plan.dropped.length > 1 ? 's' : ''} de côté (toujours en erreur) : le reste peut être appliqué
          </summary>
          <ul>
            {plan.dropped.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      {plan.warnings.length > 0 && (
        <details class="proposal-warnings">
          <summary>
            {plan.warnings.length} ajustement{plan.warnings.length > 1 ? 's' : ''} automatique
            {plan.warnings.length > 1 ? 's' : ''}
          </summary>
          <ul>
            {plan.warnings.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      <ul>
        {plan.edits.map((e, i) => (
          <li key={`e${i}`}>
            {describeEdit(e)}
            {segmentText(e) && <q>{segmentText(e)}</q>}
            {e.op === 'replace' && (
              <>
                {' '}
                <button type="button" class="link" onClick={() => setShowAll((o) => !o)}>
                  {showAll ? 'masquer' : 'lire'}
                </button>
                {showAll && (
                  <ol class="proposal-segments">
                    {e.segments.map((seg) => (
                      <li key={seg.id}>
                        <b>{seg.id}</b> · {seg.mood}
                        {seg.key ? ` · ${seg.key}` : ''}
                        <q>{seg.text}</q>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </li>
        ))}
        {plan.scenes.map((s) => (
          <li key={s.id}>
            {s.created ? `nouvelle scène « ${s.id} »` : `scène « ${s.id} » : +${s.added} −${s.removed} lignes`}{' '}
            <button type="button" class="link" onClick={() => setCode(code === s.id ? null : s.id)}>
              {code === s.id ? 'masquer' : 'voir le code'}
            </button>
            {code === s.id && <pre class="code">{s.code}</pre>}
          </li>
        ))}
      </ul>
      {!applied && (
        <>
          <label class="proposal-option">
            <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.currentTarget.checked)} />
            Puis mettre à jour la vidéo (voix, musique, brouillon 720p)
          </label>
          <Button variant="primary" icon="check" disabled={busy} onClick={() => void validate()}>
            Valider
          </Button>
        </>
      )}
      {undoKey && (
        <Button small variant="ghost" icon="close" disabled={busy} onClick={() => void undo(undoKey)}>
          Annuler ces modifications
        </Button>
      )}
    </div>
  );
}
