/**
 * code-viewer.ts — collapsible source code panel
 *
 * Reusable component following existing vanilla TS patterns.
 * Supports primary + optional secondary tab for showing related infra files.
 */

export interface CodeViewerConfig {
  id: string;
  label: string;
  source: string;
  secondaryLabel?: string;
  secondarySource?: string;
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function codeViewerHTML(cfg: CodeViewerConfig): string {
  const hasTabs = cfg.secondaryLabel && cfg.secondarySource;
  return `
    <div class="code-viewer" id="cv-${cfg.id}">
      <button class="code-viewer-toggle btn btn-secondary btn-sm" data-cv="${cfg.id}">View Source</button>
      <div class="code-viewer-body" data-cv-body="${cfg.id}" style="display:none">
        <div class="code-viewer-toolbar">
          ${hasTabs ? `
            <div class="code-viewer-tabs">
              <button class="code-viewer-tab active" data-cv-tab="${cfg.id}" data-tab="primary">${cfg.label}</button>
              <button class="code-viewer-tab" data-cv-tab="${cfg.id}" data-tab="secondary">${cfg.secondaryLabel}</button>
            </div>
          ` : `
            <span class="code-viewer-filename">${cfg.label}</span>
          `}
          <button class="code-viewer-copy btn btn-secondary btn-sm" data-cv-copy="${cfg.id}">Copy</button>
        </div>
        <pre class="code-viewer-pre" data-cv-pre="${cfg.id}">${escapeHTML(cfg.source)}</pre>
      </div>
    </div>
  `;
}

export function attachCodeViewer(container: HTMLElement, cfg: CodeViewerConfig): void {
  const toggle = container.querySelector<HTMLButtonElement>(`[data-cv="${cfg.id}"]`);
  const body = container.querySelector<HTMLElement>(`[data-cv-body="${cfg.id}"]`);
  const pre = container.querySelector<HTMLElement>(`[data-cv-pre="${cfg.id}"]`);
  if (!toggle || !body || !pre) return;

  let activeSource = cfg.source;

  toggle.addEventListener("click", () => {
    const open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
    toggle.textContent = open ? "View Source" : "Hide Source";
    if (!open) {
      body.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  // Copy button
  container.querySelector<HTMLButtonElement>(`[data-cv-copy="${cfg.id}"]`)
    ?.addEventListener("click", () => {
      navigator.clipboard.writeText(activeSource);
      const btn = container.querySelector<HTMLButtonElement>(`[data-cv-copy="${cfg.id}"]`)!;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy"; }, 1500);
    });

  // Tab switching
  if (cfg.secondaryLabel && cfg.secondarySource) {
    const tabs = container.querySelectorAll<HTMLButtonElement>(`[data-cv-tab="${cfg.id}"]`);
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const which = tab.dataset["tab"];
        tabs.forEach((t) => t.classList.toggle("active", t === tab));
        if (which === "secondary" && cfg.secondarySource) {
          activeSource = cfg.secondarySource;
          pre.textContent = cfg.secondarySource;
        } else {
          activeSource = cfg.source;
          pre.textContent = cfg.source;
        }
      });
    });
  }
}
