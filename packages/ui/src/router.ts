/** Hash routes: `#/<project>/<step>`, so a reload or a shared link reopens the same view. */
import { useEffect, useState } from 'preact/hooks';

/** The production steps in order, then the settings. */
export const TABS = ['ecrire', 'voix', 'musique', 'verifier', 'exporter', 'reglages'] as const;
export type Tab = (typeof TABS)[number];

export interface Route {
  readonly project: string | null;
  readonly tab: Tab;
}

function parse(hash: string): Route {
  const [project, tab] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { project: project || null, tab: TABS.includes(tab as Tab) ? (tab as Tab) : 'ecrire' };
}

export function navigate(route: Partial<Route>): void {
  const next = { ...parse(location.hash), ...route };
  location.hash = next.project ? `#/${encodeURIComponent(next.project)}/${next.tab}` : '#/';
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = (): void => setRoute(parse(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
