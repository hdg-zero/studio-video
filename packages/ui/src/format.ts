/** Display helpers (French formatting). */
export const seconds = (s: number): string => {
  if (!Number.isFinite(s)) return '–';
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m ? `${m} min ${String(Math.round(r)).padStart(2, '0')}` : `${r.toFixed(1).replace('.', ',')} s`;
};

/** 83.4 → "1:23.4" (timecode for the player). */
export const timecode = (s: number): string => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
};

export const bytes = (n: number): string =>
  n > 1 << 30
    ? `${(n / (1 << 30)).toFixed(2).replace('.', ',')} Go`
    : n > 1 << 20
      ? `${(n / (1 << 20)).toFixed(1).replace('.', ',')} Mo`
      : `${Math.round(n / 1024)} Ko`;

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export const ago = (time: number): string => {
  const s = (time - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return 'à l’instant';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
};

export const clock = (time: number): string =>
  new Date(time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
