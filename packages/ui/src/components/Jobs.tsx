/** Bottom dock: the running job with its progress, the queue, and the log of each job. */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JobInfo } from '../../../cli/src/ui/protocol.js';
import { api } from '../api.js';
import { askAssistant, errorExcerpt } from '../assistant.js';
import { clock, seconds } from '../format.js';
import { selectJobs, selectLogs, useLive } from '../store.js';
import { attempt } from '../toast.js';
import { Button, Icon, Progress } from './ui.js';

const KIND_LABEL: Record<JobInfo['kind'], string> = {
  tts: 'Voix',
  timeline: 'Timeline',
  music: 'Musique',
  stills: 'Planche',
  render: 'Rendu',
  make: 'Chaîne complète',
};

const label = (j: JobInfo): string => `${KIND_LABEL[j.kind]}${j.options.draft ? ' brouillon' : ''}`;

const STATE_LABEL: Record<JobInfo['state'], string> = {
  queued: 'en file',
  running: 'en cours',
  done: 'terminé',
  failed: 'échec',
  cancelled: 'annulé',
};

function ProgressText({ job }: { job: JobInfo }): JSX.Element | null {
  const p = job.progress;
  if (!p) return null;
  return (
    <span class="small mono">
      {p.done}/{p.total} {p.unit}
      {p.rate !== undefined && ` · ${p.rate.toFixed(1)}/s`}
      {p.eta !== undefined && p.done < p.total && ` · reste ${seconds(p.eta)}`}
    </span>
  );
}

export function Jobs(): JSX.Element {
  const jobs = useLive(selectJobs);
  const logs = useLive(selectLogs);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  const running = jobs.find((j) => j.state === 'running');
  const queued = jobs.filter((j) => j.state === 'queued');
  const latest = running ?? jobs.at(-1);
  const focus = jobs.find((j) => j.id === selected) ?? latest;
  const lines = useMemo(() => (focus ? logs.filter((l) => l.jobId === focus.id) : logs), [logs, focus]);

  // open the dock when a job fails, so its error is seen
  const lastFailed = jobs.filter((j) => j.state === 'failed').at(-1)?.id;
  useEffect(() => {
    if (lastFailed) {
      setOpen(true);
      setSelected(lastFailed);
    }
  }, [lastFailed]);

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, open]);

  const p = running?.progress;
  return (
    <section class={`dock${open ? ' dock-open' : ''}`}>
      <div class="dock-bar">
        {running ? (
          <>
            <span class="spinner" />
            <b>{label(running)}</b>
            <span class="muted">{running.project}</span>
            <div class="dock-progress">
              <Progress value={p ? p.done / Math.max(p.total, 1) : null} />
            </div>
            <ProgressText job={running} />
            <Button small variant="danger" icon="stop" onClick={() => void attempt(() => api.cancel(running.id))}>
              Arrêter
            </Button>
          </>
        ) : latest ? (
          <span class={`job-line job-${latest.state}`}>
            <Icon name={latest.state === 'done' ? 'check' : latest.state === 'failed' ? 'alert' : 'close'} size={14} />
            {label(latest)} · {latest.project} · {STATE_LABEL[latest.state]}
            {latest.error && <span class="muted"> · {latest.error.split('\n')[0]}</span>}
          </span>
        ) : (
          <span class="muted">Aucune tâche lancée</span>
        )}
        {queued.length > 0 && <span class="badge">{queued.length} en file</span>}
        <div class="grow" />
        <Button small variant="ghost" icon={open ? 'down' : 'up'} onClick={() => setOpen((o) => !o)}>
          Journal
        </Button>
      </div>
      {open && (
        <div class="dock-body">
          <ul class="job-list">
            {[...jobs].reverse().map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  class={`job-item${j === focus ? ' active' : ''}`}
                  onClick={() => setSelected(j.id)}
                >
                  <span class={`dot dot-${j.state}`} />
                  <span>
                    <b>{label(j)}</b> <span class="muted">{j.project}</span>
                  </span>
                  <span class="small muted">
                    {clock(j.created)} · {STATE_LABEL[j.state]}
                    {j.started && j.ended ? ` · ${seconds((j.ended - j.started) / 1000)}` : ''}
                  </span>
                </button>
                {j.state === 'queued' && (
                  <Button
                    small
                    variant="ghost"
                    icon="close"
                    title="Retirer de la file"
                    onClick={() => void attempt(() => api.cancel(j.id))}
                  />
                )}
              </li>
            ))}
            {jobs.length === 0 && <li class="muted small">Les étapes lancées depuis l’interface apparaissent ici.</li>}
          </ul>
          <div class="console mono" ref={consoleRef}>
            {lines.length === 0 && <div class="muted">journal vide</div>}
            {lines.map((l, i) => (
              <div key={i} class={`log log-${l.level}`}>
                <span class="log-time">{clock(l.time)}</span>
                <span class="log-msg">{l.msg}</span>
              </div>
            ))}
            {focus?.error && (
              <div class="log log-error">
                {focus.error}
                {focus.state === 'failed' && (
                  <Button
                    small
                    icon="sparkle"
                    variant="accent-soft"
                    onClick={() =>
                      askAssistant(
                        focus.project,
                        `La tâche « ${focus.kind} » a échoué :\n${errorExcerpt(focus.error ?? '')}\nTrouve la cause ; si elle vient d'une scène ou de la capsule, corrige-la, sinon dis quoi faire.`,
                        `Analyser l’échec de « ${focus.kind} »`,
                      )
                    }
                  >
                    Demander à l’assistant
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
