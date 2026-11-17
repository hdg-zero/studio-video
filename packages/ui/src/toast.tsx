/** Transient notifications (errors of API calls, saved capsule…). */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './components/ui.js';

interface Toast {
  readonly id: number;
  readonly kind: 'ok' | 'error';
  readonly text: string;
}

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<(t: readonly Toast[]) => void>();
const publish = (): void => listeners.forEach((l) => l(toasts));

export function notify(text: string, kind: Toast['kind'] = 'ok'): void {
  const id = nextId++;
  toasts = [...toasts, { id, kind, text }];
  publish();
  window.setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id);
      publish();
    },
    kind === 'error' ? 8000 : 3000,
  );
}

/** Runs an async action and reports its failure as a toast. */
export async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (err) {
    notify(err instanceof Error ? err.message : String(err), 'error');
    return undefined;
  }
}

export function Toasts(): JSX.Element {
  const [list, setList] = useState(toasts);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return (
    <div class="toasts" role="status">
      {list.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>
          <Icon name={t.kind === 'ok' ? 'check' : 'alert'} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
