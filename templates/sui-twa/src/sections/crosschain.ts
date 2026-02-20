import { peerExtensionSdk } from "@zkp2p/sdk";

import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";
import { tradFiToSuiNative, getPeerOnrampState, resolveZkp2pSuiRoute } from "../lib/crosschain";
import { getInfraSource, getSectionSource } from "../source-files";
import { wallet, type Network } from "../wallet";

interface IkaNetworkStatus {
  ready: boolean;
  message: string;
}

const PAYMENT_METHODS: string[] = [
  "venmo",
  "paypal",
  "wise",
  "cashapp",
  "zelle",
  "revolut",
  "monzo",
  "mercadopago",
];

export function renderCrosschain(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">Cross-Chain Onramp</h1>
          <p class="section-desc">One click: TradFi → Base USDC → native Sui UX via WaaP + Ika + PeerAuth.</p>
        </div>
        <div class="inline-group--tight">
          <a href="https://docs.peer.xyz" target="_blank" rel="noopener" class="btn btn-secondary btn--compact">Peer docs ↗</a>
        </div>
      </div>

      <div class="card" style="border-color:rgba(59,139,255,0.45);background:linear-gradient(145deg,rgba(59,139,255,0.16),rgba(15,16,24,0.92));margin-bottom:14px">
        <div class="card-title" style="margin-bottom:6px">ThunderBun - Web4 Native</div>
        <p class="card-description" style="margin:0;color:var(--text)">Electrobun was cool. This is the future.</p>
      </div>

      <div class="card">
        <div class="card-title">Runtime readiness</div>
        <div style="display:grid;gap:8px" id="crosschain-status-grid">
          <div class="spread-row" style="background:var(--bg);padding:8px 12px;border-radius:var(--r-sm)">
            <span class="card-description" style="margin-bottom:0">Sui wallet</span>
            <span class="badge badge-yellow" id="cc-sui-badge">Checking…</span>
          </div>
          <div class="spread-row" style="background:var(--bg);padding:8px 12px;border-radius:var(--r-sm)">
            <span class="card-description" style="margin-bottom:0">PeerAuth extension</span>
            <span class="badge badge-yellow" id="cc-peer-badge">Checking…</span>
          </div>
          <div class="spread-row" style="background:var(--bg);padding:8px 12px;border-radius:var(--r-sm)">
            <span class="card-description" style="margin-bottom:0">Ika network config</span>
            <span class="badge badge-yellow" id="cc-ika-badge">Checking…</span>
          </div>
          <div class="spread-row" style="background:var(--bg);padding:8px 12px;border-radius:var(--r-sm)">
            <span class="card-description" style="margin-bottom:0">SuiNS route</span>
            <span class="badge badge-yellow" id="cc-route-badge">Checking…</span>
          </div>
        </div>
        <div id="cc-peer-action" style="margin-top:10px"></div>
      </div>

      <div class="card">
        <div class="card-title">One-click onramp</div>
        <p class="card-description">
          Starts PeerAuth onramp to your WaaP Base address, then submits a Sui marker PTB.
          The marker PTB is a temporary on-chain anchor until native Ika CCTP entrypoints are finalized.
        </p>

        <div class="inline-group--tight" style="flex-wrap:wrap;gap:10px">
          <label class="card-description" for="cc-amount" style="margin:0">Amount (USD)</label>
          <input id="cc-amount" type="number" min="1" value="100"
            style="width:120px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--bg);color:var(--fg);font-size:13px" />

          <label class="card-description" for="cc-method" style="margin:0">Method</label>
          <select id="cc-method"
            style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--bg);color:var(--fg);font-size:13px">
            ${PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join("")}
          </select>

          <button id="cc-start" class="btn btn-primary btn--compact" style="margin-left:auto">Start one-click flow</button>
        </div>

        <div class="result-box spaced-top" id="cc-result" style="display:none">
          <div class="result-label">Flow result</div>
          <div class="result-value code-text" id="cc-result-value" style="font-size:12px;word-break:break-word"></div>
        </div>

        <div class="error-msg" id="cc-error"></div>
      </div>

      <div class="info-links">
        <div class="info-links-label">Resources</div>
        <div class="info-links-row">
          <a href="https://docs.waap.xyz" target="_blank" rel="noopener" class="badge badge-blue">WaaP ↗</a>
          <a href="https://docs.ika.xyz" target="_blank" rel="noopener" class="badge badge-blue">Ika ↗</a>
          <a href="https://www.npmjs.com/package/@zkp2p/sdk" target="_blank" rel="noopener" class="badge badge-blue">PeerAuth SDK ↗</a>
          <a href="https://github.com/zkp2p/zkp2p-contracts" target="_blank" rel="noopener" class="badge badge-blue">zkp2p-contracts ↗</a>
        </div>
      </div>
    </div>
  `;

  const src = getSectionSource("crosschain");
  if (src) {
    const cfg = {
      id: "crosschain-src",
      label: "crosschain.ts",
      source: src,
      secondaryLabel: "lib/crosschain.ts",
      secondarySource: getInfraSource("lib/crosschain.ts") ?? undefined,
    };
    container.querySelector(".section")!.insertAdjacentHTML("beforeend", codeViewerHTML(cfg));
    attachCodeViewer(container, cfg);
  }

  const amountInput = container.querySelector<HTMLInputElement>("#cc-amount")!;
  const methodInput = container.querySelector<HTMLSelectElement>("#cc-method")!;
  const startBtn = container.querySelector<HTMLButtonElement>("#cc-start")!;
  const errorEl = container.querySelector<HTMLElement>("#cc-error")!;
  const resultBox = container.querySelector<HTMLElement>("#cc-result")!;
  const resultValue = container.querySelector<HTMLElement>("#cc-result-value")!;

  const refreshStatus = async (): Promise<void> => {
    const suiBadge = container.querySelector<HTMLElement>("#cc-sui-badge")!;
    const peerBadge = container.querySelector<HTMLElement>("#cc-peer-badge")!;
    const ikaBadge = container.querySelector<HTMLElement>("#cc-ika-badge")!;
    const routeBadge = container.querySelector<HTMLElement>("#cc-route-badge")!;

    const state = wallet.getState();
    if (state.connected && state.address) {
      suiBadge.className = "badge badge-green";
      suiBadge.textContent = `${state.network}: ${shortAddress(state.address)}`;
    } else {
      suiBadge.className = "badge badge-yellow";
      suiBadge.textContent = "Connect wallet";
    }

    const peerState = await getPeerOnrampState();
    renderPeerState(container, peerState);
    if (peerState === "ready") {
      peerBadge.className = "badge badge-green";
      peerBadge.textContent = "Ready";
    } else if (peerState === "needs_connection") {
      peerBadge.className = "badge badge-yellow";
      peerBadge.textContent = "Needs connection";
    } else if (peerState === "needs_install") {
      peerBadge.className = "badge badge-yellow";
      peerBadge.textContent = "Needs install";
    } else {
      peerBadge.className = "badge badge-yellow";
      peerBadge.textContent = "Unavailable";
    }

    const ika = await fetchIkaStatus(state.network);
    ikaBadge.className = ika.ready ? "badge badge-green" : "badge badge-yellow";
    ikaBadge.textContent = ika.message;

    try {
      const route = await resolveZkp2pSuiRoute();
      routeBadge.className = "badge badge-green";
      routeBadge.textContent = `${route.name} → ${shortAddress(route.address)}`;
    } catch (err) {
      routeBadge.className = "badge badge-yellow";
      routeBadge.textContent = err instanceof Error ? err.message : "Route unavailable";
    }
  };

  const startFlow = async (): Promise<void> => {
    const amount = Number(amountInput.value);
    const method = methodInput.value;

    errorEl.classList.remove("visible");
    errorEl.textContent = "";
    resultBox.style.display = "none";

    startBtn.disabled = true;
    const originalText = startBtn.textContent;
    startBtn.textContent = "Running…";

    try {
      const result = await tradFiToSuiNative({
        amountUsd: amount,
        paymentMethod: method,
      });

      resultBox.style.display = "block";
      resultValue.textContent = [
        `Base recipient: ${result.baseAddress}`,
        `Peer state: ${result.peerState}`,
        `Sui route: ${result.markerRecipientName} → ${result.markerRecipientAddress}`,
        `Reverse name: ${result.markerRecipientDefaultName ?? "none"}`,
        `Marker PTB digest: ${result.markerTxDigest ?? "unavailable"}`,
      ].join("\n");
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      errorEl.classList.add("visible");
    } finally {
      startBtn.disabled = false;
      startBtn.textContent = originalText;
      await refreshStatus();
    }
  };

  startBtn.addEventListener("click", () => {
    startFlow().catch((err) => {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      errorEl.classList.add("visible");
    });
  });

  const unsub = wallet.subscribe(() => {
    refreshStatus().catch((err) => console.error("[crosschain] status refresh failed", err));
  });
  cleanup(container, unsub);

  refreshStatus().catch((err) => {
    errorEl.textContent = err instanceof Error ? err.message : String(err);
    errorEl.classList.add("visible");
  });
}

function renderPeerState(container: HTMLElement, state: "needs_install" | "needs_connection" | "ready" | "error"): void {
  const actionEl = container.querySelector<HTMLElement>("#cc-peer-action")!;

  if (state === "needs_install") {
    actionEl.innerHTML = '<button id="cc-peer-install" class="btn btn-secondary btn--compact">Install PeerAuth ↗</button>';
    actionEl.querySelector("#cc-peer-install")?.addEventListener("click", () => {
      peerExtensionSdk.openInstallPage();
    });
    return;
  }

  if (state === "needs_connection") {
    actionEl.innerHTML = '<button id="cc-peer-connect" class="btn btn-secondary btn--compact">Connect PeerAuth</button>';
    actionEl.querySelector("#cc-peer-connect")?.addEventListener("click", async () => {
      await peerExtensionSdk.requestConnection();
    });
    return;
  }

  actionEl.innerHTML = '<div class="status-hint" style="font-size:12px">PeerAuth is ready for onramp requests.</div>';
}

async function fetchIkaStatus(network: Network): Promise<IkaNetworkStatus> {
  if (network !== "mainnet" && network !== "testnet") {
    return { ready: false, message: `Unsupported (${network})` };
  }

  try {
    const { getNetworkConfig } = await import("@ika.xyz/sdk");
    const cfg = getNetworkConfig(network);
    return {
      ready: true,
      message: `${network}: ${shortAddress(cfg.packages.ikaSystemPackage)}`,
    };
  } catch (err) {
    return {
      ready: false,
      message: err instanceof Error ? err.message : "Ika unavailable",
    };
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function cleanup(container: HTMLElement, unsub: () => void): void {
  const obs = new MutationObserver(() => {
    if (!document.contains(container)) {
      unsub();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
