/**
 * InterfacePicker stories (CSF3). Storybook itself lands with roadmap 2.0;
 * until then this file stays dependency-free and only typechecks.
 */
import { useState, type ComponentProps } from 'react';
import { InterfacePicker } from './InterfacePicker.js';
import type { PickerOption } from '../lib/interfacePicker.js';

const options: PickerOption[] = [
  { name: 'bond1', type: 'bond', have: ['leaf01', 'SW2'] },
  { name: 'swp1', type: 'swp', have: ['leaf01', 'SW2'] },
  { name: 'swp2', type: 'swp', have: ['leaf01', 'SW2'] },
  { name: 'swp5', type: 'swp', have: ['leaf01'] },
  { name: 'swp10', type: 'swp', have: ['leaf01', 'SW2'] },
];

type Args = Omit<ComponentProps<typeof InterfacePicker>, 'value' | 'onChange'> & { initial: string[] };

function Stateful({ initial, ...props }: Args) {
  const [value, setValue] = useState(initial);
  return <InterfacePicker {...props} value={value} onChange={setValue} />;
}

export default { title: 'Pickers/InterfacePicker', component: InterfacePicker, render: Stateful };

export const SingleSwitch = {
  args: { label: 'Parent port', options, members: ['leaf01'], initial: [] } satisfies Args,
};
export const GroupMulti = {
  args: {
    label: 'Member ports',
    options: options.filter((o) => o.type === 'swp'),
    members: ['leaf01', 'SW2'],
    multiple: true,
    initial: ['swp1', 'swp5'],
  } satisfies Args,
};
export const Empty = {
  args: {
    label: 'Member ports',
    options: [],
    members: ['leaf01'],
    multiple: true,
    initial: [],
  } satisfies Args,
};
