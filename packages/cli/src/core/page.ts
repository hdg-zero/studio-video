/** The HTML page that hosts a capsule (generated, served from memory). */
import type { BootConfig, Timeline, Visual } from '@studio/runtime';
import { layoutOf, subtitleStyle, type Capsule } from './config.js';

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** JSON that is safe to inline inside a <script> element. */
const inlineJson = (v: unknown): string =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/** `msaa` overrides the capsule's value (the renderer turns it off on a software GPU). */
function bootConfig(
  capsule: Capsule,
  timeline: Timeline,
  msaa = capsule.look.msaa,
  visuals: Readonly<Record<string, Visual>> = {},
): BootConfig {
  return {
    timeline,
    visuals,
    meta: { title: capsule.title, kicker: capsule.kicker, credits: capsule.credits, closingLine: capsule.closingLine },
    layout: layoutOf(capsule.format),
    subtitles: subtitleStyle(capsule),
    look: {
      background: Number.parseInt(capsule.look.background.slice(1), 16),
      accent: Number.parseInt(capsule.look.accent.slice(1), 16),
      fogDensity: capsule.look.fogDensity,
      bloom: capsule.look.bloom,
      exposure: capsule.look.exposure,
      msaa,
    },
  };
}

export interface PageOptions {
  readonly liveReload?: boolean;
  readonly msaa?: number;
  /** Ready-made shots, resolved (`media.ts`). */
  readonly visuals?: Readonly<Record<string, Visual>>;
}

export function renderPage(
  capsule: Capsule,
  timeline: Timeline,
  { liveReload = false, msaa, visuals }: PageOptions = {},
): string {
  const boot = bootConfig(capsule, timeline, msaa, visuals);
  const reload = liveReload ? `<script>new EventSource('__reload').onmessage = () => location.reload();</script>` : '';
  return `<!doctype html>
<html lang="${escapeHtml(capsule.language)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(capsule.title)}</title>
<link rel="stylesheet" href="bundle.css">
<style>:root{--w:${boot.layout.width}px;--h:${boot.layout.height}px;--accent:${capsule.look.accent}}</style>
</head>
<body>
<div id="stage"><div id="visual"></div><div id="vig"></div><div id="ui"></div><div id="fade"></div></div>
<script>window.__STUDIO_BOOT__ = ${inlineJson(boot)};</script>
<script type="module" src="bundle.js"></script>
${reload}
</body>
</html>
`;
}
