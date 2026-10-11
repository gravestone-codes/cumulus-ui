/** LineDropdown stories (design §7): underline trigger, portal menu, search past 7 items. */
import { useState } from 'react';
import { LineDropdown } from './ui.js';

function Stateful(props: { label: string; options: Array<{ value: string; label: string }> }) {
  const [value, setValue] = useState(props.options[0]?.value ?? '');
  return <LineDropdown label={props.label} options={props.options} value={value} onChange={setValue} />;
}

const SPEEDS = ['10G', '25G', '40G', '100G', '200G', '400G'].map((s) => ({ value: s, label: s }));
const VLANS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `VLAN ${i + 1}` }));

export default { title: 'Atoms/LineDropdown', component: LineDropdown };

export const FewOptions = { render: () => <Stateful label="Speed" options={SPEEDS} /> };
export const Searchable = { render: () => <Stateful label="Access VLAN" options={VLANS} /> };
