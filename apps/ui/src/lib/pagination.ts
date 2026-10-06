/**
 * Client-side pagination over a filtered/sorted array — ported from GRG's
 * usePagination. Page size persists per table via localStorage. Sizes follow
 * the fleet convention: 10, 15, 20, 25, 50, 100, 200.
 */
import { useState } from 'react';

export const PAGE_SIZES = [10, 15, 20, 25, 50, 100, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

const isPageSize = (n: number): n is PageSize => (PAGE_SIZES as readonly number[]).includes(n);

export function usePagination<T>(items: T[], storageKey: string) {
  const [pageSize, setPageSizeState] = useState<PageSize>(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return isPageSize(saved) ? saved : 10;
  });
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  const setPageSize = (n: PageSize) => {
    localStorage.setItem(storageKey, String(n));
    setPageSizeState(n);
    setPage(1);
  };

  return {
    page: clampedPage,
    setPage,
    pageSize,
    setPageSize,
    pageItems,
    totalPages,
    total: items.length,
    start,
  };
}
