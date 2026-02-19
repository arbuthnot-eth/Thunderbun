/**
 * DeepBook section — DeepBookV3 CLOB on Sui via @mysten/deepbook-v3 SDK
 * Docs: https://docs.sui.io/standards/deepbook
 *
 * Uses the DeepBook SDK for:
 *   - midPrice, getLevel2TicksFromMid (order book)
 *   - poolTradeParams, poolBookParams (pool config)
 *   - PTB construction for limit orders via SDK transaction builders
 */

import { wallet } from "../wallet";
import { getDeepBookClient } from "../sui-client";
import { getSectionSource, getInfraSource } from "../source-files";
import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";

// Pool key used by the SDK registry (matches SDK constants)
const POOL_KEY = "SUI_USDC";

export function renderDeepBook(container: HTMLElement) {
  const dbClient = getDeepBookClient();
  const network = wallet.getState().network;

  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">DeepBook 📖</h1>
          <p class="section-desc">On-chain CLOB on Sui. Query pools and build limit/market orders.</p>
        </div>
        <div class="row gap-2">
          <span class="badge ${dbClient ? "badge-green" : "badge-yellow"}">${dbClient ? "SDK" : "No pools (" + network + ")"}</span>
          <a href="https://docs.sui.io/standards/deepbook" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Docs ↗</a>
        </div>
      </div>

      <!-- Pool stats -->
      <div class="card">
        <div class="row-between" style="margin-bottom:14px">
          <div class="card-title" style="margin:0">SUI/USDC Pool</div>
          <span class="badge badge-blue">DeepBook v3</span>
        </div>
        <div class="stat-grid" id="pool-stats">
          <div class="stat-box"><div class="stat-label">Mid Price</div><div class="stat-value" id="db-mid">—</div></div>
          <div class="stat-box"><div class="stat-label">Best Bid</div><div class="stat-value" id="db-bid">—</div></div>
          <div class="stat-box"><div class="stat-label">Best Ask</div><div class="stat-value" id="db-ask">—</div></div>
          <div class="stat-box"><div class="stat-label">Spread</div><div class="stat-value" id="db-spread">—</div></div>
        </div>
        <button id="db-refresh" class="btn btn-secondary btn-full mt-4" ${!dbClient ? "disabled" : ""}>
          ${dbClient ? "↻ Refresh" : "Switch to mainnet or testnet"}
        </button>
      </div>

      <!-- Pool params -->
      <div class="card">
        <div class="card-title">Pool Parameters</div>
        <div class="stat-grid" id="pool-params">
          <div class="stat-box"><div class="stat-label">Taker Fee</div><div class="stat-value" id="db-taker-fee">—</div></div>
          <div class="stat-box"><div class="stat-label">Maker Fee</div><div class="stat-value" id="db-maker-fee">—</div></div>
          <div class="stat-box"><div class="stat-label">Tick Size</div><div class="stat-value" id="db-tick">—</div></div>
          <div class="stat-box"><div class="stat-label">Lot Size</div><div class="stat-value" id="db-lot">—</div></div>
          <div class="stat-box"><div class="stat-label">Min Size</div><div class="stat-value" id="db-min">—</div></div>
          <div class="stat-box"><div class="stat-label">Stake Required</div><div class="stat-value" id="db-stake">—</div></div>
        </div>
      </div>

      <!-- Order book (5 ticks from mid) -->
      <div class="card">
        <div class="card-title">Order Book (5 ticks from mid)</div>
        <div id="db-orderbook" class="small mono" style="max-height:200px;overflow-y:auto">
          <div class="muted">Loading…</div>
        </div>
      </div>

      <!-- Order form -->
      <div class="card">
        <div class="card-title">Place Order</div>

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

        <div class="result-box" id="db-ptb-result">
          <div class="result-label">PTB preview</div>
          <pre class="small" id="db-ptb-code" style="max-height:150px;overflow:auto"></pre>
        </div>
        <div class="error-msg" id="db-order-err"></div>
      </div>

      <!-- SDK snippet -->
      <div class="card">
        <div class="card-title">SDK usage</div>
        <pre style="font-size:11px;line-height:1.6">import { DeepBookClient, mainnetCoins, mainnetPools } from '@mysten/deepbook-v3';

const db = new DeepBookClient({
  client: suiClient,
  network: 'mainnet',
  address: walletAddress,
  coins: mainnetCoins,
  pools: mainnetPools,
});

// Read pool data
const mid = await db.midPrice('SUI_USDC');
const book = await db.getLevel2TicksFromMid('SUI_USDC', 5);
const trade = await db.poolTradeParams('SUI_USDC');
const params = await db.poolBookParams('SUI_USDC');

// Build a limit order PTB
const tx = db.deepBook.placeLimitOrder({
  poolKey: 'SUI_USDC',
  balanceManagerKey: 'default',
  clientOrderId: Date.now(),
  price: 3.50,
  quantity: 10,
  isBid: true,
  selfMatchingOption: SelfMatchingOptions.CANCEL_TAKER,
});</pre>
      </div>

      <div class="info-links">
        <div class="info-links-label">Resources</div>
        <div class="info-links-row">
          <a href="https://deepbook.tech" target="_blank" rel="noopener" class="badge badge-blue">deepbook.tech ↗</a>
          <a href="https://docs.sui.io/standards/deepbook" target="_blank" rel="noopener" class="badge badge-blue">Sui Docs ↗</a>
          <a href="https://www.npmjs.com/package/@mysten/deepbook-v3" target="_blank" rel="noopener" class="badge badge-blue">npm ↗</a>
          <a href="https://suivision.xyz/coin/0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP" target="_blank" rel="noopener" class="badge badge-blue">DEEP token ↗</a>
        </div>
      </div>
    </div>
  `;

  // ── Fetch pool data via SDK ───────────────────────────────────────────
  async function fetchPool() {
    const db = getDeepBookClient();
    if (!db) return;

    const btn = container.querySelector<HTMLButtonElement>("#db-refresh")!;
    btn.disabled = true;
    btn.textContent = "Loading…";

    try {
      // Mid price
      const mid = await db.midPrice(POOL_KEY);
      container.querySelector("#db-mid")!.textContent = `$${mid.toFixed(4)}`;

      // Order book (5 ticks from mid)
      const book = await db.getLevel2TicksFromMid(POOL_KEY, 5);

      const bestBid = book.bid_prices.length > 0 ? book.bid_prices[0] : null;
      const bestAsk = book.ask_prices.length > 0 ? book.ask_prices[0] : null;
      const spread = bestBid && bestAsk ? bestAsk - bestBid : null;

      container.querySelector("#db-bid")!.textContent = bestBid ? `$${bestBid.toFixed(4)}` : "—";
      container.querySelector("#db-ask")!.textContent = bestAsk ? `$${bestAsk.toFixed(4)}` : "—";
      container.querySelector("#db-spread")!.textContent = spread ? `$${spread.toFixed(6)}` : "—";

      // Render order book
      const obEl = container.querySelector<HTMLElement>("#db-orderbook")!;
      let html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px 8px;font-size:11px">';
      html += '<div class="muted">Price</div><div class="muted">Qty</div><div class="muted">Side</div>';

      for (let i = book.ask_prices.length - 1; i >= 0; i--) {
        html += `<div style="color:var(--red)">${book.ask_prices[i].toFixed(4)}</div>`;
        html += `<div>${book.ask_quantities[i].toFixed(2)}</div>`;
        html += `<div style="color:var(--red)">Ask</div>`;
      }
      for (let i = 0; i < book.bid_prices.length; i++) {
        html += `<div style="color:var(--green)">${book.bid_prices[i].toFixed(4)}</div>`;
        html += `<div>${book.bid_quantities[i].toFixed(2)}</div>`;
        html += `<div style="color:var(--green)">Bid</div>`;
      }
      html += '</div>';
      obEl.innerHTML = html;

      // Pool trade params
      const trade = await db.poolTradeParams(POOL_KEY);
      container.querySelector("#db-taker-fee")!.textContent = `${(trade.takerFee * 100).toFixed(4)}%`;
      container.querySelector("#db-maker-fee")!.textContent = `${(trade.makerFee * 100).toFixed(4)}%`;
      container.querySelector("#db-stake")!.textContent = `${trade.stakeRequired.toFixed(0)} DEEP`;

      // Pool book params
      const book_params = await db.poolBookParams(POOL_KEY);
      container.querySelector("#db-tick")!.textContent = `$${book_params.tickSize}`;
      container.querySelector("#db-lot")!.textContent = `${book_params.lotSize} SUI`;
      container.querySelector("#db-min")!.textContent = `${book_params.minSize} SUI`;
    } catch (err) {
      console.warn("[deepbook] SDK fetch error:", err);
      container.querySelector("#db-mid")!.textContent = "Error";
      container.querySelector("#db-bid")!.textContent = "Error";
      container.querySelector("#db-ask")!.textContent = "Error";
      container.querySelector<HTMLElement>("#db-orderbook")!.innerHTML =
        `<div class="muted">${err instanceof Error ? err.message : "Failed to load"}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "↻ Refresh";
    }
  }

  container.querySelector("#db-refresh")?.addEventListener("click", fetchPool);
  if (dbClient) fetchPool();

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
    const hasDb = getDeepBookClient() !== null;
    btn.disabled = !s.connected || !hasDb;
    btn.textContent = !hasDb
      ? "Switch to mainnet or testnet"
      : s.connected
        ? `Place ${side.toUpperCase()} Order`
        : "Connect wallet to trade";
  }

  const unsub = wallet.subscribe(updateOrderBtn);
  cleanup(container, unsub);

  // ── Build order PTB ─────────────────────────────────────────────────────
  // Code viewer
  const src = getSectionSource("deepbook");
  if (src) {
    const cfg = { id: "deepbook-src", label: "deepbook.ts", source: src, secondaryLabel: "sui-client.ts", secondarySource: getInfraSource("sui-client.ts") ?? undefined };
    container.querySelector(".section")!.insertAdjacentHTML("beforeend", codeViewerHTML(cfg));
    attachCodeViewer(container, cfg);
  }

  container.querySelector("#db-order")?.addEventListener("click", () => {
    const price = parseFloat(container.querySelector<HTMLInputElement>("#db-price")!.value);
    const qty   = parseFloat(container.querySelector<HTMLInputElement>("#db-qty")!.value);
    const resultEl = container.querySelector<HTMLElement>("#db-ptb-result")!;
    const codeEl = container.querySelector<HTMLElement>("#db-ptb-code")!;
    const errEl = container.querySelector<HTMLElement>("#db-order-err")!;

    resultEl.classList.remove("visible");
    errEl.classList.remove("visible");

    if (!price || price <= 0 || !qty || qty <= 0) {
      errEl.textContent = "Enter a valid price and quantity.";
      errEl.classList.add("visible");
      return;
    }

    // Show PTB construction code
    const ptbCode = `// DeepBook SDK limit order PTB
const tx = db.deepBook.placeLimitOrder({
  poolKey: '${POOL_KEY}',
  balanceManagerKey: 'default',
  clientOrderId: ${Date.now()},
  price: ${price},
  quantity: ${qty},
  isBid: ${side === "buy"},
  selfMatchingOption: SelfMatchingOptions.CANCEL_TAKER,
});

// Sign and execute:
// await suiClient.signAndExecuteTransaction({
//   transaction: tx,
//   signer: wallet,
// });`;

    codeEl.textContent = ptbCode;
    resultEl.classList.add("visible");
  });
}

function cleanup(container: HTMLElement, unsub: () => void) {
  const obs = new MutationObserver(() => {
    if (!document.contains(container)) { unsub(); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
