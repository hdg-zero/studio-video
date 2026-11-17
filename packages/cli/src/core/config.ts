/**
 * `capsule.json` schema: the single source of truth for one video.
 * Validated with zod so a typo fails fast with a readable message instead of a broken render.
 */
import { z } from 'zod';

// validation messages in French, like the rest of the studio's messages
z.config(z.locales.fr());

export const MOODS = [
  'intro',
  'calm',
  'pulse',
  'build',
  'explosion',
  'suspense',
  'bright',
  'dark',
  'minimal',
  'finale',
] as const;
export type Mood = (typeof MOODS)[number];

/** Segment id reserved for the silent credits segment appended by the timeline. */
export const CREDITS_ID = 'credits';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'couleur attendue, ex. #01030a');

/** A file in the project's `media/` folder (no path outside it). */
const mediaFile = z
  .string()
  .min(1, 'nom de fichier attendu')
  .regex(/^(?!\.)(?!.*\.\.)[^\\:]+$/, 'nom de fichier du dossier media/, ex. tour.jpg');

const mediaCommon = {
  fit: z.enum(['cover', 'contain']).default('cover'),
  dim: z.number().min(0).max(1).default(0.35),
  caption: z.string().default(''),
  credit: z.string().default(''),
};

export const MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'still'] as const;

/**
 * A ready-made shot instead of (or over) a coded scene: no code to write.
 * Image and video files live in the project's `media/` folder.
 */
export const VisualSpec = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('image'),
    src: mediaFile,
    motion: z.enum(MOTIONS).default('zoom-in'),
    focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0.5, 0.5]),
    ...mediaCommon,
  }),
  z.object({
    type: z.literal('video'),
    src: mediaFile,
    /** Seconds skipped at the start of the clip. */
    start: z.number().min(0).default(0),
    loop: z.boolean().default(true),
    ...mediaCommon,
  }),
  z.object({ type: z.literal('title'), text: z.string().min(1), sub: z.string().default('') }),
  z.object({ type: z.literal('quote'), text: z.string().min(1), author: z.string().default('') }),
  z.object({
    type: z.literal('stat'),
    value: z.number(),
    decimals: z.number().int().min(0).max(4).default(0),
    prefix: z.string().default(''),
    suffix: z.string().default(''),
    label: z.string().default(''),
  }),
  z.object({
    type: z.literal('list'),
    items: z.array(z.string().min(1)).min(1).max(7),
    numbered: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('chart'),
    kind: z.enum(['bar', 'line']).default('bar'),
    data: z
      .array(z.object({ label: z.string().default(''), value: z.number() }))
      .min(1)
      .max(12),
    unit: z.string().default(''),
    title: z.string().default(''),
  }),
  z.object({
    type: z.literal('dates'),
    events: z
      .array(z.object({ date: z.string().min(1), text: z.string().default('') }))
      .min(1)
      .max(6),
  }),
]);
export type VisualSpec = z.infer<typeof VisualSpec>;
export const SegmentSpec = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'minuscules, chiffres, - et _ uniquement (ex. mon-segment)')
    .refine((id) => id !== CREDITS_ID, `« ${CREDITS_ID} » est réservé au générique`),
  mood: z.enum(MOODS).default('calm'),
  /** Small chapter tag, top-left. */
  label: z.string().default(''),
  /** Headline; HTML allowed, `<small>` for a second line. */
  key: z.string().default(''),
  /** Exactly what the voice says (numbers spelled out for the ear). */
  text: z.string().min(1),
  /** Ready-made shot (image, video, title, quote, figure, list, chart, dates), drawn over the segment's scene if it has one. */
  visual: VisualSpec.optional(),
});
export type SegmentSpec = z.infer<typeof SegmentSpec>;

export const FormatSpec = z.object({
  /** Output resolution in pixels. */
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  fps: z.number().int().min(1).max(120).default(30),
  /** Output pixels per CSS pixel: the overlay layout is width/pixelRatio CSS px wide. */
  pixelRatio: z.number().positive().default(1.5),
});
export type FormatSpec = z.infer<typeof FormatSpec>;

export const LookSpec = z.object({
  background: hexColor.default('#01030a'),
  accent: hexColor.default('#ffb35c'),
  fogDensity: z.number().min(0).default(0.015),
  bloom: z.number().min(0).default(0.9),
  exposure: z.number().positive().default(1.1),
  /** Multisample anti-aliasing of the 3D scene (0 = off, 4 = smooth edges; nearly free on a GPU). */
  msaa: z.number().int().min(0).max(8).default(4),
});

