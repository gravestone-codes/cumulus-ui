/**
 * Canonical atoms (Phase 2, design language §7): one element, one component.
 * New screens compose these; they wrap the `.btn` / `.lf` / `.field-err`
 * language so underline fields, shake-once errors and inverted buttons stay
 * identical everywhere. No switch-derived constants here — labels/options
 * arrive via props from backend data.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/* Button: inverted primary, secondary outline, danger. Full-width by §7. */
export function Button({
  variant = 'primary',
  auto = false,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  auto?: boolean;
}) {
  const tone = variant === 'primary' ? '' : variant === 'danger' ? ' btn-danger' : ' btn-secondary';
  return <button type="button" className={`btn${auto ? ' auto' : ''}${tone} ${className}`} {...props} />;
}

/* LineField: wordless underline input, label only, reserved error slot. */
export function LineField({
  label,
  error,
  shake = {},
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  shake?: { className?: string; onAnimationEnd?: () => void };
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{label}</span>
      <span
        className={`lf${error ? ' invalid' : ''} ${shake.className ?? ''}`}
        onAnimationEnd={shake.onAnimationEnd}
      >
        <input aria-label={label} {...props} />
      </span>
      <p className="field-err" role={error ? 'alert' : undefined}>
        {error ?? ''}
      </p>
    </label>
  );
}

/* LineDropdown: native select in line-field clothing (accessible, no custom listbox yet). */
export function LineDropdown({
  label,
  error,
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{label}</span>
      <span className={`lf${error ? ' invalid' : ''}`}>
        <select
          aria-label={label}
          {...props}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            font: 'inherit',
            fontSize: '0.95rem',
            padding: '0.45rem 0 0.5rem',
            outline: 'none',
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} style={{ background: 'var(--color-surface)' }}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      <p className="field-err" role={error ? 'alert' : undefined}>
        {error ?? ''}
      </p>
    </label>
  );
}

/* Modal: overlay + panel, Escape closes, click-outside closes. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: 440,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* Confirm: the one destructive/affirmative dialog. Max two actions by §7. */
export function Confirm({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: '0 0 20px' }}>{body}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button auto variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button auto variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* Alert: inline pass/warn/fail/note strip. Toasts (below) for transient echoes. */
export function Alert({
  tone = 'note',
  children,
}: {
  tone?: 'pass' | 'warn' | 'fail' | 'note';
  children: ReactNode;
}) {
  const color =
    tone === 'pass'
      ? 'var(--color-pass)'
      : tone === 'warn'
        ? 'var(--color-warn)'
        : tone === 'fail'
          ? 'var(--color-fail)'
          : 'var(--color-brand)';
  return (
    <div
      role={tone === 'fail' ? 'alert' : 'status'}
      style={{
        border: `1px solid ${color}`,
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 13,
        color: 'var(--color-text)',
        background: 'color-mix(in srgb, transparent 80%, currentColor 20%)',
      }}
    >
      {children}
    </div>
  );
}

interface Toast {
  id: number;
  tone: 'pass' | 'warn' | 'fail';
  text: string;
}
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});

/** Push a transient echo (apply done, staged, conflicts). Provider mounts the stack. */
export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 60, display: 'grid', gap: 8 }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderLeft: `3px solid var(--color-${t.tone})`,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              maxWidth: 320,
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export interface NavItem {
  to: string;
  label: string;
  disabled?: boolean;
}

/* NavRail: switch context on top, domain links below. Disabled = not yet sliced. */
export function NavRail({
  switchName,
  items,
  active,
  onNav,
  user,
  onLogout,
}: {
  switchName?: string;
  items: NavItem[];
  active: string;
  onNav: (to: string) => void;
  user?: string;
  onLogout?: () => void;
}) {
  return (
    <nav
      aria-label="Primary"
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border)',
        padding: '20px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minHeight: '100vh',
      }}
    >
      <p style={{ fontSize: 15, fontWeight: 800, padding: '0 8px', margin: '0 0 2px' }}>Junction</p>
      {switchName && (
        <p style={{ fontSize: 12, color: 'var(--color-muted)', padding: '0 8px', margin: '0 0 16px' }}>
          {switchName}
        </p>
      )}
      {items.map((item) => (
        <button
          key={item.to}
          type="button"
          disabled={item.disabled}
          onClick={() => onNav(item.to)}
          style={{
            textAlign: 'left',
            background: active === item.to ? 'var(--color-surface-2)' : 'transparent',
            border: 'none',
            borderRadius: 8,
            color: item.disabled ? 'var(--color-muted)' : 'var(--color-text)',
            opacity: item.disabled ? 0.5 : 1,
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            font: 'inherit',
            fontSize: 14,
            padding: '8px 10px',
          }}
        >
          {item.label}
        </button>
      ))}
      <span style={{ flex: 1 }} />
      {user && (
        <p style={{ fontSize: 12, color: 'var(--color-muted)', padding: '0 8px', margin: '0 0 4px' }}>
          {user}
        </p>
      )}
      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          style={{
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-muted)',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 13,
            padding: '8px 10px',
          }}
        >
          Sign out
        </button>
      )}
    </nav>
  );
}

/* AppShell: rail + content column. Domain screens mount inside, never beside. */
export function AppShell({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}
    >
      {rail}
      <main style={{ flex: 1, padding: 28, maxWidth: 1100 }}>{children}</main>
    </div>
  );
}
