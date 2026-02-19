/**
 * Ika MPC section — threshold multi-party computation on Sui
 * Docs: https://docs.ika.xyz/
 * Package: @ika.xyz/sdk
 *
 * Ika uses 2PC (two-party computation) to create dWallets — distributed wallets
 * that can sign transactions without exposing private keys. Ideal for
 * key management, cross-chain bridges, and institutional custody.
 *
 * SDK is dynamically imported for code splitting.
 */

import { wallet } from "../wallet";
import { getSectionSource } from "../source-files";
import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";

interface IkaStatus {
  connected: boolean;
  network: string;
  packageId?: string;
  coordinatorId?: string;
  error?: string;
}

export function renderIka(container: HTMLElement) {
  const network = wallet.getState().network;
  const supported = network === "testnet" || network === "mainnet";

  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">Ika MPC 🔐</h1>
          <p class="section-desc">Threshold multi-party computation for distributed wallets (dWallets) on Sui.</p>
        </div>
        <div class="row gap-2">
          <span class="badge ${supported ? "badge-blue" : "badge-yellow"}" id="ika-status-badge">
            ${supported ? "Loading…" : "Not available (" + network + ")"}
          </span>
          <a href="https://docs.ika.xyz" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Docs ↗</a>
        </div>
      </div>

      <!-- Overview -->
      <div class="card">
        <div class="card-title">What is Ika?</div>
        <div class="seal-steps">
          <div class="seal-step">
            <div class="seal-step-num">1</div>
            <div class="seal-step-body">
              <div class="seal-step-title">2PC threshold MPC</div>
              <div class="seal-step-desc">
                Ika uses two-party computation to split key material between the user and the
                Ika network. Neither party can sign alone — both must cooperate.
              </div>
            </div>
          </div>
          <div class="seal-step">
            <div class="seal-step-num">2</div>
            <div class="seal-step-body">
              <div class="seal-step-title">dWallets (distributed wallets)</div>
              <div class="seal-step-desc">
                A dWallet is a programmable signing entity on Sui. It can hold keys for any chain —
                Bitcoin, Ethereum, Solana, etc. — and sign transactions via MPC.
              </div>
            </div>
          </div>
          <div class="seal-step">
            <div class="seal-step-num">3</div>
            <div class="seal-step-body">
              <div class="seal-step-title">On-chain access control</div>
              <div class="seal-step-desc">
                dWallet signing policies are enforced by Sui Move smart contracts.
                Multi-sig, time locks, spend limits, and custom logic are all possible.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Network status -->
      <div class="card">
        <div class="row-between" style="margin-bottom:14px">
          <div class="card-title" style="margin:0">Network Status</div>
          <button id="ika-refresh" class="btn btn-secondary btn-sm" ${!supported ? "disabled" : ""}>↻ Refresh</button>
        </div>
        <div id="ika-network-info">
          ${supported
            ? '<div class="muted small">Connecting to Ika ' + network + '…</div>'
            : '<div class="muted small">Ika is available on testnet and mainnet. Switch network in Settings.</div>'
          }
        </div>
      </div>

      <!-- dWallet info -->
      <div class="card">
        <div class="card-title">dWallet Overview</div>
        <p class="small muted" style="margin-bottom:12px">
          dWallets are created through a DKG (distributed key generation) protocol between
          you and the Ika network. Each dWallet has a cap (ownership token) and an encrypted
          user secret key share stored on-chain.
        </p>
        <div id="ika-dwallet-info">
          <div class="muted small">Connect wallet and refresh to check for existing dWallets.</div>
        </div>
      </div>

      <!-- SDK snippet -->
      <div class="card">
        <div class="card-title">SDK usage</div>
        <pre style="font-size:11px;line-height:1.6">import { IkaClient, getNetworkConfig } from '@ika.xyz/sdk';
import { SuiClient } from '@mysten/sui/client';

// Create clients
const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io' });
const ikaClient = new IkaClient({
  suiClient,
  config: getNetworkConfig('testnet'),
});

// Fetch coordinator state
const coordinator = await ikaClient.getCoordinatorInner();
console.log('Active sessions:', coordinator);

// Fetch system state
const system = await ikaClient.getSystemInner();
console.log('Ika system:', system);

// Create a dWallet (requires full DKG flow)
// See: https://docs.ika.xyz/developers/creating-dwallets</pre>
      </div>

      <div class="info-links">
        <div class="info-links-label">Resources</div>
        <div class="info-links-row">
          <a href="https://docs.ika.xyz" target="_blank" rel="noopener" class="badge badge-blue">Ika docs ↗</a>
          <a href="https://github.com/dwallet-labs/ika" target="_blank" rel="noopener" class="badge badge-blue">GitHub ↗</a>
          <a href="https://www.npmjs.com/package/@ika.xyz/sdk" target="_blank" rel="noopener" class="badge badge-blue">npm ↗</a>
          <a href="https://ika.xyz" target="_blank" rel="noopener" class="badge badge-blue">ika.xyz ↗</a>
        </div>
      </div>
    </div>
  `;

  // Code viewer
  const src = getSectionSource("ika");
  if (src) {
    const cfg = { id: "ika-src", label: "ika.ts", source: src };
    container.querySelector(".section")!.insertAdjacentHTML("beforeend", codeViewerHTML(cfg));
    attachCodeViewer(container, cfg);
  }

  // ── Network status via dynamic import ─────────────────────────────────
  async function fetchIkaStatus(): Promise<IkaStatus> {
    const net = wallet.getState().network;
    if (net !== "testnet" && net !== "mainnet") {
      return { connected: false, network: net, error: "Ika requires testnet or mainnet" };
    }

    try {
      const { IkaClient, getNetworkConfig } = await import("@ika.xyz/sdk");
      // Ika SDK v0.2.7 requires @mysten/sui v1.x — isolated JSON-RPC client
      const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } = await import("@mysten/sui/jsonRpc");

      const suiClient = new SuiJsonRpcClient({
        url: getJsonRpcFullnodeUrl(net),
        network: net,
      });

      const config = getNetworkConfig(net);
      // Verify config is valid by creating client (validates package IDs exist)
      void new IkaClient({ suiClient: suiClient as never, config });

      return {
        connected: true,
        network: net,
        packageId: config.packages.ikaSystemPackage,
        coordinatorId: config.objects.ikaDWalletCoordinator.objectID,
      };
    } catch (err) {
      return {
        connected: false,
        network: net,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function refreshStatus() {
    const badge = container.querySelector<HTMLElement>("#ika-status-badge")!;
    const infoEl = container.querySelector<HTMLElement>("#ika-network-info")!;

    badge.textContent = "Loading…";
    badge.className = "badge badge-blue";

    const status = await fetchIkaStatus();

    if (status.connected) {
      badge.textContent = `Connected (${status.network})`;
      badge.className = "badge badge-green";
      infoEl.innerHTML = `
        <div style="display:grid;gap:8px">
          <div class="row-between" style="background:var(--bg);padding:8px 12px;border-radius:var(--r-sm)">
            <span class="small muted">Network</span>
            <span class="small mono">${status.network}</span>
          </div>
          <div class="row-between" style="background:var(--bg);padding:8px 12px;border-radius:var(--r-sm)">
            <span class="small muted">System Package</span>
            <span class="small mono">${status.packageId?.slice(0, 10)}…${status.packageId?.slice(-6)}</span>
          </div>
          <div class="row-between" style="background:var(--bg);padding:8px 12px;border-radius:var(--r-sm)">
            <span class="small muted">Coordinator</span>
            <span class="small mono">${status.coordinatorId?.slice(0, 10)}…${status.coordinatorId?.slice(-6)}</span>
          </div>
        </div>
      `;
    } else {
      badge.textContent = status.error ?? "Not connected";
      badge.className = "badge badge-yellow";
      infoEl.innerHTML = `<div class="muted small">${status.error ?? "Failed to connect"}</div>`;
    }
  }

  container.querySelector("#ika-refresh")?.addEventListener("click", refreshStatus);
  if (supported) refreshStatus();
}
