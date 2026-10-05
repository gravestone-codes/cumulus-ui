/**
 * Canonical atoms (Phase 2, design language §7): one element, one component.
 * New screens compose these; they wrap the `.btn` / `.lf` / `.field-err`
 * language so underline fields, shake-once errors and inverted buttons stay
 * identical everywhere. No switch-derived constants here — labels/options
 * arrive via props from backend data.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

/* PromptModal: one question, one line-field, two buttons. Renames and
   other single-value edits — never a form. */
export function PromptModal({
  open,
  title,
  label,
  initial = '',
  confirmLabel = 'Save',
  busy = false,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <LineField
        label={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error ?? undefined}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <Button auto variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          auto
          disabled={busy || value.trim().length === 0}
          onClick={() => value.trim() && onSubmit(value.trim())}
        >
          {busy ? 'Saving…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

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

/* Pinned rail preference: collapse state survives reloads, per rail. */
export function usePinnedRail(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(`rail:${key}`) === '1';
    } catch {
      return false;
    }
  });
  function toggle() {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(`rail:${key}`, c ? '0' : '1');
      } catch {
        /* private mode: pin lasts the session */
      }
      return !c;
    });
  }
  return [collapsed, toggle];
}

/* NavRail: collapsible (§9 — click ‹), optional scope header (name + back
   link) for switch/group views, domain links, user chip. */
export function NavRail({
  switchName,
  scope,
  back,
  brand = true,
  items,
  active,
  onNav,
  user,
  onLogout,
  collapsed = false,
  onToggleCollapse,
}: {
  switchName?: string;
  scope?: { kind: 'switch' | 'group'; name: string; sub?: string };
  back?: { label: string; to: string };
  brand?: boolean;
  items: NavItem[];
  active: string;
  onNav: (to: string) => void;
  user?: string;
  onLogout?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  function ToggleButton() {
    if (!onToggleCollapse) return null;
    return (
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
          flexShrink: 0,
        }}
      >
        {collapsed ? '›' : '‹'}
      </button>
    );
  }
  return (
    <nav
      aria-label="Primary"
      style={{
        width: collapsed ? 72 : 220,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border)',
        padding: collapsed ? '20px 8px' : '20px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        position: 'sticky',
        top: 0,
        height: '100vh',
      }}
    >
      {back && !collapsed && (
        <button
          type="button"
          onClick={() => onNav(back.to)}
          style={{
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-muted)',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 14,
            padding: '4px 8px 12px',
            whiteSpace: 'nowrap',
          }}
        >
          ‹ {back.label}
        </button>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: '0 8px',
          marginBottom: 2,
          whiteSpace: 'nowrap',
        }}
      >
        {brand && !scope && (
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
        )}
        {brand && !scope && !collapsed && (
          <span style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>Cumulus</span>
        )}
        {scope && !collapsed && (
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: 'block',
                fontSize: 15,
                fontWeight: 800,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginTop: 6,
              }}
            >
              {scope.name}
            </span>
            {scope.sub && (
              <span style={{ display: 'block', fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
                {scope.sub}
              </span>
            )}
          </span>
        )}
        {switchName && !scope && !collapsed && (
          <span style={{ fontSize: 13, color: 'var(--color-muted)', flex: 1 }}>{switchName}</span>
        )}
        <ToggleButton />
      </div>
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
            padding: collapsed ? '8px 8px' : '8px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
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
      {user && <UserChip user={user} collapsed={collapsed} onNav={onNav} onLogout={onLogout} />}
    </nav>
  );
}

/* UserChip: avatar + name opens a popup (Profile, Sign out, future personal
   settings). The popup anchors above the chip; Escape or click-out closes. */
function UserChip({
  user,
  collapsed,
  onNav,
  onLogout,
}: {
  user: string;
  collapsed: boolean;
  onNav: (to: string) => void;
  onLogout?: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  function menuItem(label: string, run: () => void) {
    return (
      <button
        key={label}
        type="button"
        onClick={() => {
          setOpen(false);
          run();
        }}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          borderRadius: 6,
          color: 'var(--color-text)',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 14,
          padding: '8px 10px',
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      {open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 40 }}
        />
      )}
      {open && (
        <div
          role="menu"
          aria-label="Account"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            minWidth: 180,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 4,
            zIndex: 50,
            boxShadow: '0 16px 40px rgba(0,0,0,.5)',
          }}
        >
          {menuItem('Profile', () => onNav('/settings'))}
          {onLogout && menuItem('Sign out', onLogout)}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 8,
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderRadius: 8,
          color: 'var(--color-muted)',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 13,
          padding: '8px',
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
      </button>
    </div>
  );
}
/* Hint: (?) marker with a hover/focus tooltip. Explanations live here —
   labels stay terse and prose paragraphs stay out of screens. */