export const VoiceSpec = z.object({
  /** OpenRouter text-to-speech model. */
  model: z.string().default('fish-audio/s2.1-pro-free:free'),
  /** Fixed speaker (Fish Audio reference_id, HeyGen voice name…). Without it Fish picks a random voice per call. */
  voice: z.string().optional(),
  /** Parallel requests. */
  concurrency: z.number().int().min(1).max(16).default(3),
  /** Shown in the credits and docs; the credits must name the voice actually used. */
  credit: z.string().default(''),
});

export const TimingSpec = z.object({
  /** Picture before the first voice (title card). */
  introLead: z.number().min(0).default(3.2),
  /** Picture before each voice. */
  lead: z.number().min(0).default(0.9),
  /** Picture after each voice. */
  tail: z.number().min(0).default(1.1),
  /** Picture after the last voice (room for the closing line). */
  outroTail: z.number().min(0).default(1.8),
  /** Credits length; 0 disables the credits segment. */
  credits: z.number().min(0).default(6),
  /** Characters per second used to estimate durations when there is no voice. */
  readingSpeed: z.number().positive().default(15),
});
export type TimingSpec = z.infer<typeof TimingSpec>;

export const MusicSpec = z.object({
  enabled: z.boolean().default(true),
  /** MIDI root of the key (50 = D3). */
  root: z.number().int().min(24).max(84).default(50),
  major: z.boolean().default(false),
  gain: z.number().min(0).max(2).default(0.55),
  /** How much the music dips under the voice (0-1). */
  duck: z.number().min(0).max(1).default(0.55),
  seed: z.number().int().default(7),
});

export const SubtitlesSpec = z.object({
  /**
   * `line`: one sentence at a time at the bottom; `words`: a few big words at a time, the spoken one
   * highlighted (vertical short videos); `auto`: `words` when the frame is taller than wide, else `line`.
   */
  style: z.enum(['auto', 'line', 'words']).default('auto'),
});

export const CapsuleSpec = z
  .object({
    $schema: z.string().optional(),
    title: z.string().min(1),
    kicker: z.string().default(''),
    /** HTML; `<b>` for the heading line. */
    credits: z.string().default(''),
    closingLine: z.string().default(''),
    language: z.string().default('fr'),
    format: FormatSpec.prefault({}),
    look: LookSpec.prefault({}),
    voice: VoiceSpec.prefault({}),
    timing: TimingSpec.prefault({}),
    music: MusicSpec.prefault({}),
    subtitles: SubtitlesSpec.prefault({}),
    segments: z.array(SegmentSpec).min(1),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.segments.forEach((s, i) => {
      if (seen.has(s.id))
        ctx.addIssue({ code: 'custom', path: ['segments', i, 'id'], message: `identifiant « ${s.id} » en double` });
      seen.add(s.id);
    });
    if (c.format.width % 2 || c.format.height % 2) {
      ctx.addIssue({ code: 'custom', path: ['format'], message: 'largeur et hauteur doivent être paires (yuv420p)' });
    }
  });
export type Capsule = z.infer<typeof CapsuleSpec>;

/** Parses and validates a capsule; throws an Error listing every problem with its JSON path. */
export function parseCapsule(data: unknown, source = 'capsule.json'): Capsule {
  const r = CapsuleSpec.safeParse(data);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(`${source} invalide :\n${lines.join('\n')}`);
}

/** 1080x1920 at pixel ratio 1.5: the 720x1280 CSS layout the vertical styles are written for. */
export const VERTICAL_FORMAT = { width: 1080, height: 1920, pixelRatio: 1.5 } as const;

/** Short videos get to the point: brief title card, tight breaths between segments, short credits. */
export const SHORT_TIMING = {
  introLead: 1.2,
  lead: 0.4,
  tail: 0.5,
  outroTail: 1.2,
  credits: 2.5,
} as const satisfies Partial<TimingSpec>;

/** Taller than wide: a vertical video (9:16 for short-video apps). */
export const isPortrait = (format: FormatSpec): boolean => format.height > format.width;

/** The subtitle style the engine draws, with `auto` resolved from the orientation. */
export function subtitleStyle(capsule: Capsule): 'line' | 'words' {
  const { style } = capsule.subtitles;
  return style === 'auto' ? (isPortrait(capsule.format) ? 'words' : 'line') : style;
}

/** CSS layout size derived from the output format. */
export function layoutOf(format: FormatSpec): { width: number; height: number } {
  return { width: Math.round(format.width / format.pixelRatio), height: Math.round(format.height / format.pixelRatio) };
}
