/** DataTable stories (design §7 tables): search, funnel filters, pin/reorder, pagination. */
import { Badge } from './ui.js';
import { DataTable, type GridColumn } from './DataTable.js';

type Row = { id: string; state: string; speed: string; mtu: string };

const COLS: GridColumn<Row>[] = [
  { key: 'id', label: 'Name', always: true, value: (r) => r.id },
  {
    key: 'state',
    label: 'State',
    value: (r) => r.state,
    render: (r) => (
      <Badge tone={r.state === 'up' ? 'pass' : r.state === 'down' ? 'fail' : 'muted'}>{r.state}</Badge>
    ),
  },
  { key: 'speed', label: 'Speed', value: (r) => r.speed },
  { key: 'mtu', label: 'MTU', value: (r) => r.mtu },
];

const ROWS: Row[] = Array.from({ length: 14 }, (_, i) => ({
  id: `swp${i + 1}`,
  state: i % 4 === 3 ? 'down' : 'up',
  speed: i % 2 === 0 ? '100G' : '25G',
  mtu: i % 3 === 0 ? '9216' : '1500',
}));

export default { title: 'Tables/DataTable', component: DataTable };

export const Paginated = {
  args: { cols: COLS, rows: ROWS, storageKey: 'story.data-table' },
};
export const Empty = {
  args: { cols: COLS, rows: [], storageKey: 'story.data-table-empty', emptyIcon: 'interfaces' },
};
