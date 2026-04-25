"use client";

// Shared filter dropdown — the .fd / .fd-trigger / .fd-menu pattern
// styled in panels.css. Used by every tab's filter row (priority,
// status, severity, type, …). The data-v / data-value attributes on
// trigger and menu options light up CSS dot colors that match the
// rest of the design (must=red, should=amber, etc.).

import { useEffect, useRef, useState } from "react";


export interface FilterDropdownOption {
  value: string;
  label: string;
}


interface FilterDropdownProps {
  label: string;
  value: string;
  options: FilterDropdownOption[];
  onChange: (value: string) => void;
}


export function FilterDropdown({
  label, value, options, onChange,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const isActive = value && value !== "all";
  const activeOpt = options.find((o) => o.value === value);

  return (
    <div className={`fd${open ? " open" : ""}`} ref={ref}>
      <button
        type="button"
        className={`fd-trigger${isActive ? " has-value" : ""}`}
        data-v={isActive ? value : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="fd-value-dot" />
        <span className="fd-label">{isActive ? activeOpt?.label : label}</span>
        <svg className="fd-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
        {isActive && (
          <span
            className="fd-clear"
            onClick={(e) => { e.stopPropagation(); onChange("all"); setOpen(false); }}
            title="Clear filter"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </span>
        )}
      </button>
      {open && (
        <div className="fd-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`fd-opt${opt.value === value ? " active" : ""}`}
              data-value={opt.value === "all" ? undefined : opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <span className="opt-dot" />
              {opt.label}
              <svg className="opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
