/** Step 5, Exporter: a quick 720p draft, then the final 1080p video. */
import type { JSX } from 'preact';
import type { ProjectContext } from '../ProjectView.js';
import { Renders } from '../Renders.js';
import { Button } from '../ui.js';
import { activeJob, StepIntro, timelineFirst } from './common.js';

export function ExportStep({ ctx }: { ctx: ProjectContext }): JSX.Element {
  const s = ctx.detail.status;
  const hasDraft = s.renders.some((r) => r.name === s.outputs.draft && !r.stale);
  return (
    <div class="export">
      <StepIntro
        title="Exporter la vidéo"
        lead="Commencez par un brouillon 720p pour juger du rythme, puis lancez la vidéo finale 1080p. Seuls les morceaux modifiés depuis le dernier rendu sont recalculés, et un rendu arrêté reprend où il en était."
        job={activeJob(ctx.jobs, ['render', 'make'])}
        actions={
          <>
            <Button
              variant={hasDraft ? 'default' : 'primary'}
              icon="film"
              onClick={() => void ctx.run(...timelineFirst(ctx), ['render', { draft: true }])}
            >
              Brouillon 720p
            </Button>
            <Button
              variant={hasDraft ? 'primary' : 'default'}
              icon="film"
              onClick={() => void ctx.run(...timelineFirst(ctx), ['render'])}
            >
              Vidéo finale 1080p
            </Button>
          </>
        }
      >
        {s.music.state !== 'fresh' && (
          <p class="small warn">La musique n’est pas à jour : la vidéo sortira avec l’ancien son ou sans son.</p>
        )}
      </StepIntro>
      <Renders ctx={ctx} />
    </div>
  );
}
