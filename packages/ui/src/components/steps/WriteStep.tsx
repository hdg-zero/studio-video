/**
 * Step 1, Écrire: the narration as a list of segments. The text said by the voice comes first;
 * headline, chapter tag, mood and identifier are secondary. The assistant can write or rework it.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { fileUrl } from '../../api.js';
import { seconds } from '../../format.js';
import { MOOD_LABELS, moodColor } from '../../moods.js';
import type { Capsule, Issues, ProjectContext } from '../ProjectView.js';
import { Button, Icon, Menu } from '../ui.js';
import { VisualEditor } from '../VisualEditor.js';
import { NextStep, StepIntro } from './common.js';

type SegmentDraft = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const segmentsOf = (c: Capsule): SegmentDraft[] => (Array.isArray(c.segments) ? (c.segments as SegmentDraft[]) : []);
const issueFor = (issues: Issues, i: number, field: string): string | undefined =>
  issues.find((x) => x.path === `segments.${i}.${field}`)?.message;

function uniqueId(existing: readonly SegmentDraft[]): string {
  const ids = new Set(existing.map((s) => str(s.id)));
  let n = existing.length + 1;
  while (ids.has(`segment-${n}`)) n++;
  return `segment-${n}`;
}

const AI_ACTIONS: readonly { label: string; prompt: (id: string) => string }[] = [
  {
    label: 'Réécrire plus clairement',
    prompt: (id) =>
      `Réécris le texte du segment « ${id} » pour qu'il soit plus clair et plus vivant à l'oral, sans changer le sens ni la longueur.`,
  },
  {
    label: 'Raccourcir',
    prompt: (id) => `Raccourcis le texte du segment « ${id} » d'environ un tiers en gardant l'essentiel.`,
  },
  {
    label: 'Préparer pour la voix',
    prompt: (id) =>
      `Dans le segment « ${id} », écris en toutes lettres les nombres, dates et sigles, et reformule ce qui se lit mal à voix haute.`,
  },
  {
    label: 'Proposer titre et chapitre',
    prompt: (id) => `Propose un titre à l'écran (key) et un repère de chapitre (label) pour le segment « ${id} ».`,
  },
  {
    label: 'Choisir un plan sans code',
    prompt: (id) =>
      `Propose pour le segment « ${id} » le plan tout prêt (visual) qui l'illustre le mieux : titre, citation, chiffre, liste, graphique, frise, ou image / vidéo si un fichier de media/ convient. Pas de scène 3D.`,
  },
  {
    label: 'Écrire la scène 3D',
    prompt: (id) =>
      `Écris la scène 3D du segment « ${id} » : le fichier scenes/${id}.ts complet. L'image illustre le texte, le sujet reste à droite quand un titre est affiché en haut à gauche, et la caméra bouge.`,
  },
];

export function WriteStep({ ctx }: { ctx: ProjectContext }): JSX.Element {
  const { detail, draft, setDraft, issues } = ctx;
  const segments = segmentsOf(draft);
  const speed = detail.resolved.timing.readingSpeed;
  const statusById = new Map(detail.status.segments.map((s) => [s.id, s]));
  const savedText = new Map(detail.resolved.segments.map((s) => [s.id, s.text]));
  const placed = new Map(detail.timeline.segments.map((s) => [s.id, s]));
  const [subject, setSubject] = useState('');

  const update = (fn: (list: SegmentDraft[]) => SegmentDraft[]): void =>
    setDraft((c) => ({ ...c, segments: fn(segmentsOf(c).map((s) => ({ ...s }))) }));
  const setField = (i: number, field: string, value: string): void =>
    update((list) => list.map((s, k) => (k === i ? { ...s, [field]: value } : s)));
  const move = (i: number, by: number): void =>
    update((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j] as SegmentDraft, copy[i] as SegmentDraft];
      return copy;
    });
  const insert = (at: number): void => {
    update((list) => [...list.slice(0, at), { id: uniqueId(list), mood: 'calm', text: '' }, ...list.slice(at)]);
    window.setTimeout(() => document.getElementById(`seg-${at}`)?.querySelector('textarea')?.focus(), 30);
  };
  const remove = (i: number): void => {
    const s = segments[i];
    if (s && str(s.text).trim() && !window.confirm(`Supprimer le segment « ${str(s.id)} » ?`)) return;
    update((list) => list.filter((_, k) => k !== i));
  };

  const durations = segments.map((s) => {
    const id = str(s.id);
    const st = statusById.get(id);
    return st?.voice === 'fresh' && savedText.get(id) === str(s.text) ? st.dur : str(s.text).length / speed;
  });
  const voiceTotal = durations.reduce((a, b) => a + b, 0);
  const globalIssues = issues.filter((x) => !/^segments\.\d+\./.test(x.path));

  return (
    <div class="write">
      <StepIntro
        title="Écrire la narration"
        lead={
          <>
            Un segment par idée : le <b>texte</b> est exactement ce que dira la voix, le <b>titre</b> s'affiche à
            l'écran, l'
            <b>ambiance</b> guide la musique. Tout s'enregistre automatiquement.
          </>
        }
      >
        <form
          class="ai-subject"
          onSubmit={(e) => {
            e.preventDefault();
            if (!subject.trim()) return;
            ctx.ask(
              `Écris la narration complète d'une capsule sur ce sujet : ${subject.trim()}\nUtilise une seule opération replace avec tous les segments, puis des set pour le titre (title), le surtitre (kicker) et la phrase finale (closingLine). Pas de scène pour l'instant.`,
              { display: `Écrire la narration : ${subject.trim()}` },
            );
            setSubject('');
          }}
        >
          <Icon name="sparkle" />
          <input
            placeholder="Sujet de la capsule, ex. « la tour de Babel » : l'assistant écrit une première version"
            value={subject}
            onInput={(e) => setSubject(e.currentTarget.value)}
          />
          <Button type="submit" variant="accent-soft" disabled={!subject.trim()}>
            Écrire
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              ctx.ask(
                'Relis toute la narration : clarté à l’oral, rythme, enchaînements, longueur des segments, cohérence entre l’accroche et la fin. Donne tes remarques principales puis propose les modifications.',
                { display: 'Relire toute la narration' },
              )
            }
          >
            Relire tout
          </Button>
        </form>
      </StepIntro>

      <div class="timeline-bar" aria-label="Durée de chaque segment">
        {segments.map((s, i) => (
          <button
            key={i}
            type="button"
            style={{ flexGrow: (durations[i] ?? 0) + 2, '--mood': moodColor(str(s.mood) || 'calm') }}
            title={`${str(s.id)} · ${seconds(durations[i] ?? 0)}`}
            onClick={() => document.getElementById(`seg-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            <span>{str(s.id)}</span>
          </button>
        ))}
      </div>
      <p class="small muted">
        Voix ≈ {seconds(voiceTotal)} · vidéo ≈ {seconds(detail.timeline.duration)} avec les respirations et le générique
      </p>

      {globalIssues.map((x) => (
        <div key={x.path} class="banner banner-error">
          <Icon name="alert" /> {x.path || 'capsule'} : {x.message}
        </div>
      ))}

      <div class="segments">
        {segments.map((s, i) => {
          const id = str(s.id);
          const st = statusById.get(id);
          const changed = savedText.has(id) && savedText.get(id) !== str(s.text);
          const at = placed.get(id);
          const mood = str(s.mood) || 'calm';
          const voice = !st
            ? 'nouveau'
            : changed || st.voice === 'stale'
              ? 'à refaire'
              : st.voice === 'fresh'
                ? 'prête'
                : 'à générer';
          return (
            <div key={i}>
              <article id={`seg-${i}`} class="segment" style={{ '--mood': moodColor(mood) }}>
                <header class="segment-head">
                  <span class="segment-num">{i + 1}</span>
                  <input
                    class={`segment-id mono${issueFor(issues, i, 'id') ? ' invalid' : ''}`}
                    value={id}
                    aria-label="Identifiant (nom du fichier de scène)"
                    title={
                      issueFor(issues, i, 'id') ?? 'Identifiant : nomme aussi le fichier de la scène, scenes/<id>.ts'
                    }
                    onInput={(e) => setField(i, 'id', e.currentTarget.value)}
                  />
                  <label class="mood-select" title="Ambiance : guide la musique">
                    <i />
                    <select value={mood} onChange={(e) => setField(i, 'mood', e.currentTarget.value)}>
                      {detail.moods.map((m) => (
                        <option key={m} value={m}>
                          {MOOD_LABELS[m] ?? m}
                        </option>
                      ))}
                    </select>
                  </label>
                  {st && !st.scene && !s.visual && (
                    <span class="tag tag-warn" title={`Pas de fichier scenes/${id}.ts : image par défaut`}>
                      sans scène
                    </span>
                  )}
                  <div class="grow" />
                  <Menu
                    label="Assistant"
                    icon="sparkle"
                    variant="accent-soft"
                    items={AI_ACTIONS.map((a) => ({
                      label: a.label,
                      onSelect: () => ctx.ask(a.prompt(id), { display: `${a.label} · ${id}`, segment: id }),
                    }))}
                  />
                  <Menu
                    title="Plus d’actions"
                    items={[
                      { label: 'Monter', icon: 'up', disabled: i === 0, onSelect: () => move(i, -1) },
                      {
                        label: 'Descendre',
                        icon: 'down',
                        disabled: i === segments.length - 1,
                        onSelect: () => move(i, 1),
                      },
                      { label: 'Insérer un segment après', icon: 'plus', onSelect: () => insert(i + 1) },
                      ...(at
                        ? [{ label: 'Voir dans l’aperçu', icon: 'play' as const, onSelect: () => ctx.seek(at.t0) }]
                        : []),
                      { label: 'Supprimer', icon: 'trash', danger: true, onSelect: () => remove(i) },
                    ]}
                  />
                </header>
                <textarea
                  class={`segment-text${issueFor(issues, i, 'text') ? ' invalid' : ''}`}
                  rows={Math.max(2, Math.ceil(str(s.text).length / 90))}
                  placeholder="Ce que dit la voix. Phrases courtes, nombres en toutes lettres."
                  value={str(s.text)}
                  onInput={(e) => setField(i, 'text', e.currentTarget.value)}
                />
                {issueFor(issues, i, 'text') && <p class="field-msg">{issueFor(issues, i, 'text')}</p>}
                <div class="segment-meta">
                  <label>
                    <span>Titre à l’écran</span>
                    <input
                      value={str(s.key)}
                      placeholder="facultatif · <small> pour une 2e ligne"
                      onInput={(e) => setField(i, 'key', e.currentTarget.value)}
                    />
                  </label>
                  <label>
                    <span>Chapitre</span>
                    <input
                      value={str(s.label)}
                      placeholder="facultatif · ex. 1786 · Russie"
                      onInput={(e) => setField(i, 'label', e.currentTarget.value)}
                    />
                  </label>
                </div>
                <VisualEditor ctx={ctx} index={i} segment={s} issues={issues} />
                <footer class="segment-foot">
                  <span
                    class={`voice-state voice-${voice === 'prête' ? 'ok' : voice === 'à refaire' ? 'stale' : 'none'}`}
                  >
                    <Icon name="mic" size={13} /> voix {voice}
                  </span>
                  <span class="muted">
                    {str(s.text).length} caractères · {seconds(durations[i] ?? 0)}
                  </span>
                  {issueFor(issues, i, 'id') && (
                    <span class="field-msg">identifiant : {issueFor(issues, i, 'id')}</span>
                  )}
                  <div class="grow" />
                  {st && st.voice !== 'missing' && !changed && <VoicePlayer project={ctx.name} id={id} />}
                </footer>
              </article>
              <button type="button" class="insert-here" onClick={() => insert(i + 1)} title="Insérer un segment ici">
                <Icon name="plus" size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <NextStep ctx={ctx} to="voix" label="Étape suivante : les voix" />
    </div>
  );
}

export function VoicePlayer({ project, id }: { project: string; id: string }): JSX.Element {
  const [audio] = useState(() => new Audio());
  const [playing, setPlaying] = useState(false);
  audio.onended = () => setPlaying(false);
  audio.onpause = () => setPlaying(false);
  return (
    <Button
      small
      variant="ghost"
      icon={playing ? 'pause' : 'volume'}
      onClick={() => {
        if (playing) {
          audio.pause();
          return;
        }
        audio.src = fileUrl(project, `voice/${id}.wav`, Date.now());
        void audio.play().then(() => setPlaying(true));
      }}
    >
      Écouter
    </Button>
  );
}
