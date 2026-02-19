/**
 * SuiNS section — SuiNS SDK + gRPC
 *
 * Uses two complementary APIs:
 *   1. SuinsClient.getNameRecord(name)                         → full record incl. targetAddress (name → addr)
 *   2. SuiGrpcClient.defaultNameServiceName({ address })       → default name (addr → primary name)
 *
 * Docs:
 *   https://docs.suins.io/developer/sdk/querying
 *   https://docs.suins.io/developer/indexing
 */

import { SuinsClient } from "@mysten/suins";
import { wallet } from "../wallet";

let suinsClient: SuinsClient | null = null;
let lastNetwork = "";

function getSuinsClient(): SuinsClient {
  const network = wallet.getState().network === "mainnet" ? "mainnet" : "testnet";
  if (!suinsClient || lastNetwork !== network) {
    suinsClient = new SuinsClient({ client: wallet.getClient(), network });
    lastNetwork = network;
  }
  return suinsClient;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setLoading(btn: HTMLButtonElement, label: string, loading: boolean) {
  btn.disabled = loading;
  btn.textContent = loading ? label : btn.dataset.idle ?? btn.textContent;
}

function showResult(box: HTMLElement) { box.classList.add("visible"); }
function hideResult(box: HTMLElement) { box.classList.remove("visible"); }
function showErr(el: HTMLElement, msg: string) {
  el.textContent = msg;
  el.classList.add("visible");
}
function clearErr(el: HTMLElement) {
  el.textContent = "";
  el.classList.remove("visible");
}

function expiryLabel(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function mono(s: string) {
  return `<span class="mono">${s}</span>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

export function renderSuiNS(container: HTMLElement) {
  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">SuiNS</h1>
          <p class="section-desc">
            Forward &amp; reverse name resolution via the SuiNS SDK and gRPC.
          </p>
        </div>
        <a href="https://docs.suins.io/developer/indexing" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Indexer docs ↗</a>
      </div>

      <!-- ── Forward lookup: name → address ───────────────────────────── -->
      <div class="card">
        <div class="card-title">Forward lookup — name → address</div>
        <p class="card-note">Uses SuiNS SDK <code>getNameRecord()</code></p>
        <label class="input-label">SuiNS name</label>
        <div class="input-row">
          <input id="suins-name" type="text" class="input-field" placeholder="example.sui" />
          <button id="suins-resolve" class="btn btn-primary" data-idle="Resolve">Resolve</button>
        </div>
        <div class="result-box" id="suins-fwd-result">
          <div class="result-label">Target address</div>
          <div class="result-value green mono" id="suins-fwd-addr"></div>
        </div>
        <div class="error-msg" id="suins-fwd-err"></div>
      </div>

      <!-- ── Name record: full metadata ───────────────────────────────── -->
      <div class="card">
        <div class="card-title">Name record — full metadata</div>
        <p class="card-note">Uses <code>SuinsClient.getNameRecord()</code> — avatar, expiry, Walrus site, content hash</p>
        <label class="input-label">SuiNS name</label>
        <div class="input-row">
          <input id="suins-record-name" type="text" class="input-field" placeholder="example.sui" />
          <button id="suins-record-btn" class="btn btn-primary" data-idle="Fetch record">Fetch record</button>
        </div>
        <div class="result-box" id="suins-record-result">
          <table class="kv-table" id="suins-record-table"></table>
        </div>
        <div class="error-msg" id="suins-record-err"></div>
      </div>

      <!-- ── Reverse lookup: address → default name ─────────────────── -->
      <div class="card">
        <div class="card-title">Reverse lookup — address → default name</div>
        <p class="card-note">Uses gRPC <code>defaultNameServiceName()</code> — returns primary name</p>
        <label class="input-label">Sui address</label>
        <div class="input-row">
          <input id="suins-addr" type="text" class="input-field mono" placeholder="0x…" />
          <button id="suins-reverse" class="btn btn-primary" data-idle="Look up">Look up</button>
        </div>
        <div class="result-box" id="suins-rev-result">
          <div class="result-label">Default name for this address</div>
          <div id="suins-rev-names" class="tag-list"></div>
        </div>
        <div class="error-msg" id="suins-rev-err"></div>
      </div>

      <!-- ── Price list ────────────────────────────────────────────────── -->
      <div class="card">
        <div class="card-title">Registration price list</div>
        <p class="card-note">Current pricing via <code>SuinsClient.getPriceList()</code></p>
        <button id="suins-prices-btn" class="btn btn-secondary" data-idle="Load prices">Load prices</button>
        <div class="result-box" id="suins-prices-result">
          <table class="kv-table" id="suins-prices-table"></table>
        </div>
        <div class="error-msg" id="suins-prices-err"></div>
      </div>

      <div class="info-links">
        <div class="info-links-label">Resources</div>
        <div class="info-links-row">
          <a href="https://suins.io" target="_blank" rel="noopener" class="badge badge-blue">Register a name ↗</a>
          <a href="https://docs.suins.io/developer/indexing" target="_blank" rel="noopener" class="badge badge-blue">Indexer API ↗</a>
          <a href="https://docs.sui.io/sui-api-ref#suix_resolvenameservicenames" target="_blank" rel="noopener" class="badge badge-blue">RPC ref ↗</a>
          <a href="https://docs.suins.io/developer/sdk/querying" target="_blank" rel="noopener" class="badge badge-blue">SDK querying ↗</a>
        </div>
      </div>
    </div>
  `;

  // Pre-fill reverse-lookup input with connected wallet address
  const addrInput = container.querySelector<HTMLInputElement>("#suins-addr")!;
  const s = wallet.getState();
  if (s.address) addrInput.value = s.address;

  attachHandlers(container);
}

function attachHandlers(container: HTMLElement) {
  // ── Forward lookup ──────────────────────────────────────────────────────────
  container.querySelector("#suins-resolve")?.addEventListener("click", async () => {
    const name = container.querySelector<HTMLInputElement>("#suins-name")!.value.trim();
    if (!name) return;

    const btn    = container.querySelector<HTMLButtonElement>("#suins-resolve")!;
    const resBox = container.querySelector<HTMLElement>("#suins-fwd-result")!;
    const addrEl = container.querySelector<HTMLElement>("#suins-fwd-addr")!;
    const errEl  = container.querySelector<HTMLElement>("#suins-fwd-err")!;

    hideResult(resBox);
    clearErr(errEl);
    setLoading(btn, "Resolving…", true);

    try {
      const record = await getSuinsClient().getNameRecord(name);
      const address = record?.targetAddress ?? null;
      if (address) {
        addrEl.textContent = address;
        showResult(resBox);
      } else {
        showErr(errEl, `No address linked to "${name}"`);
      }
    } catch (err) {
      showErr(errEl, "Resolution failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(btn, "", false);
      btn.textContent = "Resolve";
    }
  });

  // ── Name record ─────────────────────────────────────────────────────────────
  container.querySelector("#suins-record-btn")?.addEventListener("click", async () => {
    const name = container.querySelector<HTMLInputElement>("#suins-record-name")!.value.trim();
    if (!name) return;

    const btn    = container.querySelector<HTMLButtonElement>("#suins-record-btn")!;
    const resBox = container.querySelector<HTMLElement>("#suins-record-result")!;
    const table  = container.querySelector<HTMLElement>("#suins-record-table")!;
    const errEl  = container.querySelector<HTMLElement>("#suins-record-err")!;

    hideResult(resBox);
    clearErr(errEl);
    setLoading(btn, "Fetching…", true);

    try {
      const record = await getSuinsClient().getNameRecord(name);
      if (!record) {
        showErr(errEl, `No record found for "${name}"`);
        return;
      }

      const rows: Array<[string, string]> = [
        ["Name", record.name ?? name],
        ["Target address", record.targetAddress ?? "—"],
        ["NFT object ID", record.nftId ?? "—"],
        ["Expires", expiryLabel(record.expirationTimestampMs)],
        ["Avatar object", record.avatar ?? "—"],
        ["Content hash", record.contentHash ?? "—"],
        ["Walrus site ID", record.walrusSiteId ?? "—"],
      ];

      table.innerHTML = rows
        .map(([k, v]) => `<tr><td class="kv-key">${k}</td><td class="kv-val mono-sm">${v}</td></tr>`)
        .join("");
      showResult(resBox);
    } catch (err) {
      showErr(errEl, "Fetch failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(btn, "", false);
      btn.textContent = "Fetch record";
    }
  });

  // ── Reverse lookup (Indexer API) ─────────────────────────────────────────────
  container.querySelector("#suins-reverse")?.addEventListener("click", async () => {
    const address = container.querySelector<HTMLInputElement>("#suins-addr")!.value.trim();
    if (!address) return;

    const btn    = container.querySelector<HTMLButtonElement>("#suins-reverse")!;
    const resBox = container.querySelector<HTMLElement>("#suins-rev-result")!;
    const namesEl = container.querySelector<HTMLElement>("#suins-rev-names")!;
    const errEl  = container.querySelector<HTMLElement>("#suins-rev-err")!;

    hideResult(resBox);
    clearErr(errEl);
    setLoading(btn, "Looking up…", true);

    try {
      const { data } = await wallet.getClient().defaultNameServiceName({ address });
      const defaultName = data.name;

      if (!defaultName) {
        showErr(errEl, "No default SuiNS name for this address.");
        return;
      }

      namesEl.innerHTML = `<span class="badge badge-green">${defaultName}</span>`;
      showResult(resBox);
    } catch (err) {
      showErr(errEl, "Lookup failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(btn, "", false);
      btn.textContent = "Look up";
    }
  });

  // ── Price list ───────────────────────────────────────────────────────────────
  container.querySelector("#suins-prices-btn")?.addEventListener("click", async () => {
    const btn    = container.querySelector<HTMLButtonElement>("#suins-prices-btn")!;
    const resBox = container.querySelector<HTMLElement>("#suins-prices-result")!;
    const table  = container.querySelector<HTMLElement>("#suins-prices-table")!;
    const errEl  = container.querySelector<HTMLElement>("#suins-prices-err")!;

    hideResult(resBox);
    clearErr(errEl);
    setLoading(btn, "Loading…", true);

    try {
      const priceList = await getSuinsClient().getPriceList();

      table.innerHTML = `<tr><th class="kv-key">Name length</th><th class="kv-val">Price (USDC)</th></tr>` +
        [...priceList.entries()]
          .map(([range, mist]) => {
            const [from, to] = range as [number, number];
            const label = from === to ? `${from} chars` : `${from}–${to} chars`;
            const usdc  = (Number(mist) / 1_000_000).toFixed(2);
            return `<tr><td class="kv-key">${label}</td><td class="kv-val">${mono("$" + usdc + " USDC")}</td></tr>`;
          })
          .join("");
      showResult(resBox);
    } catch (err) {
      showErr(errEl, "Failed to load prices: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(btn, "", false);
      btn.textContent = "Load prices";
    }
  });
}
