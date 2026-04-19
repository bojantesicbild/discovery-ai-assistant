const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchAPI(path: string, options: RequestInit = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || "API error");
  }
  return res.json();
}

// Auth
export async function register(email: string, name: string) {
  return fetchAPI("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, name, auth_provider: "local" }),
  });
}

export async function login(email: string) {
  return fetchAPI(`/api/auth/login?email=${encodeURIComponent(email)}`, {
    method: "POST",
  });
}

export async function getMe() {
  return fetchAPI("/api/auth/me");
}

// Projects
export async function createProject(data: {
  name: string;
  client_name: string;
  project_type: string;
  repo_url?: string;
}) {
  return fetchAPI("/api/projects", { method: "POST", body: JSON.stringify(data) });
}

export async function listProjects() {
  return fetchAPI("/api/projects");
}

export async function getProject(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}`);
}

// Search
export async function searchProject(projectId: string, query: string) {
  return fetchAPI(`/api/projects/${projectId}/search?q=${encodeURIComponent(query)}`);
}

// Documents
export async function uploadDocument(projectId: string, file: File) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/api/projects/${projectId}/documents`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

export async function deleteDocument(projectId: string, documentId: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(`${API_URL}/api/projects/${projectId}/documents/${documentId}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Delete failed");
}

export async function listDocuments(projectId: string): Promise<{ documents: ApiDocument[] }> {
  return fetchAPI(`/api/projects/${projectId}/documents`);
}

export async function getDocumentContent(projectId: string, documentId: string) {
  return fetchAPI(`/api/projects/${projectId}/documents/${documentId}/content`);
}

// ── Extracted-item shapes (mirror the dicts returned by backend/app/api/extracted_items.py) ──
export interface ApiSourceRef {
  doc_id?: string;
  filename?: string;
  quote?: string;
  added_at?: string;
}

export interface ApiRequirement {
  id: string;
  req_id: string;
  title: string;
  type: string;                // functional | non_functional
  priority: string;            // must | should | could | wont
  description: string;
  user_perspective: string | null;
  business_rules: string[];
  edge_cases: string[];
  acceptance_criteria: string[];
  source_doc: string | null;
  source_doc_id: string | null;
  source_quote: string | null;
  source_person: string | null;
  sources: ApiSourceRef[];
  version: number;
  status: string;              // proposed | discussed | confirmed | changed | dropped
  confidence: string;          // high | medium | low
  created_at: string | null;
  seen_at: string | null;
}

export interface ApiGap {
  id: string;
  gap_id: string;
  question: string;
  severity: string;            // high | medium | low
  area: string;
  source_doc: string | null;
  source_doc_id: string | null;
  source_quote: string | null;
  source_person: string | null;
  blocked_reqs: string[];
  sources: ApiSourceRef[];
  suggested_action: string | null;
  status: string;              // open | resolved | dismissed
  resolution: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  assignee?: string | null;
  created_at: string | null;
  seen_at: string | null;
}

export interface ApiConstraint {
  id: string;
  type: string;
  description: string;
  impact: string;
  status: string;
  source_quote: string | null;
  source_doc?: string | null;
  source_doc_id?: string | null;
  sources?: ApiSourceRef[];
  created_at?: string | null;
  seen_at: string | null;
}

export interface ApiDecision {
  id: string;
  title: string;
  decided_by: string | null;
  date: string | null;
  rationale: string;
  alternatives: string[];
  impacts: string[];           // BR ids the decision affects
  status: string;
  seen_at: string | null;
}

export interface ApiStakeholder {
  id: string;
  name: string;
  role: string;
  organization: string;
  decision_authority: string;  // final | recommender | informed
  interests: string[];
  seen_at: string | null;
}

export interface ApiAssumption {
  id: string;
  statement: string;
  basis: string;
  risk_if_wrong: string;
  needs_validation_by: string | null;
  validated: boolean;
  seen_at: string | null;
}

export interface ApiScope {
  id: string;
  description: string;
  in_scope: boolean;
  rationale: string;
  seen_at: string | null;
}

export interface ApiContradiction {
  id: string;
  item_a_type: string;
  item_a_id: string;
  item_a_ref: string;
  item_a_source: string | null;
  item_a_person?: string | null;
  item_b_type: string;
  item_b_id: string;
  item_b_ref: string;
  item_b_source: string | null;
  item_b_person?: string | null;
  explanation: string;
  resolved: boolean;
  resolution_note: string | null;
  suggested_resolution?: string | null;
  created_at: string | null;
  seen_at: string | null;
}

export interface ApiDocument {
  id: string;
  project_id?: string;
  filename: string;
  file_type: string;
  file_size_bytes: number | null;
  chunking_template?: string | null;
  classification?: Record<string, unknown> | null;
  pipeline_stage: string;
  pipeline_error: string | null;
  items_extracted: number;
  contradictions_found: number;
  created_at: string;
  pipeline_started_at?: string | null;
  pipeline_completed_at?: string | null;
}

export interface ApiListResponse<T> {
  items: T[];
  total: number;
}


// Client review feedback (aggregated per item across all submissions)
export interface ReqClientFeedback {
  action: "confirm" | "discuss";
  note: string | null;
  round: number;
  submitted_at: string | null;
  client_name: string | null;
}
export interface GapClientFeedback {
  action: "answer";
  answer: string | null;
  round: number;
  submitted_at: string | null;
  client_name: string | null;
}
export async function getClientFeedback(projectId: string): Promise<{
  requirements: Record<string, ReqClientFeedback>;
  gaps: Record<string, GapClientFeedback>;
}> {
  return fetchAPI(`/api/projects/${projectId}/client-feedback`);
}

// Review tokens (PM-facing)
export interface ReviewToken {
  id: string;
  token: string;
  label: string | null;
  client_name: string | null;
  client_email: string | null;
  expires_at: string;
  revoked_at: string | null;
  submitted_at: string | null;
  round_number: number;
  created_at: string | null;
  shareable_url: string;
}
export interface ReviewSubmission {
  id: string;
  round_number: number;
  client_name: string | null;
  submitted_at: string | null;
  confirmed: number;
  discussed: number;
  gaps_answered: number;
  requirement_actions?: { req_id: string; action: string; note?: string }[];
  gap_actions?: { gap_id: string; action: string; answer?: string }[];
}
export async function listReviewTokens(projectId: string): Promise<{ tokens: ReviewToken[] }> {
  return fetchAPI(`/api/projects/${projectId}/review-tokens`);
}
export async function createReviewToken(projectId: string, body: {
  label?: string; client_name?: string; client_email?: string; expires_in_days?: number;
}): Promise<ReviewToken> {
  return fetchAPI(`/api/projects/${projectId}/review-tokens`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export async function revokeReviewToken(projectId: string, tokenId: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  await fetch(`${API_URL}/api/projects/${projectId}/review-tokens/${tokenId}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
export async function listReviewSubmissions(projectId: string): Promise<{ submissions: ReviewSubmission[] }> {
  return fetchAPI(`/api/projects/${projectId}/review-submissions`);
}

// Staged proposals — agent-generated patches awaiting PM review
export interface ProposedUpdate {
  id: string;
  source_gap_id: string;
  gap_question: string | null;
  target_req_id: string;
  req_title: string | null;
  proposed_field: "description" | "acceptance_criteria" | "business_rules";
  proposed_value: string | string[];
  current_value: string | string[] | null;
  rationale: string | null;
  client_answer: string | null;
  review_round: number | null;
  status: "pending" | "accepted" | "rejected" | "edited";
  created_at: string | null;
  reviewed_at: string | null;
}
export async function listProposedUpdates(projectId: string, status: string = "pending"): Promise<{ items: ProposedUpdate[]; total: number }> {
  return fetchAPI(`/api/projects/${projectId}/proposed-updates?status=${encodeURIComponent(status)}`);
}
export async function acceptProposal(projectId: string, proposalId: string, overrideValue?: string | string[]) {
  return fetchAPI(`/api/projects/${projectId}/proposed-updates/${proposalId}/accept`, {
    method: "POST",
    body: JSON.stringify({ override_value: overrideValue ?? null }),
  });
}
export async function rejectProposal(projectId: string, proposalId: string) {
  return fetchAPI(`/api/projects/${projectId}/proposed-updates/${proposalId}/reject`, {
    method: "POST",
  });
}

// Extracted items
export async function listRequirements(projectId: string, params?: Record<string, string>): Promise<ApiListResponse<ApiRequirement>> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return fetchAPI(`/api/projects/${projectId}/requirements${qs}`);
}

export async function updateRequirement(projectId: string, reqId: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return fetchAPI(`/api/projects/${projectId}/requirements/${reqId}?${qs}`, { method: "PATCH" });
}

export async function validateAssumption(projectId: string, assumptionId: string, validated: boolean) {
  return fetchAPI(`/api/projects/${projectId}/assumptions/${assumptionId}/validate?validated=${validated}`, { method: "PATCH" });
}

export async function resolveContradiction(projectId: string, contradictionId: string, note: string) {
  return fetchAPI(`/api/projects/${projectId}/contradictions/${contradictionId}/resolve?resolution_note=${encodeURIComponent(note)}`, { method: "PATCH" });
}

export async function listConstraints(projectId: string): Promise<ApiListResponse<ApiConstraint>> {
  return fetchAPI(`/api/projects/${projectId}/constraints`);
}

export async function listDecisions(projectId: string): Promise<ApiListResponse<ApiDecision>> {
  return fetchAPI(`/api/projects/${projectId}/decisions`);
}

export async function listStakeholders(projectId: string): Promise<ApiListResponse<ApiStakeholder>> {
  return fetchAPI(`/api/projects/${projectId}/stakeholders`);
}

export async function listAssumptions(projectId: string): Promise<ApiListResponse<ApiAssumption>> {
  return fetchAPI(`/api/projects/${projectId}/assumptions`);
}

export async function listScope(projectId: string): Promise<ApiListResponse<ApiScope>> {
  return fetchAPI(`/api/projects/${projectId}/scope`);
}

export async function listContradictions(projectId: string): Promise<ApiListResponse<ApiContradiction>> {
  return fetchAPI(`/api/projects/${projectId}/contradictions`);
}

export async function listGaps(projectId: string): Promise<ApiListResponse<ApiGap>> {
  return fetchAPI(`/api/projects/${projectId}/gaps`);
}

export async function resolveGap(
  projectId: string,
  gapId: string,
  resolution: string,
  status: "resolved" | "dismissed" | "open" = "resolved",
) {
  const q = `resolution=${encodeURIComponent(resolution)}&status=${status}`;
  return fetchAPI(`/api/projects/${projectId}/gaps/${gapId}/resolve?${q}`, { method: "PATCH" });
}

export async function updateConstraintStatus(
  projectId: string,
  constraintId: string,
  status: "confirmed" | "assumed" | "negotiable",
) {
  return fetchAPI(
    `/api/projects/${projectId}/constraints/${constraintId}/status?status=${status}`,
    { method: "PATCH" },
  );
}

// Dashboard
export async function getDashboard(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/dashboard`);
}

export async function getReadiness(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/readiness`);
}

