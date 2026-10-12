/** LineField stories (design §7 forms): underline line-fields, label only, one error line. */
import { useState } from 'react';
import { LineField } from './ui.js';

export default { title: 'Atoms/LineField', component: LineField };

function StatefulField(props: { label: string; error?: string; value?: string }) {
  const [value, setValue] = useState(props.value ?? '');
  return (
    <LineField
      label={props.label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      error={props.error}
    />
  );
}

export const Plain = { render: () => <StatefulField label="Description" /> };
export const WithValue = { render: () => <StatefulField label="Description" value="uplink to spine" /> };
export const Invalid = {
  render: () => <StatefulField label="MTU" value="100000" error="Must be at most 9216." />,
};
