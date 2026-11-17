/** Step 4, Vérifier: the live preview, then the contact sheet (one frame per segment). */
import type { JSX } from 'preact';
import type { ProjectContext } from '../ProjectView.js';
import { Preview } from '../Preview.js';
import { Stills } from '../Stills.js';
import { Button } from '../ui.js';
import { activeJob, NextStep, StepIntro, timelineFirst } from './common.js';

export function ReviewStep({ ctx }: { ctx: ProjectContext }): JSX.Element {
  const stills = ctx.detail.status.stills;
  return (
    <div class="review">
      <StepIntro
        title="Vérifier les images"
        lead="L’aperçu joue la vidéo en direct, avec le son. La planche contact montre une image par segment en pleine qualité : le plus rapide pour repérer un texte qui chevauche le sujet ou une image trop claire."
        job={activeJob(ctx.jobs, ['stills'])}
        actions={
          <Button
            variant={stills.state === 'fresh' ? 'default' : 'primary'}
            icon="image"
            onClick={() => void ctx.run(...timelineFirst(ctx), ['stills'])}
          >
            {stills.mtime === null ? 'Faire la planche contact' : 'Refaire la planche'}
          </Button>
        }
      />
      <Preview ctx={ctx} />
      <Stills ctx={ctx} />
      <NextStep ctx={ctx} to="exporter" label="Étape suivante : exporter la vidéo" />
    </div>
  );
}
