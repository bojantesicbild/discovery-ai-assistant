"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  type ApiTokenSummary,
  type ApiTokenWithPlaintext,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "@/lib/api";


export default function TokensPage() {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRevoked, setShowRevoked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [justCreated, setJustCreated] = useState<ApiTokenWithPlaintext | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listApiTokens({ includeRevoked: showRevoked });
      setTokens(res.tokens);
    } catch {
      // Surface via empty state — the user can retry.
    }
    setLoading(false);
  }, [showRevoked]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const row = await createApiToken({ name });
      setJustCreated(row);
      setNewName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(t: ApiTokenSummary) {
    if (!confirm(`Revoke token "${t.name}"? This cannot be undone — any MCP still using it will fail on its next startup.`)) {
      return;
    }
    setBusyId(t.id);
    try {
      await revokeApiToken(t.id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopy() {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: do nothing — the token is visible on-screen.
    }
  }

  const mcpSnippet = justCreated
    ? JSON.stringify({
        mcpServers: {
          discovery: {
            env: {
              DISCOVERY_API_TOKEN: justCreated.token,
              DISCOVERY_API_URL: typeof window !== "undefined" ? window.location.origin.replace(/:\d+$/, ":8008") : "http://localhost:8008",
              DISCOVERY_PROJECT_ID: "<project-uuid>",
            },
          },
        },
      }, null, 2)
    : "";

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Personal Access Tokens</h1>
          <p className="text-sm text-gray-500 mt-1">
            Use these to authenticate the Discovery MCP from a terminal Claude Code session.
            Web chat and pipeline workers already inherit your identity automatically.
          </p>
        </div>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← Back</Link>
      </div>

      {/* Copy-once modal — shows immediately after creation, never again */}
      {justCreated && (
        <div className="mb-6 rounded-xl border border-green-300 bg-green-50 p-5">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="font-semibold text-green-900">Token created — copy it now</div>
              <div className="text-xs text-green-700 mt-1">
                This is the only time the plaintext will be shown. If you lose it, revoke and create a new one.
              </div>
            </div>
            <button
              onClick={() => setJustCreated(null)}
              className="text-green-700 hover:text-green-900 text-sm"
            >
              Done
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-200 rounded px-3 py-2 text-sm font-mono break-all">
              {justCreated.token}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 px-3 py-2 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <details className="mt-3">
            <summary className="text-xs text-green-800 cursor-pointer hover:underline">
              Show `.mcp.json` snippet for terminal setup
            </summary>
            <pre className="mt-2 text-xs bg-white border border-green-200 rounded p-3 overflow-x-auto">
              {mcpSnippet}
            </pre>
            <p className="text-xs text-green-700 mt-2">
              Replace <code>&lt;project-uuid&gt;</code> with the project id you want the terminal session to target.
            </p>
          </details>
        </div>
      )}

      {/* Create form */}
      <form onSubmit={handleCreate} className="mb-6 rounded-xl border bg-white p-5">
        <label className="block text-sm font-medium mb-2" htmlFor="token-name">
          Token name
        </label>
        <div className="flex gap-2">
          <input
            id="token-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder='e.g. "laptop CLI", "codespace"'
            className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={100}
            disabled={creating}
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="shrink-0 px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create token"}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Names are just labels — pick one that reminds you where you'll use the token.
        </p>
      </form>

      {/* List */}
      <div className="rounded-xl border bg-white">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="text-sm font-medium">
            {tokens.length} token{tokens.length === 1 ? "" : "s"}
          </div>
          <label className="text-xs text-gray-600 flex items-center gap-2">
            <input
              type="checkbox"
              checked={showRevoked}
              onChange={(e) => setShowRevoked(e.target.checked)}
              className="rounded"
            />
            Show revoked
          </label>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : tokens.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No tokens yet. Create one above.</div>
        ) : (
          <ul className="divide-y">
            {tokens.map((t) => (
              <TokenRow
                key={t.id}
                token={t}
                busy={busyId === t.id}
                onRevoke={() => handleRevoke(t)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}


function TokenRow({
  token,
  busy,
  onRevoke,
}: {
  token: ApiTokenSummary;
  busy: boolean;
  onRevoke: () => void;
}) {
  const isRevoked = token.revoked_at !== null;
  return (
    <li className={`p-4 flex items-center gap-4 ${isRevoked ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{token.name}</span>
          {isRevoked && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-semibold">
              REVOKED
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-1 flex gap-3 flex-wrap">
          <span>Created {fmtDate(token.created_at)}</span>
          {token.last_used_at && <span>Last used {fmtRelative(token.last_used_at)}</span>}
          {!token.last_used_at && !isRevoked && <span className="italic">Never used</span>}
          {token.expires_at && <span>Expires {fmtDate(token.expires_at)}</span>}
          {isRevoked && <span>Revoked {fmtDate(token.revoked_at)}</span>}
        </div>
      </div>
      {!isRevoked && (
        <button
          disabled={busy}
          onClick={onRevoke}
          className="shrink-0 text-xs px-3 py-1.5 rounded border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
        >
          {busy ? "Revoking…" : "Revoke"}
        </button>
      )}
    </li>
  );
}


function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}


function fmtRelative(iso: string): string {
  try {
    const ts = new Date(iso).getTime();
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 14) return `${days}d ago`;
    return fmtDate(iso);
  } catch {
    return iso;
  }
}
