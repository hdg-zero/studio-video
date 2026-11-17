/**
 * Ready-made shots: images that move, video clips, titles, quotes, key figures, lists, charts
 * and dates, described in `capsule.json` instead of being coded as a 3D scene.
 *
 * They are DOM layers between the 3D canvas and the texts (crisp at any resolution), animated as
 * pure functions of the segment's local time like the scenes. Texts appear with the voice: a list
 * reveals its items over the time the voice speaks, a figure counts up when the voice starts.
 */
import { clamp, lerp, smooth } from './math.js';
import type { FrameInfo, Motion, Timeline, Visual } from './types.js';

interface Shot {
  readonly el: HTMLElement;
  /** Poses the shot for a frame; returns a promise when a picture must be decoded first. */
  update(f: FrameInfo): Promise<void> | undefined;
  /** Waits for the pictures needed by the first frame. */
  ready?(): Promise<void>;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

const div = (cls: string, html = ''): HTMLDivElement => {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return el;
};

/** Writes a style only when it changes (fewer style invalidations per captured frame). */
const setter = (el: HTMLElement) => {
  const last: Record<string, string> = {};
  return (prop: 'opacity' | 'transform' | 'width' | 'height' | 'strokeDashoffset', value: string): void => {
    if (last[prop] === value) return;
    last[prop] = value;
    el.style[prop] = value;
  };
};

/** Reveal of an element at local time `at`: fade and slight rise. */
const reveal = (el: HTMLElement) => {
  const set = setter(el);
  return (u: number, at: number, dur = 0.5): void => {
    const k = smooth(at, at + dur, u);
    set('opacity', k.toFixed(3));
    set('transform', `translateY(${((1 - k) * 14).toFixed(1)}px)`);
  };
};

/** Start of the voice and how long it speaks (the whole segment when silent). */
const speech = (f: FrameInfo): { from: number; span: number } =>
  f.seg.voice === null || f.seg.dur <= 0
    ? { from: 0.4, span: Math.max(f.len - 1.2, 0.5) }
    : { from: f.voiceAt, span: f.seg.dur };

const MOTIONS: Record<Motion, (p: number) => { s: number; x: number; y: number }> = {
  'zoom-in': (p) => ({ s: lerp(1.02, 1.16, p), x: 0, y: 0 }),
  'zoom-out': (p) => ({ s: lerp(1.16, 1.02, p), x: 0, y: 0 }),
  'pan-left': (p) => ({ s: 1.14, x: lerp(4, -4, p), y: 0 }),
  'pan-right': (p) => ({ s: 1.14, x: lerp(-4, 4, p), y: 0 }),
  'pan-up': (p) => ({ s: 1.14, x: 0, y: lerp(4, -4, p) }),
  'pan-down': (p) => ({ s: 1.14, x: 0, y: lerp(-4, 4, p) }),
  still: () => ({ s: 1, x: 0, y: 0 }),
};

/** Shared frame of image and video shots: picture, blurred fill, darkening, caption, credit. */
function mediaFrame(
  v: Extract<Visual, { type: 'image' | 'video' }>,
  first: string,
): { el: HTMLElement; img: HTMLImageElement; blur: HTMLImageElement | null } {
  const el = div(`v v-media v-${v.fit}`);
  let blur: HTMLImageElement | null = null;
  if (v.fit === 'contain') {
    blur = document.createElement('img');
    blur.className = 'v-blur';
    blur.src = first;
    el.appendChild(blur);
  }
  const img = document.createElement('img');
  img.className = 'v-img';
  img.src = first;
  el.appendChild(img);
  const dim = div('v-dim');
  dim.style.opacity = String(v.dim);
  el.appendChild(dim);
  if (v.caption) el.appendChild(div('v-caption', escapeHtml(v.caption)));
  if (v.credit) el.appendChild(div('v-credit', escapeHtml(v.credit)));
  return { el, img, blur };
}

function imageShot(v: Extract<Visual, { type: 'image' }>): Shot {
  const { el, img, blur } = mediaFrame(v, v.src);
  img.style.transformOrigin = `${(v.focus[0] * 100).toFixed(1)}% ${(v.focus[1] * 100).toFixed(1)}%`;
  const set = setter(img);
  const caption = el.querySelector<HTMLElement>('.v-caption');
  const showCaption = caption ? reveal(caption) : null;
  return {
    el,
    ready: () =>
      Promise.all([img.decode(), blur?.decode()]).then(
        () => undefined,
        () => {
          throw new Error(`image introuvable ou illisible : ${v.src}`);
        },
      ),
    update(f) {
      // the movement spans the segment, and continues under the credits
      const p = clamp(f.u / Math.max(f.len + 6, 1));
      const m = MOTIONS[v.motion](smooth(0, 1, p) * 0.35 + p * 0.65);
      set('transform', `translate(${m.x.toFixed(2)}%, ${m.y.toFixed(2)}%) scale(${m.s.toFixed(4)})`);
      showCaption?.(f.u, 1.2, 0.8);
      return undefined;
    },
  };
}

function videoShot(v: Extract<Visual, { type: 'video' }>): Shot {
  const url = (n: number): string => `${v.frames}/${String(n + 1).padStart(6, '0')}.jpg`;
  const { el, img, blur } = mediaFrame(v, url(0));
  const caption = el.querySelector<HTMLElement>('.v-caption');
  const showCaption = caption ? reveal(caption) : null;
  let shown = -1;
  // a few decoded frames kept around: previews seek back and forth
  const cache = new Map<number, Promise<HTMLImageElement>>();
  const load = (n: number): Promise<HTMLImageElement> => {
    let p = cache.get(n);
    if (!p) {
      const im = new Image();
      im.src = url(n);
      p = im.decode().then(() => im);
      cache.set(n, p);
      if (cache.size > 24) cache.delete(cache.keys().next().value as number);
    }
    return p;
  };
  return {
    el,
    ready: () => load(0).then(() => undefined),
    update(f) {
      showCaption?.(f.u, 1.2, 0.8);
      const raw = Math.floor(Math.max(f.u, 0) * v.fps + 1e-6);
      const n = v.loop ? raw % v.count : Math.min(raw, v.count - 1);
      if (n === shown) return undefined;
      shown = n;
      return load(n).then(
        (im) => {
          // a later frame may have been asked meanwhile (previews)
          if (shown !== n) return;
          img.src = im.src;
          if (blur) blur.src = im.src;
        },
        () => {
          throw new Error(`image ${n + 1} du clip introuvable (${v.frames})`);
        },
      );
    },
  };
}

/** Words revealed one after the other from `at`, over `span` seconds. */
function words(container: HTMLElement, text: string) {
  container.innerHTML = text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `<span class="w">${escapeHtml(w)}</span>`)
    .join(' ');
  const spans = [...container.querySelectorAll<HTMLElement>('.w')].map(reveal);
  return (u: number, at: number, span: number): void => {
    spans.forEach((show, i) => show(u, at + (span * i) / Math.max(spans.length, 1), 0.45));
  };
}