export function Hint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', marginLeft: 6, verticalAlign: 'middle' }}>
      <button
        type="button"
        aria-label={`More info: ${text}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: '1px solid var(--color-border)',
          background: 'transparent',
          color: 'var(--color-muted)',
          cursor: 'help',
          font: 'inherit',
          fontSize: 12,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            minWidth: 200,
            maxWidth: 280,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 13,
            fontWeight: 400,
            color: 'var(--color-text)',
            zIndex: 60,
            boxShadow: '0 16px 40px rgba(0,0,0,.5)',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/* RowMenu: kebab trigger per table row, menu through a portal (never
   clipped by table overflow). Flips upward near the viewport bottom.
   Items carry danger/disabled/title — same contract as GRG's RowMenu. */
export interface RowMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

const MENU_W = 200;

export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  }

  const height = items.length * 40 + 12;
  const flipUp = rect ? rect.bottom + height + 8 > window.innerHeight : false;
  const left = rect == null ? 0 : Math.min(Math.max(8, rect.right - MENU_W), window.innerWidth - MENU_W - 8);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        style={{
          background: 'transparent',
          border: 'none',
          borderRadius: 6,
          color: 'var(--color-muted)',
          cursor: 'pointer',
          font: 'inherit',
          padding: '6px 8px',
          display: 'inline-flex',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            role="menu"
            aria-label={label}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              width: MENU_W,
              top: flipUp ? rect.top - height - 6 : rect.bottom + 6,
              left,
              zIndex: 70,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              padding: 6,
              boxShadow: '0 16px 40px rgba(0,0,0,.5)',
            }}
          >
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                disabled={it.disabled}
                title={it.title}
                onClick={(e) => {
                  // Portal content bubbles through the React tree: stop it
                  // reaching row onClick handlers (the DOM stop above is not enough).
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick();
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: it.danger ? 'var(--color-fail)' : 'var(--color-text)',
                  cursor: it.disabled ? 'not-allowed' : 'pointer',
                  opacity: it.disabled ? 0.4 : 1,
                  font: 'inherit',
                  fontSize: 14,
                  padding: '10px 12px',
                }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/* Breadcrumb: leaf01 / Interfaces — every ancestor a clickable way back.
   Depth grows with the route; the last segment is the current page. */
export function Breadcrumb({
  trail,
  onNav,
}: {
  trail: Array<{ label: string; to?: string }>;
  onNav: (to: string) => void;
}) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      {trail.map((seg, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            {i > 0 && (
              <span aria-hidden="true" style={{ color: 'var(--color-muted)' }}>
                /
              </span>
            )}
            {last || !seg.to ? (
              <span
                aria-current={last ? 'page' : undefined}
                style={{
                  color: last ? 'var(--color-text)' : 'var(--color-muted)',
                  fontWeight: last ? 700 : 400,
                }}
              >
                {seg.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => seg.to && onNav(seg.to)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  font: 'inherit',
                  color: 'var(--color-muted)',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                {seg.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/* Spinner: centered ring for loads, both axes. Motion-safe: static ring when
   the user prefers reduced motion. */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}
    >
      <span className="spinner" aria-hidden="true" />
    </div>
  );
}

/* EmptyState: centered icon + line for empty collections. Callers own the words. */ export function EmptyState({
  icon,
  text,
  action,
}: {
  icon?: NavIcon;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: '50vh',
        padding: 16,
        color: 'var(--color-muted)',
      }}
    >
      <span style={{ display: 'inline-flex', transform: 'scale(2.6)', opacity: 0.8 }} aria-hidden="true">
        {icon ? NAV_ICONS[icon] : null}
      </span>
      <p style={{ fontSize: 15, margin: 0 }}>{text}</p>
      {action}
    </div>
  );
}

/* AppShell: rail + content column (flex, so EmptyState truly centers).
   Domain screens mount inside, never beside. */
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
      <main
        style={{
          flex: 1,
          padding: 28,
          maxWidth: 1100,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}
