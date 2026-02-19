/**
 * NFT section — browse owned NFTs + TradePort data API
 * Docs: https://www.tradeport.xyz/docs
 *
 * Two tools:
 *   1. SuiGrpcClient.listOwnedObjects() — fetches wallet NFTs with JSON struct data
 *   2. TradePort GraphQL API — rich collection/listing/history data
 *
 * TradePort Trading SDK (@tradeport/sui-trading-sdk) requires an API key.
 * Request one at: https://form.asana.com/?k=ClRNDmKRUMlBEYDWbxR_Mw
 */

import { wallet } from "../wallet";
import { getSectionSource } from "../source-files";
import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";

const TRADEPORT_GRAPHQL = "https://api.tradeport.xyz/graphql";

interface NFT {
  objectId: string;
  name: string;
  imageUrl: string;
  collection: string;
}

export function renderNFT(container: HTMLElement) {
  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">NFTs 🖼</h1>
          <p class="section-desc">Browse your Sui NFTs and query TradePort collection data.</p>
        </div>
        <a href="https://www.tradeport.xyz/docs" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Docs ↗</a>
      </div>

      <div id="nft-prompt" class="card hidden">
        <p class="small muted" style="text-align:center;padding:24px 0">Connect your wallet to view your NFTs.</p>
      </div>

      <div id="nft-loading" class="loading-center hidden">
        <div class="spinner"></div>
        <p>Loading NFTs…</p>
      </div>

      <div id="nft-empty" class="card hidden" style="text-align:center;padding:40px 20px">
        <div style="font-size:40px;margin-bottom:12px">🖼</div>
        <p class="muted small">No NFTs found in this wallet.</p>
        <a href="https://tradeport.xyz/sui" target="_blank" rel="noopener" class="btn btn-primary btn-sm mt-3" style="display:inline-flex">Browse on TradePort</a>
      </div>

      <div id="nft-grid" class="nft-grid"></div>

      <!-- TradePort collection search -->
      <div class="card mt-4" id="tradeport-card" style="margin-top:24px">
        <div class="card-title">TradePort collection search</div>
        <p class="small muted" style="margin-bottom:12px">
          Query collection stats via the <a href="https://www.tradeport.xyz/docs/nft-data-api/overview" target="_blank">TradePort GraphQL API</a>.
          No API key needed for read operations on public data.
        </p>
        <div class="input-row">
          <input id="tp-slug" type="text" class="input-field" placeholder="Collection slug (e.g. suifrens)" />
          <button id="tp-search" class="btn btn-primary">Search</button>
        </div>
        <div class="result-box" id="tp-result">
          <div id="tp-result-inner"></div>
        </div>
        <div class="error-msg" id="tp-err"></div>
      </div>

      <div class="info-links" style="margin-top:14px">
        <div class="info-links-label">Resources</div>
        <div class="info-links-row">
          <a href="https://tradeport.xyz/sui" target="_blank" rel="noopener" class="badge badge-blue">TradePort ↗</a>
          <a href="https://www.tradeport.xyz/docs/nft-data-api/overview" target="_blank" rel="noopener" class="badge badge-blue">GraphQL API ↗</a>
          <a href="https://www.tradeport.xyz/docs/nft-trading-sdk/sui-sdk/getting-started" target="_blank" rel="noopener" class="badge badge-blue">Trading SDK ↗</a>
          <a href="https://bluemove.net" target="_blank" rel="noopener" class="badge badge-blue">BlueMove ↗</a>
        </div>
      </div>
    </div>
  `;

  // Code viewer
  const nftSrc = getSectionSource("nft");
  if (nftSrc) {
    const cfg = { id: "nft-src", label: "nft.ts", source: nftSrc };
    container.querySelector(".section")!.insertAdjacentHTML("beforeend", codeViewerHTML(cfg));
    attachCodeViewer(container, cfg);
  }

  const prompt  = container.querySelector<HTMLElement>("#nft-prompt")!;
  const loading = container.querySelector<HTMLElement>("#nft-loading")!;
  const empty   = container.querySelector<HTMLElement>("#nft-empty")!;
  const grid    = container.querySelector<HTMLElement>("#nft-grid")!;

  async function loadNFTs(address: string) {
    loading.classList.remove("hidden");
    prompt.classList.add("hidden");
    empty.classList.add("hidden");
    grid.innerHTML = "";

    try {
      const client = wallet.getClient();
      const { objects } = await client.listOwnedObjects({
        owner: address,
        include: { json: true },
        limit: 24,
      });

      const nfts: NFT[] = objects
        .filter((o) => {
          const j = o.json as Record<string, unknown> | null;
          return j && (j["image_url"] || j["img_url"] || j["url"] || j["name"]);
        })
        .map((o) => {
          const j = (o.json ?? {}) as Record<string, unknown>;
          return {
            objectId:  o.objectId,
            name:      String(j["name"] ?? j["title"] ?? "Unnamed"),
            imageUrl:  String(j["image_url"] ?? j["img_url"] ?? j["url"] ?? ""),
            collection: String(j["collection"] ?? j["project_name"] ?? ""),
          };
        });

      loading.classList.add("hidden");

      if (nfts.length === 0) {
        empty.classList.remove("hidden");
        return;
      }

      for (const nft of nfts) {
        const card = document.createElement("div");
        card.className = "nft-card";
        card.innerHTML = `
          ${nft.imageUrl
            ? `<img class="nft-img" src="${nft.imageUrl}" alt="${nft.name}" loading="lazy" />`
            : `<div class="nft-img-placeholder">🖼</div>`}
          <div class="nft-meta">
            <div class="nft-name">${nft.name}</div>
            ${nft.collection ? `<div class="nft-coll">${nft.collection}</div>` : ""}
          </div>
        `;
        card.addEventListener("click", () =>
          window.open(`https://tradeport.xyz/sui/token/${nft.objectId}`, "_blank")
        );
        grid.appendChild(card);
      }
    } catch (err) {
      loading.classList.add("hidden");
      grid.innerHTML = `<p class="small" style="color:var(--red);padding:20px 0">Failed to load NFTs: ${err instanceof Error ? err.message : String(err)}</p>`;
    }
  }

  const state = wallet.getState();
  if (!state.connected || !state.address) {
    prompt.classList.remove("hidden");
  } else {
    loadNFTs(state.address);
  }

  const unsub = wallet.subscribe((s) => {
    if (s.connected && s.address) {
      prompt.classList.add("hidden");
      loadNFTs(s.address);
    } else {
      prompt.classList.remove("hidden");
      grid.innerHTML = "";
      loading.classList.add("hidden");
    }
  });

  // ── TradePort GraphQL search ───────────────────────────────────────────
  container.querySelector("#tp-search")?.addEventListener("click", async () => {
    const slug   = container.querySelector<HTMLInputElement>("#tp-slug")!.value.trim();
    const btn    = container.querySelector<HTMLButtonElement>("#tp-search")!;
    const result = container.querySelector<HTMLElement>("#tp-result")!;
    const inner  = container.querySelector<HTMLElement>("#tp-result-inner")!;
    const err    = container.querySelector<HTMLElement>("#tp-err")!;

    result.classList.remove("visible");
    err.classList.remove("visible");

    if (!slug) return;

    btn.disabled = true;
    btn.textContent = "Searching…";

    try {
      const query = `
        query GetCollection($slug: String!) {
          sui {
            collection(slug: $slug) {
              title
              supply
              floor
              volume24h
              owners
            }
          }
        }
      `;

      const res = await fetch(TRADEPORT_GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { slug } }),
      });

      const json = await res.json() as {
        data?: { sui?: { collection?: Record<string, unknown> | null } };
        errors?: Array<{ message: string }>;
      };

      if (json.errors?.length) throw new Error(json.errors[0]!.message);

      const col = json.data?.sui?.collection;
      if (!col) throw new Error(`Collection "${slug}" not found`);

      inner.innerHTML = `
        <div class="row-between"><span class="result-label">Name</span><span class="result-value">${col["title"] ?? "—"}</span></div>
        <div class="row-between mt-2"><span class="result-label">Supply</span><span class="result-value mono">${col["supply"] ?? "—"}</span></div>
        <div class="row-between mt-2"><span class="result-label">Floor</span><span class="result-value mono">${col["floor"] ? Number(col["floor"]) / 1e9 + " SUI" : "—"}</span></div>
        <div class="row-between mt-2"><span class="result-label">24h Volume</span><span class="result-value mono">${col["volume24h"] ? Number(col["volume24h"]) / 1e9 + " SUI" : "—"}</span></div>
        <div class="row-between mt-2"><span class="result-label">Owners</span><span class="result-value mono">${col["owners"] ?? "—"}</span></div>
      `;
      result.classList.add("visible");
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : String(e);
      err.classList.add("visible");
    } finally {
      btn.disabled = false;
      btn.textContent = "Search";
    }
  });

  const obs = new MutationObserver(() => {
    if (!document.contains(container)) { unsub(); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
