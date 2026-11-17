/** The guided path through a project: five steps with their state; the current one is open. */
import type { JSX } from 'preact';
import type { Tab } from '../router.js';
import type { ProjectContext } from './ProjectView.js';
import { stepInfos } from './steps/common.js';
import { Icon } from './ui.js';

export function Stepper({ ctx, tab }: { ctx: ProjectContext; tab: Tab }): JSX.Element {
  const steps = stepInfos(ctx.detail);
  const running = ctx.jobs.find((j) => j.state === 'running');
  const runningStep: Record<string, Tab> = {
    tts: 'voix',
    timeline: 'voix',
    music: 'musique',
    stills: 'verifier',
    render: 'exporter',
    make: 'exporter',
  };
  return (
    <nav class="stepper" aria-label="Étapes">
      {steps.map((s, i) => {
        const busy = running && runningStep[running.kind] === s.id;
        return (
          <a
            key={s.id}
            href={`#/${encodeURIComponent(ctx.name)}/${s.id}`}
            class={`stepper-item state-${s.state}${tab === s.id ? ' current' : ''}${busy ? ' busy' : ''}`}
            aria-current={tab === s.id ? 'step' : undefined}
          >
            <span class="stepper-mark">
              {busy ? <span class="spinner" /> : s.state === 'fresh' ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span class="stepper-text">
              <b>{s.label}</b>
              <small>{busy ? 'en cours…' : s.summary}</small>
            </span>
          </a>
        );
      })}
    </nav>
  );
}
