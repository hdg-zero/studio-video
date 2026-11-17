/** One colour per mood, shared by the narration editor, the timeline and the preview. */
const COLORS: Record<string, string> = {
  intro: '#8fb3ff',
  calm: '#6fd3c1',
  pulse: '#ffb35c',
  build: '#f6d365',
  explosion: '#ff6b6b',
  suspense: '#b58cff',
  bright: '#ffe9a8',
  dark: '#6f7fa3',
  minimal: '#c3c9d4',
  finale: '#ff9fd0',
  credits: '#3a4152',
};

export const moodColor = (mood: string): string => COLORS[mood] ?? '#8a93a6';

export const MOOD_LABELS: Record<string, string> = {
  intro: 'ouverture',
  calm: 'calme',
  pulse: 'pulsation',
  build: 'montée',
  explosion: 'explosion',
  suspense: 'suspense',
  bright: 'lumineux',
  dark: 'sombre',
  minimal: 'dépouillé',
  finale: 'final',
};