function titleShot(v: Extract<Visual, { type: 'title' }>): Shot {
  const el = div('v v-title');
  const text = div('vt-text');
  el.appendChild(text);
  const showWords = words(text, v.text);
  const sub = v.sub ? div('vt-sub', escapeHtml(v.sub)) : null;
  if (sub) el.appendChild(sub);
  const showSub = sub ? reveal(sub) : null;
  const rule = div('vt-rule');
  el.appendChild(rule);
  const setRule = setter(rule);
  return {
    el,
    update(f) {
      showWords(f.u, 0.35, 0.8);
      setRule('transform', `scaleX(${smooth(0.6, 1.6, f.u).toFixed(3)})`);
      showSub?.(f.u, 1.3, 0.6);
      return undefined;
    },
  };
}

function quoteShot(v: Extract<Visual, { type: 'quote' }>): Shot {
  const el = div('v v-quote');
  el.appendChild(div('vq-mark', '«'));
  const text = div('vq-text');
  el.appendChild(text);
  const showWords = words(text, v.text);
  const author = v.author ? div('vq-author', escapeHtml(v.author)) : null;
  if (author) el.appendChild(author);
  const showAuthor = author ? reveal(author) : null;
  return {
    el,
    update(f) {
      const { from, span } = speech(f);
      // the words follow the voice when it reads the quote, else appear within two seconds
      const over = Math.min(span * 0.8, Math.max(1.6, v.text.length / 18));
      showWords(f.u, Math.min(from, 0.6), over);
      showAuthor?.(f.u, Math.min(from, 0.6) + over + 0.2, 0.6);
      return undefined;
    },
  };
}

