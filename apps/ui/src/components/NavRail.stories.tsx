/** NavRail stories (design §7 navigation): collapsible icon rail, hand-drawn icons. */
import { useState } from 'react';
import { NavRail, type NavItem } from './ui.js';

const ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/switches', label: 'Switches', icon: 'switches' },
  { to: '/groups', label: 'Groups', icon: 'switches' },
  { to: '/settings', label: 'Settings', icon: 'software' },
];

function Stateful(props: { active: string; collapsed?: boolean; scope?: { kind: 'switch' | 'group'; name: string } }) {
  const [collapsed, setCollapsed] = useState(props.collapsed ?? false);
  const [active, setActive] = useState(props.active);
  return (
    <div style={{ display: 'flex', minHeight: 420 }}>
      <NavRail
        brand={!props.scope}
        back={props.scope ? { label: 'Switches', to: '/switches' } : undefined}
        scope={props.scope}
        items={ITEMS}
        active={active}
        onNav={setActive}
        user="Ada"
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
    </div>
  );
}

export default { title: 'Atoms/NavRail', component: NavRail };

export const Global = { render: () => <Stateful active="/dashboard" /> };
export const Collapsed = { render: () => <Stateful active="/switches" collapsed /> };
export const SwitchScope = {
  render: () => <Stateful active="/switches/leaf01" scope={{ kind: 'switch', name: 'leaf01' }} />,
};
