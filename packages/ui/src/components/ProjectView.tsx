/**
 * One project: a header with the guided steps (Écrire → Voix → Musique → Vérifier → Exporter),
 * the current step's screen, and the assistant drawer. Holds the capsule draft, saved
 * automatically a moment after each edit (Ctrl+S saves at once).
 */
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ActionKind, ActionOptions, ApiError, JobInfo, ProjectDetail } from '../../../cli/src/ui/protocol.js';
import { api, RequestError } from '../api.js';
import { send } from '../assistant.js';
import { seconds } from '../format.js';
import { navigate, type Tab } from '../router.js';
import { selectJobs, selectVersions, useLive } from '../store.js';
import { attempt, notify } from '../toast.js';
import { assistantModel, assistantWeb } from '../assistantPrefs.js';
import { Assistant } from './Assistant.js';
import { Settings } from './Settings.js';
import { Stepper } from './Stepper.js';
import { ExportStep } from './steps/ExportStep.js';
import { MusicStep } from './steps/MusicStep.js';
import { ReviewStep } from './steps/ReviewStep.js';
import { VoiceStep } from './steps/VoiceStep.js';
import { WriteStep } from './steps/WriteStep.js';
import { Button, Empty, Icon } from './ui.js';

export type Capsule = Record<string, unknown>;
export type Issues = NonNullable<ApiError['issues']>;
export type SaveState = 'saved' | 'pending' | 'saving' | 'invalid' | 'error';
export type Step = readonly [ActionKind, ActionOptions?];

export interface ProjectContext {
  readonly name: string;
  readonly detail: ProjectDetail;
  readonly draft: Capsule;
  readonly setDraft: (update: (c: Capsule) => Capsule) => void;
  readonly issues: Issues;
  readonly saveState: SaveState;
  /** Saves pending edits now; false when the capsule is invalid or the save failed. */
  readonly save: () => Promise<boolean>;
  /** Saves pending edits, then queues the steps in order (the queue runs one job at a time). */
  readonly run: (...steps: Step[]) => Promise<void>;
  readonly jobs: readonly JobInfo[];
  /** Opens the check step's player at a given time. */
  readonly seek: (t: number) => void;
  readonly seekRequest: number | null;
  /** Sends a request to the assistant (and opens it). */
  readonly ask: (prompt: string, opts?: { display?: string; segment?: string }) => void;
}

const AUTOSAVE_MS = 800;

