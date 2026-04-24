"use client";

import React from "react";
import type { TableState } from "@/lib/tableState";

/* ── Search input ─────────────────────────────────────── */

export function TableSearch({
  state,
  placeholder = "Search…",
  width = 220,
}: {
  state: TableState;
  placeholder?: string;
  width?: number;
}) {
  return (
    <div style={{ position: "relative", width }}>
      <svg
        viewBox="0 0 24 24"
        style={{
          position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
          width: 12, height: 12, color: "#94a3b8", stroke: "currentColor", fill: "none", strokeWidth: 2,
        }}
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        placeholder={placeholder}
        value={state.search}
        onChange={(e) => state.setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: "5px 8px 5px 26px",
          border: "1px solid var(--gray-200)",
          borderRadius: 6,
          fontSize: 11,
          outline: "none",
          fontFamily: "var(--font)",
        }}
      />
      {state.search && (
        <button
          onClick={() => state.setSearch("")}
          title="Clear search"
          style={{
            position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
            width: 16, height: 16, padding: 0, border: "none",
            background: "none", color: "#94a3b8", cursor: "pointer",
            fontSize: 14, lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ── Sortable column header ──────────────────────────── */

export function SortableHeader({
  label,
  columnKey,
  state,
  width,
  align = "left",
}: {
  label: string;
  columnKey: string;
  state: TableState;
  width?: number;
  align?: "left" | "right" | "center";
}) {
  const active = state.sortKey === columnKey;
  return (
    <th
      onClick={() => state.setSort(columnKey)}
      style={{
        cursor: "pointer",
        userSelect: "none",
        textAlign: align,
        width,
        whiteSpace: "nowrap",
      }}
      title={`Sort by ${label}`}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        {label}
        <span style={{
          fontSize: 9,
          color: active ? "var(--green)" : "var(--gray-300, #cbd5e1)",
          width: 8,
        }}>
          {active ? (state.sortDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
    </th>
  );
}

/* ── Pagination footer ───────────────────────────────── */

export function Pagination({
  state,
  total,
  pageStart,
  pageEnd,
  totalPages,
}: {
  state: TableState;
  total: number;
  pageStart: number;
  pageEnd: number;
  totalPages: number;
}) {
  if (total === 0) return null;
  const canPrev = state.page > 1;
  const canNext = state.page < totalPages;

  return (
    <div className="reqs-footer">
      <span>
        Showing <strong>{pageStart + 1}–{pageEnd}</strong> of <strong>{total}</strong>
      </span>

      <div style={{ flex: 1 }} />

      <select
        className="pager-size"
        value={state.pageSize}
        onChange={(e) => state.setPageSize(Number(e.target.value))}
        title="Items per page"
      >
        {[10, 25, 50, 100].map((n) => (
          <option key={n} value={n}>{n}/page</option>
        ))}
      </select>

      <div className="pager">
        <button onClick={() => state.setPage(1)} disabled={!canPrev} title="First page">«</button>
        <button onClick={() => state.setPage(state.page - 1)} disabled={!canPrev}>‹</button>
        <span className="current">{state.page}</span>
        <span className="pager-sep">/ {totalPages}</span>
        <button onClick={() => state.setPage(state.page + 1)} disabled={!canNext}>›</button>
        <button onClick={() => state.setPage(totalPages)} disabled={!canNext} title="Last page">»</button>
      </div>
    </div>
  );
}
