"use client";

// Lazy-loaded Mermaid runtime. Imported dynamically so the ~700KB
// bundle isn't paid by users who never open a doc with a diagram.
//
// Both markdown renderers emit `<div class="mermaid">…raw code…</div>`
// for ```mermaid fences (see lib/markdown.ts and ChatPanel's
// renderChatMarkdown). After the HTML lands in the DOM, callers run
// `renderMermaid(rootEl)` to swap those placeholders for SVG.
//
// Mermaid is browser-only — calling these from the server side is a
// no-op. The `if (typeof window === "undefined")` guard makes SSR
// safe; the actual render only happens after hydration via useEffect.

type MermaidApi = {
  initialize: (opts: Record<string, unknown>) => void;
  run: (opts?: { nodes?: HTMLElement[] | NodeListOf<HTMLElement>; querySelector?: string; suppressErrors?: boolean }) => Promise<void>;
};

let cached: MermaidApi | null = null;
let initPromise: Promise<MermaidApi | null> | null = null;

async function loadMermaid(): Promise<MermaidApi | null> {
  if (typeof window === "undefined") return null;
  if (cached) return cached;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const mod = await import("mermaid");
      const m = (mod.default ?? mod) as MermaidApi;
      m.initialize({
        startOnLoad: false,
        // Match the rest of the UI — neutral surface, accent stroke
        // for emphasis. `themeVariables` overrides individual tokens
        // so the diagram doesn't look like a foreign element.
        theme: "base",
        themeVariables: {
          primaryColor: "#FFFFFF",
          primaryTextColor: "#0A0A0B",
          primaryBorderColor: "#D6D6CE",
          lineColor: "#6B6B72",
          secondaryColor: "#FBFBF8",
          tertiaryColor: "#F7F7F4",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
          fontSize: "13px",
        },
        // `loose` lets mermaid render click handlers inside diagrams.
        // We're rendering trusted vault content, not user-uploaded
        // arbitrary mermaid, so the relaxed posture is fine here.
        securityLevel: "loose",
      });
      cached = m;
      // One-shot signal so it's easy to confirm in DevTools that the
      // lazy import succeeded vs. silently failed. Removed once the
      // surface stabilizes.
      console.info("[mermaid] loaded");
      return m;
    } catch (e) {
      // Fail soft — leaving the raw code visible is strictly better
      // than crashing the panel.
      console.warn("[mermaid] failed to load", e);
      return null;
    }
  })();
  return initPromise;
}

export async function renderMermaid(root?: HTMLElement | null): Promise<void> {
  const m = await loadMermaid();
  if (!m) return;
  // Scope the run to a specific container when one is passed in;
  // otherwise scan the whole document. Mermaid marks each rendered
  // node with `data-processed="true"` so re-running is idempotent —
  // safe to call on every content change.
  const scope: ParentNode = root ?? document;
  const nodes = scope.querySelectorAll<HTMLElement>(
    '.mermaid:not([data-processed="true"])'
  );
  if (nodes.length === 0) return;
  try {
    await m.run({ nodes: Array.from(nodes), suppressErrors: true });
  } catch (e) {
    // Per-diagram syntax errors are caught + rendered inline by
    // mermaid itself. Anything that escapes that net is fail-soft
    // here too.
    console.warn("[mermaid] render error", e);
  }
}
