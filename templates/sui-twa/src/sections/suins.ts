/**
 * SuiNS section — uses @mysten/suins SuinsClient
 * Docs: https://docs.suins.io/developer/sdk
 * Package: npm install @mysten/suins
 */

import { SuinsClient } from "@mysten/suins";
import { wallet } from "../wallet";

let suinsClient: SuinsClient | null = null;

function getClient(): SuinsClient {
  if (!suinsClient) {
    suinsClient = new SuinsClient({
      client: wallet.getClient(),
      network: wallet.getState().network === "mainnet" ? "mainnet" : "testnet",
    });
  }
  return suinsClient;
}

export function renderSuiNS(container: HTMLElement) {
  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">SuiNS 🔖</h1>
          <p class="section-desc">Resolve human-readable .sui names to addresses.</p>
        </div>
        <a href="https://docs.suins.io" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Docs ↗</a>
      </div>

      <!-- Forward resolve: name → address -->
      <div class="card">
        <div class="card-title">Resolve name → address</div>
        <label class="input-label">SuiNS name</label>
        <div class="input-row">
          <input id="suins-name" type="text" class="input-field" placeholder="example.sui" />
          <button id="suins-resolve" class="btn btn-primary">Resolve</button>
        </div>
        <div class="result-box" id="suins-fwd-result">
          <div class="result-label">Resolved address</div>
          <div class="result-value green mono" id="suins-fwd-addr"></div>
        </div>
        <div class="error-msg" id="suins-fwd-err"></div>
      </div>

      <!-- Reverse resolve: address → name -->
      <div class="card">
        <div class="card-title">Reverse lookup address → name</div>
        <label class="input-label">Sui address</label>
        <div class="input-row">
          <input id="suins-addr" type="text" class="input-field mono" placeholder="0x…" />
          <button id="suins-reverse" class="btn btn-primary">Look up</button>
        </div>
        <div class="result-box" id="suins-rev-result">
          <div class="result-label">SuiNS names</div>
          <div class="result-value green" id="suins-rev-names"></div>
        </div>
        <div class="error-msg" id="suins-rev-err"></div>
      </div>

      <div class="info-links">
        <div class="info-links-label">Resources</div>
        <div class="info-links-row">
          <a href="https://suins.io" target="_blank" rel="noopener" class="badge badge-blue">Register a name ↗</a>
          <a href="https://docs.suins.io/developer/sdk" target="_blank" rel="noopener" class="badge badge-blue">SDK reference ↗</a>
          <a href="https://www.npmjs.com/package/@mysten/suins" target="_blank" rel="noopener" class="badge badge-blue">npm ↗</a>
        </div>
      </div>
    </div>
  `;

  // Pre-fill reverse input with connected address
  const addrInput = container.querySelector<HTMLInputElement>("#suins-addr")!;
  const s = wallet.getState();
  if (s.address) addrInput.value = s.address;

  // Forward resolve
  container.querySelector("#suins-resolve")?.addEventListener("click", async () => {
    const name = container.querySelector<HTMLInputElement>("#suins-name")!.value.trim();
    if (!name) return;

    const btn = container.querySelector<HTMLButtonElement>("#suins-resolve")!;
    const resultEl = container.querySelector<HTMLElement>("#suins-fwd-result")!;
    const addrEl   = container.querySelector<HTMLElement>("#suins-fwd-addr")!;
    const errEl    = container.querySelector<HTMLElement>("#suins-fwd-err")!;

    resultEl.classList.remove("visible");
    errEl.classList.remove("visible");
    btn.disabled = true;
    btn.textContent = "Resolving…";

    try {
      // SuinsClient.getAddress() resolves a name to its linked Sui address
      const address = await getClient().getAddress(name);
      if (address) {
        addrEl.textContent = address;
        resultEl.classList.add("visible");
      } else {
        errEl.textContent = `No address linked to "${name}"`;
        errEl.classList.add("visible");
      }
    } catch (err) {
      errEl.textContent = "Resolution failed: " + (err instanceof Error ? err.message : String(err));
      errEl.classList.add("visible");
    } finally {
      btn.disabled = false;
      btn.textContent = "Resolve";
    }
  });

  // Reverse lookup
  container.querySelector("#suins-reverse")?.addEventListener("click", async () => {
    const address = addrInput.value.trim();
    if (!address) return;

    const btn      = container.querySelector<HTMLButtonElement>("#suins-reverse")!;
    const resultEl = container.querySelector<HTMLElement>("#suins-rev-result")!;
    const namesEl  = container.querySelector<HTMLElement>("#suins-rev-names")!;
    const errEl    = container.querySelector<HTMLElement>("#suins-rev-err")!;

    resultEl.classList.remove("visible");
    errEl.classList.remove("visible");
    btn.disabled = true;
    btn.textContent = "Looking up…";

    try {
      // SuinsClient.getNames() returns an array of names for an address
      const names = await getClient().getNames(address);
      if (names && names.length > 0) {
        namesEl.textContent = names.join(", ");
        resultEl.classList.add("visible");
      } else {
        errEl.textContent = "No SuiNS names found for this address.";
        errEl.classList.add("visible");
      }
    } catch (err) {
      errEl.textContent = "Lookup failed: " + (err instanceof Error ? err.message : String(err));
      errEl.classList.add("visible");
    } finally {
      btn.disabled = false;
      btn.textContent = "Look up";
    }
  });
}
