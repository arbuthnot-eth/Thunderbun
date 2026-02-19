import { wallet } from "../wallet";

export function renderSuiNS(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-6 max-w-2xl mx-auto">
      <div class="mb-6 mt-4 flex items-start justify-between">
        <div>
          <h1 class="section-header">SuiNS 🔖</h1>
          <p class="section-desc">Resolve human-readable .sui names to addresses.</p>
        </div>
        <a href="https://suins.io" target="_blank" rel="noopener" class="btn-secondary text-xs">Docs ↗</a>
      </div>

      <div class="card mb-4">
        <label class="block text-xs font-medium text-sui-muted mb-2">Resolve a .sui name</label>
        <div class="flex gap-2">
          <input id="suins-input" type="text" placeholder="example.sui" class="input-field" />
          <button id="suins-resolve-btn" class="btn-primary whitespace-nowrap">Resolve</button>
        </div>
        <div id="suins-result" class="mt-3 hidden">
          <div class="flex items-center gap-2 p-3 bg-sui-dark rounded-lg">
            <span class="text-sui-success text-sm">✓</span>
            <div>
              <p class="text-xs text-sui-muted">Resolved address</p>
              <p class="text-sm text-white font-mono" id="suins-result-address"></p>
            </div>
          </div>
        </div>
        <div id="suins-error" class="mt-3 hidden">
          <p class="text-sui-error text-sm" id="suins-error-msg"></p>
        </div>
      </div>

      <div class="card">
        <label class="block text-xs font-medium text-sui-muted mb-2">Look up name for an address</label>
        <div class="flex gap-2">
          <input id="suins-reverse-input" type="text" placeholder="0x..." class="input-field" />
          <button id="suins-reverse-btn" class="btn-primary whitespace-nowrap">Look up</button>
        </div>
        <div id="suins-reverse-result" class="mt-3 hidden">
          <div class="flex items-center gap-2 p-3 bg-sui-dark rounded-lg">
            <span class="text-sui-success text-sm">✓</span>
            <p class="text-sm text-white" id="suins-reverse-name"></p>
          </div>
        </div>
      </div>

      <div class="mt-6 card border-dashed">
        <p class="text-xs text-sui-muted mb-3 font-medium">Quick links</p>
        <div class="flex flex-wrap gap-2">
          <a href="https://suins.io" target="_blank" rel="noopener" class="badge badge-blue">Register a name ↗</a>
          <a href="https://docs.sui.io/standards/suins" target="_blank" rel="noopener" class="badge badge-blue">SuiNS standard ↗</a>
        </div>
      </div>
    </div>
  `;

  const resolveBtn = container.querySelector<HTMLButtonElement>("#suins-resolve-btn")!;
  const reverseBtn = container.querySelector<HTMLButtonElement>("#suins-reverse-btn")!;

  resolveBtn.addEventListener("click", async () => {
    const input = container.querySelector<HTMLInputElement>("#suins-input")!;
    const name = input.value.trim();
    if (!name) return;

    const result = container.querySelector<HTMLElement>("#suins-result")!;
    const errorEl = container.querySelector<HTMLElement>("#suins-error")!;
    const addrEl = container.querySelector<HTMLElement>("#suins-result-address")!;
    const errMsg = container.querySelector<HTMLElement>("#suins-error-msg")!;

    result.classList.add("hidden");
    errorEl.classList.add("hidden");
    resolveBtn.disabled = true;
    resolveBtn.textContent = "Resolving…";

    try {
      const client = wallet.getClient();
      const res = await client.call("suix_resolveNameServiceAddress", [name]);
      if (res) {
        addrEl.textContent = res as string;
        result.classList.remove("hidden");
      } else {
        errMsg.textContent = `No address found for "${name}"`;
        errorEl.classList.remove("hidden");
      }
    } catch {
      errMsg.textContent = "Resolution failed. Check the name and try again.";
      errorEl.classList.remove("hidden");
    } finally {
      resolveBtn.disabled = false;
      resolveBtn.textContent = "Resolve";
    }
  });

  reverseBtn.addEventListener("click", async () => {
    const input = container.querySelector<HTMLInputElement>("#suins-reverse-input")!;
    const address = input.value.trim() || wallet.getState().address || "";
    if (!address) return;

    const resultEl = container.querySelector<HTMLElement>("#suins-reverse-result")!;
    const nameEl = container.querySelector<HTMLElement>("#suins-reverse-name")!;

    resultEl.classList.add("hidden");
    reverseBtn.disabled = true;
    reverseBtn.textContent = "Looking up…";

    try {
      const client = wallet.getClient();
      const res = await client.call("suix_resolveNameServiceNames", [address]);
      const names = (res as { data: string[] })?.data;
      if (names && names.length > 0) {
        nameEl.textContent = names[0]!;
        resultEl.classList.remove("hidden");
      } else {
        nameEl.textContent = "No .sui name found for this address";
        resultEl.classList.remove("hidden");
      }
    } catch {
      nameEl.textContent = "Lookup failed.";
      resultEl.classList.remove("hidden");
    } finally {
      reverseBtn.disabled = false;
      reverseBtn.textContent = "Look up";
    }
  });

  // Pre-fill with connected address for reverse lookup
  const state = wallet.getState();
  if (state.address) {
    const reverseInput = container.querySelector<HTMLInputElement>("#suins-reverse-input")!;
    reverseInput.value = state.address;
  }
}
