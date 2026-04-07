"use client";

interface SyncSettingsBlockProps {
  enabled: boolean;
  intervalMinutes: number;
  lastSyncedAt?: string | null;
  lastImported?: number | null;
  onToggle: (v: boolean) => void;
  onIntervalChange: (minutes: number) => void;
}

const INTERVALS: { label: string; minutes: number }[] = [
  { label: "Every 15 minutes", minutes: 15 },
  { label: "Every 30 minutes", minutes: 30 },
  { label: "Every hour", minutes: 60 },
  { label: "Every 4 hours", minutes: 240 },
  { label: "Every 12 hours", minutes: 720 },
  { label: "Once a day", minutes: 1440 },
];

function relativeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "never";
  }
}

export default function SyncSettingsBlock({
  enabled, intervalMinutes, lastSyncedAt, lastImported,
  onToggle, onIntervalChange,
}: SyncSettingsBlockProps) {
  return (
    <div style={{
      marginTop: 12, padding: 14, borderRadius: 10,
      background: enabled ? "linear-gradient(180deg, var(--green-light), #fff)" : "var(--gray-50)",
      border: `1px solid ${enabled ? "var(--green)" : "var(--gray-200)"}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: enabled ? "var(--green)" : "var(--gray-200)",
          color: enabled ? "var(--dark)" : "var(--gray-500)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--dark)" }}>
              Auto-sync new items
            </div>
            <Toggle checked={enabled} onChange={onToggle} />
          </div>
          <div style={{ fontSize: 11, color: "var(--gray-500)", lineHeight: 1.5 }}>
            Run the current filters automatically in the background and import any new matches into the project.
          </div>

          {enabled && (
            <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={intervalMinutes}
                onChange={(e) => onIntervalChange(parseInt(e.target.value))}
                style={{
                  padding: "6px 10px", borderRadius: 7,
                  border: "1px solid var(--gray-200)", background: "#fff",
                  fontSize: 11, fontWeight: 600, color: "var(--dark)",
                  fontFamily: "var(--font)", outline: "none",
                }}
              >
                {INTERVALS.map((i) => (
                  <option key={i.minutes} value={i.minutes}>{i.label}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "var(--gray-500)" }}>
                Last sync: <strong style={{ color: "var(--dark)" }}>{relativeAgo(lastSyncedAt)}</strong>
                {typeof lastImported === "number" && lastImported > 0 && (
                  <span> · imported <strong style={{ color: "var(--green-hover)" }}>{lastImported}</strong></span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span
      onClick={() => onChange(!checked)}
      style={{
        width: 30, height: 17, borderRadius: 9, padding: 2, flexShrink: 0,
        background: checked ? "var(--green-hover)" : "var(--gray-200)",
        transition: "background 0.15s", display: "inline-flex", alignItems: "center",
        cursor: "pointer",
      }}
    >
      <span style={{
        width: 13, height: 13, borderRadius: "50%", background: "#fff",
        transform: checked ? "translateX(13px)" : "translateX(0)",
        transition: "transform 0.15s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
      }} />
    </span>
  );
}