export async function getReadinessTrajectory(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/readiness/trajectory`);
}

export async function getLatestDigest(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/digests/latest`);
}

export async function generateDigest(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/digests/generate`, { method: "POST" });
}

// Chat (SSE streaming)
export function chatStream(
  projectId: string,
  text: string,
  onText: (text: string) => void,
  onDone: (stats?: { numTurns?: number; durationMs?: number }) => void,
  onError: (error: string) => void,
  onTool?: (tool: string, toolType?: string) => void,
  onThinking?: () => void,
  onRetry?: (attempt: number, maxRetries: number) => void,
) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  fetch(`${API_URL}/api/projects/${projectId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text }),
  }).then(async (response) => {
    if (!response.ok) {
      onError("Chat request failed");
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onError("No response body");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) onText(data.text);
            if (data.tool) onTool?.(data.tool, data.toolType);
            if (data.thinking) onThinking?.();
            if (data.retry) onRetry?.(data.attempt, data.maxRetries);
            if (data.error) onError(data.error);
            if (data.done) onDone(data.stats);
          } catch {
            // Skip unparseable lines
          }
        }
      }
    }
  }).catch((err) => onError(err.message));
}

export async function getConversation(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/conversation`);
}

export async function clearConversation(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/conversation`, { method: "DELETE" });
}

