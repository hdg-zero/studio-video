/** Pieces shared by the step screens: the step's header card, its running job, the next step. */
import type { ComponentChildren, JSX } from 'preact';
import type { ActionKind, Freshness, JobInfo, ProjectDetail } from '../../../../cli/src/ui/protocol.js';
import { api } from '../../api.js';
import { seconds } from '../../format.js';
import type { Tab } from '../../router.js';
import { attempt } from '../../toast.js';
import type { ProjectContext } from '../ProjectView.js';
import { Button, Icon, Progress, type IconName } from '../ui.js';

export interface StepInfo {
  readonly id: Tab;
  readonly label: string;
  readonly icon: IconName;
  readonly state: Freshness;
  /** One line under the label: what is done or missing. */
  readonly summary: string;
}

/** State of each production step, as shown by the stepper. */
export function stepInfos(detail: ProjectDetail): StepInfo[] {
  const s = detail.status;
  const voiced = s.segments.filter((x) => x.voice === 'fresh').length;
  const render = (name: string): Freshness => {
    const r = s.renders.find((x) => x.name === name);
    return !r ? 'missing' : r.stale ? 'stale' : 'fresh';
  };
  const finalState = render(s.outputs.final);
  const draftState = render(s.outputs.draft);
  const voiceState: Freshness = s.voice === 'fresh' && s.timeline.state !== 'fresh' ? 'stale' : s.voice;
  return [
    {
      id: 'ecrire',
      label: 'Écrire',
      icon: 'text',
      state: s.segments.every((x) => x.chars > 0) ? 'fresh' : 'missing',
      summary: `${s.segments.length} segments`,
    },
    {
      id: 'voix',
      label: 'Voix',
      icon: 'mic',
      state: voiceState,
      summary: voiced === s.segments.length ? 'toutes prêtes' : `${voiced}/${s.segments.length} prêtes`,
    },
    {
      id: 'musique',
      label: 'Musique',
      icon: 'music',
      state: s.music.state,
      summary: s.music.state === 'fresh' ? 'mixée' : s.music.state === 'stale' ? 'à refaire' : 'à composer',
    },
    {
      id: 'verifier',
      label: 'Vérifier',
      icon: 'image',
      state: s.stills.state,
      summary: s.stills.state === 'fresh' ? 'planche à jour' : 'aperçu, planche',
    },
    {
      id: 'exporter',
      label: 'Exporter',
      icon: 'film',
      state: finalState === 'fresh' ? 'fresh' : draftState === 'fresh' || finalState === 'stale' ? 'stale' : 'missing',
      summary: finalState === 'fresh' ? 'vidéo finale prête' : draftState === 'fresh' ? 'brouillon prêt' : 'MP4',
    },
  ];
}

/** The queued or running job of one of these kinds, if any. */
export function activeJob(jobs: readonly JobInfo[], kinds: readonly ActionKind[]): JobInfo | undefined {
  return (
    jobs.find((j) => j.state === 'running' && kinds.includes(j.kind)) ??
    jobs.find((j) => j.state === 'queued' && kinds.includes(j.kind))
  );
}

const JOB_LABEL: Record<ActionKind, string> = {
  tts: 'Génération des voix',
  timeline: 'Calcul de la timeline',
  music: 'Composition de la musique',
  stills: 'Rendu de la planche contact',
  render: 'Rendu de la vidéo',
  make: 'Chaîne complète',
};

function JobProgress({ job }: { job: JobInfo }): JSX.Element {
  const p = job.progress;
  const ratio = p && p.total > 0 ? p.done / p.total : null;
  return (
    <div class="job-progress">
      <div class="job-progress-head">
        <span class="spinner" />
        <b>{JOB_LABEL[job.kind]}</b>
        <span class="muted">
          {job.state === 'queued'
            ? 'en attente de la tâche en cours'
            : p
              ? `${p.done}/${p.total} ${p.unit ?? ''}${p.eta !== undefined && p.done < p.total ? ` · encore ${seconds(p.eta)}` : ''}`
              : 'en cours…'}
        </span>
        <div class="grow" />
        <Button small variant="ghost" icon="stop" onClick={() => void attempt(() => api.cancel(job.id))}>
          Arrêter
        </Button>
      </div>
      <Progress value={job.state === 'queued' ? 0 : ratio} />
    </div>
  );
}

/** Header of a step screen: what this step is for, and its main action(s). */
export function StepIntro({
  title,
  lead,
  actions,
  job,
  children,
}: {
  title: string;
  lead: ComponentChildren;
  actions?: ComponentChildren;
  job?: JobInfo | undefined;
  children?: ComponentChildren;
}): JSX.Element {
  return (
    <div class="step-intro">
      <div class="step-intro-text">
        <h2>{title}</h2>
        <p>{lead}</p>
        {children}
      </div>
      {!job && actions && <div class="step-actions">{actions}</div>}
      {job && <JobProgress job={job} />}
    </div>
  );
}

export function NextStep({ ctx, to, label }: { ctx: ProjectContext; to: Tab; label: string }): JSX.Element {
  return (
    <div class="next-step">
      <a class="btn btn-ghost" href={`#/${encodeURIComponent(ctx.name)}/${to}`}>
        <span>{label}</span>
        <Icon name="arrow" />
      </a>
    </div>
  );
}

/** Steps to queue so the timeline is up to date before another step. */
export function timelineFirst(ctx: ProjectContext): [ActionKind, { estimate: boolean }][] {
  const s = ctx.detail.status;
  return s.timeline.state === 'fresh' ? [] : [['timeline', { estimate: s.voice !== 'fresh' }]];
}
