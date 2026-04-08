"use client";

import { useState, useMemo } from "react";
import { usePersistedState } from "./persistedState";

export type SortDir = "asc" | "desc";

export interface TableState {
  search: string;
  setSearch: (v: string) => void;
  sortKey: string;
  sortDir: SortDir;
  setSort: (key: string) => void;
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (s: number) => void;
}

/**
 * Persisted-per-project table state for search / sort / page / pageSize.
 * Each tab gets its own storage namespace via the `key` parameter.
 *
 * Usage:
 *   const t = useTableState(`reqs:${projectId}`, "req_id", "asc", 25);
 *   const visible = paginateAndSort(items, t, ["title", "req_id"], (r) => r.req_id);
 */
export function useTableState(
  key: string,
  defaultSortKey: string,
  defaultSortDir: SortDir = "asc",
  defaultPageSize: number = 25,
): TableState {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = usePersistedState<string>(`${key}:sortKey`, defaultSortKey);
  const [sortDir, setSortDir] = usePersistedState<SortDir>(`${key}:sortDir`, defaultSortDir);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistedState<number>(`${key}:pageSize`, defaultPageSize);

  const setSort = (k: string) => {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(1);
  };

  return {
    search,
    setSearch: (v) => { setSearch(v); setPage(1); },
    sortKey,
    sortDir,
    setSort,
    page,
    setPage,
    pageSize,
    setPageSize: (s) => { setPageSize(s); setPage(1); },
  };
}

/**
 * Filter, sort, and paginate a list in one pass. Returns the visible
 * slice plus the totals needed to render the page navigator.
 *
 * @param items     The full source array
 * @param state     A TableState from useTableState()
 * @param searchFields  Field names to match against the search query
 * @param getSortValue  Optional accessor returning the value to sort by
 *                       (defaults to indexing item[sortKey])
 */
export function applyTableState<T extends Record<string, any>>(
  items: T[],
  state: TableState,
  searchFields: (keyof T)[],
  getSortValue?: (item: T, key: string) => any,
): {
  visible: T[];
  filteredCount: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
} {
  // Filter
  const q = state.search.trim().toLowerCase();
  const filtered = q
    ? items.filter((item) =>
        searchFields.some((f) => {
          const v = item[f];
          if (v == null) return false;
          return String(v).toLowerCase().includes(q);
        }),
      )
    : items;

  // Sort — primary key is "unread first" (so the user always sees what
  // needs attention at the top of page 1), secondary key is the column
  // the user clicked. This applies to any item that has a `seen_at`
  // field; items without are unaffected.
  const sorted = [...filtered].sort((a, b) => {
    // Unread always comes first
    const aHasField = "seen_at" in a;
    const bHasField = "seen_at" in b;
    if (aHasField && bHasField) {
      const aUnread = a.seen_at == null ? 0 : 1;
      const bUnread = b.seen_at == null ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
    }

    // Then by the user's chosen column
    const va = getSortValue ? getSortValue(a, state.sortKey) : (a as any)[state.sortKey];
    const vb = getSortValue ? getSortValue(b, state.sortKey) : (b as any)[state.sortKey];
    if (va == null && vb == null) return 0;
    if (va == null) return state.sortDir === "asc" ? 1 : -1;
    if (vb == null) return state.sortDir === "asc" ? -1 : 1;
    if (typeof va === "number" && typeof vb === "number") {
      return state.sortDir === "asc" ? va - vb : vb - va;
    }
    const sa = String(va).toLowerCase();
    const sb = String(vb).toLowerCase();
    if (sa < sb) return state.sortDir === "asc" ? -1 : 1;
    if (sa > sb) return state.sortDir === "asc" ? 1 : -1;
    return 0;
  });

  // Paginate
  const filteredCount = sorted.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / state.pageSize));
  const safePage = Math.min(state.page, totalPages);
  const pageStart = (safePage - 1) * state.pageSize;
  const pageEnd = Math.min(pageStart + state.pageSize, filteredCount);
  const visible = sorted.slice(pageStart, pageEnd);

  return { visible, filteredCount, totalPages, pageStart, pageEnd };
}


// Re-exported for caller convenience
export { useMemo };
