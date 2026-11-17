/**
 * DOM overlays drawn above the WebGL canvas: title card, chapter labels, headlines,
 * subtitles, closing line, credits and the black "dip" between segments.
 *
 * DOM text is crisper than in-scene text and benefits from CSS typography.
 * Opacity writes are skipped when the value did not change: fewer style
 * invalidations means cheaper compositing for every captured frame.
 */
import { smooth } from './math.js';
import { splitSubtitles, splitWordCues } from './subtitles.js';
import type { CapsuleMeta, Segment, SubtitleStyle, Timeline } from './types.js';

class Fader {
  private last = -1;

  constructor(readonly el: HTMLElement) {}

  set(opacity: number): void {
    const v = Math.round(opacity * 1000) / 1000;
    if (v === this.last) return;
    this.last = v;
    this.el.style.opacity = String(v);
    this.el.style.visibility = v > 0 ? 'visible' : 'hidden';
  }

  /** Fades in over `[a, a + f]` and out over `[b - f, b]`. */
  window(t: number, a: number, b: number, f = 0.4): void {
    this.set(Math.min(smooth(a, a + f, t), 1 - smooth(b - f, b, t)));
  }
}

/** A word of a word-by-word cue: highlighted from `start` until the next word starts. */
interface SpokenWord {
  readonly el: HTMLElement;
  readonly start: number;
  readonly end: number;
  on: boolean;
}

interface Timed {
  readonly fader: Fader;
  readonly start: number;
  readonly end: number;
  readonly fade: number;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export class Overlays {
  private readonly timed: Timed[] = [];
  private readonly words: SpokenWord[] = [];
  private readonly dip: Fader;
  private readonly first: Segment;
  private readonly credits: Segment | undefined;

  constructor(
    root: HTMLElement,
    fadeEl: HTMLElement,
    timeline: Timeline,
    meta: CapsuleMeta,
    /** Segments whose ready-made shot shows the headline itself. */
    ownHeadline: ReadonlySet<string> = new Set(),
    subtitles: SubtitleStyle = 'line',
  ) {
    const segments = timeline.segments;
    const first = segments[0];
    if (!first) throw new Error('timeline has no segment');
    this.first = first;
    this.credits = segments.find((s) => s.id === 'credits');
    this.dip = new Fader(fadeEl);

    const add = (cls: string, html: string, start: number, end: number, fade = 0.4): HTMLElement => {
      const el = document.createElement('div');
      el.className = `o ${cls}`;
      el.innerHTML = html;
      root.appendChild(el);
      const fader = new Fader(el);
      fader.set(0);
      this.timed.push({ fader, start, end, fade });
      return el;
    };

    add(
      'title',
      `<div class="k">${escapeHtml(meta.kicker)}</div><div class="t">${escapeHtml(meta.title)}</div>`,
      0.8,
      first.t1 - 0.4,
      0.7,
    );
    for (const s of segments) {
      if (s.label) add('label', s.label, s.t0 + 0.5, s.t1 - 0.2);
      if (s.key && !ownHeadline.has(s.id)) add('key', s.key, s.t0 + 0.7, s.t1 - 0.2, 0.5);
      if (s.voice !== null && s.text && subtitles === 'words') {
        for (const cue of splitWordCues(s.text, s.voice, s.dur)) {
          const html = cue.words.map((w) => `<span>${escapeHtml(w.text)}</span>`).join(' ');
          // back to back without overlap: two big cues must never show at once
          const el = add('sub words', html, cue.start, cue.end, 0.04);
          const spans = el.querySelectorAll('span');
          cue.words.forEach((w, i) => {
            const span = spans[i];
            if (span) this.words.push({ el: span, start: w.start, end: cue.words[i + 1]?.start ?? cue.end, on: false });
          });
        }
      } else if (s.voice !== null && s.text) {
        for (const cue of splitSubtitles(s.text, s.voice, s.dur)) {
          add('sub', `<span>${escapeHtml(cue.text)}</span>`, cue.start - 0.12, cue.end + 0.05, 0.12);
        }
      }
    }
    const lastSpoken = [...segments].reverse().find((s) => s.voice !== null);
    if (meta.closingLine && lastSpoken?.voice != null) {
      const end = (this.credits?.t0 ?? timeline.duration) + 0.4;
      add('big', escapeHtml(meta.closingLine), lastSpoken.voice + lastSpoken.dur - 0.2, end, 0.7);
    }
    if (this.credits) add('credits', meta.credits, this.credits.t0 + 0.6, this.credits.t1 - 0.3, 0.6);
  }

  update(t: number, seg: Segment): void {
    const u = t - seg.t0;
    const len = seg.t1 - seg.t0;
    // short black dip between segments, long fade-in for the first one, dim + fade-out under the credits
    let dip = Math.max(1 - smooth(0, 0.45, u), smooth(len - 0.35, len, u));
    if (seg === this.first) dip = Math.max(1 - smooth(0, 1.6, u), smooth(len - 0.35, len, u));
    if (seg === this.credits) dip = Math.max(0.65 * smooth(0, 0.8, u), smooth(len - 1.5, len - 0.1, u));
    this.dip.set(dip);
    for (const o of this.timed) o.fader.window(t, o.start, o.end, o.fade);
    for (const w of this.words) {
      const on = t >= w.start && t < w.end;
      if (on !== w.on) w.el.classList.toggle('on', (w.on = on));
    }
  }
}
