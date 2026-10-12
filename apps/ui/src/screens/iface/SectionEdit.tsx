/**
 * Section edit (3A.7, design §4A + §6B): the interface-domain adapter over
 * ResourceForm (R9). Curates the hand-written section lists (labels,
 * per-switch flags, live `/vrf` options, link-down warnings) into planned
 * fields; the modal, drafts, review and apply live in ResourceForm.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { Alert } from '../../components/ui.js';
import { choicesOf, decodeValue, invalidReason, kindOf, leafSchema } from '../../lib/fieldSchema.js';
import { getPath } from '../../lib/format.js';
import type { FormField, SharedDraft } from '../../lib/plan.js';
import { usePerSwitch, type Scope } from './scope.js';
import { fieldPath, type SectionDef } from './sections.js';
import { ResourceForm } from './ResourceForm.js';

/** A section needs the spec unless it sits at the object root with every leaf kind-hinted. */
const needsSchema = (s: SectionDef) => s.base !== '' || s.fields.some((f) => !f.kind);

/** Spec schema for a section's subtree; cached per collection, since every object shares it. */
export function useSectionSchema(objectPath: string, section: SectionDef) {
  const collection = objectPath.slice(0, objectPath.lastIndexOf('/'));
  return useQuery({
    queryKey: ['spec-fields', collection, section.base],
    queryFn: () => api.fields(section.base ? `${objectPath}/${section.base}` : objectPath, 'PATCH'),
    enabled: needsSchema(section),
    staleTime: Infinity,
  });
}

/** Choices fed by a live collection (`/vrf`): names every present member has. */
function useLiveOptions(scope: Scope, path: string | undefined, members: string[]): string[] | null {
  const read = usePerSwitch<Record<string, unknown>>(scope, path ?? '/', { rev: 'applied', enabled: !!path });
  if (!path || read.loading) return null;
  const sets = members.map((m) => Object.keys(read.objects[m] ?? {}));
  const [first = [], ...rest] = sets;
  return first.filter((k) => rest.every((s) => s.includes(k))).sort();
}

export function SectionEdit({
  scope,
  objectPath,
  name,
  section,
  cfg,
  present,
  preset = {},
  onClose,
  onApplied,
  notify,
}: {
  scope: Scope;
  /** NVUE path of the edited object; every PATCH goes here. */
  objectPath: string;
  /** Object name in titles and warnings. */
  name: string;
  section: SectionDef;
  /** Applied config per switch (object root). */
  cfg: Record<string, Record<string, unknown> | undefined>;
  /** Members that have this object. */
  present: string[];
  /** Pre-filled shared values (Align all to …). */
  preset?: SharedDraft;
  onClose: () => void;
  onApplied: () => void;
  notify: (tone: 'pass' | 'warn' | 'fail', text: string) => void;
}) {
  const schema = useSectionSchema(objectPath, section);
  const liveField = section.fields.find((f) => f.optionsFrom);
  const liveOptions = useLiveOptions(scope, liveField?.optionsFrom, present);

  const sectionSchema = schema.data?.schema;
  const fields: FormField[] = section.fields.map((f) => {
    const s = leafSchema(sectionSchema, f.leaf);
    const kind = kindOf(s, f.kind);
    return {
      path: fieldPath(section, f),
      label: f.label,
      kind,
      choices: f.optionsFrom ? (liveOptions ?? []) : choicesOf(s),
      perSwitch: !!f.perSwitch && scope.kind === 'group' && present.length > 1,
      invalid: (t: string) => invalidReason(kind, t, s),
      schema: s,
    };
  });

  function warning(shared: SharedDraft) {
    const goingDown =
      shared['link/state'] === 'down' &&
      present.some((sw) => decodeValue('choice', getPath(cfg[sw], 'link/state')) !== 'down');
    if (!goingDown) return null;
    const mgmt = present.some((sw) => getPath(cfg[sw], 'ip/vrf') === 'mgmt');
    return (
      <Alert tone="warn">
        {mgmt
          ? `${name} is a management port — taking it down cuts this app off from the switch.`
          : `Taking ${name} down stops all traffic on it.`}
      </Alert>
    );
  }

  const loading = (needsSchema(section) && schema.isPending) || (liveField && liveOptions === null);

  return (
    <ResourceForm
      scope={scope}
      objectPath={objectPath}
      name={name}
      title={section.title}
      fields={fields}
      cfg={cfg}
      present={present}
      preset={preset}
      warning={warning}
      pending={loading}
      doneText={`${section.title} on ${name}`}
      onClose={onClose}
      onApplied={onApplied}
      notify={notify}
    />
  );
}
