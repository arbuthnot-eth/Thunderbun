/**
 * Settings section — network switcher, wallet management, ecosystem overview
 * MVR: https://www.moveregistry.com/
 * Ika: https://docs.ika.xyz/
 * Nautilus: https://docs.sui.io/guides/developer/nautilus
 */

import { wallet, type Network } from "../wallet";
import { getSectionSource, getInfraSource } from "../source-files";
import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";

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
          <h1 class="section-title">Settings</h1>
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
            <div class="address-display" style="color:var(--text);margin-top:4px">${s.address}</div>
          </div>
          <div class="inline-group--tight">
            <button id="copy-addr" class="btn btn-secondary" style="flex:1">Copy address</button>
            <button id="disconnect" class="btn btn-danger" style="flex:1">Disconnect</button>
          </div>
        ` : `
          <p class="card-description">No wallet connected.</p>
          <button id="connect-wallet" class="btn btn-primary">Connect Wallet</button>
        `}
      </div>

      <!-- MVR -->
      <div class="card">
        <div class="card-title">MVR — Move Package Registry</div>
        <p class="card-description">
          MVR allows using <code>@pkg/module</code> named references in transactions
          instead of raw package addresses. Activated in this template via
          <code>mvr: {}</code> in the <code>SuiGrpcClient</code> constructor
          (<code>dapp-kit.ts</code>). All transactions automatically resolve
          MVR names without needing a global serialization plugin.
        </p>
        <pre style="font-size:11px">// In dapp-kit.ts:
new SuiGrpcClient({
  baseUrl: \`https://fullnode.\${network}.sui.io:443\`,
  network,
  mvr: {},  // ← enables MVR name resolution
});

// Now use named packages in PTBs:
tx.moveCall({
  target: '@deepbook/core::book::place_order',
  arguments: [...],
});</pre>
        <div class="info-links-row spaced-top">
          <a href="https://www.moveregistry.com" target="_blank" rel="noopener" class="badge badge-blue">MVR site ↗</a>
          <a href="https://docs.suins.io/move-registry/tooling/mvr-cli" target="_blank" rel="noopener" class="badge badge-blue">MVR CLI ↗</a>
        </div>
      </div>

      <!-- Ika -->
      <div class="card">
        <div class="card-title">Ika — MPC Network</div>
        <p class="card-description">
          Ika is a threshold multi-party computation network for Sui.
          It uses 2PC (two-party computation) to sign transactions without exposing private keys.
          Ideal for key management, cross-chain bridges, and institutional custody.
        </p>
        <p class="card-description">
          <strong>→</strong> See the <a href="#" id="ika-nav-link" style="color:var(--accent)">Ika MPC section</a>
          for live network status, SDK demos, and dWallet information.
        </p>
        <div class="info-links-row spaced-top">
          <a href="https://docs.ika.xyz" target="_blank" rel="noopener" class="badge badge-blue">Ika docs ↗</a>
          <a href="https://github.com/dwallet-labs/ika" target="_blank" rel="noopener" class="badge badge-blue">GitHub ↗</a>
        </div>
      </div>

      <!-- Nautilus -->
      <div class="card">
        <div class="card-title">Nautilus — Verifiable Off-chain Compute</div>
        <p class="card-description">
          Nautilus runs code inside AWS Nitro Enclaves (TEEs) and posts cryptographic attestations
          on-chain to Sui, enabling trustless AI agents, oracles, fraud prevention,
          and DePIN solutions.
        </p>
        <div class="info-links-row">
          <a href="https://docs.sui.io/guides/developer/nautilus" target="_blank" rel="noopener" class="badge badge-blue">Nautilus docs ↗</a>
          <a href="https://github.com/MystenLabs/nautilus" target="_blank" rel="noopener" class="badge badge-blue">GitHub template ↗</a>
        </div>
      </div>

      <!-- Passkeys -->
      <div class="card">
        <div class="card-title">Passkeys — WebAuthn for Sui</div>
        <p class="card-description">
          Passkeys let users sign Sui transactions with biometrics (Face ID, fingerprint, PIN) —
          no seed phrase or extension needed. Set <code>rpId</code> to the root domain for
          cross-subdomain portability.
        </p>
        <p class="card-description">
          <strong>&rarr;</strong> See the <a href="#" id="passkeys-nav-link" style="color:var(--accent)">Passkeys section</a>
          for a live demo and cross-subdomain iframe architecture.
        </p>
        <div class="info-links-row spaced-top">
          <a href="https://sdk.mystenlabs.com/typescript/cryptography/keypairs/passkey" target="_blank" rel="noopener" class="badge badge-blue">SDK docs ↗</a>
          <a href="https://webauthn.guide" target="_blank" rel="noopener" class="badge badge-blue">WebAuthn guide ↗</a>
        </div>
      </div>

      <!-- Sponsored Transactions -->
      <div class="card">
        <div class="card-title">Sponsored Transactions</div>
        <p class="card-description">
          Two patterns for gasless UX — both using native Sui SDK:
        </p>
        <ul class="card-description" style="padding-left:18px">
          <li><strong>Client-side:</strong> <code>wallet.buildSponsoredTx()</code> sets
              <code>gasOwner</code> to a known sponsor, user signs, then both signatures
              are submitted via <code>executeSponsoredTx()</code></li>
          <li><strong>Server gas station:</strong> <code>POST /api/sponsor</code> on the
              Worker signs with a hot wallet — opt-in via <code>SPONSOR_PRIVATE_KEY</code>
              Wrangler secret</li>
        </ul>
        <pre style="font-size:11px">// Client-side sponsored transaction
const { bytes, userSignature } = await wallet.buildSponsoredTx(
  (tx) =&gt; tx.moveCall({ target: "...", arguments: [...] }),
  sponsorAddress
);

// Send to gas station for sponsor signature
const res = await fetch("/api/sponsor", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ txBytes: bytes }),
});
const { sponsorSignature } = await res.json();

// Execute with both signatures
await wallet.executeSponsoredTx(bytes, [userSignature, sponsorSignature]);</pre>
      </div>

      <!-- About -->
      <div class="card">
        <div class="card-title">About</div>
        <div class="settings-row"><span class="settings-key">Framework</span><a href="https://github.com/arbuthnot-eth/thunderbun" target="_blank" class="settings-val">Thunderbun ↗</a></div>
        <div class="settings-row"><span class="settings-key">Wallet</span><a href="https://docs.waap.xyz" target="_blank" class="settings-val">WaaP ↗</a></div>
        <div class="settings-row"><span class="settings-key">Chain</span><a href="https://sui.io" target="_blank" class="settings-val">Sui ↗</a></div>
        <div class="settings-row"><span class="settings-key">Storage</span><a href="https://docs.wal.app" target="_blank" class="settings-val">Walrus ↗</a></div>
        <div class="settings-row"><span class="settings-key">Encryption</span><a href="https://seal-docs.wal.app" target="_blank" class="settings-val">Seal ↗</a></div>
        <div class="settings-row"><span class="settings-key">Indexer</span><a href="https://www.tradeport.xyz/docs" target="_blank" class="settings-val">TradePort ↗</a></div>
      </div>
    </div>
  `;

  // Code viewer
  const src = getSectionSource("settings");
  if (src) {
    const cfg = { id: "settings-src", label: "settings.ts", source: src, secondaryLabel: "dapp-kit.ts", secondarySource: getInfraSource("dapp-kit.ts") ?? undefined };
    container.querySelector(".section")!.insertAdjacentHTML("beforeend", codeViewerHTML(cfg));
    attachCodeViewer(container, cfg);
  }

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
    await wallet.disconnectAndHardReset();
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

  // Ika nav link — navigates to Ika section
  container.querySelector("#ika-nav-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    const app = (window as unknown as Record<string, { showSection: (id: string) => void }>).__app;
    if (app) app.showSection("ika");
  });

  // Passkeys nav link — navigates to Passkeys section
  container.querySelector("#passkeys-nav-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    const app = (window as unknown as Record<string, { showSection: (id: string) => void }>).__app;
    if (app) app.showSection("passkeys");
  });
}
