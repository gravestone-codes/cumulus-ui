/**
 * MergedList stories (CSF3). Storybook itself lands with roadmap 2.0;
 * until then this file stays dependency-free and only typechecks.
 */
import type { ComponentProps } from 'react';
import { MergedList, type MergedColumn } from './MergedList.js';

type Args = ComponentProps<typeof MergedList>;

const columns: MergedColumn[] = [
  { key: 'type', label: 'Type', get: (o) => String(o?.['type'] ?? '') },
  { key: 'untagged', label: 'Untagged', get: (o) => String(o?.['untagged'] ?? '') },
];

const base = {
  noun: 'domains',
  columns,
  loading: false,
  refetch: () => undefined,
  storageKey: 'story.merged-list',
};

export default { title: 'Tables/MergedList', component: MergedList };

export const SingleSwitch = {
  args: {
    ...base,
    group: false,
    title: 'Bridge domains',
    members: ['leaf01'],
    objects: { leaf01: { br_default: { type: 'vlan-aware', untagged: 1 } } },
  } satisfies Args,
};
export const GroupWithDrift = {
  args: {
    ...base,
    group: true,
    title: 'Bridge domains',
    members: ['leaf01', 'SW2'],
    objects: {
      leaf01: { br_default: { type: 'vlan-aware', untagged: 1 }, br_lab: { type: 'vlan-aware' } },
      SW2: { br_default: { type: 'vlan-aware', untagged: 10 } },
    },
  } satisfies Args,
};
export const MemberUnreadable = {
  args: {
    ...base,
    group: true,
    members: ['leaf01', 'SW2'],
    objects: { leaf01: { br_default: { type: 'vlan-aware', untagged: 1 } } },
    errors: { SW2: 'switch session expired' },
  } satisfies Args,
};