export function ProjectView({ name, tab }: { name: string; tab: Tab }): JSX.Element {
  const version = useLive(selectVersions)[name] ?? 0;
  const allJobs = useLive(selectJobs);
  const jobs = useMemo(() => allJobs.filter((j) => j.project === name), [allJobs, name]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Capsule>({});
  const [issues, setIssues] = useState<Issues>([]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState(false);
  const [seekRequest, setSeekRequest] = useState<number | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(() => {
    try {
      return localStorage.getItem('studio.assistant') === 'open';
    } catch {
      return false;
    }
  });
  // what is on disk, as last loaded or saved (the empty draft counts as saved until the first load)
  const saved = useRef('{}');
  const main = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const timer = useRef<number | undefined>(undefined);
  const dirty = (): boolean => detail !== null && JSON.stringify(draftRef.current) !== saved.current;

  const adopt = useCallback((d: ProjectDetail, replaceDraft: boolean) => {
    setDetail(d);
    const text = JSON.stringify(d.capsule);
    if (replaceDraft) {
      saved.current = text;
      setDraftState(structuredClone(d.capsule));
      setConflict(false);
    } else if (text !== saved.current) setConflict(true);
  }, []);

  // (re)load on open and whenever the project's files change on disk
  useEffect(() => {
    let live = true;
    api
      .project(name)
      .then((d) => {
        if (!live) return;
        setError(null);
        // with edits pending, keep them; a different capsule on disk is then a conflict
        adopt(d, JSON.stringify(draftRef.current) === saved.current);
      })
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [name, version, adopt]);

  const save = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    const sent = draftRef.current;
    const text = JSON.stringify(sent);
    if (text === saved.current) return true;
    setSaveState('saving');
    try {
      const d = await api.saveCapsule(name, sent);
      saved.current = text;
      setDetail(d);
      setIssues([]);
      // edits typed while saving stay pending
      setSaveState(JSON.stringify(draftRef.current) === text ? 'saved' : 'pending');
      return true;
    } catch (err) {
      if (err instanceof RequestError && err.body.issues) {
        setIssues(err.body.issues);
        setSaveState('invalid');
      } else {
        setSaveState('error');
        notify(err instanceof Error ? err.message : String(err), 'error');
      }
      return false;
    }
  }, [name]);

  const setDraft = useCallback(
    (update: (c: Capsule) => Capsule) => {
      setDraftState((c) => update(c));
      setSaveState('pending');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
    },
    [save],
  );

  const run = useCallback(
    async (...steps: Step[]) => {
      if (!(await save())) {
        notify('La capsule contient des erreurs (en rouge) : corrigez-les avant de lancer une étape.', 'error');
        return;
      }
      for (const [kind, options] of steps) {
        if (!(await attempt(() => api.run(name, kind, options ?? {})))) return;
      }
    },
    [name, save],
  );

  const toggleAssistant = useCallback((open: boolean) => {
    setAssistantOpen(open);
    try {
      localStorage.setItem('studio.assistant', open ? 'open' : 'closed');
    } catch {
      // remembered for this page only
    }
  }, []);

  const ask = useCallback(
    (prompt: string, opts: { display?: string; segment?: string } = {}) => {
      toggleAssistant(true);
      void save().then(() =>
        send(name, prompt, {
          model: assistantModel(),
          web: assistantWeb(),
          focus: { step: tab, ...(opts.segment ? { segment: opts.segment } : {}) },
          ...(opts.display ? { display: opts.display } : {}),
        }),
      );
    },
    [name, tab, save, toggleAssistant],
  );

  // requests from outside the project view (error messages, job dock)
  useEffect(() => {
    const on = (e: Event): void => {
      const d = (e as CustomEvent<{ project: string; prompt: string; display: string; segment?: string }>).detail;
      if (d.project === name) ask(d.prompt, { display: d.display, ...(d.segment ? { segment: d.segment } : {}) });
    };
    window.addEventListener('studio:ask', on);
    return () => window.removeEventListener('studio:ask', on);
  }, [name, ask]);

  // each step opens at its top
  useEffect(() => {
    main.current?.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    };
    const onLeave = (e: BeforeUnloadEvent): void => {
      if (dirty()) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onLeave);
    };
  });

  if (error && !detail)
    return (
      <Empty icon="alert" title="Projet illisible">
        <pre class="error-text">{error}</pre>
      </Empty>
    );
  if (!detail) return <div class="loading">Chargement…</div>;

  const ctx: ProjectContext = {
    name,
    detail,
    draft,
    setDraft,
    issues,
    saveState,
    save,
    run,
    jobs,
    seekRequest,
    seek: (t) => {
      setSeekRequest(t);
      navigate({ tab: 'verifier' });
    },
    ask,
  };
  const title = typeof draft.title === 'string' && draft.title ? draft.title : detail.status.title;

  return (
    <div class={`project${assistantOpen ? ' with-assistant' : ''}`}>
      <div class="project-main" ref={main}>
        <header class="project-head">
          <div class="project-heading">
            <div>
              <h1>{title}</h1>
              <span class="muted small">
                {detail.status.segments.length} segments · {seconds(detail.timeline.duration)}
                {detail.estimated.length > 0 && ' (durée estimée)'}
              </span>
            </div>
            <div class="grow" />
            <SaveIndicator state={saveState} onRetry={() => void save()} />
            <a
              class={`btn btn-ghost${tab === 'reglages' ? ' active' : ''}`}
              href={`#/${encodeURIComponent(name)}/reglages`}
            >
              <Icon name="settings" /> <span>Réglages</span>
            </a>
            <Button
              icon="sparkle"
              variant={assistantOpen ? 'default' : 'accent-soft'}
              onClick={() => toggleAssistant(!assistantOpen)}
            >
              Assistant
            </Button>
          </div>
          {conflict && (
            <div class="banner">
              <Icon name="alert" />
              <span>capsule.json a été modifié ailleurs pendant que vous écriviez.</span>
              <Button
                small
                onClick={() =>
                  void attempt(() => api.project(name)).then((d) => d && (adopt(d, true), setSaveState('saved')))
                }
              >
                Prendre la version du disque
              </Button>
              <Button small variant="ghost" onClick={() => setConflict(false)}>
                Garder la mienne
              </Button>
            </div>
          )}
          <Stepper ctx={ctx} tab={tab} />
        </header>
        <section class="step-body">
          {tab === 'ecrire' && <WriteStep ctx={ctx} />}
          {tab === 'voix' && <VoiceStep ctx={ctx} />}
          {tab === 'musique' && <MusicStep ctx={ctx} />}
          {tab === 'verifier' && <ReviewStep ctx={ctx} />}
          {tab === 'exporter' && <ExportStep ctx={ctx} />}
          {tab === 'reglages' && <Settings ctx={ctx} />}
        </section>
      </div>
      {assistantOpen && <Assistant ctx={ctx} step={tab} onClose={() => toggleAssistant(false)} />}
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }): JSX.Element {
  const label: Record<SaveState, string> = {
    saved: 'Enregistré',
    pending: 'Modifié…',
    saving: 'Enregistrement…',
    invalid: 'Erreurs à corriger',
    error: 'Non enregistré',
  };
  return (
    <span class={`save-state save-${state}`} title="Enregistrement automatique (Ctrl+S pour forcer)">
      <Icon name={state === 'saved' ? 'check' : state === 'invalid' || state === 'error' ? 'alert' : 'dot'} size={14} />
      {label[state]}
      {state === 'error' && (
        <Button small variant="ghost" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </span>
  );
}
