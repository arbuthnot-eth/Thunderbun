import { wallet } from "../wallet";

export function renderDeepBook(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-6 max-w-2xl mx-auto">
      <div class="mb-6 mt-4 flex items-start justify-between">
        <div>
          <h1 class="section-header">DeepBook 📖</h1>
          <p class="section-desc">On-chain central limit order book for Sui. Query pools and market data.</p>
        </div>
        <a href="https://deepbook.tech" target="_blank" rel="noopener" class="btn-secondary text-xs">Docs ↗</a>
      </div>

      <div class="card mb-4">
        <div class="flex items-center justify-between mb-4">
          <p class="text-sm font-medium text-white">SUI/USDC Pool</p>
          <span class="badge badge-blue">DeepBook v3</span>
        </div>
        <div id="pool-stats" class="grid grid-cols-2 gap-3">
          <div class="p-3 bg-sui-dark rounded-lg">
            <p class="text-xs text-sui-muted mb-1">Best Bid</p>
            <p class="text-white font-mono text-sm" id="best-bid">—</p>
          </div>
          <div class="p-3 bg-sui-dark rounded-lg">
            <p class="text-xs text-sui-muted mb-1">Best Ask</p>
            <p class="text-white font-mono text-sm" id="best-ask">—</p>
          </div>
          <div class="p-3 bg-sui-dark rounded-lg">
            <p class="text-xs text-sui-muted mb-1">Mid Price</p>
            <p class="text-white font-mono text-sm" id="mid-price">—</p>
          </div>
          <div class="p-3 bg-sui-dark rounded-lg">
            <p class="text-xs text-sui-muted mb-1">Spread</p>
            <p class="text-white font-mono text-sm" id="spread">—</p>
          </div>
        </div>
        <button id="refresh-pool" class="btn-secondary w-full mt-4 text-xs">↻ Refresh Pool Data</button>
      </div>

      <div class="card mb-4">
        <p class="text-sm font-medium text-white mb-3">Place Order (Testnet Demo)</p>
        <div class="space-y-3">
          <div class="flex gap-2">
            <button id="side-buy" class="flex-1 py-2 rounded-lg text-sm font-medium bg-sui-success bg-opacity-20 text-sui-success border border-sui-success border-opacity-30">Buy</button>
            <button id="side-sell" class="flex-1 py-2 rounded-lg text-sm font-medium text-sui-muted border border-sui-border">Sell</button>
          </div>
          <input id="order-price" type="number" placeholder="Price (USDC)" class="input-field" step="0.0001" />
          <input id="order-qty" type="number" placeholder="Quantity (SUI)" class="input-field" step="0.1" />
        </div>
        <div id="order-preview" class="hidden mt-3 p-3 bg-sui-dark rounded-lg text-xs text-sui-muted">
          <p>Total: <span id="order-total" class="text-white font-mono"></span> USDC</p>
        </div>
        <button id="place-order-btn" class="btn-primary w-full mt-4" disabled>Connect wallet to trade</button>
      </div>

      <div class="mt-4 card border-dashed">
        <p class="text-xs text-sui-muted mb-3 font-medium">DeepBook resources</p>
        <div class="flex flex-wrap gap-2">
          <a href="https://deepbook.tech" target="_blank" rel="noopener" class="badge badge-blue">DeepBook v3 ↗</a>
          <a href="https://docs.sui.io/standards/deepbook" target="_blank" rel="noopener" class="badge badge-blue">Sui Docs ↗</a>
        </div>
      </div>
    </div>
  `;

  // Pool data fetch (using DeepBook v3 public RPC endpoint)
  const DEEPBOOK_POOL = "0x4405b50d791fd3346754e8171aaab6bc2ed26c2c46efdd033c14b30ae507ac33";

  async function fetchPoolData() {
    const client = wallet.getClient();
    const btn = container.querySelector<HTMLButtonElement>("#refresh-pool")!;
    btn.disabled = true;
    btn.textContent = "Loading…";

    try {
      const result = await client.call("suix_getPoolSummary", [DEEPBOOK_POOL]);
      const summary = result as { bestBid?: string; bestAsk?: string } | null;
      if (summary) {
        const bid = parseFloat(summary.bestBid ?? "0");
        const ask = parseFloat(summary.bestAsk ?? "0");
        const mid = (bid + ask) / 2;
        const spread = ask - bid;
        container.querySelector("#best-bid")!.textContent = bid > 0 ? `$${bid.toFixed(4)}` : "—";
        container.querySelector("#best-ask")!.textContent = ask > 0 ? `$${ask.toFixed(4)}` : "—";
        container.querySelector("#mid-price")!.textContent = mid > 0 ? `$${mid.toFixed(4)}` : "—";
        container.querySelector("#spread")!.textContent = spread > 0 ? `$${spread.toFixed(6)}` : "—";
      }
    } catch {
      container.querySelector("#best-bid")!.textContent = "N/A";
      container.querySelector("#best-ask")!.textContent = "N/A";
    } finally {
      btn.disabled = false;
      btn.textContent = "↻ Refresh Pool Data";
    }
  }

  container.querySelector("#refresh-pool")?.addEventListener("click", fetchPoolData);
  fetchPoolData();

  // Order side toggle
  let side: "buy" | "sell" = "buy";
  container.querySelector("#side-buy")?.addEventListener("click", () => {
    side = "buy";
    container.querySelector("#side-buy")!.className = "flex-1 py-2 rounded-lg text-sm font-medium bg-sui-success bg-opacity-20 text-sui-success border border-sui-success border-opacity-30";
    container.querySelector("#side-sell")!.className = "flex-1 py-2 rounded-lg text-sm font-medium text-sui-muted border border-sui-border";
  });
  container.querySelector("#side-sell")?.addEventListener("click", () => {
    side = "sell";
    container.querySelector("#side-sell")!.className = "flex-1 py-2 rounded-lg text-sm font-medium bg-sui-error bg-opacity-20 text-sui-error border border-sui-error border-opacity-30";
    container.querySelector("#side-buy")!.className = "flex-1 py-2 rounded-lg text-sm font-medium text-sui-muted border border-sui-border";
  });

  // Order preview
  const updatePreview = () => {
    const price = parseFloat((container.querySelector<HTMLInputElement>("#order-price")!).value);
    const qty = parseFloat((container.querySelector<HTMLInputElement>("#order-qty")!).value);
    const preview = container.querySelector<HTMLElement>("#order-preview")!;
    if (price > 0 && qty > 0) {
      preview.classList.remove("hidden");
      container.querySelector("#order-total")!.textContent = (price * qty).toFixed(4);
    } else {
      preview.classList.add("hidden");
    }
  };
  container.querySelector("#order-price")?.addEventListener("input", updatePreview);
  container.querySelector("#order-qty")?.addEventListener("input", updatePreview);

  // Order button state
  const unsubscribe = wallet.subscribe((state) => {
    const btn = container.querySelector<HTMLButtonElement>("#place-order-btn")!;
    if (state.connected) {
      btn.disabled = false;
      btn.textContent = `Place ${side.toUpperCase()} Order`;
    } else {
      btn.disabled = true;
      btn.textContent = "Connect wallet to trade";
    }
  });

  container.querySelector("#place-order-btn")?.addEventListener("click", () => {
    alert("Order placement requires a live DeepBook v3 integration.\nSee https://deepbook.tech for SDK usage.");
  });

  // Cleanup
  const observer = new MutationObserver(() => {
    if (!document.contains(container)) { unsubscribe(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
