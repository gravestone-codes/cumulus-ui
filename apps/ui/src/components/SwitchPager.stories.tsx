/** SwitchPager stories: one switch (no chrome) vs many (pager chrome). */
import { Meter, Facts, SubHead } from './cards.js';
import { SwitchPager } from './SwitchPager.js';

export default { title: 'Atoms/SwitchPager', component: SwitchPager };

const demo = [
  { id: 'leaf01', display_name: 'leaf01' },
  { id: 'leaf02', display_name: 'leaf02' },
  { id: 'spine01', display_name: 'spine01' },
];

const slide = (id: string, heading: string) => (
  <>
    <SubHead title={heading} value="42.0%" />
    <Meter label={`${heading} CPU utilization`} value={42} bare />
    <Facts
      items={[
        { label: 'Model', value: 'Intel Xeon D-1531' },
        { label: 'Cores', value: '6' },
        { label: 'Used', value: '42.0%' },
        { label: 'Free', value: '58.0%' },
      ]}
    />
  </>
);

export const Single = {
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <SwitchPager switches={demo.slice(0, 1)} failed={[]} label="CPU per switch">
        {slide}
      </SwitchPager>
    </div>
  ),
};

export const Many = {
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <SwitchPager switches={demo} failed={['leaf02']} label="CPU per switch">
        {slide}
      </SwitchPager>
    </div>
  ),
};
