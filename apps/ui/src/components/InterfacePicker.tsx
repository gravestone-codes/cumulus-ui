/**
 * InterfacePicker (R11): searchable single/multi select over existing
 * interfaces, resolving to `S1` names. Options come from the backend list
 * (lib/interfacePicker); in a group each option shows `have/members` and a
 * pick missing on some members raises a warning.
 */
import { useState } from 'react';
import { filterOptions, missingOn, optionTypes, type PickerOption } from '../lib/interfacePicker.js';

export function InterfacePicker({
  label,
  options,
  members,
  value,
  onChange,
  multiple = false,
  error,
}: {
  label: string;
  options: PickerOption[];
  /** Switches in scope; more than one shows per-option availability. */
  members: string[];
  value: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const types = optionTypes(options);
  const shown = filterOptions(options, query, type);
  const group = members.length > 1;
  const missing = group ? missingOn(options, value, members) : [];

  const toggle = (name: string) =>
    onChange(
      value.includes(name)
        ? value.filter((v) => v !== name)
        : multiple
          ? [...value, name].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          : [name],
    );

  return (
    <div style={{ marginBottom: 4 }}>
      <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>{label}</span>
      {multiple && value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
          {value.map((v) => (
            <button
              key={v}
              type="button"
              className="chip"
              aria-label={`Remove ${v}`}
              onClick={() => toggle(v)}
            >
              {v} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      <div
        style={{
          border: `1px solid ${error ? 'var(--color-fail)' : 'var(--color-border)'}`,
          borderRadius: 10,
          marginTop: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 6 }}>
          <input
            aria-label={`Search ${label}`}
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="select-search"
            style={{ margin: 0, borderBottom: 'none' }}
          />
          {types.length > 1 &&
            ['', ...types].map((t) => (
              <button
                key={t || 'all'}
                type="button"
                className="chip"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                style={{
                  padding: '3px 9px',
                  fontSize: 12,
                  borderColor: type === t ? 'var(--color-brand)' : undefined,
                }}
              >
                {t || 'All'}
              </button>
            ))}
        </div>
        <div
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          style={{
            borderTop: '1px solid var(--color-border)',
            maxHeight: 200,
            overflowY: 'auto',
            padding: 4,
          }}
        >
          {shown.length === 0 ? (
            <p style={{ color: 'var(--color-muted)', fontSize: 13, margin: 0, padding: '8px 10px' }}>
              {options.length === 0 ? 'No interfaces available.' : 'No match.'}
            </p>
          ) : (
            shown.map((o) => {
              const selected = value.includes(o.name);
              const partial = o.have.length < members.length;
              return (
                <button
                  key={o.name}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="select-opt"
                  onClick={() => toggle(o.name)}
                  style={{ fontWeight: selected ? 700 : 400, padding: '6px 10px' }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 16,
                      color: selected ? 'var(--color-brand)' : 'transparent',
                      fontSize: 13,
                    }}
                  >
                    ✓
                  </span>
                  <span style={{ flex: 1 }}>{o.name}</span>
                  <span style={{ color: 'var(--color-muted)', fontSize: 12 }}>{o.type}</span>
                  {group && (
                    <span
                      title={partial ? `Only on ${o.have.join(', ')}` : undefined}
                      style={{
                        color: partial ? 'var(--color-warn)' : 'var(--color-muted)',
                        fontSize: 12,
                        minWidth: 28,
                        textAlign: 'right',
                      }}
                    >
                      {o.have.length}/{members.length}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
      <p className="field-err" role={error ? 'alert' : undefined}>
        {error ?? ''}
      </p>
      {missing.length > 0 && (
        <p role="status" style={{ fontSize: 13, color: 'var(--color-warn)', margin: '0 0 8px' }}>
          Missing on some switches:{' '}
          {missing.map((m) => `${m.name} (not on ${m.lacking.join(', ')})`).join('; ')}.
        </p>
      )}
    </div>
  );
}
