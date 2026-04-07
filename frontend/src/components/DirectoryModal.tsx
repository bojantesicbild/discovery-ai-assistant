"use client";

import { useEffect, useState } from "react";
import {
  getConnectorCatalog,
  listIntegrations,
  addIntegration,
  removeIntegration,
  startGoogleAuthorize,
  listLinkedSlackChannels,
  listAvailableSlackChannels,
  linkSlackChannel,
  unlinkSlackChannel,
  CatalogConnector,
  ProjectIntegrationSummary,
  LinkedSlackChannel,
  AvailableSlackChannel,
} from "@/lib/api";

interface DirectoryModalProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

type Tab = "connectors" | "skills" | "plugins";

export default function DirectoryModal({ projectId, open, onClose }: DirectoryModalProps) {
  const [tab, setTab] = useState<Tab>("connectors");
  const [catalog, setCatalog] = useState<CatalogConnector[]>([]);
  const [installed, setInstalled] = useState<ProjectIntegrationSummary[]>([]);
  const [selected, setSelected] = useState<CatalogConnector | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([getConnectorCatalog(), listIntegrations(projectId)])
      .then(([cat, inst]) => {
        setCatalog(cat.connectors || []);
        setInstalled(inst.integrations || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, projectId]);

  // Handle OAuth callback redirect message
  useEffect(() => {
    if (!open) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("integration_connected") === "google") {
      // Refresh the installed list
      listIntegrations(projectId).then((d) => setInstalled(d.integrations || []));
      // Clean the URL
      url.searchParams.delete("integration_connected");
      window.history.replaceState({}, "", url.toString());
    }
    const err = url.searchParams.get("integration_error");
    if (err) {
      alert(`Integration error: ${err}`);
      url.searchParams.delete("integration_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, [open, projectId]);

  if (!open) return null;

  const installedMap = new Map(installed.map((i) => [i.connector_id, i]));

  // Group gmail + google_drive under one "Google Workspace" card
  const filtered = catalog.filter((c) =>
    query ? c.name.toLowerCase().includes(query.toLowerCase()) || c.short_description.toLowerCase().includes(query.toLowerCase()) : true
  );

  async function handleRemove(connectorId: string) {
    if (!confirm(`Disconnect ${connectorId}?`)) return;
    await removeIntegration(projectId, connectorId);
    const d = await listIntegrations(projectId);
    setInstalled(d.integrations || []);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 14, width: "min(960px, 92vw)",
          maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.24)", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 28px 16px", borderBottom: "1px solid var(--gray-100)" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", flex: 1 }}>Directory</div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: "none",
              background: "var(--gray-50)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: "var(--gray-600)", fill: "none", strokeWidth: 2 }}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Sidebar tabs */}
          <div style={{ width: 220, borderRight: "1px solid var(--gray-100)", padding: 16, background: "#fafbfc" }}>
            {([
              { key: "skills", label: "Skills", icon: "book" },
              { key: "connectors", label: "Connectors", icon: "plug" },
              { key: "plugins", label: "Plugins", icon: "puzzle" },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  padding: "10px 12px", borderRadius: 8, border: "none",
                  background: tab === t.key ? "#fff" : "transparent",
                  boxShadow: tab === t.key ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                  cursor: "pointer", fontSize: 13, fontWeight: 600,
                  color: tab === t.key ? "#0f172a" : "#64748b",
                  marginBottom: 4, textAlign: "left",
                }}
              >
                <TabIcon name={t.icon} active={tab === t.key} />
                {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, padding: 24, overflow: "auto", minWidth: 0 }}>
            {tab === "connectors" && (
              <>
                {/* Search + filter */}
                <div style={{ position: "relative", marginBottom: 20 }}>
                  <svg viewBox="0 0 24 24" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "#94a3b8", stroke: "currentColor", fill: "none", strokeWidth: 2 }}>
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search connectors..."
                    style={{
                      width: "100%", padding: "10px 12px 10px 38px",
                      border: "1px solid var(--gray-200)", borderRadius: 10,
                      fontSize: 13, outline: "none", fontFamily: "var(--font)",
                    }}
                  />
                </div>

                {loading && <div style={{ color: "#64748b", fontSize: 13 }}>Loading…</div>}

                {!loading && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
                    {filtered.map((c) => {
                      const inst = installedMap.get(c.id);
                      return (
                        <ConnectorCard
                          key={c.id}
                          connector={c}
                          installed={inst}
                          onAdd={() => setSelected(c)}
                          onRemove={() => handleRemove(c.id)}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Slack inbound — linked channels section */}
                {installedMap.get("slack")?.status === "active" && (
                  <SlackChannelsSection projectId={projectId} />
                )}
              </>
            )}

            {tab === "skills" && (
              <ComingSoon
                title="Skills"
                description="Project-specific instructions and workflows the assistant can invoke. Browse and enable discovery skills here."
              />
            )}

            {tab === "plugins" && (
              <ComingSoon
                title="Plugins"
                description="Custom tools and slash commands. Extend the assistant with your own plugins."
              />
            )}
          </div>
        </div>
      </div>

      {/* Setup drawer */}
      {selected && (
        <ConnectorSetupDrawer
          projectId={projectId}
          connector={selected}
          onClose={() => setSelected(null)}
          onDone={async () => {
            const d = await listIntegrations(projectId);
            setInstalled(d.integrations || []);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}


/* ── Connector card ── */

function ConnectorCard({ connector, installed, onAdd, onRemove }: {
  connector: CatalogConnector;
  installed?: ProjectIntegrationSummary;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const isActive = installed?.status === "active";
  const email = installed?.metadata && (installed.metadata as any).email;

  return (
    <div style={{
      border: "1px solid var(--gray-200)", borderRadius: 12,
      padding: 16, background: "#fff",
      display: "flex", flexDirection: "column", gap: 10,
      transition: "all 0.15s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ConnectorIcon provider={connector.provider} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{connector.name}</div>
          {isActive && (
            <div style={{ fontSize: 10, fontWeight: 600, color: "#16a34a", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a" }} />
              Connected{email ? ` · ${email}` : ""}
            </div>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5, minHeight: 36 }}>
        {connector.short_description}
      </div>
      {isActive ? (
        <button
          onClick={onRemove}
          style={{
            padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: "#fff", color: "#dc2626",
            border: "1px solid #fecaca", cursor: "pointer",
          }}
        >
          Disconnect
        </button>
      ) : (
        <button
          onClick={onAdd}
          style={{
            padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: "#0f172a", color: "#fff", border: "none", cursor: "pointer",
          }}
        >
          + Add
        </button>
      )}
    </div>
  );
}


/* ── Setup drawer ── */

function ConnectorSetupDrawer({ projectId, connector, onClose, onDone }: {
  projectId: string;
  connector: CatalogConnector;
  onClose: () => void;
  onDone: () => void;
}) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      if (connector.auth.type === "oauth_google") {
        const { authorize_url } = await startGoogleAuthorize(projectId, connector.id);
        window.location.href = authorize_url;
        return;
      }
      await addIntegration(projectId, connector.id, formValues);
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to connect";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)",
        zIndex: 1100, display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(480px, 94vw)", background: "#fff", height: "100%",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--gray-100)", display: "flex", alignItems: "center", gap: 12 }}>
          <ConnectorIcon provider={connector.provider} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Connect {connector.name}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{connector.category}</div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "var(--gray-50)", cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
          <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, marginBottom: 20 }}>
            {connector.long_description}
          </div>

          {/* Permissions */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#64748b", marginBottom: 8, letterSpacing: 0.5 }}>
              Permissions
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {connector.permissions.map((p, i) => (
                <li key={i} style={{ fontSize: 12, color: "#475569", padding: "4px 0", display: "flex", gap: 8 }}>
                  <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, stroke: "#16a34a", fill: "none", strokeWidth: 2.5 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          {/* OAuth: one-click button */}
          {connector.auth.type === "oauth_google" && (
            <div style={{
              padding: 16, background: "#f8fafc", borderRadius: 10,
              border: "1px solid var(--gray-100)", marginBottom: 16,
            }}>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
                Clicking <strong>Connect Google</strong> opens Google&rsquo;s consent screen in a new window.
                Both Gmail and Google Drive will be enabled after you grant access.
              </div>
            </div>
          )}

          {/* Token paste: form + instructions */}
          {connector.auth.type === "token_paste" && (
            <>
              {connector.auth.instructions_steps && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#64748b", marginBottom: 8, letterSpacing: 0.5 }}>
                    Setup
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: "#475569", lineHeight: 1.7 }}>
                    {connector.auth.instructions_steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                  {connector.auth.instructions_url && (
                    <a
                      href={connector.auth.instructions_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 12, color: "#0891b2", display: "inline-block", marginTop: 8 }}
                    >
                      Open setup page →
                    </a>
                  )}
                </div>
              )}
              {(connector.auth.fields || []).map((f) => (
                <div key={f.key} style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>
                    {f.label}{f.required && <span style={{ color: "#dc2626" }}> *</span>}
                  </label>
                  <input
                    type={f.secret ? "password" : "text"}
                    placeholder={f.placeholder}
                    value={formValues[f.key] || ""}
                    onChange={(e) => setFormValues({ ...formValues, [f.key]: e.target.value })}
                    style={{
                      width: "100%", padding: "10px 12px", border: "1px solid var(--gray-200)",
                      borderRadius: 8, fontSize: 13, outline: "none", fontFamily: "var(--font)",
                    }}
                  />
                  {f.help && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{f.help}</div>}
                </div>
              ))}
            </>
          )}

          {error && !/Google OAuth not configured/i.test(error) && (
            <div style={{ padding: 10, borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: 12, marginTop: 12 }}>
              {error}
            </div>
          )}

          {error && /Google OAuth not configured/i.test(error) && (
            <GoogleSetupHelp />
          )}
        </div>

        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--gray-100)", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#475569" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#0f172a", color: "#fff", fontSize: 13, fontWeight: 600, cursor: submitting ? "wait" : "pointer", opacity: submitting ? 0.6 : 1 }}
          >
            {connector.auth.type === "oauth_google" ? "Connect Google" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ── Google OAuth guided setup ── */

function GoogleSetupHelp() {
  const [copied, setCopied] = useState<string | null>(null);
  const redirectUri = "http://localhost:8000/api/integrations/google/callback";
  const envSnippet = `GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com\nGOOGLE_OAUTH_CLIENT_SECRET=your-client-secret\nGOOGLE_OAUTH_REDIRECT_URI=${redirectUri}`;

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  const steps = [
    { num: 1, title: "Open Google Cloud Console", body: (
      <>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", fontWeight: 600 }}>console.cloud.google.com/apis/credentials</a> and create (or select) a project.</>
    )},
    { num: 2, title: "Enable the APIs", body: (
      <>In <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", fontWeight: 600 }}>APIs &amp; Services → Library</a>, enable <strong>Gmail API</strong> and <strong>Google Drive API</strong>.</>
    )},
    { num: 3, title: "Configure consent screen", body: (
      <>In <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", fontWeight: 600 }}>OAuth consent screen</a>, choose <strong>External</strong>, fill in app name + your email, and add yourself under <strong>Test users</strong>.</>
    )},
    { num: 4, title: "Create OAuth client ID", body: (
      <>Back in Credentials → <strong>Create Credentials → OAuth client ID</strong> → <strong>Web application</strong>. Add the redirect URI below.</>
    )},
    { num: 5, title: "Add redirect URI", body: (
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
        <code style={{ flex: 1, padding: "6px 10px", background: "#0f172a", color: "#a7f3d0", fontSize: 11, borderRadius: 6, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {redirectUri}
        </code>
        <button
          onClick={() => copy(redirectUri, "uri")}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer", color: "#475569", fontFamily: "var(--font)" }}
        >
          {copied === "uri" ? "Copied!" : "Copy"}
        </button>
      </div>
    )},
    { num: 6, title: "Paste into backend/.env", body: (
      <div style={{ marginTop: 6 }}>
        <div style={{ position: "relative" }}>
          <pre style={{ margin: 0, padding: "10px 12px", background: "#0f172a", color: "#a7f3d0", fontSize: 10, borderRadius: 6, fontFamily: "monospace", overflow: "auto", lineHeight: 1.5, whiteSpace: "pre" }}>
{envSnippet}
          </pre>
          <button
            onClick={() => copy(envSnippet, "env")}
            style={{ position: "absolute", top: 6, right: 6, padding: "4px 8px", borderRadius: 4, border: "none", background: "rgba(255,255,255,0.1)", color: "#a7f3d0", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)" }}
          >
            {copied === "env" ? "Copied!" : "Copy"}
          </button>
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}>
          Then restart the backend and click Connect Google again.
        </div>
      </div>
    )},
  ];

  return (
    <div style={{
      marginTop: 12, padding: 16, borderRadius: 10,
      background: "linear-gradient(180deg, #fffbeb 0%, #fff7ed 100%)",
      border: "1px solid #fcd34d",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "none", stroke: "#fff", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }}>
            <path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="10" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#78350f" }}>One-time setup required</div>
          <div style={{ fontSize: 10, color: "#92400e" }}>Google OAuth credentials are missing on the server. Takes ~10 minutes.</div>
        </div>
      </div>

      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((s) => (
          <li key={s.num} style={{ display: "flex", gap: 10 }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
              background: "#f59e0b", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700,
            }}>
              {s.num}
            </div>
            <div style={{ fontSize: 11.5, color: "#451a03", lineHeight: 1.55, flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{s.title}</div>
              <div>{s.body}</div>
            </div>
          </li>
        ))}
      </ol>

      <div style={{
        marginTop: 14, padding: "8px 12px", borderRadius: 6,
        background: "rgba(180, 83, 9, 0.1)", fontSize: 10, color: "#78350f",
        lineHeight: 1.5,
      }}>
        <strong>Why?</strong> Google requires every app that reads Gmail to be registered as an OAuth client. This is a one-time setup for the app owner — end users will never see this again.
      </div>
    </div>
  );
}

/* ── Placeholder for Skills / Plugins ── */

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14, background: "#f1f5f9",
        margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg viewBox="0 0 24 24" style={{ width: 24, height: 24, stroke: "#94a3b8", fill: "none", strokeWidth: 2 }}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{title} — coming soon</div>
      <div style={{ fontSize: 13, maxWidth: 360, margin: "0 auto", lineHeight: 1.6 }}>{description}</div>
    </div>
  );
}


/* ── Icons ── */

/* ── Slack channel linking section ── */

function SlackChannelsSection({ projectId }: { projectId: string }) {
  const [linked, setLinked] = useState<LinkedSlackChannel[]>([]);
  const [available, setAvailable] = useState<AvailableSlackChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLinked = async () => {
    try {
      const d = await listLinkedSlackChannels(projectId);
      setLinked(d.channels || []);
    } catch {
      setLinked([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLinked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openPicker = async () => {
    setPickerOpen(true);
    setLoadingAvailable(true);
    setError(null);
    try {
      const d = await listAvailableSlackChannels(projectId);
      setAvailable(d.channels || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch channels");
      setAvailable([]);
    } finally {
      setLoadingAvailable(false);
    }
  };

  const handleLink = async (channelId: string, channelName: string) => {
    try {
      await linkSlackChannel(projectId, channelId, channelName);
      setPickerOpen(false);
      await loadLinked();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Link failed");
    }
  };

  const handleUnlink = async (channelId: string) => {
    if (!confirm("Unlink this channel? The agent will stop responding to @mentions here.")) return;
    await unlinkSlackChannel(projectId, channelId);
    await loadLinked();
  };

  const linkedIds = new Set(linked.map((l) => l.channel_id));

  return (
    <div style={{
      marginTop: 28, padding: 20,
      background: "#f8fafc",
      border: "1px solid var(--gray-100)",
      borderRadius: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: "#f3e8ff", color: "#7c3aed",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 800,
        }}>
          S
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Slack channels linked to this project</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Mention the bot in any linked channel to chat with the agent directly from Slack.
          </div>
        </div>
        <button
          onClick={openPicker}
          style={{
            padding: "8px 14px", borderRadius: 8,
            background: "#0f172a", color: "#fff",
            border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          + Link channel
        </button>
      </div>

      {loading && <div style={{ fontSize: 12, color: "#64748b" }}>Loading…</div>}

      {!loading && linked.length === 0 && (
        <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", padding: "8px 0" }}>
          No channels linked yet. Requires an <code style={{ fontFamily: "monospace" }}>xapp-…</code> app token in your Slack connector for inbound chat to work.
        </div>
      )}

      {!loading && linked.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {linked.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", background: "#fff",
                borderRadius: 8, border: "1px solid var(--gray-100)",
              }}
            >
              <span style={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>
                #{c.channel_name || c.channel_id}
              </span>
              <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>{c.channel_id}</span>
              <button
                onClick={() => handleUnlink(c.channel_id)}
                style={{
                  marginLeft: "auto",
                  padding: "4px 10px", borderRadius: 6,
                  background: "#fff", color: "#dc2626",
                  border: "1px solid #fecaca",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Picker popover */}
      {pickerOpen && (
        <div
          onClick={() => setPickerOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", zIndex: 1200,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 92vw)", maxHeight: "70vh",
              background: "#fff", borderRadius: 12,
              display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 24px 64px rgba(0,0,0,0.24)",
            }}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--gray-100)" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Link a Slack channel</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                The bot must already be a member of the channel (use <code>/invite</code>).
              </div>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 10 }}>
              {loadingAvailable && <div style={{ padding: 12, fontSize: 12, color: "#64748b" }}>Loading channels…</div>}
              {error && <div style={{ padding: 12, color: "#dc2626", fontSize: 12 }}>{error}</div>}
              {!loadingAvailable && !error && available.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: "#94a3b8" }}>No channels found.</div>
              )}
              {available.map((c) => {
                const alreadyLinked = linkedIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    disabled={alreadyLinked}
                    onClick={() => handleLink(c.id, c.name)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%",
                      padding: "10px 12px", borderRadius: 8,
                      background: alreadyLinked ? "#f1f5f9" : "#fff",
                      border: "1px solid var(--gray-100)",
                      cursor: alreadyLinked ? "default" : "pointer",
                      marginBottom: 4, textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: alreadyLinked ? "#94a3b8" : "#0f172a" }}>
                      {c.is_private ? "🔒" : "#"} {c.name}
                    </span>
                    {c.is_member ? null : (
                      <span style={{ fontSize: 10, color: "#dc2626", marginLeft: "auto" }}>bot not in channel</span>
                    )}
                    {alreadyLinked && <span style={{ fontSize: 10, color: "#64748b", marginLeft: "auto" }}>linked</span>}
                  </button>
                );
              })}
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--gray-100)", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setPickerOpen(false)}
                style={{
                  padding: "8px 16px", borderRadius: 8,
                  background: "#fff", border: "1px solid var(--gray-200)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function ConnectorIcon({ provider }: { provider: string }) {
  const bg: Record<string, string> = {
    google: "#fef3c7",
    slack: "#f3e8ff",
  };
  const fg: Record<string, string> = {
    google: "#d97706",
    slack: "#7c3aed",
  };
  const letter: Record<string, string> = {
    google: "G",
    slack: "S",
  };
  return (
    <div style={{
      width: 40, height: 40, borderRadius: 10,
      background: bg[provider] || "#f1f5f9", color: fg[provider] || "#64748b",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize: 16, flexShrink: 0,
    }}>
      {letter[provider] || provider[0]?.toUpperCase() || "?"}
    </div>
  );
}

function TabIcon({ name, active }: { name: string; active: boolean }) {
  const color = active ? "#0f172a" : "#94a3b8";
  const common = { width: 16, height: 16, stroke: color, fill: "none", strokeWidth: 2 } as const;
  if (name === "book") {
    return (
      <svg viewBox="0 0 24 24" style={common}>
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      </svg>
    );
  }
  if (name === "plug") {
    return (
      <svg viewBox="0 0 24 24" style={common}>
        <path d="M12 22v-5" />
        <path d="M9 7V2" />
        <path d="M15 7V2" />
        <path d="M6 13V8h12v5a6 6 0 01-12 0z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" style={common}>
      <path d="M20.5 11H19V7a2 2 0 00-2-2h-4V3.5a2.5 2.5 0 00-5 0V5H4a2 2 0 00-2 2v3.8h1.5a2.2 2.2 0 010 4.4H2V19a2 2 0 002 2h3.8v-1.5a2.2 2.2 0 014.4 0V21H17a2 2 0 002-2v-4h1.5a2.5 2.5 0 000-5z" />
    </svg>
  );
}
