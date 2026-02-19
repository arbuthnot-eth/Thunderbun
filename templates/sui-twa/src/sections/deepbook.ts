/**
 * DeepBook section — DeepBookV3 CLOB on Sui
 * Docs: https://docs.sui.io/standards/deepbook
 *
 * DeepBookV3 is queried via the Sui RPC (suix_* endpoints).
 * The DEEP token is the fee token: 0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP
 * Pool creation and trading requires building PTBs (programmable transaction blocks).
 */

import { wallet } from "../wallet";

// Mainnet SUI/USDC pool (DeepBook v3)
const SUI_USDC_POOL =
  "0x4405b50d791fd3346754e8171aaab6bc2ed26c2c46efdd033c14b30ae507ac33";

export function renderDeepBook(container: HTMLElement) {
  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">DeepBook 📖</h1>
          <p class="section-desc">On-chain CLOB on Sui. Query pools and build limit/market orders.</p>
        </div>
        <a href="https://docs.sui.io/standards/deepbook" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Docs ↗</a>
      </div>

      <!-- Pool stats -->
      <div class="card">
        <div class="row-between" style="margin-bottom:14px">
          <div class="card-title" style="margin:0">SUI/USDC Pool</div>
          <span class="badge badge-blue">DeepBook v3</span>
        </div>
        <div class="stat-grid" id="pool-stats">
          <div class="stat-box"><div class="stat-label">Best Bid</div><div class="stat-value" id="db-bid">—</div></div>
          <div class="stat-box"><div class="stat-label">Best Ask</div><div class="stat-value" id="db-ask">—</div></div>
          <div class="stat-box"><div class="stat-label">Mid Price</div><div class="stat-value" id="db-mid">—</div></div>
          <div class="stat-box"><div class="stat-label">Spread</div><div class="stat-value" id="db-spread">—</div></div>
        </div>
        <button id="db-refresh" class="btn btn-secondary btn-full mt-4">↻ Refresh</button>
      </div>

      <!-- Order form (demo) -->
      <div class="card">
        <div class="card-title">Place Order <span class="badge badge-yellow">Demo</span></div>

        <div class="side-toggle">
          <button id="db-buy" class="side-btn buy active">Buy</button>
          <button id="db-sell" class="side-btn sell">Sell</button>
        </div>

        <div class="input-group">
          <label class="input-label">Price (USDC)</label>
          <input id="db-price" type="number" class="input-field" placeholder="0.0000" step="0.0001" min="0" />
        </div>
        <div class="input-group">
          <label class="input-label">Quantity (SUI)</label>
          <input id="db-qty" type="number" class="input-field" placeholder="0.00" step="0.1" min="0" />
        </div>

        <div class="result-box" id="db-preview">
          <div class="result-label">Order total</div>
          <div class="result-value" id="db-total"></div>
        </div>

        <button id="db-order" class="btn btn-primary btn-full mt-3" disabled>
          Connect wallet to trade
        </button>
        <p class="small muted mt-3">
          Real order execution requires building a PTB with DeepBook's Move package.
          See <a href="https://docs.sui.io/standards/deepbook" target="_blank">DeepBook docs</a> for the full SDK.
        </p>
      </div>

      <div class="info-links">
        <div class="info-links-label">Resources</div>
        <div class="info-links-row">
          <a href="https://deepbook.tech" target="_blank" rel="noopener" class="badge badge-blue">deepbook.tech ↗</a>
          <a href="https://docs.sui.io/standards/deepbook" target="_blank" rel="noopener" class="badge badge-blue">Sui Docs ↗</a>
          <a href="https://suivision.xyz/coin/0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP" target="_blank" rel="noopener" class="badge badge-blue">DEEP token ↗</a>
        </div>
      </div>
    </div>
  `;

  // ── Fetch pool stats ────────────────────────────────────────────────────
  async function fetchPool() {
    const btn = container.querySelector<HTMLButtonElement>("#db-refresh")!;
    btn.disabled = true;
    btn.textContent = "Loading…";

    try {
      // Query pool summary via Sui JSON-RPC
      const client = wallet.getClient();
      const result = await client.call("suix_getPoolSummary", [SUI_USDC_POOL]) as
        { bestBid?: string | null; bestAsk?: string | null } | null;

      if (result) {
        const bid = result.bestBid ? Number(result.bestBid) / 1e9 : null;
        const ask = result.bestAsk ? Number(result.bestAsk) / 1e9 : null;
        const mid = bid && ask ? (bid + ask) / 2 : null;
        const spread = bid && ask ? ask - bid : null;

        container.querySelector("#db-bid")!.textContent    = bid    ? `$${bid.toFixed(4)}`    : "—";
        container.querySelector("#db-ask")!.textContent    = ask    ? `$${ask.toFixed(4)}`    : "—";
        container.querySelector("#db-mid")!.textContent    = mid    ? `$${mid.toFixed(4)}`    : "—";
        container.querySelector("#db-spread")!.textContent = spread ? `$${spread.toFixed(6)}` : "—";
      } else {
        // Fallback: fetch pool object for display
        const obj = await client.getObject({ id: SUI_USDC_POOL, options: { showContent: true } });
        if (obj.data) {
          container.querySelector("#db-bid")!.textContent = "N/A";
          container.querySelector("#db-ask")!.textContent = "N/A";
          container.querySelector("#db-mid")!.textContent = "Query not supported";
          container.querySelector("#db-spread")!.textContent = "—";
        }
      }
    } catch (err) {
      console.warn("[deepbook] pool fetch error:", err);
      container.querySelector("#db-bid")!.textContent = "Error";
      container.querySelector("#db-ask")!.textContent = "Error";
    } finally {
      btn.disabled = false;
      btn.textContent = "↻ Refresh";
    }
  }

  container.querySelector("#db-refresh")?.addEventListener("click", fetchPool);
  fetchPool();

  // ── Side toggle ─────────────────────────────────────────────────────────
  let side: "buy" | "sell" = "buy";

  container.querySelector("#db-buy")?.addEventListener("click", () => {
    side = "buy";
    container.querySelector("#db-buy")!.classList.add("active");
    container.querySelector("#db-sell")!.classList.remove("active");
    updateOrderBtn();
  });
  container.querySelector("#db-sell")?.addEventListener("click", () => {
    side = "sell";
    container.querySelector("#db-sell")!.classList.add("active");
    container.querySelector("#db-buy")!.classList.remove("active");
    updateOrderBtn();
  });

  // ── Order preview ────────────────────────────────────────────────────────
  const updatePreview = () => {
    const price = parseFloat(container.querySelector<HTMLInputElement>("#db-price")!.value);
    const qty   = parseFloat(container.querySelector<HTMLInputElement>("#db-qty")!.value);
    const preview = container.querySelector<HTMLElement>("#db-preview")!;
    if (price > 0 && qty > 0) {
      preview.classList.add("visible");
      container.querySelector("#db-total")!.textContent = `${(price * qty).toFixed(4)} USDC`;
    } else {
      preview.classList.remove("visible");
    }
  };
  container.querySelector("#db-price")?.addEventListener("input", updatePreview);
  container.querySelector("#db-qty")?.addEventListener("input",   updatePreview);

  // ── Order button ─────────────────────────────────────────────────────────
  function updateOrderBtn() {
    const btn = container.querySelector<HTMLButtonElement>("#db-order")!;
    const s = wallet.getState();
    btn.disabled = !s.connected;
    btn.textContent = s.connected ? `Place ${side.toUpperCase()} Order` : "Connect wallet to trade";
  }

  const unsub = wallet.subscribe(updateOrderBtn);
  cleanup(container, unsub);

  container.querySelector("#db-order")?.addEventListener("click", () => {
    alert(
      "To place a real order:\n\n" +
      "1. Build a PTB calling DeepBook's place_limit_order or place_market_order\n" +
      "2. Pay fees in DEEP token\n" +
      "3. Sign with wallet.getState() address\n\n" +
      "See https://docs.sui.io/standards/deepbook for the full Move package interface."
    );
  });
}

function cleanup(container: HTMLElement, unsub: () => void) {
  const obs = new MutationObserver(() => {
    if (!document.contains(container)) { unsub(); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
