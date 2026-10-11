/** DiffList stories (§7 dry-run): staged-branch changes in tabular numerals. */
import { DiffList } from './diff.js';

export default { title: 'Atoms/DiffList', component: DiffList };

export const Mixed = {
  args: {
    rows: [
      { path: '/interface/swp1', method: 'PATCH', before: { description: 'old' }, mine: { description: 'uplink' } },
      { path: '/interface/bond0', method: 'DELETE', before: { type: 'bond' } },
    ],
  },
};
