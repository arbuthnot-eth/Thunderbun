/**
 * Walrus section — decentralized blob storage via HTTP REST API
 * Docs: https://docs.wal.app/
 *
 * No extra SDK needed — Walrus exposes simple HTTP endpoints:
 *   PUT /v1/blobs?epochs=N   → store a blob, returns { blobId }
 *   GET /v1/blobs/:blobId    → retrieve a blob
 */

const PUBLISHER  = "https://publisher.walrus-testnet.walrus.space";
const AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

interface WalrusBlobResponse {
  newlyCreated?: { blobObject?: { blobId?: string; size?: number } };
  alreadyCertified?: { blobId?: string };
}

export function renderWalrus(container: HTMLElement) {
  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">Walrus 🐋</h1>
          <p class="section-desc">Decentralized blob storage. Store anything — text, images, files.</p>
        </div>
        <a href="https://docs.wal.app" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Docs ↗</a>
      </div>

      <!-- Store -->
      <div class="card">
        <div class="card-title">Store a blob</div>

        <div class="drop-zone" id="drop-zone">
          <div class="drop-zone-text">
            Drop a file here or <span class="drop-zone-link" id="file-pick">browse</span>
          </div>
          <div class="drop-zone-sub">Any format · Max 10 MB</div>
          <input type="file" id="file-input" style="display:none" />
        </div>

        <div id="file-info" class="hidden mt-3">
          <div class="row-between" style="background:var(--bg);padding:10px 14px;border-radius:var(--r-md)">
            <div>
              <div style="font-size:13px;color:#fff" id="file-name"></div>
              <div class="small muted" id="file-size"></div>
            </div>
            <div class="row gap-2">
              <select id="epochs-select" class="input-field" style="width:auto;padding:4px 8px">
                <option value="1">1 epoch</option>
                <option value="5" selected>5 epochs</option>
                <option value="10">10 epochs</option>
              </select>
              <button id="store-btn" class="btn btn-primary btn-sm">Store</button>
            </div>
          </div>
        </div>

        <div class="result-box" id="store-result">
          <div class="result-label">Blob ID (save this!)</div>
          <div class="result-value green mono break-all" id="blob-id"></div>
          <button class="btn btn-secondary btn-sm mt-3" id="copy-blob">Copy blob ID</button>
        </div>
        <div class="error-msg" id="store-err"></div>
      </div>

      <!-- Retrieve -->
      <div class="card">
        <div class="card-title">Retrieve a blob</div>
        <label class="input-label">Blob ID</label>
        <div class="input-row">
          <input id="blob-input" type="text" class="input-field mono" placeholder="Enter blob ID…" />
          <button id="retrieve-btn" class="btn btn-primary">Fetch</button>
        </div>
        <div class="result-box" id="retrieve-result">
          <div class="result-label">Content preview</div>
          <pre id="blob-content"></pre>
        </div>
        <div class="error-msg" id="retrieve-err"></div>
      </div>

      <div class="info-links">
        <div class="info-links-label">Resources</div>
        <div class="info-links-row">
          <a href="https://docs.wal.app" target="_blank" rel="noopener" class="badge badge-blue">Documentation ↗</a>
          <a href="https://walrus.site" target="_blank" rel="noopener" class="badge badge-blue">Walrus Sites ↗</a>
          <a href="https://github.com/MystenLabs/walrus" target="_blank" rel="noopener" class="badge badge-blue">GitHub ↗</a>
        </div>
      </div>
    </div>
  `;

  let selectedFile: File | null = null;

  // Drop zone & file picker
  const dropZone = container.querySelector<HTMLElement>("#drop-zone")!;
  const fileInput = container.querySelector<HTMLInputElement>("#file-input")!;

  container.querySelector("#file-pick")?.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer?.files[0]) setFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) setFile(fileInput.files[0]);
  });

  function setFile(f: File) {
    selectedFile = f;
    container.querySelector<HTMLElement>("#file-name")!.textContent = f.name;
    container.querySelector<HTMLElement>("#file-size")!.textContent =
      f.size < 1024 ? `${f.size} B`
      : f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(1)} KB`
      : `${(f.size / 1024 / 1024).toFixed(2)} MB`;
    container.querySelector<HTMLElement>("#file-info")!.classList.remove("hidden");
    container.querySelector<HTMLElement>("#store-result")!.classList.remove("visible");
  }

  // Store
  container.querySelector("#store-btn")?.addEventListener("click", async () => {
    if (!selectedFile) return;
    const btn    = container.querySelector<HTMLButtonElement>("#store-btn")!;
    const epochs = container.querySelector<HTMLSelectElement>("#epochs-select")!.value;
    const errEl  = container.querySelector<HTMLElement>("#store-err")!;

    btn.disabled = true;
    btn.textContent = "Storing…";
    errEl.classList.remove("visible");

    try {
      const res = await fetch(`${PUBLISHER}/v1/blobs?epochs=${epochs}`, {
        method: "PUT",
        body: selectedFile,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

      const data = await res.json() as WalrusBlobResponse;
      const blobId =
        data.newlyCreated?.blobObject?.blobId ??
        data.alreadyCertified?.blobId ?? "";

      container.querySelector<HTMLElement>("#blob-id")!.textContent = blobId;
      container.querySelector<HTMLElement>("#store-result")!.classList.add("visible");

      // Pre-fill retrieve input
      container.querySelector<HTMLInputElement>("#blob-input")!.value = blobId;
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.classList.add("visible");
    } finally {
      btn.disabled = false;
      btn.textContent = "Store";
    }
  });

  container.querySelector("#copy-blob")?.addEventListener("click", () => {
    const id = container.querySelector<HTMLElement>("#blob-id")!.textContent ?? "";
    navigator.clipboard.writeText(id);
    const btn = container.querySelector<HTMLButtonElement>("#copy-blob")!;
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  // Retrieve
  container.querySelector("#retrieve-btn")?.addEventListener("click", async () => {
    const blobId = container.querySelector<HTMLInputElement>("#blob-input")!.value.trim();
    if (!blobId) return;

    const btn      = container.querySelector<HTMLButtonElement>("#retrieve-btn")!;
    const resultEl = container.querySelector<HTMLElement>("#retrieve-result")!;
    const contentEl = container.querySelector<HTMLElement>("#blob-content")!;
    const errEl    = container.querySelector<HTMLElement>("#retrieve-err")!;

    resultEl.classList.remove("visible");
    errEl.classList.remove("visible");
    btn.disabled = true;
    btn.textContent = "Fetching…";

    try {
      const res = await fetch(`${AGGREGATOR}/v1/blobs/${blobId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      contentEl.textContent = text.length > 600 ? text.slice(0, 600) + "\n…(truncated)" : text;
      resultEl.classList.add("visible");
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.classList.add("visible");
    } finally {
      btn.disabled = false;
      btn.textContent = "Fetch";
    }
  });
}
