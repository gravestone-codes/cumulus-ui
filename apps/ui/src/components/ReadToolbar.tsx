/**
 * ReadToolbar: the row above a live read — line filters on the left; read
 * age, any actions and Refresh on the right. Wraps on narrow screens.
 */
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from './ui.js';
import { timeAgo } from '../lib/format.js';

export function ReadToolbar({
  q,
  children,
  actions,
}: {
  q: Pick<UseQueryResult<unknown>, 'dataUpdatedAt' | 'isFetching' | 'refetch'>;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 20,
        rowGap: 12,
        marginBottom: 16,
      }}
    >
      {children}
      {/* margin-left:auto keeps the group right-aligned even after it wraps. */}
      <span
        style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginLeft: 'auto' }}
      >
        {q.dataUpdatedAt > 0 && (
          <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            read {timeAgo(new Date(q.dataUpdatedAt).toISOString())}
          </span>
        )}
        {actions}
        <Button auto variant="secondary" disabled={q.isFetching} onClick={() => void q.refetch()}>
          {q.isFetching ? 'Reading…' : 'Refresh'}
        </Button>
      </span>
    </div>
  );
}
