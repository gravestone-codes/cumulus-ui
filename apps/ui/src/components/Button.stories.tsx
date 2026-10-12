/** Button stories (design §7): inverted primary, bordered secondary, solid danger. */
import type { ComponentProps } from 'react';
import { Button } from './ui.js';

type Args = ComponentProps<typeof Button>;

export default { title: 'Atoms/Button', component: Button };

export const Primary = { args: { children: 'Apply' } satisfies Args };
export const Secondary = { args: { children: 'Cancel', variant: 'secondary' } satisfies Args };
export const Danger = { args: { children: 'Delete', variant: 'danger' } satisfies Args };
export const Auto = {
  args: { children: 'Discard and stage mine', variant: 'secondary', auto: true } satisfies Args,
};
export const Disabled = { args: { children: 'Apply', disabled: true } satisfies Args };
