/**
 * The assistant drawer (OpenRouter): a conversation that knows the project, with suggestions
 * for the current step. Its proposals (narration edits, scene files) are applied in one click.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AiStatus, ModelInfo, SearchProvider } from '../../../cli/src/ui/protocol.js';
import { clearConversation, send, stop, useConversation } from '../assistant.js';
import { assistantModel, assistantWeb, MODEL_KEY, SEARCH, WEB_KEY } from '../assistantPrefs.js';
import type { Tab } from '../router.js';
import { MessageView } from './AssistantMessage.js';
import type { ProjectContext } from './ProjectView.js';
import { Button, Icon } from './ui.js';

const SUGGESTIONS: Record<Tab, readonly { label: string; prompt: string }[]> = {
  ecrire: [
    { label: 'Relire la narration', prompt: 'Relis toute la narration et propose les améliorations les plus utiles.' },
    {
      label: 'Trouver une meilleure accroche',
      prompt: 'Propose trois accroches plus fortes pour le premier segment, puis applique la meilleure.',
    },
    {
      label: 'Ajouter un segment',
      prompt: 'Quelle idée manque à ce récit ? Propose un segment à insérer au bon endroit.',
    },
  ],
  voix: [
    {
      label: 'Préparer le texte pour la voix',
      prompt:
        'Repère dans tous les segments ce qui se lira mal par une voix de synthèse (nombres, sigles, parenthèses, phrases trop longues) et propose les corrections.',
    },
  ],
  musique: [
    {
      label: 'Choisir les ambiances',
      prompt: 'Propose une ambiance (mood) pour chaque segment qui suive la progression dramatique du récit.',
    },
    {
      label: 'Régler la tonalité',
      prompt: 'Propose une tonalité (music.root, music.major) adaptée au sujet et explique ton choix en une phrase.',
    },
  ],
  verifier: [
    {
      label: 'Écrire les scènes manquantes',
      prompt: 'Écris la scène 3D des segments qui n’ont pas encore de fichier de scène.',
    },
    {
      label: 'Idées de mise en scène',
      prompt: 'Pour chaque segment, propose en une ligne une idée de mise en scène 3D simple et forte.',
    },
  ],
  exporter: [
    {
      label: 'Titre et description',
      prompt: 'Propose un titre et une description courte pour publier cette vidéo en ligne.',
    },
  ],
  reglages: [
    {
      label: 'Titre, surtitre, phrase finale',
      prompt: 'Propose un titre, un surtitre et une phrase finale pour cette capsule.',
    },
    {
      label: 'Générique',
      prompt: 'Rédige le générique (credits) : sources, voix utilisée, images Three.js, musique générée.',
    },
  ],
};

export function Assistant({
  ctx,
  step,
  onClose,
}: {
  ctx: ProjectContext;
  step: Tab;
  onClose: () => void;
}): JSX.Element {
  const { messages, streaming } = useConversation(ctx.name);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState(assistantModel() ?? '');
  const [web, setWeb] = useState(assistantWeb());
  const pickWeb = (v: SearchProvider | undefined): void => {
    setWeb(v);
    try {
      if (v) localStorage.setItem(WEB_KEY, v);
      else localStorage.removeItem(WEB_KEY);
    } catch {
      // kept for this page only
    }
  };
  const [input, setInput] = useState('');
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch('/api/ai/status')
      .then((r) => r.json() as Promise<AiStatus>)
      .then(setStatus)
      .catch(() => setStatus({ available: false, defaultModel: null }));
  }, []);
  useEffect(() => {
    if (status?.available)
      void fetch('/api/ai/models')
        .then((r) => (r.ok ? (r.json() as Promise<ModelInfo[]>) : []))
        .then(setModels)
        .catch(() => undefined);
  }, [status?.available]);
  useEffect(() => {
    const el = list.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const pickModel = (id: string): void => {
    setModel(id);
    try {
      if (id) localStorage.setItem(MODEL_KEY, id);
      else localStorage.removeItem(MODEL_KEY);
    } catch {
      // kept for this page only
    }
  };
  const submit = (text: string, display?: string): void => {
    if (!text.trim() || streaming) return;
    void send(ctx.name, text.trim(), {
      model: model || undefined,
      ...(web ? { web } : {}),
      focus: { step },
      ...(display ? { display } : {}),
    });
    setInput('');
  };
  const last = messages.at(-1);
  const usage = last?.role === 'assistant' ? last.usage : null;

  return (
    <aside class="assistant" aria-label="Assistant">
      <header class="assistant-head">
        <Icon name="sparkle" />
        <b>Assistant</b>
        <div class="grow" />
        {messages.length > 0 && (
          <Button
            small
            variant="ghost"
            icon="trash"
            title="Nouvelle conversation"
            onClick={() => clearConversation(ctx.name)}
          />
        )}
        <Button small variant="ghost" icon="close" title="Fermer" onClick={onClose} />
      </header>

      {status && !status.available ? (
        <div class="assistant-empty">
          <Icon name="key" size={26} />
          <h3>Clé OpenRouter manquante</h3>
          <p>
            L’assistant utilise OpenRouter, comme la voix. Arrêtez l’interface (Ctrl+C) puis relancez-la depuis un
            terminal avec votre clé :
          </p>
          <pre>OPENROUTER_API_KEY=sk-or-… studio ui</pre>
          <p class="small muted">
            La clé reste dans l’environnement : elle n’est jamais écrite dans un fichier ni envoyée au navigateur.
          </p>
        </div>
      ) : (
        <>
          <div class="assistant-model">
            <label>
              <span>Modèle</span>
              <input
                list="ai-models"
                value={model}
                placeholder={status?.defaultModel ?? 'par défaut'}
                onChange={(e) => pickModel(e.currentTarget.value.trim())}
              />
            </label>
            <label
              class="assistant-web"
              title={
                web
                  ? `Le modèle reçoit des résultats du web avant de répondre et cite ses sources. ${SEARCH[web].hint}`
                  : 'Recherche web avant de répondre (dates, chiffres, citations à vérifier).'
              }
            >
              <Icon name="search" size={14} />
              <select
                value={web ?? ''}
                aria-label="Recherche web"
                onChange={(e) => pickWeb((e.currentTarget.value || undefined) as SearchProvider | undefined)}
              >
                <option value="">Web : non</option>
                {(Object.keys(SEARCH) as SearchProvider[]).map((p) => {
                  const ready = status?.search?.includes(p) ?? p === 'openrouter';
                  return (
                    <option key={p} value={p} disabled={!ready}>
                      {SEARCH[p].label}
                      {ready ? '' : ' (clé absente)'}
                    </option>
                  );
                })}
              </select>
            </label>
            <datalist id="ai-models">
              {models.slice(0, 400).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.prompt === 0 && m.completion === 0
                    ? ' · gratuit'
                    : ` · ${m.prompt.toFixed(2)} / ${m.completion.toFixed(2)} $ par M jetons`}
                </option>
              ))}
            </datalist>
          </div>

          <div class="assistant-messages" ref={list}>
            {messages.length === 0 && (
              <div class="assistant-hello">
                <p>
                  Je connais la narration, les durées et le code des scènes de ce projet. Demandez-moi d’écrire, de
                  relire ou de programmer une scène : je propose, vous appliquez.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <MessageView
                key={i}
                message={m}
                index={i}
                ctx={ctx}
                step={step}
                live={streaming && i === messages.length - 1}
              />
            ))}
          </div>

          <div class="assistant-suggestions">
            {SUGGESTIONS[step].map((s) => (
              <button
                key={s.label}
                type="button"
                class="suggestion"
                disabled={streaming}
                onClick={() => submit(s.prompt, s.label)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <form
            class="assistant-input"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <textarea
              rows={Math.min(8, Math.max(2, input.split('\n').length))}
              placeholder="Demandez quelque chose… (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)"
              value={input}
              onInput={(e) => setInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
            />
            {streaming ? (
              <Button icon="stop" variant="danger" title="Arrêter la réponse" onClick={() => stop(ctx.name)} />
            ) : (
              <Button type="submit" icon="send" variant="primary" title="Envoyer" disabled={!input.trim()} />
            )}
          </form>
          {usage && (
            <p class="assistant-usage">
              {usage.promptTokens + usage.completionTokens} jetons
              {usage.cachedTokens ? ` (dont ${usage.cachedTokens} en cache)` : ''}
              {usage.cost !== undefined ? ` · ${usage.cost.toFixed(4)} $` : ''}
            </p>
          )}
        </>
      )}
    </aside>
  );
}