// Knowledge Graph
export async function getKnowledgeGraph(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/knowledge-graph`);
}

// Generate / Handoff
export async function listHandoffDocs(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/handoff`);
}

export async function getHandoffDoc(projectId: string, docType: string) {
  return fetchAPI(`/api/projects/${projectId}/handoff/${docType}`);
}

export function generateHandoffStream(
  projectId: string,
  onText: (text: string) => void,
  onDone: (generated: string[]) => void,
  onTool?: (tool: string) => void,
  onError?: (error: string) => void,
) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  fetch(`${API_URL}/api/projects/${projectId}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).then(async (response) => {
    if (!response.ok) { onError?.("Generation failed"); return; }
    const reader = response.body?.getReader();
    if (!reader) { onError?.("No response body"); return; }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) onText(data.text);
            if (data.tool) onTool?.(data.tool);
            if (data.error) onError?.(data.error);
            if (data.done) onDone(data.generated || []);
          } catch {}
        }
      }
    }
  }).catch((err) => onError?.(err.message));
}

// Repos
export async function addRepo(projectId: string, data: { name: string; url: string; provider?: string; access_token?: string; default_branch?: string }) {
  return fetchAPI(`/api/projects/${projectId}/repos`, { method: "POST", body: JSON.stringify(data) });
}

export async function listRepos(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/repos`);
}

