/** Shell: project list on the left, the selected project in the middle, jobs at the bottom. */
import type { JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { DoctorReport, ProjectSummary } from '../../../cli/src/ui/protocol.js';
import { api } from '../api.js';
import { ago } from '../format.js';
import { navigate, useRoute } from '../router.js';
import { selectConnected, selectVersions, useLive } from '../store.js';
import { attempt, notify, Toasts } from '../toast.js';
import { Jobs } from './Jobs.js';
import { ProjectView } from './ProjectView.js';
import { Button, Empty, Field, Icon } from './ui.js';

export function App(): JSX.Element {
  const route = useRoute();
  const versions = useLive(selectVersions);
  const connected = useLive(selectConnected);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);

  const total = Object.values(versions).reduce((a, b) => a + b, 0);
  useEffect(() => {
    void attempt(api.projects).then((p) => p && setProjects(p));
  }, [total]);
  useEffect(() => {
    void attempt(() => api.doctor()).then((d) => d && setDoctor(d));
  }, []);

  return (
    <div class="app">
      <aside class="sidebar">
        <a class="brand" href="#/">
          <span class="brand-mark">
            <Icon name="play" size={14} />
          </span>
          Studio vidéo
        </a>
        <nav class="projects">
          <div class="nav-title">Projets</div>
          {projects?.map((p) => (
            <a
              key={p.name}
              href={`#/${encodeURIComponent(p.name)}/${route.project === p.name ? route.tab : 'ecrire'}`}
              class={`project-link${route.project === p.name ? ' active' : ''}`}
              title={p.error ?? p.root}
            >
              <span class="project-title">{p.title}</span>
              <span class="project-meta">
                {p.error ? <span class="warn">capsule invalide</span> : `${p.segments} segments · ${ago(p.mtime)}`}
              </span>
            </a>
          ))}
        </nav>
        <NewProject
          onCreated={(name) => {
            navigate({ project: name, tab: 'ecrire' });
          }}
        />
        <footer class="sidebar-foot">
          <span class={`dot ${connected ? 'dot-ok' : 'dot-off'}`} />
          {connected ? 'connecté' : 'serveur injoignable'}
          {doctor?.gpu && (
            <span class="gpu" title={doctor.gpu.renderer}>
              <Icon name="cpu" size={12} /> {doctor.gpu.hardware ? 'GPU' : 'CPU (lent)'}
            </span>
          )}
        </footer>
      </aside>
      <main class="main">
        {route.project ? (
          <ProjectView key={route.project} name={route.project} tab={route.tab} />
        ) : (
          <Home projects={projects} doctor={doctor} onRefreshDoctor={setDoctor} />
        )}
      </main>
      <Jobs />
      <Toasts />
    </div>
  );
}

function NewProject({ onCreated }: { onCreated: (name: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [vertical, setVertical] = useState(false);
  const name = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const submit = useCallback(
    async (e: Event) => {
      e.preventDefault();
      if (!name) return;
      const created = await attempt(() => api.createProject(name, title.trim(), vertical));
      if (!created) return;
      notify(`projet « ${title.trim()} » créé`);
      setOpen(false);
      setTitle('');
      setVertical(false);
      onCreated(created.name);
    },
    [name, title, vertical, onCreated],
  );
  if (!open)
    return (
      <Button icon="plus" variant="ghost" class="new-project" onClick={() => setOpen(true)}>
        Nouveau projet
      </Button>
    );
  return (
    <form class="new-project-form" onSubmit={(e) => void submit(e)}>
      <Field label="Titre" hint={name ? `dossier : projects/${name}` : 'ex. « La tour de Babel »'}>
        <input
          autoFocus
          value={title}
          onInput={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        />
      </Field>
      <Field label="Format" hint={vertical ? '1080×1920, pour Shorts, Reels, TikTok' : '1920×1080, capsule classique'}>
        <select
          value={vertical ? 'vertical' : 'horizontal'}
          onChange={(e) => setVertical(e.currentTarget.value === 'vertical')}
        >
          <option value="horizontal">Horizontal (16:9)</option>
          <option value="vertical">Vertical court (9:16)</option>
        </select>
      </Field>
      <div class="row">
        <Button type="submit" variant="primary" small disabled={!name}>
          Créer
        </Button>
        <Button small variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function Home({
  projects,
  doctor,
  onRefreshDoctor,
}: {
  projects: ProjectSummary[] | null;
  doctor: DoctorReport | null;
  onRefreshDoctor: (d: DoctorReport) => void;
}): JSX.Element {
  const [checking, setChecking] = useState(false);
  return (
    <div class="home">
      <header class="page-head">
        <h1>Capsules</h1>
        <p class="muted">Écrire la narration, générer voix et musique, vérifier le cadrage, rendre la vidéo.</p>
      </header>
      {projects && projects.length === 0 && (
        <Empty icon="folder" title="Aucun projet">
          <p>Créez-en un avec « Nouveau projet » dans la colonne de gauche.</p>
        </Empty>
      )}
      <div class="cards">
        {projects?.map((p) => (
          <a key={p.name} class="card project-card" href={`#/${encodeURIComponent(p.name)}/ecrire`}>
            <h3>{p.title}</h3>
            <p class="muted">
              {p.error ? <span class="warn">{p.error.split('\n')[0]}</span> : `${p.segments} segments`}
            </p>
            <p class="small muted">modifié {ago(p.mtime)}</p>
          </a>
        ))}
      </div>
      <section class="panel doctor">
        <div class="panel-head">
          <h2>Machine</h2>
          <Button
            small
            icon="refresh"
            variant="ghost"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              void attempt(() => api.doctor(true))
                .then((d) => d && onRefreshDoctor(d))
                .finally(() => setChecking(false));
            }}
          >
            {checking ? 'Diagnostic…' : 'Refaire le diagnostic'}
          </Button>
        </div>
        {doctor ? (
          <ul class="checks">
            <li class="muted small">{doctor.cpuThreads} threads CPU</li>
            {doctor.checks.map((c) => (
              <li key={c.label} class={c.ok ? 'ok' : c.blocking ? 'bad' : 'warn'}>
                <Icon name={c.ok ? 'check' : c.blocking ? 'close' : 'alert'} size={14} />
                <b>{c.label}</b>
                <span class="muted small">{c.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">Diagnostic en cours (Chromium, GPU, ffmpeg, Python)…</p>
        )}
        {doctor?.gpu && !doctor.gpu.hardware && (
          <p class="note">
            Rendu sur CPU : environ 1 image/s par worker. Voir docs/performance.md pour activer le GPU sous Arch Linux.
          </p>
        )}
      </section>
    </div>
  );
}
