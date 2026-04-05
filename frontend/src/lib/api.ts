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

export async function listDocuments(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/documents`);
}

export async function getDocumentContent(projectId: string, documentId: string) {
  return fetchAPI(`/api/projects/${projectId}/documents/${documentId}/content`);
}

// Extracted items
export async function listRequirements(projectId: string, params?: Record<string, string>) {
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

export async function listConstraints(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/constraints`);
}

export async function listDecisions(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/decisions`);
}

export async function listStakeholders(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/stakeholders`);
}

export async function listAssumptions(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/assumptions`);
}

export async function listScope(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/scope`);
}

export async function listContradictions(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/contradictions`);
}

export async function listGaps(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/gaps`);
}

export async function resolveGap(projectId: string, gapId: string, resolution: string) {
  return fetchAPI(`/api/projects/${projectId}/gaps/${gapId}/resolve?resolution=${encodeURIComponent(resolution)}`, { method: "PATCH" });
}

// Dashboard
export async function getDashboard(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/dashboard`);
}

export async function getReadiness(projectId: string) {
  return fetchAPI(`/api/projects/${projectId}/readiness`);
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
