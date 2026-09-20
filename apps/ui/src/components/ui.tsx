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
      <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>{label}</span>
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
      <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>{label}</span>
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
      <p style={{ fontSize: 15, color: 'var(--color-muted)', margin: '0 0 20px' }}>{body}</p>
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
        fontSize: 14,
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
              fontSize: 14,
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
  icon?: NavIcon;
}

export type NavIcon = 'dashboard' | 'interfaces' | 'vrfs' | 'bgp' | 'audit' | 'switches' | 'software';

/* Hand-drawn stroke icon set (final.html §9). One set, keyed by item. */
const NAV_ICONS: Record<NavIcon, ReactNode> = {
  dashboard: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  interfaces: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </svg>
  ),
  vrfs: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  ),
  bgp: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M7.5 8l3.5 7.5M16.5 8L13 15.5M8.5 6h7" />
    </svg>
  ),
  audit: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="12" r="1" fill="currentColor" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  switches: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
      <circle cx="7" cy="17" r="1" fill="currentColor" />
    </svg>
  ),
  software: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <path d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2z" />
      <path d="M12 11l8-4.5M12 11v9M12 11L4 6.5" />
    </svg>
  ),
};

/* NavRail: collapsible (§9 — click ‹), switch context, domain links, user chip. */
export function NavRail({
  switchName,
  items,
  active,
  onNav,
  user,
  onLogout,
  collapsed = false,
  onToggleCollapse,
}: {
  switchName?: string;
  items: NavItem[];
  active: string;
  onNav: (to: string) => void;
  user?: string;
  onLogout?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  return (
    <nav
      aria-label="Primary"
      style={{
        width: collapsed ? 60 : 220,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border)',
        padding: '20px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minHeight: '100vh',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', marginBottom: 2 }}>
        <span
          aria-hidden="true"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: 'var(--color-text)',
            color: 'var(--color-bg)',
            fontSize: 14,
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          C
        </span>
        {!collapsed && <span style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>Cumulus</span>}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-muted)',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 15,
              padding: 2,
            }}
          >
            {collapsed ? '›' : '‹'}
          </button>
        )}
      </div>
      {switchName && !collapsed && (
        <p style={{ fontSize: 13, color: 'var(--color-muted)', padding: '0 8px', margin: '0 0 16px' }}>
          {switchName}
        </p>
      )}
      {items.map((item) => (
        <button
          key={item.to}
          type="button"
          disabled={item.disabled}
          title={collapsed ? item.label : undefined}
          onClick={() => onNav(item.to)}
          style={{
            textAlign: 'left',
            background: active === item.to ? 'var(--color-surface-2)' : 'transparent',
            border: 'none',
            borderRadius: 8,
            color: active === item.to ? 'var(--color-text)' : 'var(--color-muted)',
            opacity: item.disabled ? 0.5 : 1,
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            font: 'inherit',
            fontSize: 15,
            fontWeight: 500,
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            whiteSpace: 'nowrap',
          }}
        >
          {item.icon && (
            <span style={{ display: 'inline-flex', flexShrink: 0 }} aria-hidden="true">
              {NAV_ICONS[item.icon]}
            </span>
          )}
          {!collapsed && item.label}
        </button>
      ))}
      <span style={{ flex: 1 }} />
      {user && (
        <p
          style={{
            fontSize: 13,
            color: 'var(--color-muted)',
            padding: '0 8px',
            margin: '0 0 4px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--color-text)',
              flexShrink: 0,
            }}
          >
            {user.slice(0, 1).toUpperCase()}
          </span>
          {!collapsed && user}
        </p>
      )}
      {onLogout && !collapsed && (
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
            fontSize: 14,
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