function statShot(v: Extract<Visual, { type: 'stat' }>): Shot {
  const el = div('v v-stat');
  const num = div('vs-num');
  el.appendChild(num);
  if (v.label) el.appendChild(div('vs-label', escapeHtml(v.label)));
  const label = el.querySelector<HTMLElement>('.vs-label');
  const showLabel = label ? reveal(label) : null;
  const fmt = new Intl.NumberFormat(document.documentElement.lang || 'fr', {
    minimumFractionDigits: v.decimals,
    maximumFractionDigits: v.decimals,
  });
  // long figures get a smaller size so they always fit the width
  const digits = (v.prefix + fmt.format(v.value)).length + v.suffix.length * 0.55;
  num.style.fontSize = `${Math.min(150, Math.round(1700 / Math.max(digits, 1)))}px`;
  let last = '';
  const showNum = reveal(num);
  return {
    el,
    update(f) {
      const { from } = speech(f);
      const k = smooth(from, from + 2.2, f.u);
      // ease out: fast at first, settles on the exact value
      const value = v.value * (1 - (1 - k) ** 3);
      const html = `${escapeHtml(v.prefix)}${fmt.format(value)}<span class="vs-suffix">${escapeHtml(v.suffix)}</span>`;
      if (html !== last) num.innerHTML = last = html;
      showNum(f.u, from - 0.3, 0.4);
      showLabel?.(f.u, from + 0.6, 0.6);
      return undefined;
    },
  };
}

function listShot(v: Extract<Visual, { type: 'list' }>): Shot {
  const el = div(`v v-list${v.numbered ? ' numbered' : ''}`);
  const items = v.items.map((t, i) => {
    const item = div('vl-item', `<span class="vl-mark">${v.numbered ? i + 1 : ''}</span>${escapeHtml(t)}`);
    el.appendChild(item);
    return reveal(item);
  });
  return {
    el,
    update(f) {
      const { from, span } = speech(f);
      items.forEach((show, i) => show(f.u, from + (span * 0.85 * i) / Math.max(items.length, 1), 0.5));
      return undefined;
    },
  };
}

const formatValue = (n: number): string =>
  new Intl.NumberFormat(document.documentElement.lang || 'fr', { maximumFractionDigits: 2 }).format(n);

function chartShot(v: Extract<Visual, { type: 'chart' }>): Shot {
  const el = div(`v v-chart v-chart-${v.kind}`);
  if (v.title) el.appendChild(div('vc-title', escapeHtml(v.title)));
  const max = Math.max(...v.data.map((d) => d.value), 0) || 1;
  const min = Math.min(...v.data.map((d) => d.value), 0);
  const plot = div('vc-plot');
  el.appendChild(plot);
  const unit = v.unit ? ` ${escapeHtml(v.unit)}` : '';
  if (v.kind === 'bar') {
    const bars = v.data.map((d) => {
      const col = div(
        'vc-col',
        `<div class="vc-value">${formatValue(d.value)}${unit}</div><div class="vc-bar"></div><div class="vc-label">${escapeHtml(d.label)}</div>`,
      );
      plot.appendChild(col);
      const bar = col.querySelector<HTMLElement>('.vc-bar') as HTMLElement;
      return {
        set: setter(bar),
        value: reveal(col.querySelector<HTMLElement>('.vc-value') as HTMLElement),
        h: Math.max(d.value - min, 0) / (max - min || 1),
      };
    });
    return {
      el,
      update(f) {
        const { from, span } = speech(f);
        bars.forEach((b, i) => {
          const at = from + (Math.min(span, 4) * 0.7 * i) / Math.max(bars.length, 1);
          b.set('height', `${(b.h * 100 * smooth(at, at + 0.9, f.u)).toFixed(2)}%`);
          b.value(f.u, at + 0.6, 0.4);
        });
        return undefined;
      },
    };
  }
  // line: drawn from left to right, values shown as the line reaches them
  const W = 1000;
  const H = 400;
  const n = v.data.length;
  const pts = v.data.map((d, i) => ({
    x: n === 1 ? W / 2 : (W * i) / (n - 1),
    y: H - ((d.value - min) / (max - min || 1)) * H * 0.9 - H * 0.05,
  }));
  const path = pts.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  plot.innerHTML = `<svg viewBox="-20 -20 ${W + 40} ${H + 40}" preserveAspectRatio="none"><path class="vc-line" d="${path}" pathLength="1"/></svg>`;
  const line = plot.querySelector<SVGPathElement>('.vc-line') as unknown as HTMLElement;
  const setLine = setter(line);
  const marks = v.data.map((d, i) => {
    const { x, y } = pts[i] ?? { x: 0, y: 0 };
    const m = div(
      'vc-point',
      `<i></i><span class="vc-value">${formatValue(d.value)}${unit}</span><span class="vc-label">${escapeHtml(d.label)}</span>`,
    );
    m.style.left = `${((x + 20) / (W + 40)) * 100}%`;
    m.style.top = `${((y + 20) / (H + 40)) * 100}%`;
    plot.appendChild(m);
    return { show: reveal(m), at: n === 1 ? 0 : i / (n - 1) };
  });
  return {
    el,
    update(f) {
      const { from, span } = speech(f);
      const draw = Math.min(span * 0.8, 5);
      setLine('strokeDashoffset', (1 - clamp((f.u - from) / draw)).toFixed(4));
      for (const m of marks) m.show(f.u, from + m.at * draw - 0.1, 0.4);
      return undefined;
    },
  };
}