export async function removeRepo(projectId: string, repoId: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  await fetch(`${API_URL}/api/projects/${projectId}/repos/${repoId}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function getRepoPulls(projectId: string, repoId: string, state: string = "all", base?: string) {
  const qs = new URLSearchParams({ state });
  if (base) qs.set("base", base);
  return fetchAPI(`/api/projects/${projectId}/repos/${repoId}/pulls?${qs.toString()}`);
}

export async function getRepoCommits(projectId: string, repoId: string, sha?: string) {
  const qs = new URLSearchParams();
  if (sha) qs.set("sha", sha);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return fetchAPI(`/api/projects/${projectId}/repos/${repoId}/commits${suffix}`);
}

export async function getRepoInfo(projectId: string, repoId: string) {
  return fetchAPI(`/api/projects/${projectId}/repos/${repoId}/info`);
}

export async function getRepoBranches(projectId: string, repoId: string) {
  return fetchAPI(`/api/projects/${projectId}/repos/${repoId}/branches`);
}

export async function getRepoWorkflows(projectId: string, repoId: string) {
  return fetchAPI(`/api/projects/${projectId}/repos/${repoId}/workflows`);
}

// Notifications
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  data: Record<string, unknown> | null;
  created_at: string | null;
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
  total: number;
  offset: number;
  limit: number;
}

export async function getNotifications(
  projectId: string,
  limit: number = 6,
  offset: number = 0,
): Promise<NotificationsResponse> {
  return fetchAPI(
    `/api/projects/${projectId}/notifications?limit=${limit}&offset=${offset}`,
  );
}

export async function getNotificationCount(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/notifications/count`);
}

export async function markNotificationRead(projectId: string, notificationId: string) {
  return fetchAPI(`/api/projects/${projectId}/notifications/${notificationId}/read`, { method: "PATCH" });
}

// Integrations / Connectors
export interface CatalogConnector {
  id: string;
  name: string;
  category: string;
  provider: string;
  icon: string;
  short_description: string;
  long_description: string;
  auth: {
    type: "oauth_google" | "token_paste";
    scopes?: string[];
    fields?: { key: string; label: string; placeholder: string; secret: boolean; required: boolean; validation?: string; help?: string }[];
    instructions_url?: string;
    instructions_steps?: string[];
  };
  permissions: string[];
}

