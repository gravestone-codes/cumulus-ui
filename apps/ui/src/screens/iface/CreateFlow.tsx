/**
 * CreateFlow (generic object creation): name prompt, then a schema-enumerated
 * ResourceForm for the initial values, then ChangeFlow (dry-run → apply).
 * NVUE creates on PATCH to a fresh path, so creation rides the exact same
 * machinery as edits — no per-object creators. Members that already hold the
 * object are refused up front (create never overwrites). Key-only rows (DNS
 * servers: the name IS the config, zero leaves) skip the values form and
 * stage an empty PATCH instead.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, PromptModal, Spinner, useToast } from '../../components/ui.js';
import { refreshInterfaces, usePerSwitch, type Scope } from './scope.js';
import { ChangeFlow } from './ChangeFlow.js';
import { ResourceForm } from './ResourceForm.js';

/** NVUE object names: no slashes, bounded. Overridable per object. */
export const OBJECT_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

export function CreateFlow({
  scope,
  title,
  nameLabel,
  nameHint,
  collection,
  fields,
  labels,
  validateName,
  warning,
  members,
  onClose,
  onApplied,
}: {
  scope: Scope;
  /** Modal title once past the name step (e.g. `New bridge domain`). */
  title: string;
  /** Name prompt label (e.g. `Bridge domain`). */
  nameLabel: string;
  nameHint?: string;
  /** Collection read path (e.g. `/bridge/domain`); the object lands at `${collection}/${name}`). */
  collection: string;
  /** Initial-value leaves (schema-enumerated subset). */
  fields: string[];
  /** Presentation label overrides by leaf path. */
  labels?: Record<string, string>;
  /** Name validation; null = fine. Defaults to the object-name shape. */
  validateName?: (name: string) => string | null;
  /** Extra warning on the review step. */
  warning?: string;
  /** Restrict targets (e.g. switches holding the parent row); default: the whole scope. */
  members?: string[];
  onClose: () => void;
  onApplied?: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check =
    validateName ??
    ((n: string) =>
      OBJECT_NAME.test(n) ? null : 'Letters, digits, dot, dash, underscore, colon — no slashes.');
  // Holders gate creation: a member that already has the object is refused, never overwritten.
  const holders = usePerSwitch<Record<string, unknown>>(scope, collection, { enabled: name !== null });
  if (name === null) {
    return (
      <PromptModal
        open
        title={title}
        label={nameHint ? `${nameLabel} (${nameHint})` : nameLabel}
        confirmLabel="Continue"
        error={error}
        onSubmit={(v) => {
          const bad = check(v);
          if (bad) {
            setError(bad);
            return;
          }
          setError(null);
          setName(v);
        }}
        onCancel={onClose}
      />
    );
  }
  const objectPath = `${collection}/${encodeURIComponent(name)}`;
  // Who already holds the name decides the targets: never stage before it is known.
  if (holders.loading) {
    return (
      <Modal open onClose={onClose} title={title}>
        <Spinner label="Checking switches in scope" />
      </Modal>
    );
  }
  if (holders.error) {
    return (
      <Modal open onClose={onClose} title={title}>
        <Alert tone="fail">{`Could not check which switches hold ${name}: ${holders.error.message}`}</Alert>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button auto variant="secondary" onClick={() => setName(null)}>
            Back
          </Button>
        </div>
      </Modal>
    );
  }
  // Unreadable members are skipped, never staged blind.
  const inScope = holders.members.filter((sw) => (members ?? [sw]).includes(sw) && !holders.errors[sw]);
  const taken = inScope.filter((sw) => holders.objects[sw]?.[name] !== undefined);
  const present = inScope.filter((sw) => holders.objects[sw]?.[name] === undefined);
  if (present.length === 0) {
    return (
      <Modal open onClose={() => setName(null)} title={title}>
        <Alert tone="warn">{name} already exists on every switch in scope — nothing to create.</Alert>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button auto variant="secondary" onClick={() => setName(null)}>
            Back
          </Button>
        </div>
      </Modal>
    );
  }
  if (fields.length === 0) {
    return (
      <Modal open onClose={onClose} title={title} width={scope.kind === 'group' ? 600 : 460}>
        <ChangeFlow
          scope={scope}
          calls={Object.fromEntries(
            present.map((sw) => [sw, [{ path: objectPath, method: 'PATCH' as const, body: {} }]]),
          )}
          warning={
            taken.length > 0
              ? `${name} already exists on ${taken.join(', ')} — created on the remaining switches only.`
              : (warning ?? undefined)
          }
          onBack={() => setName(null)}
          onClose={onClose}
          onApplied={() => {
            refreshInterfaces(queryClient);
            onApplied?.();
          }}
          notify={toast}
          doneText={`${title}: ${name}`}
        />
      </Modal>
    );
  }
  return (
    <ResourceForm
      scope={scope}
      objectPath={objectPath}
      name={name}
      title={title}
      only={fields}
      labels={labels}
      cfg={{}}
      present={present}
      warning={() =>
        [
          taken.length > 0
            ? `${name} already exists on ${taken.join(', ')} — created on the remaining switches only.`
            : null,
          warning ?? null,
        ]
          .filter(Boolean)
          .join(' ') || null
      }
      doneText={`${title}: ${name}`}
      onClose={() => setName(null)}
      onApplied={() => {
        refreshInterfaces(queryClient);
        onApplied?.();
      }}
      notify={toast}
    />
  );
}
