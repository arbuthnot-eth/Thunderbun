export function renderWalrus(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-6 max-w-2xl mx-auto">
      <div class="mb-6 mt-4 flex items-start justify-between">
        <div>
          <h1 class="section-header">Walrus Storage 🐋</h1>
          <p class="section-desc">Decentralized blob storage on Sui. Store and retrieve any file.</p>
        </div>
        <a href="https://docs.walrus.site" target="_blank" rel="noopener" class="btn-secondary text-xs">Docs ↗</a>
      </div>

      <div class="card mb-4">
        <p class="text-sm font-medium text-white mb-3">Store a file</p>
        <div class="border-2 border-dashed border-sui-border rounded-lg p-6 text-center cursor-pointer hover:border-sui-accent transition-colors" id="drop-zone">
          <p class="text-sui-muted text-sm">Drop a file here or <span class="text-sui-accent underline cursor-pointer" id="file-pick">browse</span></p>
          <p class="text-xs text-sui-muted mt-1">Max 10 MB · Any format</p>
          <input type="file" id="file-input" class="hidden" />
        </div>
        <div id="file-info" class="hidden mt-3 p-3 bg-sui-dark rounded-lg">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-white" id="file-name"></p>
              <p class="text-xs text-sui-muted" id="file-size"></p>
            </div>
            <button id="store-btn" class="btn-primary text-xs">Store on Walrus</button>
          </div>
        </div>
        <div id="store-result" class="hidden mt-3 p-3 bg-sui-dark rounded-lg">
          <p class="text-xs text-sui-muted mb-1">Blob ID</p>
          <p class="text-sm text-sui-success font-mono break-all" id="blob-id"></p>
          <button id="copy-blob" class="mt-2 text-xs text-sui-accent hover:underline">Copy blob ID</button>
        </div>
      </div>

      <div class="card">
        <p class="text-sm font-medium text-white mb-3">Retrieve a blob</p>
        <div class="flex gap-2">
          <input id="blob-input" type="text" placeholder="Enter blob ID…" class="input-field font-mono text-xs" />
          <button id="retrieve-btn" class="btn-primary whitespace-nowrap">Retrieve</button>
        </div>
        <div id="retrieve-result" class="hidden mt-3">
          <div class="p-3 bg-sui-dark rounded-lg">
            <p class="text-xs text-sui-muted mb-1">Retrieved content</p>
            <pre class="text-xs text-sui-text overflow-auto max-h-32" id="blob-content"></pre>
          </div>
        </div>
      </div>

      <div class="mt-6 card border-dashed">
        <p class="text-xs text-sui-muted mb-3 font-medium">Walrus resources</p>
        <div class="flex flex-wrap gap-2">
          <a href="https://docs.walrus.site" target="_blank" rel="noopener" class="badge badge-blue">Documentation ↗</a>
          <a href="https://walrus.site" target="_blank" rel="noopener" class="badge badge-blue">Walrus Sites ↗</a>
          <a href="https://github.com/MystenLabs/walrus" target="_blank" rel="noopener" class="badge badge-blue">GitHub ↗</a>
        </div>
      </div>
    </div>
  `;

  const WALRUS_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
  const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

  // File picker
  const dropZone = container.querySelector<HTMLElement>("#drop-zone")!;
  const filePick = container.querySelector<HTMLElement>("#file-pick")!;
  const fileInput = container.querySelector<HTMLInputElement>("#file-input")!;
  const fileInfo = container.querySelector<HTMLElement>("#file-info")!;
  let selectedFile: File | null = null;

  filePick.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-sui-accent");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("border-sui-accent"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-sui-accent");
    const file = e.dataTransfer?.files[0];
    if (file) setFile(file);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) setFile(file);
  });

  function setFile(file: File) {
    selectedFile = file;
    container.querySelector<HTMLElement>("#file-name")!.textContent = file.name;
    container.querySelector<HTMLElement>("#file-size")!.textContent =
      `${(file.size / 1024).toFixed(1)} KB`;
    fileInfo.classList.remove("hidden");
  }

  container.querySelector("#store-btn")?.addEventListener("click", async () => {
    if (!selectedFile) return;
    const btn = container.querySelector<HTMLButtonElement>("#store-btn")!;
    btn.disabled = true;
    btn.textContent = "Storing…";
    try {
      const epochs = 5;
      const res = await fetch(
        `${WALRUS_PUBLISHER}/v1/blobs?epochs=${epochs}`,
        { method: "PUT", body: selectedFile }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { newlyCreated?: { blobObject?: { blobId?: string } }; alreadyCertified?: { blobId?: string } };
      const blobId =
        data.newlyCreated?.blobObject?.blobId ??
        data.alreadyCertified?.blobId ?? "unknown";
      container.querySelector<HTMLElement>("#blob-id")!.textContent = blobId;
      container.querySelector<HTMLElement>("#store-result")!.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      alert("Store failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      btn.disabled = false;
      btn.textContent = "Store on Walrus";
    }
  });

  container.querySelector("#copy-blob")?.addEventListener("click", () => {
    const id = container.querySelector<HTMLElement>("#blob-id")!.textContent ?? "";
    navigator.clipboard.writeText(id);
    const btn = container.querySelector<HTMLElement>("#copy-blob")!;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy blob ID"), 1500);
  });

  container.querySelector("#retrieve-btn")?.addEventListener("click", async () => {
    const input = container.querySelector<HTMLInputElement>("#blob-input")!;
    const blobId = input.value.trim();
    if (!blobId) return;
    const btn = container.querySelector<HTMLButtonElement>("#retrieve-btn")!;
    btn.disabled = true;
    btn.textContent = "Fetching…";
    const resultEl = container.querySelector<HTMLElement>("#retrieve-result")!;
    const contentEl = container.querySelector<HTMLElement>("#blob-content")!;
    try {
      const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      contentEl.textContent = text.length > 500 ? text.slice(0, 500) + "…" : text;
      resultEl.classList.remove("hidden");
    } catch (err) {
      contentEl.textContent = "Error: " + (err instanceof Error ? err.message : String(err));
      resultEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Retrieve";
    }
  });
}
