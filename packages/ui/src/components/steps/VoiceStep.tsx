/** Step 2, Voix: which voice reads the narration, and one clip per segment. */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { seconds } from '../../format.js';
import type { ProjectContext } from '../ProjectView.js';
import { SectionFields, VoiceSearch } from '../Settings.js';
import { Button, Icon } from '../ui.js';
import { VoicePlayer } from './WriteStep.js';
import { activeJob, NextStep, StepIntro } from './common.js';

export function VoiceStep({ ctx }: { ctx: ProjectContext }): JSX.Element {
  const s = ctx.detail.status;
  const job = activeJob(ctx.jobs, ['tts', 'timeline']);
  const todo = s.segments.filter((x) => x.voice !== 'fresh');
  const [choose, setChoose] = useState(false);
  const textById = new Map(ctx.detail.resolved.segments.map((x) => [x.id, x.text]));

  const actions = s.apiKey ? (
    <>
      <Button
        variant="primary"
        icon="mic"
        disabled={todo.length === 0 && s.timeline.state === 'fresh'}
        onClick={() => void ctx.run(...(todo.length ? [['tts'] as const] : []), ['timeline'])}
      >
        {todo.length
          ? `Générer ${todo.length === s.segments.length ? 'les voix' : `${todo.length} voix`}`
          : 'Voix à jour'}
      </Button>
      {todo.length === 0 && (
        <Button variant="ghost" onClick={() => void ctx.run(['tts', { force: true }], ['timeline'])}>
          Tout régénérer
        </Button>
      )}
    </>
  ) : (
    <Button variant="primary" onClick={() => void ctx.run(['timeline', { estimate: true }])}>
      Continuer sans voix
    </Button>
  );

  return (
    <div class="voice">
      <StepIntro
        title="Les voix"
        lead="Une voix de synthèse lit chaque segment ; la durée des voix fixe le rythme de toute la vidéo. Seuls les segments nouveaux ou modifiés sont regénérés."
        actions={actions}
        job={job}
      >
        {!s.apiKey && (
          <div class="callout">
            <Icon name="key" />
            <div>
              <b>Pas de clé OpenRouter.</b> Pour générer les voix (et utiliser l’assistant), arrêtez l’interface puis
              relancez-la ainsi : <code>OPENROUTER_API_KEY=sk-or-… studio ui</code>. En attendant, « Continuer sans voix
              » estime les durées depuis le texte.
            </div>
          </div>
        )}
      </StepIntro>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Voix utilisée</h3>
            <p class="small muted">
              {ctx.detail.resolved.voice.model}
              {ctx.detail.resolved.voice.voice ? ` · ${ctx.detail.resolved.voice.voice}` : ' · voix aléatoire'}
            </p>
          </div>
          <Button small variant="ghost" onClick={() => setChoose((c) => !c)}>
            {choose ? 'Fermer' : 'Changer de voix'}
          </Button>
        </div>
        {choose && (
          <>
            <SectionFields ctx={ctx} title="Voix" />
            <VoiceSearch
              lang={ctx.detail.resolved.language}
              onPick={(v) =>
                ctx.setDraft((c) => ({
                  ...c,
                  voice: {
                    ...(typeof c.voice === 'object' ? c.voice : {}),
                    voice: v.id,
                    credit: `« ${v.title} », Fish Audio`,
                  },
                }))
              }
            />
          </>
        )}
      </section>

      <ul class="clip-list">
        {s.segments.map((seg, i) => (
          <li key={seg.id} class={`clip clip-${seg.voice}`}>
            <span class="clip-num">{i + 1}</span>
            <div class="clip-text">
              <b>{seg.id}</b>
              <span class="muted">{textById.get(seg.id)}</span>
            </div>
            <span class="clip-state">
              {seg.voice === 'fresh' ? seconds(seg.dur) : seg.voice === 'stale' ? 'texte modifié' : 'à générer'}
            </span>
            {seg.voice !== 'missing' ? <VoicePlayer project={ctx.name} id={seg.id} /> : <span class="clip-play" />}
          </li>
        ))}
      </ul>
      <NextStep ctx={ctx} to="musique" label="Étape suivante : la musique" />
    </div>
  );
}
