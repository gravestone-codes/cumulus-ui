/** ScrollArea stories (design §7): bounded scroll regions keep tall panels in place. */
import { ScrollArea } from './ui.js';

export default { title: 'Atoms/ScrollArea', component: ScrollArea };

export const Tall = {
  render: () => (
    <ScrollArea maxHeight={160}>
      <div style={{ display: 'grid', gap: 8 }}>
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
            }}
          >
            Row {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};