export interface ProjectIntegrationSummary {
  id: string;
  connector_id: string;
  status: "active" | "error" | "pending_auth";
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string | null;
  last_verified_at: string | null;
}

export async function getConnectorCatalog(): Promise<{ connectors: CatalogConnector[] }> {
  return fetchAPI("/api/integrations/catalog");
}

export async function listIntegrations(projectId: string): Promise<{ integrations: ProjectIntegrationSummary[] }> {
  return fetchAPI(`/api/projects/${projectId}/integrations`);
}

export async function addIntegration(projectId: string, connectorId: string, config: Record<string, unknown>) {
  return fetchAPI(`/api/projects/${projectId}/integrations`, {
    method: "POST",
    body: JSON.stringify({ connector_id: connectorId, config }),
  });
}

export async function removeIntegration(projectId: string, connectorId: string) {
  return fetchAPI(`/api/projects/${projectId}/integrations/${connectorId}`, { method: "DELETE" });
}

export async function startGoogleAuthorize(projectId: string, connectorId: string): Promise<{ authorize_url?: string; already_connected?: boolean }> {
  return fetchAPI(`/api/projects/${projectId}/integrations/google/authorize?connector_id=${connectorId}`);
}

// Gmail — list & import messages as Documents
export interface GmailMessage {
  id: string;
  thread_id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  label_ids: string[];
}

export async function listGmailMessages(projectId: string, query?: string, maxResults: number = 25): Promise<{ messages: GmailMessage[]; query: string | null }> {
  const params = new URLSearchParams({ max_results: String(maxResults) });
  if (query) params.set("q", query);
  return fetchAPI(`/api/projects/${projectId}/integrations/gmail/messages?${params.toString()}`);
}

export async function createGmailDraft(projectId: string, subject: string, body: string, to: string = "") {
  return fetchAPI(`/api/projects/${projectId}/integrations/gmail/draft`, {
    method: "POST",
    body: JSON.stringify({ subject, body, to }),
  });
}

export async function importGmailMessages(projectId: string, messageIds: string[]): Promise<{ imported: { id: string; document_id: string; filename: string }[]; skipped: { id: string; reason: string }[] }> {
  return fetchAPI(`/api/projects/${projectId}/integrations/gmail/import`, {
    method: "POST",
    body: JSON.stringify({ message_ids: messageIds }),
  });
}

// Google Drive — list & import files as Documents
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  iconLink?: string;
  webViewLink?: string;
  owners?: { displayName: string; emailAddress: string; photoLink?: string }[];
  supported: boolean;
}

export async function listDriveFiles(projectId: string, query?: string, maxResults: number = 50): Promise<{ files: DriveFile[]; query: string | null }> {
  const params = new URLSearchParams({ max_results: String(maxResults) });
  if (query) params.set("q", query);
  return fetchAPI(`/api/projects/${projectId}/integrations/google_drive/files?${params.toString()}`);
}

export async function importDriveFiles(projectId: string, fileIds: string[]): Promise<{ imported: { id: string; document_id: string; filename: string }[]; skipped: { id: string; reason: string }[] }> {
  return fetchAPI(`/api/projects/${projectId}/integrations/google_drive/import`, {
    method: "POST",
    body: JSON.stringify({ file_ids: fileIds }),
  });
}

// Per-connector retrieval settings (defaults for search forms)
export async function getIntegrationSettings(projectId: string, connectorId: string): Promise<{ settings: Record<string, any> }> {
  return fetchAPI(`/api/projects/${projectId}/integrations/${connectorId}/settings`);
}

export async function updateIntegrationSettings(projectId: string, connectorId: string, settings: Record<string, any>): Promise<{ status: string; settings: Record<string, any> }> {
  return fetchAPI(`/api/projects/${projectId}/integrations/${connectorId}/settings`, {
    method: "PATCH",
    body: JSON.stringify({ settings }),
  });
}

