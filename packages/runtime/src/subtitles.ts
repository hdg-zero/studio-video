/** Subtitle cue: one line of text shown from `start` to `end` (seconds). */
export interface Cue {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface SubtitleOptions {
  /** Sentences longer than this are wrapped. */
  maxLine?: number;
  /** Target width when wrapping a long sentence. */
  wrapAt?: number;
  /** Extra weight per cue, in characters, to account for pauses between sentences. */
  pause?: number;
}

/**
 * Splits narration text into subtitle cues timed proportionally to their length.
 * Cuts after sentence ends and colons, then wraps sentences that are still too long.
 */
export function splitSubtitles(
  text: string,
  voiceStart: number,
  voiceDuration: number,
  { maxLine = 95, wrapAt = 80, pause = 6 }: SubtitleOptions = {},
): Cue[] {
  const sentences = text
    .replace(/ : /g, ' :|')
    .replace(/([.?!…]) /g, '$1|')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const lines = sentences.flatMap((s) => (s.length <= maxLine ? [s] : wrapWords(s, wrapAt)));
  const total = lines.reduce((acc, l) => acc + l.length + pause, 0);
  const cues: Cue[] = [];
  let t = voiceStart;
  for (const line of lines) {
    const d = (voiceDuration * (line.length + pause)) / total;
    cues.push({ text: line, start: t, end: t + d });
    t += d;
  }
  return cues;
}

function wrapWords(sentence: string, width: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of sentence.split(' ')) {
    if (current && current.length + 1 + word.length > width) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}

/** One word of a word-by-word cue, with the time the voice is estimated to reach it. */
export interface TimedWord {
  readonly text: string;
  readonly start: number;
}

/** Short cue of a few words (vertical videos), each word timed for highlighting. */
export interface WordCue extends Cue {
  readonly words: readonly TimedWord[];
}

export interface WordCueOptions {
  /** Most words per cue. */
  maxWords?: number;
  /** Most characters per cue (a longer word still gets its own cue). */
  maxChars?: number;
  /** Extra weight, in characters, after a sentence end. */
  pause?: number;
  /** Extra weight, in characters, after a comma, colon or semicolon. */
  shortPause?: number;
}

/**
 * Splits narration text into short cues of a few words, as in vertical short videos.
 * Without word timestamps from the voice, each word's time is estimated from its length
 * (plus a pause after punctuation); a cue never runs across a sentence end.
 */
export function splitWordCues(
  text: string,
  voiceStart: number,
  voiceDuration: number,
  { maxWords = 4, maxChars = 24, pause = 6, shortPause = 3 }: WordCueOptions = {},
): WordCue[] {
  // French typography: keep « : », « ? », « ! » and « ; » with the word before them
  const words = text
    .replace(/\s+([:;?!»])/g, '\u00a0$1')
    .replace(/([«])\s+/g, '$1\u00a0')
    .split(/[ \t\r\n]+/) // not \s, which would also split at the no-break spaces
    .filter(Boolean);
  if (!words.length) return [];
  const ends = (w: string): 'sentence' | 'clause' | null =>
    /[.?!…]["»)]?$/.test(w) ? 'sentence' : /[,;:]["»)]?$/.test(w) ? 'clause' : null;
  const weightOf = (w: string): number =>
    w.length + 1 + (ends(w) === 'sentence' ? pause : ends(w) === 'clause' ? shortPause : 0);
  const total = words.reduce((acc, w) => acc + weightOf(w), 0);

  const groups: string[][] = [];
  let current: string[] = [];
  for (const w of words) {
    const length = current.reduce((n, x) => n + x.length + 1, 0) + w.length;
    if (current.length && (current.length >= maxWords || length > maxChars)) {
      groups.push(current);
      current = [];
    }
    current.push(w);
    if (ends(w)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);

  const cues: WordCue[] = [];
  let t = voiceStart;
  for (const group of groups) {
    const start = t;
    const timed = group.map((w) => {
      const word = { text: w, start: t };
      t += (voiceDuration * weightOf(w)) / total;
      return word;
    });
    cues.push({ text: group.join(' '), start, end: t, words: timed });
  }
  return cues;
}
