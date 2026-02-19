import { wallet } from "../wallet";

interface NFTItem {
  objectId: string;
  name?: string;
  imageUrl?: string;
  collection?: string;
}

export function renderNFT(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-6 max-w-2xl mx-auto">
      <div class="mb-6 mt-4 flex items-start justify-between">
        <div>
          <h1 class="section-header">NFTs 🖼</h1>
          <p class="section-desc">Browse your Sui NFTs via TradePort.</p>
        </div>
        <a href="https://tradeport.xyz" target="_blank" rel="noopener" class="btn-secondary text-xs">TradePort ↗</a>
      </div>

      <div id="nft-connect-prompt" class="card text-center py-10 hidden">
        <p class="text-sui-muted text-sm">Connect your wallet to view your NFTs.</p>
      </div>

      <div id="nft-loading" class="hidden text-center py-16">
        <div class="inline-block w-6 h-6 border-2 border-sui-blue border-t-transparent rounded-full animate-spin mb-3"></div>
        <p class="text-sui-muted text-sm">Loading NFTs…</p>
      </div>

      <div id="nft-empty" class="hidden card text-center py-10">
        <p class="text-3xl mb-3">🖼</p>
        <p class="text-sui-muted text-sm">No NFTs found in this wallet.</p>
        <a href="https://tradeport.xyz/sui" target="_blank" rel="noopener" class="btn-primary mt-4 inline-block text-xs">Browse NFTs on TradePort</a>
      </div>

      <div id="nft-grid" class="grid grid-cols-2 sm:grid-cols-3 gap-3"></div>

      <div class="mt-6 card border-dashed">
        <p class="text-xs text-sui-muted mb-3 font-medium">NFT marketplaces</p>
        <div class="flex flex-wrap gap-2">
          <a href="https://tradeport.xyz/sui" target="_blank" rel="noopener" class="badge badge-blue">TradePort ↗</a>
          <a href="https://bluemove.net" target="_blank" rel="noopener" class="badge badge-blue">BlueMove ↗</a>
          <a href="https://hyperspace.xyz" target="_blank" rel="noopener" class="badge badge-blue">HyperSpace ↗</a>
        </div>
      </div>
    </div>
  `;

  async function loadNFTs(address: string) {
    const loadingEl = container.querySelector<HTMLElement>("#nft-loading")!;
    const emptyEl = container.querySelector<HTMLElement>("#nft-empty")!;
    const gridEl = container.querySelector<HTMLElement>("#nft-grid")!;

    loadingEl.classList.remove("hidden");
    emptyEl.classList.add("hidden");
    gridEl.innerHTML = "";

    try {
      const client = wallet.getClient();

      // Fetch owned objects that are likely NFTs (have display metadata)
      const { data } = await client.getOwnedObjects({
        owner: address,
        options: { showDisplay: true, showType: true },
        limit: 24,
      });

      const nfts: NFTItem[] = data
        .filter((obj) => {
          const display = obj.data?.display?.data;
          return display && (display.image_url || display.name);
        })
        .map((obj) => {
          const display = obj.data?.display?.data ?? {};
          return {
            objectId: obj.data?.objectId ?? "",
            name: display.name ?? display.title ?? "Unnamed NFT",
            imageUrl: display.image_url ?? display.img_url ?? "",
            collection: display.collection ?? display.project_name ?? "",
          };
        });

      loadingEl.classList.add("hidden");

      if (nfts.length === 0) {
        emptyEl.classList.remove("hidden");
        return;
      }

      nfts.forEach((nft) => {
        const card = document.createElement("div");
        card.className = "card p-0 overflow-hidden cursor-pointer hover:border-sui-accent transition-colors group";
        card.innerHTML = `
          <div class="aspect-square bg-sui-dark flex items-center justify-center overflow-hidden">
            ${nft.imageUrl
              ? `<img src="${nft.imageUrl}" alt="${nft.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />`
              : `<div class="text-4xl">🖼</div>`
            }
          </div>
          <div class="p-2">
            <p class="text-xs text-white font-medium truncate">${nft.name ?? "Unnamed"}</p>
            ${nft.collection ? `<p class="text-xs text-sui-muted truncate">${nft.collection}</p>` : ""}
          </div>
        `;
        card.addEventListener("click", () => {
          window.open(`https://tradeport.xyz/sui/token/${nft.objectId}`, "_blank");
        });
        gridEl.appendChild(card);
      });
    } catch (err) {
      loadingEl.classList.add("hidden");
      console.error("[nft] fetch error:", err);
      gridEl.innerHTML = `<div class="col-span-full text-center py-8 text-sui-error text-sm">Failed to load NFTs.</div>`;
    }
  }

  const state = wallet.getState();
  const prompt = container.querySelector<HTMLElement>("#nft-connect-prompt")!;

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
      container.querySelector<HTMLElement>("#nft-grid")!.innerHTML = "";
    }
  });

  const observer = new MutationObserver(() => {
    if (!document.contains(container)) { unsub(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