// Slack channels (inbound chat)
export interface LinkedSlackChannel {
  id: string;
  channel_id: string;
  channel_name: string | null;
  team_id: string;
  created_at: string | null;
}

export interface AvailableSlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members: number | null;
}

export async function listLinkedSlackChannels(projectId: string): Promise<{ channels: LinkedSlackChannel[] }> {
  return fetchAPI(`/api/projects/${projectId}/slack/channels`);
}

export async function listAvailableSlackChannels(projectId: string): Promise<{ channels: AvailableSlackChannel[] }> {
  return fetchAPI(`/api/projects/${projectId}/slack/channels/available`);
}

export async function linkSlackChannel(projectId: string, channelId: string, channelName?: string) {
  return fetchAPI(`/api/projects/${projectId}/slack/channels`, {
    method: "POST",
    body: JSON.stringify({ channel_id: channelId, channel_name: channelName }),
  });
}

export async function unlinkSlackChannel(projectId: string, channelId: string) {
  return fetchAPI(`/api/projects/${projectId}/slack/channels/${channelId}`, { method: "DELETE" });
}

// Finding read-state (per-user unread tracking)
export type FindingType =
  | "requirement"
  | "gap"
  | "constraint"
  | "decision"
  | "contradiction"
  | "assumption"
  | "scope"
  | "stakeholder";

export interface UnreadCounts {
  requirement: number;
  gap: number;
  constraint: number;
  decision: number;
  contradiction: number;
  assumption: number;
  scope: number;
  stakeholder: number;
  total: number;
}

export async function getUnreadCounts(projectId: string): Promise<UnreadCounts> {
  return fetchAPI(`/api/projects/${projectId}/findings/unread`);
}

export async function markFindingSeen(projectId: string, findingType: FindingType, findingId: string) {
  return fetchAPI(`/api/projects/${projectId}/findings/${findingType}/${findingId}/seen`, {
    method: "POST",
  });
}

export async function markFindingsTypeSeenAll(projectId: string, findingType: FindingType) {
  return fetchAPI(`/api/projects/${projectId}/findings/${findingType}/seen-all`, {
    method: "POST",
  });
}

export async function markFindingsProjectSeenAll(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/findings/seen-all`, {
    method: "POST",
  });
}

// Item history
export interface HistoryEntry {
  id: string;
  action: "create" | "update";
  old_value: Record<string, any>;
  new_value: Record<string, any>;
  source_doc_id: string | null;
  source_filename: string | null;
  triggered_by: string | null;
  created_at: string | null;
}

export async function getItemHistory(
  projectId: string,
  itemType: string,
  itemId: string,
): Promise<{ item_type: string; item_id: string; history: HistoryEntry[] }> {
  return fetchAPI(`/api/projects/${projectId}/items/${itemType}/${itemId}/history`);
}

// Meeting Agenda
export async function getMeetingAgenda(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/meeting-agenda`);
}

export async function getMeetingAgendaFromVault(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/meeting-agenda/from-vault`);
}

export async function listMeetingAgendas(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/meeting-agenda/history`);
}

export async function getMeetingAgendaByRound(projectId: string, round: number) {
  return fetchAPI(`/api/projects/${projectId}/meeting-agenda/round/${round}`);
}

export async function saveMeetingAgenda(projectId: string, contentMd: string) {
  return fetchAPI(`/api/projects/${projectId}/meeting-agenda`, {
    method: "PUT",
    body: JSON.stringify({ content_md: contentMd }),
  });
}

export async function createNewAgenda(projectId: string, contentMd: string) {
  return fetchAPI(`/api/projects/${projectId}/meeting-agenda/new`, {
    method: "POST",
    body: JSON.stringify({ content_md: contentMd }),
  });
}

// Wiki
export async function getWikiFiles(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/wiki/files`);
}

export async function getWikiFile(projectId: string, path: string) {
  return fetchAPI(`/api/projects/${projectId}/wiki/file?path=${encodeURIComponent(path)}`);
}
