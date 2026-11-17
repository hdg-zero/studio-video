/** Step 3, Musique: the soundtrack follows the moods; the voice is mixed over it. */
import type { JSX } from 'preact';
import { fileUrl, relativeTo } from '../../api.js';
import { seconds } from '../../format.js';
import { MOOD_LABELS, moodColor } from '../../moods.js';
import type { ProjectContext } from '../ProjectView.js';
import { SectionFields } from '../Settings.js';
import { Button } from '../ui.js';
import { activeJob, NextStep, StepIntro, timelineFirst } from './common.js';

export function MusicStep({ ctx }: { ctx: ProjectContext }): JSX.Element {
  const { status, timeline, estimated } = ctx.detail;
  const music = status.music;
  const job = activeJob(ctx.jobs, ['music', 'timeline']);
  const noVoice = estimated.length === status.segments.length;
  const segments = timeline.segments;

  return (
    <div class="music">
      <StepIntro
        title="La musique"
        lead="Composée automatiquement à partir de l’ambiance de chaque segment, puis mixée sous la voix (la musique s’efface quand la voix parle) et normalisée pour le web."
        job={job}
        actions={
          <Button
            variant={music.state === 'fresh' ? 'default' : 'primary'}
            icon="music"
            onClick={() => void ctx.run(...timelineFirst(ctx), ['music', { noVoice }])}
          >
            {music.mtime === null
              ? 'Composer la musique'
              : music.state === 'fresh'
                ? 'Recomposer'
                : 'Mettre à jour la musique'}
          </Button>
        }
      >
        {noVoice && <p class="small warn">Pas encore de voix : la musique sera mixée seule.</p>}
      </StepIntro>

      <section class="panel">
        <h3>Ambiances</h3>
        <div class="mood-track">
          {segments.map((s) => (
            <div
              key={s.id}
              style={{ flexGrow: s.t1 - s.t0, '--mood': moodColor(s.id === 'credits' ? 'credits' : s.mood) }}
              title={`${s.id} · ${seconds(s.t1 - s.t0)}`}
            >
              <b>{s.id === 'credits' ? 'générique' : (MOOD_LABELS[s.mood] ?? s.mood)}</b>
              <span>{s.id}</span>
            </div>
          ))}
        </div>
        <p class="small muted">Les ambiances se changent à l’étape Écrire, segment par segment.</p>
      </section>

      {music.mtime !== null && (
        <section class="panel">
          <div class="panel-head">
            <h3>Écouter le mixage</h3>
            {music.state !== 'fresh' && <span class="small warn">pas à jour</span>}
          </div>
          <audio
            class="audio"
            controls
            preload="none"
            src={fileUrl(ctx.name, relativeTo(status.root, music.file), music.mtime)}
          />
        </section>
      )}

      <section class="panel">
        <h3>Réglages</h3>
        <SectionFields ctx={ctx} title="Musique" />
      </section>
      <NextStep ctx={ctx} to="verifier" label="Étape suivante : vérifier les images" />
    </div>
  );
}
