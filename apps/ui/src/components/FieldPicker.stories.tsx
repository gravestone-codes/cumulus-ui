/** FieldPicker stories (roadmap 2.1/R7): checked fields drive columns and `?include`. */
import { useState } from 'react';
import { FieldPicker } from './FieldPicker.js';
import type { SchemaLeaf } from '../lib/schema.js';

const LEAVES: SchemaLeaf[] = [
  { path: 'type', label: 'Type', kind: 'enum' },
  { path: 'description', label: 'Description', kind: 'string' },
  { path: 'link/speed', label: 'Speed', kind: 'string' },
  { path: 'link/mtu', label: 'Mtu', kind: 'integer' },
  { path: 'link/state', label: 'State', kind: 'enum' },
];

function Stateful({ initial }: { initial: string[] }) {
  const [checked, setChecked] = useState(initial);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>{checked.length} picked</span>
      <FieldPicker
        leaves={LEAVES}
        checked={checked}
        defaults={['type', 'description']}
        onChange={setChecked}
      />
    </div>
  );
}

export default { title: 'Tables/FieldPicker', component: FieldPicker };

export const Defaults = { render: () => <Stateful initial={['type', 'description']} /> };
