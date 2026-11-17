/** Small presentational building blocks shared by every view. */
import type { ButtonHTMLAttributes, ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Freshness } from '../../../cli/src/ui/protocol.js';

const PATHS = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  stop: 'M6 6h12v12H6z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z',
  up: 'M12 6l6 6-1.4 1.4L13 9.8V19h-2V9.8l-3.6 3.6L6 12z',
  down: 'M12 18l-6-6 1.4-1.4 3.6 3.6V5h2v9.2l3.6-3.6L18 12z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm-7 9h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h-2v-2.1A7 7 0 0 1 5 12z',
  timeline: 'M3 6h8v4H3zM13 6h8v4h-8zM3 14h12v4H3zM17 14h4v4h-4z',
  music: 'M19 3v12.5a3.5 3.5 0 1 1-2-3.15V7l-8 1.6v8.9A3.5 3.5 0 1 1 7 14.35V5z',
  image: 'M4 5h16v14H4zm2 2v8l4-4 3 3 2-2 3 3V7zm9 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  film: 'M4 4h16v16H4zm2 2v2h2V6zm10 0v2h2V6zM6 10v4h12v-4zm0 6v2h2v-2zm10 0v2h2v-2z',
  settings:
    'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10.5 2h3l.5 2.6 1.9.8 2.2-1.5 2.1 2.1-1.5 2.2.8 1.9 2.5.4v3l-2.5.5-.8 1.9 1.5 2.2-2.1 2.1-2.2-1.5-1.9.8-.5 2.5h-3l-.5-2.5-1.9-.8-2.2 1.5-2.1-2.1 1.5-2.2-.8-1.9L2 13.5v-3l2.5-.5.8-1.9-1.5-2.2 2.1-2.1 2.2 1.5 1.9-.8z',
  text: 'M4 5h16v2H4zm0 4h10v2H4zm0 4h16v2H4zm0 4h10v2H4z',
  check: 'M9.5 16.2L5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z',
  close: 'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4L12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
  alert: 'M12 3l10 18H2zm-1 6v6h2V9zm0 8v2h2v-2z',
  volume: 'M4 9h4l5-4v14l-5-4H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z',
  mute: 'M4 9h4l5-4v14l-5-4H4zm11.6.2l1.4-1.4 2 2 2-2 1.4 1.4-2 2 2 2-1.4 1.4-2-2-2 2-1.4-1.4 2-2z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  folder: 'M3 5h7l2 2h9v12H3z',
  refresh: 'M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4z',
  chevron: 'M9 6l6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6z',
  copy: 'M8 3h11v13h-2V5H8zM5 7h10v14H5z',
  save: 'M5 3h11l3 3v15H5zm2 2v5h8V5zm5 9a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  undo: 'M12.5 8c-2.6 0-5 1-6.9 2.6L3 8v8h8l-2.9-2.9A7 7 0 0 1 19.5 16l2-.7A9 9 0 0 0 12.5 8z',
  search: 'M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  sparkle:
    'M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9zM5 15l.7 1.6 1.6.7-1.6.7L5 19.6l-.7-1.6-1.6-.7 1.6-.7z',
  dot: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  more: 'M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  send: 'M3 20l18-8L3 4v6l12 2-12 2z',
  arrow: 'M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4 5.6-5.6H4z',
  key: 'M7 10a5 5 0 1 1 4.6 5H10v2H8v2H5v-3.4l4.1-4.1A5 5 0 0 1 7 10zm5-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  cpu: 'M8 8h8v8H8zM9 2h2v3H9zm4 0h2v3h-2zM9 19h2v3H9zm4 0h2v3h-2zM2 9h3v2H2zm0 4h3v2H2zm17-4h3v2h-3zm0 4h3v2h-3zM6 6h12v12H6z',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} fill="currentColor" fill-rule="evenodd" />
    </svg>
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes, 'icon'> & {
  icon?: IconName;
  variant?: 'primary' | 'ghost' | 'danger' | 'default' | 'accent-soft';
  small?: boolean;
};

export function Button({
  icon,
  variant = 'default',
  small,
  children,
  class: cls,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      class={`btn btn-${variant}${small ? ' btn-sm' : ''}${children ? '' : ' btn-icon'} ${typeof cls === 'string' ? cls : ''}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={small ? 14 : 16} />}
      {children && <span>{children}</span>}
    </button>
  );
}

const FRESH_LABEL: Record<Freshness, string> = { fresh: 'à jour', stale: 'à refaire', missing: 'absent' };

export function Status({ state, label }: { state: Freshness; label?: string }): JSX.Element {
  return (
    <span class={`status status-${state}`}>
      <i />
      {label ?? FRESH_LABEL[state]}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  wide,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ComponentChildren;
  wide?: boolean;
}): JSX.Element {
  return (
    <label class={`field${wide ? ' field-wide' : ''}${error ? ' field-error' : ''}`}>
      <span class="field-label">{label}</span>
      {children}
      {error ? <span class="field-msg">{error}</span> : hint ? <span class="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Progress({ value }: { value: number | null }): JSX.Element {
  return (
    <div class={`progress${value === null ? ' progress-indeterminate' : ''}`}>
      <div style={{ width: `${Math.round((value ?? 0.3) * 100)}%` }} />
    </div>
  );
}

export interface MenuItem {
  readonly label: string;
  readonly icon?: IconName;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

/** A button that opens a small list of actions (closes on choice, outside click or Escape). */
export function Menu({
  label,
  icon = 'more',
  items,
  variant = 'ghost',
  title,
}: {
  label?: string;
  icon?: IconName;
  items: readonly MenuItem[];
  variant?: 'ghost' | 'default' | 'accent-soft';
  title?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div class="menu" ref={ref}>
      <Button small variant={variant} icon={icon} title={title} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </Button>
      {open && (
        <ul class="menu-list" role="menu">
          {items.map((it) => (
            <li key={it.label}>
              <button
                type="button"
                role="menuitem"
                class={it.danger ? 'danger' : ''}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon && <Icon name={it.icon} size={14} />}
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
