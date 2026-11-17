/** One message of the assistant's conversation: text, compact blocks, checks and the validation card. */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { isBlock, parseAnswer, type BlockPart } from '../../../cli/src/ai/blocks.js';
import { resume, type Message } from '../assistant.js';
import { assistantModel } from '../assistantPrefs.js';
import { Markdown } from '../markdown.js';
import type { Tab } from '../router.js';
import { PlanCard } from './PlanCard.js';
import type { ProjectContext } from './ProjectView.js';
import { Button, Icon } from './ui.js';

export function MessageView({
  message,
  index,
  ctx,
  step,
  live,
}: {
  message: Message;
  index: number;
  ctx: ProjectContext;
  step: Tab;
  live: boolean;
}): JSX.Element {
  if (message.role === 'user')
    return (
      <div class="msg msg-user">
        <p>{message.display ?? message.content}</p>
      </div>
    );
  // each correction round starts after a blank line appended to the content (see assistant.ts)
  const parts = parseAnswer(message.content);
  const checking = live && !message.plan && !message.invalid && parts.some((p) => isBlock(p) && p.complete);
  return (
    <div class="msg msg-assistant">
      {parts.map((p, k) => {
        if (p.kind === 'text') return <Markdown key={k} text={p.text} />;
        if (p.kind === 'code')
          return (
            <pre key={k} class="code">
              {p.code}
            </pre>
          );
        return <BlockChip key={k} part={p} />;
      })}
      {message.repairs?.map((errors, k) => (
        <details key={`r${k}`} class="msg-repair">
          <summary>
            <Icon name="refresh" size={13} /> Correction automatique {k + 1} : {errors.length} erreur
            {errors.length > 1 ? 's' : ''} renvoyée{errors.length > 1 ? 's' : ''} au modèle
          </summary>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      ))}
      {live && message.notices?.at(-1) && <p class="msg-notice">{message.notices.at(-1)}</p>}
      {live && message.content === '' && (
        <span class="typing">
          <i />
          <i />
          <i />
        </span>
      )}
      {checking && (
        <div class="proposal proposal-pending">
          <span class="spinner" /> Vérification (capsule, compilation et typage des scènes)…
        </div>
      )}
      {message.plan && <PlanCard plan={message.plan} message={message} index={index} ctx={ctx} />}
      {message.invalid && (
        <div class="proposal proposal-error">
          <div class="proposal-head">
            <Icon name="alert" size={14} />
            <b>Proposition refusée par les vérifications</b>
          </div>
          <ul>
            {message.invalid.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <Button
            small
            icon="refresh"
            onClick={() =>
              ctx.ask(
                `Ta proposition échoue encore aux vérifications :\n${message.invalid?.map((e) => `- ${e}`).join('\n') ?? ''}\nReprends-la autrement.`,
                {
                  display: 'Réessayer autrement',
                },
              )
            }
          >
            Réessayer autrement
          </Button>
        </div>
      )}
      {message.error && (
        <p class="msg-error">
          <Icon name="alert" size={14} /> {message.error}
        </p>
      )}
      {message.partial && !live && message.content.trim() && (
        <div class="msg-interrupted">
          <span>Réponse interrompue : ce qui a été reçu est gardé.</span>
          <Button
            small
            icon="refresh"
            variant="accent-soft"
            onClick={() => void resume(ctx.name, { model: assistantModel(), focus: { step } })}
          >
            Reprendre
          </Button>
        </div>
      )}
      {message.model && !live && <span class="msg-model">{message.model}</span>}
    </div>
  );
}

/** A block of the answer, shown compactly: the validation card gathers what will be applied. */
function BlockChip({ part }: { part: BlockPart }): JSX.Element {
  const [open, setOpen] = useState(false);
  const label =
    part.kind === 'edits'
      ? 'modifications de la capsule'
      : part.kind === 'scene'
        ? `scenes/${part.id}.ts`
        : `retouche de scenes/${part.id}.ts`;
  const body = part.kind === 'scene' ? part.code : part.body;
  return (
    <div class="block-chip">
      <button type="button" class="link" onClick={() => setOpen((o) => !o)}>
        {part.complete ? <Icon name={part.kind === 'edits' ? 'text' : 'image'} size={13} /> : <span class="spinner" />}
        {label}
        {!part.complete && ' (en cours d’écriture…)'}
      </button>
      {open && <pre class="code">{body}</pre>}
    </div>
  );
}
