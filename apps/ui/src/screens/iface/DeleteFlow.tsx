/**
 * DeleteFlow (roadmap 2.6/R-generic): one delete path for every object —
 * class-decided confirm (§6.6) with path echo, then ChangeFlow (dry-run →
 * apply → per-switch results). Callers map members to DELETE paths; the flow
 * owns confirm style, heartbeat, and cache refresh.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { StageCall } from '../../lib/api.js';
import { dangerOfDelete, type DangerClass } from '../../lib/danger.js';
import { Confirm, Modal, useToast } from '../../components/ui.js';
import { useHeartbeat } from '../../components/presence.js';
import { ChangeFlow } from './ChangeFlow.js';
import { refreshInterfaces, type Scope } from './scope.js';

/** Delete one object on the members that have it; the dry-run is the confirmation. */
export function DeleteFlow({
  scope,
  name,
  paths,
  danger,
  warning,
  doneText,
  onClose,
  onApplied,
}: {
  scope: Scope;
  /** Object name echoed in every confirm step (e.g. `bond0`). */
  name: string;
  /** DELETE path per member switch. */
  paths: Record<string, string>;
  /** Override the §6.6 class (default: classified from the first path). */
  danger?: DangerClass;
  /** Extra warning on the review step (e.g. traffic stops). */
  warning?: string;
  /** Toast text after apply. */
  doneText?: string;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const members = Object.keys(paths);
  const cls = danger ?? dangerOfDelete(paths[members[0] ?? ''] ?? '');
  useHeartbeat(members, paths[members[0] ?? ''] ?? '');

  const calls: Record<string, StageCall[]> = Object.fromEntries(
    Object.entries(paths).map(([sw, path]) => [sw, [{ path, method: 'DELETE' as const }]]),
  );
  const echo = members.map((sw) => `${paths[sw]} on ${sw}`).join(', ');
  if (!confirmed) {
    return (
      <Confirm
        open
        title={`Delete ${name}?`}
        body={
          cls === 'dangerous'
            ? `${echo}. This is dangerous and cannot be undone.`
            : cls === 'service'
              ? `${echo}. This affects traffic and cannot be undone.`
              : `${echo}. This cannot be undone.`
        }
        confirmLabel="Delete"
        danger
        ackLabel={cls === 'service' ? 'I understand this affects traffic' : undefined}
        requireText={cls === 'dangerous' ? name : undefined}
        onConfirm={() => setConfirmed(true)}
        onCancel={onClose}
      />
    );
  }
  return (
    <Modal open onClose={onClose} title={`Delete ${name}`} width={scope.kind === 'group' ? 600 : 460}>
      <ChangeFlow
        scope={scope}
        calls={calls}
        warning={warning}
        onBack={() => setConfirmed(false)}
        onClose={onClose}
        onApplied={() => {
          refreshInterfaces(queryClient);
          onApplied?.();
        }}
        notify={toast}
        doneText={doneText ?? `Delete ${name}`}
      />
    </Modal>
  );
}
