/**
 * Field validation UX (final language): invalid fields shake once, then the
 * error text appears in a reserved slot — forms never resize on error.
 * `flag()` retriggers the shake even for repeat offenses (key bump).
 */
import { useState } from 'react';

export function useFieldErrors() {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [shakeKey, setShakeKey] = useState<Record<string, number>>({});

  function flag(field: string, message: string) {
    setTexts((p) => ({ ...p, [field]: message }));
    // Clear first (so a repeat offense replays), then re-add across frames.
    // No key remounts — remounting would steal input focus mid-typing.
    setShakeKey((p) => ({ ...p, [field]: 0 }));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setShakeKey((p) => ({ ...p, [field]: (p[field] ?? 0) + 1 }));
      });
    });
  }

  function clear(field: string) {
    setTexts((p) => {
      if (!(field in p)) return p;
      const next = { ...p };
      delete next[field];
      return next;
    });
  }

  function clearAll() {
    setTexts({});
  }

  /** Props for the .lf wrapper: shake class replays without remounting. */
  function fieldProps(field: string) {
    const k = shakeKey[field] ?? 0;
    return {
      className: `lf${k > 0 ? ' shake' : ''}`,
      onAnimationEnd: () => setShakeKey((p) => ({ ...p, [field]: 0 })),
    };
  }

  function Err({ field }: { field: string }) {
    return <p className="field-err">{texts[field] ?? ''}</p>;
  }

  return { flag, clear, clearAll, fieldProps, Err, texts };
}
