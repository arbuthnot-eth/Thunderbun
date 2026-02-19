/**
 * Settings section — network switcher, wallet management, ecosystem overview
 * MVR: https://www.moveregistry.com/
 * Ika: https://docs.ika.xyz/
 * Nautilus: https://docs.sui.io/guides/developer/nautilus
 */

import { wallet, type Network } from "../wallet";

const NETWORKS: { id: Network; label: string; url: string }[] = [
  { id: "mainnet", label: "Mainnet", url: "https://fullnode.mainnet.sui.io" },
  { id: "testnet", label: "Testnet", url: "https://fullnode.testnet.sui.io" },
  { id: "devnet",  label: "Devnet",  url: "https://fullnode.devnet.sui.io" },
];

export function renderSettings(container: HTMLElement) {
  const s = wallet.getState();

  container.innerHTML = `
    <div class="section">
      <div class="section-top" style="margin-bottom:24px">
        <div>
          <h1 class="section-title">Settings ⚙️</h1>
          <p class="section-desc">Network, wallet, and ecosystem references.</p>
        </div>
      </div>

      <!-- Network -->
      <div class="card">
        <div class="card-title">Network</div>
        <div id="network-list">
          ${NETWORKS.map((n) => `
            <div class="network-option" data-net="${n.id}">
              <div class="radio-circle ${s.network === n.id ? "active" : ""}">
                ${s.network === n.id ? '<div class="radio-dot"></div>' : ""}
              </div>
              <div>
                <div class="network-name">${n.label}</div>
                <div class="network-url">${n.url}</div>
              </div>
              ${s.network === n.id ? '<span class="badge badge-green" style="margin-left:auto">Active</span>' : ""}
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Wallet -->
      <div class="card">
        <div class="card-title">Wallet</div>
        ${s.connected && s.address ? `
          <div style="background:var(--bg);border-radius:var(--r-md);padding:12px 14px;margin-bottom:12px">
            <div class="result-label">Connected address</div>
            <div class="mono small break-all" style="color:var(--text);margin-top:4px">${s.address}</div>
          </div>
          <div class="row gap-2">
            <button id="copy-addr" class="btn btn-secondary" style="flex:1">Copy address</button>
            <button id="disconnect" class="btn btn-danger" style="flex:1">Disconnect</button>
          </div>
        ` : `
          <p class="small muted" style="margin-bottom:12px">No wallet connected.</p>
          <button id="connect-wallet" class="btn btn-primary">Connect Wallet</button>
        `}
      </div>

      <!-- MVR -->
      <div class="card">
        <div class="card-title">MVR — Move Package Registry 📦</div>
        <p class="small muted" style="margin-bottom:12px">
          MVR allows using <code>@pkg/module</code> named references in transactions
          instead of raw package addresses. Registered in this template via
          <code>namedPackagesPlugin</code>.
        </p>
        <pre style="font-size:11px">// Already registered in wallet.ts:
Transaction.registerGlobalSerializationPlugin(
  'namedPackagesPlugin',
  namedPackagesPlugin({ url: 'https://mainnet.mvr.mystenlabs.com' })
);

// Now use named packages in PTBs:
tx.moveCall({
  target: '@deepbook/core::book::place_order',
  arguments: [...],
});</pre>
        <div class="info-links-row mt-3">
          <a href="https://www.moveregistry.com" target="_blank" rel="noopener" class="badge badge-blue">MVR site ↗</a>
          <a href="https://docs.suins.io/move-registry/tooling/mvr-cli" target="_blank" rel="noopener" class="badge badge-blue">MVR CLI ↗</a>
        </div>
      </div>

      <!-- Ika -->
      <div class="card">
        <div class="card-title">Ika — MPC Network 🔐</div>
        <p class="small muted" style="margin-bottom:12px">
          Ika is a threshold multi-party computation network for Sui.
          It uses 2PC (two-party computation) to sign transactions without exposing private keys.
          Ideal for key management, cross-chain bridges, and institutional custody.
        </p>
        <pre style="font-size:11px">// Install: pnpm add @ika.xyz/sdk
import { IkaClient } from '@ika.xyz/sdk';

const ikaClient = new IkaClient({
  url: 'https://ika-rpc.testnet.ika.xyz',
});</pre>
        <div class="info-links-row mt-3">
          <a href="https://docs.ika.xyz" target="_blank" rel="noopener" class="badge badge-blue">Ika docs ↗</a>
          <a href="https://github.com/dwallet-labs/ika" target="_blank" rel="noopener" class="badge badge-blue">GitHub ↗</a>
        </div>
      </div>

      <!-- Nautilus -->
      <div class="card">
        <div class="card-title">Nautilus — Verifiable Off-chain Compute ⚓</div>
        <p class="small muted" style="margin-bottom:12px">
          Nautilus runs code inside AWS Nitro Enclaves (TEEs) and posts cryptographic attestations
          on-chain to Sui, enabling trustless AI agents, oracles, fraud prevention,
          and DePIN solutions.
        </p>
        <div class="info-links-row">
          <a href="https://docs.sui.io/guides/developer/nautilus" target="_blank" rel="noopener" class="badge badge-blue">Nautilus docs ↗</a>
          <a href="https://github.com/MystenLabs/nautilus" target="_blank" rel="noopener" class="badge badge-blue">GitHub template ↗</a>
        </div>
      </div>

      <!-- About -->
      <div class="card">
        <div class="card-title">About</div>
        <div class="settings-row"><span class="settings-key">Framework</span><a href="https://github.com/arbuthnot-eth/thunderbun" target="_blank" class="settings-val">ThunderBun ↗</a></div>
        <div class="settings-row"><span class="settings-key">Wallet</span><a href="https://docs.waap.xyz" target="_blank" class="settings-val">WaaP ↗</a></div>
        <div class="settings-row"><span class="settings-key">Chain</span><a href="https://sui.io" target="_blank" class="settings-val">Sui ↗</a></div>
        <div class="settings-row"><span class="settings-key">Storage</span><a href="https://docs.wal.app" target="_blank" class="settings-val">Walrus ↗</a></div>
        <div class="settings-row"><span class="settings-key">Encryption</span><a href="https://seal-docs.wal.app" target="_blank" class="settings-val">Seal ↗</a></div>
        <div class="settings-row"><span class="settings-key">Indexer</span><a href="https://www.tradeport.xyz/docs" target="_blank" class="settings-val">TradePort ↗</a></div>
      </div>
    </div>
  `;

  // Network switch
  container.querySelectorAll<HTMLElement>(".network-option").forEach((el) => {
    el.addEventListener("click", () => {
      const net = el.dataset["net"] as Network | undefined;
      if (net) {
        wallet.setNetwork(net);
        renderSettings(container); // re-render to update active state
      }
    });
  });

  // Wallet actions
  container.querySelector("#copy-addr")?.addEventListener("click", () => {
    navigator.clipboard.writeText(wallet.getState().address ?? "");
    const btn = container.querySelector<HTMLButtonElement>("#copy-addr")!;
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  container.querySelector("#disconnect")?.addEventListener("click", async () => {
    await wallet.disconnect();
    renderSettings(container);
  });

  container.querySelector("#connect-wallet")?.addEventListener("click", async () => {
    const btn = container.querySelector<HTMLButtonElement>("#connect-wallet")!;
    btn.disabled = true;
    btn.textContent = "Connecting…";
    try {
      await wallet.connect();
      renderSettings(container);
    } catch {
      btn.disabled = false;
      btn.textContent = "Connect Wallet";
    }
  });
}