/** Layout facts a shot may need beyond its description. */
interface ShotContext {
  /** Vertical video: the dates run down the frame instead of across it. */
  readonly portrait: boolean;
}

function datesShot(v: Extract<Visual, { type: 'dates' }>, { portrait }: ShotContext): Shot {
  const el = div('v v-dates');
  const axis = div('vd-axis');
  el.appendChild(axis);
  const setAxis = setter(axis);
  const events = v.events.map((e, i) => {
    const item = div(
      `vd-event ${i % 2 ? 'below' : 'above'}`,
      `<i></i><div class="vd-date">${escapeHtml(e.date)}</div><div class="vd-text">${escapeHtml(e.text)}</div>`,
    );
    if (portrait) item.style.top = `${v.events.length === 1 ? 50 : 22 + (52 * i) / (v.events.length - 1)}%`;
    else item.style.left = `${v.events.length === 1 ? 50 : 14 + (72 * i) / (v.events.length - 1)}%`;
    el.appendChild(item);
    return reveal(item);
  });
  return {
    el,
    update(f) {
      const { from, span } = speech(f);
      setAxis('transform', `${portrait ? 'scaleY' : 'scaleX'}(${smooth(0.2, 1.4, f.u).toFixed(3)})`);
      events.forEach((show, i) => show(f.u, from + (span * 0.85 * i) / Math.max(events.length, 1), 0.5));
      return undefined;
    },
  };
}

const BUILDERS: { [K in Visual['type']]: (v: Extract<Visual, { type: K }>, ctx: ShotContext) => Shot } = {
  image: imageShot,
  video: videoShot,
  title: titleShot,
  quote: quoteShot,
  stat: statShot,
  list: listShot,
  chart: chartShot,
  dates: datesShot,
};

/** Shots that carry the segment's headline themselves: the engine's headline is not shown. */
export const OWN_HEADLINE: ReadonlySet<Visual['type']> = new Set(['title', 'quote']);

/** Shots that cover the whole frame: no 3D backdrop needed behind them. */
export const OPAQUE = (v: Visual): boolean => (v.type === 'image' || v.type === 'video') && v.fit === 'cover';

export class Visuals {
  private readonly shots = new Map<string, Shot>();
  private visible: Shot | undefined;

  constructor(root: HTMLElement, visuals: Readonly<Record<string, Visual>>, timeline: Timeline) {
    const ctx: ShotContext = { portrait: root.closest('.portrait') !== null };
    for (const s of timeline.segments) {
      const v = visuals[s.id];
      if (!v) continue;
      const shot = (BUILDERS[v.type] as (v: Visual, ctx: ShotContext) => Shot)(v, ctx);
      shot.el.style.display = 'none';
      root.appendChild(shot.el);
      this.shots.set(s.id, shot);
    }
  }

  has(id: string): boolean {
    return this.shots.has(id);
  }

  /** Waits for the pictures of every shot's first frame (a render never shows a half-loaded image). */
  async ready(): Promise<void> {
    await Promise.all([...this.shots.values()].flatMap((s) => (s.ready ? [s.ready()] : [])));
  }

  /** Shows the shot of `f.seg` (if any) posed for this frame. */
  update(f: FrameInfo): Promise<void> | undefined {
    const shot = this.shots.get(f.seg.id);
    if (shot !== this.visible) {
      if (this.visible) this.visible.el.style.display = 'none';
      if (shot) shot.el.style.display = '';
      this.visible = shot;
    }
    return shot?.update(f);
  }
}
