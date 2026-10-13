/**
 * CodeBlock: read-only monospace lines with a line-number gutter, scrolling
 * inside its own box. Lines may carry a diff tone (+ pass, − fail). Copy and
 * download helpers sit beside it: clipboard API on secure origins, a hidden
 * textarea fallback on plain-HTTP lab deployments.
 */
export interface CodeLine {
  text: string;
  tone?: 'add' | 'del';
}

export function CodeBlock({ lines, maxHeight = '70vh' }: { lines: CodeLine[]; maxHeight?: string | number }) {
  const gutter = String(lines.length).length;
  return (
    <pre
      tabIndex={0}
      aria-label="Configuration text"
      style={{
        margin: 0,
        maxHeight,
        overflow: 'auto',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: '12px 0',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            paddingRight: 16,
            background:
              l.tone === 'add'
                ? 'color-mix(in srgb, var(--color-pass) 12%, transparent)'
                : l.tone === 'del'
                  ? 'color-mix(in srgb, var(--color-fail) 12%, transparent)'
                  : undefined,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              flexShrink: 0,
              width: `${gutter + 3}ch`,
              paddingRight: '1.5ch',
              textAlign: 'right',
              color: 'var(--color-muted)',
              opacity: 0.6,
              userSelect: 'none',
            }}
          >
            {i + 1}
          </span>
          <span
            style={{
              whiteSpace: 'pre',
              color:
                l.tone === 'add' ? 'var(--color-pass)' : l.tone === 'del' ? 'var(--color-fail)' : undefined,
            }}
          >
            {l.tone === 'add' ? '+ ' : l.tone === 'del' ? '- ' : ''}
            {l.text}
          </span>
        </div>
      ))}
    </pre>
  );
}

/** Copy text to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
}

/** Save text as a file download. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
