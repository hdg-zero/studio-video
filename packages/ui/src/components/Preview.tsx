/**
 * Live preview: the capsule page in an iframe (`?embed`), driven by this component's clock.
 * When a mix exists the audio element is the clock, so picture, subtitles and sound stay in step;
 * the page draws whatever time it is sent, which is free because scenes are pure functions of t.
 */
import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { fileUrl, relativeTo } from '../api.js';
import { askAssistant, errorExcerpt } from '../assistant.js';
import { seconds, timecode } from '../format.js';
import { moodColor } from '../moods.js';
import type { ProjectContext } from './ProjectView.js';
import { Button, Icon } from './ui.js';

export function Preview({ ctx }: { ctx: ProjectContext }): JSX.Element {
  const { detail, name } = ctx;
  const { timeline } = detail;
  const duration = timeline.duration;
  const frame = useRef<HTMLIFrameElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const clock = useRef({ t: ctx.seekRequest ?? 0, origin: 0 });
  const [t, setT] = useState(clock.current.t);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpu, setGpu] = useState<string | null>(null);

  const music = detail.status.music;
  const hasAudio = music.mtime !== null;
  const audioUrl = hasAudio ? fileUrl(name, relativeTo(detail.status.root, music.file), music.mtime) : null;

  const post = useCallback((time: number) => {
    frame.current?.contentWindow?.postMessage({ studio: 'seek', t: time }, location.origin);
  }, []);

  const seek = useCallback(
    (time: number) => {
      const c = Math.min(Math.max(time, 0), duration);
      clock.current = { t: c, origin: performance.now() };
      if (audio.current) audio.current.currentTime = c;
      setT(c);
      post(c);
    },
    [duration, post],
  );

  // messages from the page: ready (first load and after each live reload), errors
  useEffect(() => {
    const on = (e: MessageEvent<unknown>): void => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data as { studio?: string; message?: string; gpu?: string };
      if (d.studio === 'ready') {
        setError(null);
        setGpu(d.gpu ?? null);
        post(clock.current.t);
      } else if (d.studio === 'error') setError(d.message ?? 'erreur');
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [post]);

  // the clock: audio when there is a mix, else wall time
  useEffect(() => {
    if (!playing) return;
    const a = audio.current;
    clock.current.origin = performance.now() - clock.current.t * 1000;
    if (a) {
      a.currentTime = clock.current.t;
      void a.play().catch(() => undefined);
    }
    let raf = 0;
    const tick = (): void => {
      const now = a && !a.paused ? a.currentTime : (performance.now() - clock.current.origin) / 1000;
      if (now >= duration) {
        clock.current.t = duration;
        setPlaying(false);
      } else clock.current.t = now;
      setT(clock.current.t);
      post(clock.current.t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      a?.pause();
    };
  }, [playing, duration, post]);

  useEffect(() => {
    if (ctx.seekRequest !== null) seek(ctx.seekRequest);
  }, [ctx.seekRequest, seek]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft') seek(clock.current.t - (e.shiftKey ? 5 : 1));
      else if (e.key === 'ArrowRight') seek(clock.current.t + (e.shiftKey ? 5 : 1));
      else if (e.key === 'Home') seek(0);
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seek]);

  const fromPointer = (e: PointerEvent): number => {
    const r = bar.current?.getBoundingClientRect();
    return r ? ((e.clientX - r.left) / r.width) * duration : 0;
  };
  const current = timeline.segments.find((s) => t >= s.t0 && t < s.t1) ?? timeline.segments.at(-1);
  const { width, height } = detail.resolved.format;

  return (
    <div class={height > width ? 'preview portrait' : 'preview'}>
      <div class="stage">
        <iframe ref={frame} src={`/preview/${encodeURIComponent(name)}/?embed`} title="Aperçu" />
        {error && (
          <div class="stage-error">
            <Icon name="alert" />
            <pre>{error}</pre>
            <Button
              small
              icon="sparkle"
              variant="accent-soft"
              onClick={() =>
                askAssistant(
                  name,
                  `L'aperçu affiche cette erreur${current ? ` (segment « ${current.id} », t = ${t.toFixed(1)} s)` : ''} :\n${errorExcerpt(error)}\nTrouve la cause et corrige-la.`,
                  'Corriger l’erreur de l’aperçu',
                  current && current.id !== 'credits' ? current.id : undefined,
                )
              }
            >
              Corriger avec l’assistant
            </Button>
          </div>
        )}
      </div>
      <div class="transport">
        <Button
          icon={playing ? 'pause' : 'play'}
          variant="primary"
          onClick={() => setPlaying((p) => !p)}
          title="Lecture (espace)"
        />
        <span class="timecode mono">
          {timecode(t)} <span class="muted">/ {timecode(duration)}</span>
        </span>
        <span class="current-seg">
          <i style={{ background: moodColor(current?.mood ?? '') }} />
          {current?.id}
        </span>
        <div class="grow" />
        {hasAudio ? (
          <>
            {music.state !== 'fresh' && <span class="small warn">son pas à jour</span>}
            <Button
              small
              variant="ghost"
              icon={muted ? 'mute' : 'volume'}
              title={muted ? 'Activer le son' : 'Couper le son'}
              onClick={() => setMuted((m) => !m)}
            />
          </>
        ) : (
          <span class="small muted">pas de son (étape Musique)</span>
        )}
      </div>
      <div
        class="scrubber"
        ref={bar}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(fromPointer(e));
        }}
        onPointerMove={(e) => e.buttons === 1 && seek(fromPointer(e))}
      >
        {timeline.segments.map((s) => (
          <div
            key={s.id}
            class="scrub-seg"
            style={{
              left: `${(100 * s.t0) / duration}%`,
              width: `${(100 * (s.t1 - s.t0)) / duration}%`,
              '--mood': moodColor(s.mood === 'finale' && s.id === 'credits' ? 'credits' : s.mood),
            }}
            title={`${s.id} · ${seconds(s.t0)} → ${seconds(s.t1)}`}
          >
            {s.voice !== null && s.dur > 0 && (
              <span
                class="scrub-voice"
                style={{
                  left: `${(100 * (s.voice - s.t0)) / (s.t1 - s.t0)}%`,
                  width: `${(100 * s.dur) / (s.t1 - s.t0)}%`,
                }}
              />
            )}
            <span class="scrub-label">{s.id}</span>
          </div>
        ))}
        <div class="playhead" style={{ left: `${(100 * t) / duration}%` }} />
      </div>
      <p class="small muted">
        Espace : lecture · ← → : 1 s (Maj : 5 s) · l’aperçu se recharge à chaque sauvegarde d’une scène ou de la
        capsule.
        {detail.estimated.length > 0 && ' Durées estimées pour les segments sans voix à jour.'}
        {gpu && ` · WebGL : ${gpu}`}
      </p>
      {audioUrl && <audio ref={audio} src={audioUrl} preload="auto" muted={muted} />}
    </div>
  );
}
