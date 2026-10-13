/** JourneyRail stories: a provisioning run mid-way, and a diagnosis that blocked on a check. */
import { useState } from 'react';
import { JourneyRail } from './JourneyRail.js';
import type { RailStatus } from '../lib/journeys.js';

export default { title: 'Molecules/JourneyRail', component: JourneyRail };

function Stateful({ steps }: { steps: Array<{ id: string; title: string; status: RailStatus }> }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  return (
    <div style={{ width: 260 }}>
      <JourneyRail steps={steps} selected={selected} onPick={setSelected} />
    </div>
  );
}

export const MidWay = {
  render: () => (
    <Stateful
      steps={[
        { id: 'vrf', title: 'Describe the VRF', status: 'done' },
        { id: 'create', title: 'Create the VRF', status: 'done' },
        { id: 'svi', title: 'SVI and gateway', status: 'current' },
        { id: 'bgp', title: 'BGP in the VRF', status: 'pending' },
        { id: 'evpn', title: 'EVPN L3 VNI', status: 'pending' },
        { id: 'routes', title: 'Gateway subnet in the VRF', status: 'pending' },
      ]}
    />
  ),
};

export const Blocked = {
  render: () => (
    <Stateful
      steps={[
        { id: 'leak', title: 'What leaked where', status: 'done' },
        { id: 'present', title: 'Prefix in the VRF', status: 'done' },
        { id: 'exporter', title: 'Which VRF exports it', status: 'done' },
        { id: 'import', title: 'Import policy', status: 'branched' },
        { id: 'fix', title: 'Choose the fix', status: 'skipped' },
        { id: 'gone', title: 'Leak gone', status: 'blocked' },
      ]}
    />
  ),
};
