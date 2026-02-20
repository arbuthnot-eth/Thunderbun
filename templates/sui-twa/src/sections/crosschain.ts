import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";
import {
  getOnrampState,
  getZkp2pContractSnapshot,
  connectWaaPBaseAddress,
  launchOnramp,
  executeSettlement,
} from "../lib/crosschain";
import { buildProvidersLink, getZkp2pRuntimeConfig } from "../lib/zkp2p-config";
import { getInfraSource, getSectionSource } from "../source-files";
import { wallet } from "../wallet";

type Phase = "idle" | "onramping" | "settling" | "settled";

const PHASE_LABELS: Record<Phase, string> = {
  idle: "Ready",
  onramping: "Onramp Opened",
  settling: "Settling",
  settled: "Settled",
};

const PHASE_BADGE: Record<Phase, string> = {
  idle: "badge-blue",
  onramping: "badge-yellow",
  settling: "badge-yellow",
  settled: "badge-green",
};

export function renderCrosschain(container: HTMLElement): void {
  let phase: Phase = "idle";
  let resolvedBaseAddress: string | null = null;
  let launchedOnrampUrl: string | null = null;

  const cfg = getZkp2pRuntimeConfig();

  container.innerHTML = `
    <div class="section section-wide">
      <div class="section-top">
        <div>
          <div class="section-title">Cross-Chain Onramp</div>
          <div class="section-desc">Base onboarding is configured from <code>zkp2p-contracts</code>. Settlement resolves <code>zkp2p.sui</code> and executes a sponsored Sui PTB.</div>
        </div>
        <div class="inline-group">
          <span class="badge badge-blue" id="cc-phase">Ready</span>
          <a href="https://github.com/zkp2p/zkp2p-contracts" target="_blank" rel="noopener" class="btn btn-secondary btn--compact">Contracts ↗</a>
        </div>
      </div>

      <div class="card">
        <div class="card-title">How It Works</div>
        <div class="seal-steps">
          <div class="seal-step">
            <div class="seal-step-num">1</div>
            <div class="seal-step-body">
              <div class="seal-step-title">Fund on Base</div>
              <div class="seal-step-desc">Open the zkp2p provider flow with your WaaP-linked Base address as recipient. The route is pinned to the zkp2p contracts deployment for the current environment.</div>
            </div>
          </div>
          <div class="seal-step">
            <div class="seal-step-num">2</div>
            <div class="seal-step-body">
              <div class="seal-step-title">Resolve Sponsor</div>
              <div class="seal-step-desc">ThunderBun resolves <code>zkp2p.sui</code> through SuiNS and verifies your configured gas sponsor matches that address.</div>
            </div>
          </div>
          <div class="seal-step">
            <div class="seal-step-num">3</div>
            <div class="seal-step-body">
              <div class="seal-step-title">Settle on Sui</div>
              <div class="seal-step-desc">ThunderBun submits a sponsored PTB. If PR1646 helpers are present in Ika SDK, they are used first; otherwise your configured settlement Move target executes.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Readiness</div>
        <div class="stat-grid">
          <div class="stat-box" id="cc-stat-wallet">
            <div class="stat-label">Sui Wallet</div>
            <div class="stat-value">Checking…</div>
          </div>
          <div class="stat-box" id="cc-stat-contracts">
            <div class="stat-label">zkp2p Contracts</div>
            <div class="stat-value">Checking…</div>
          </div>
          <div class="stat-box" id="cc-stat-waap">
            <div class="stat-label">WaaP Base Address</div>
            <div class="stat-value">Checking…</div>
          </div>
          <div class="stat-box" id="cc-stat-base-usdc">
            <div class="stat-label">Base USDC</div>
            <div class="stat-value">—</div>
          </div>
          <div class="stat-box" id="cc-stat-network">
            <div class="stat-label">Sui Network</div>
            <div class="stat-value">Checking…</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Contract Route</div>
        <div class="crosschain-endpoint-list">
          <div class="crosschain-endpoint-row">
            <span>Providers Base URL</span>
            <a href="${escapeHtml(buildProvidersLink())}" target="_blank" rel="noopener" class="code-text">${escapeHtml(cfg.providersBaseUrl)}</a>
          </div>
          <div class="crosschain-endpoint-row">
            <span>Contract Network</span>
            <span class="code-text" id="cc-contract-network">Checking…</span>
          </div>
          <div class="crosschain-endpoint-row">
            <span>Orchestrator</span>
            <span class="code-text" id="cc-contract-orchestrator">Checking…</span>
          </div>
          <div class="crosschain-endpoint-row">
            <span>Escrow</span>
            <span class="code-text" id="cc-contract-escrow">Checking…</span>
          </div>
          <div class="crosschain-endpoint-row">
            <span>USDC</span>
            <span class="code-text" id="cc-contract-usdc">Checking…</span>
          </div>
          <div class="crosschain-endpoint-row">
            <span>Payment Methods</span>
            <span class="code-text" id="cc-contract-methods">Checking…</span>
          </div>
        </div>
      </div>

      <div class="card" id="cc-onramp-card">
        <div class="card-title">Onramp</div>
        <div id="cc-waap-recipient" class="card-description is-hidden"></div>
        <div id="cc-onramp-launch" class="card-description is-hidden"></div>
        <button id="cc-cta" class="btn btn-primary btn--block">Checking…</button>
        <button id="cc-settle" class="btn btn-secondary btn--block is-hidden" type="button">Execute Sponsored Settlement</button>
        <div class="error-msg" id="cc-error"></div>
      </div>

      <div class="card is-hidden" id="cc-settlement-card">
        <div class="card-title">Settlement</div>
        <div id="cc-settlement-spinner" class="inline-group">
          <span class="spinner"></span>
          <span class="status-hint">Executing sponsored settlement…</span>
        </div>
        <div id="cc-settlement-result" class="is-hidden">
          <div class="stat-grid">
            <div class="stat-box">
              <div class="stat-label">TX Digest</div>
              <div class="stat-value code-text" id="cc-settle-digest"></div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Settlement Path</div>
              <div class="stat-value" id="cc-settle-path"></div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Sponsor Address</div>
              <div class="stat-value code-text" id="cc-settle-sponsor"></div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Status</div>
              <div class="stat-value" id="cc-settle-status"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="info-links">
        <div class="info-links-label">Resources</div>
        <div class="info-links-row">
          <a href="https://github.com/zkp2p/zkp2p-contracts" target="_blank" rel="noopener" class="badge badge-blue">zkp2p-contracts ↗</a>
          <a href="https://docs.waap.xyz" target="_blank" rel="noopener" class="badge badge-blue">WaaP ↗</a>
          <a href="https://docs.ika.xyz" target="_blank" rel="noopener" class="badge badge-blue">Ika ↗</a>
          <a href="${escapeHtml(buildProvidersLink())}" target="_blank" rel="noopener" class="badge badge-blue">Providers ↗</a>
        </div>
      </div>
    </div>
  `;

  const src = getSectionSource("crosschain");
  if (src) {
    const codeCfg = {
      id: "crosschain-src",
      label: "crosschain.ts",
      source: src,
      secondaryLabel: "lib/crosschain.ts",
      secondarySource: getInfraSource("lib/crosschain.ts") ?? undefined,
    };
    container.querySelector(".section")!.insertAdjacentHTML("beforeend", codeViewerHTML(codeCfg));
    attachCodeViewer(container, codeCfg);
  }

  const $ = <T extends HTMLElement>(sel: string): T => container.querySelector<T>(sel)!;

  const phaseBadge = $("#cc-phase");
  const ctaBtn = $("#cc-cta") as HTMLButtonElement;
  const settleBtn = $("#cc-settle") as HTMLButtonElement;
  const errorEl = $("#cc-error");
  const waapRecipientEl = $("#cc-waap-recipient");
  const launchEl = $("#cc-onramp-launch");
  const settlementCard = $("#cc-settlement-card");
  const settlementSpinner = $("#cc-settlement-spinner");
  const settlementResult = $("#cc-settlement-result");

  function setPhase(next: Phase): void {
    phase = next;
    phaseBadge.className = `badge ${PHASE_BADGE[next]}`;
    phaseBadge.textContent = PHASE_LABELS[next];
  }

  function showError(msg: string): void {
    errorEl.textContent = msg;
    errorEl.classList.add("visible");
  }

  function clearError(): void {
    errorEl.textContent = "";
    errorEl.classList.remove("visible");
  }

  function setContractFields(): void {
    const state = wallet.getState();
    const snapshot = getZkp2pContractSnapshot(state.network);

    $("#cc-contract-network").textContent = `${snapshot.network} (${snapshot.chainId})`;
    $("#cc-contract-orchestrator").textContent = snapshot.orchestrator ?? "Not set";
    $("#cc-contract-escrow").textContent = snapshot.escrow ?? "Not set";
    $("#cc-contract-usdc").textContent = snapshot.usdc ?? "Not set";
    $("#cc-contract-methods").textContent = snapshot.paymentMethods.length > 0
      ? snapshot.paymentMethods.slice(0, 8).join(", ")
      : "Not available";
  }

  async function refreshReadiness(): Promise<void> {
    const state = wallet.getState();

    const walletStat = $("#cc-stat-wallet .stat-value");
    if (state.connected && state.address) {
      walletStat.textContent = shortAddress(state.address);
      walletStat.style.color = "var(--green)";
    } else {
      walletStat.textContent = "Not connected";
      walletStat.style.color = "var(--yellow)";
    }

    const networkStat = $("#cc-stat-network .stat-value");
    networkStat.textContent = state.network;
    const isValidNetwork = state.network === "mainnet" || state.network === "testnet";
    networkStat.style.color = isValidNetwork ? "var(--green)" : "var(--yellow)";

    const onrampState = await getOnrampState();
    const contractsStat = $("#cc-stat-contracts .stat-value");
    if (onrampState === "ready") {
      const snapshot = getZkp2pContractSnapshot(state.network);
      contractsStat.textContent = `${snapshot.network} route active`;
      contractsStat.style.color = "var(--green)";
    } else {
      contractsStat.textContent = "Missing contract config";
      contractsStat.style.color = "var(--red)";
    }

    const waapStat = $("#cc-stat-waap .stat-value");
    if (resolvedBaseAddress || state.waapBaseAddress) {
      const addr = resolvedBaseAddress ?? state.waapBaseAddress!;
      waapStat.textContent = shortAddress(addr);
      waapStat.style.color = "var(--green)";
      waapRecipientEl.textContent = `WaaP Base recipient: ${addr}`;
      waapRecipientEl.classList.remove("is-hidden");
    } else {
      waapStat.textContent = "Not resolved";
      waapStat.style.color = "var(--muted)";
      waapRecipientEl.classList.add("is-hidden");
    }

    const usdcStat = $("#cc-stat-base-usdc .stat-value");
    const usdcDisplay = wallet.formatBaseUsdcBalance();
    usdcStat.textContent = usdcDisplay;
    if (state.waapBaseUsdcBalance !== null && state.waapBaseUsdcBalance > 0n) {
      usdcStat.style.color = "var(--green)";
    } else if (state.waapBaseAddress) {
      usdcStat.style.color = "var(--yellow)";
    } else {
      usdcStat.style.color = "var(--muted)";
    }

    setContractFields();
    updateButtons(state.connected, onrampState);
  }

  function updateButtons(walletConnected: boolean, onrampState: string): void {
    settleBtn.classList.toggle("is-hidden", phase !== "onramping");

    if (phase === "settling") {
      ctaBtn.textContent = "Processing…";
      ctaBtn.disabled = true;
      settleBtn.disabled = true;
      return;
    }

    if (phase === "settled") {
      ctaBtn.textContent = "Start New Onramp";
      ctaBtn.disabled = false;
      settleBtn.disabled = true;
      return;
    }

    if (!walletConnected) {
      ctaBtn.textContent = "Connect Wallet";
      ctaBtn.disabled = false;
      settleBtn.disabled = true;
      return;
    }

    if (onrampState === "config_missing") {
      ctaBtn.textContent = "Configure zkp2p Contracts";
      ctaBtn.disabled = true;
      settleBtn.disabled = true;
      return;
    }

    if (phase === "onramping") {
      ctaBtn.textContent = "Onramp Opened";
      ctaBtn.disabled = true;
      settleBtn.disabled = false;
      return;
    }

    ctaBtn.textContent = "Open zkp2p Onramp";
    ctaBtn.disabled = false;
    settleBtn.disabled = true;
  }

  async function handleCta(): Promise<void> {
    clearError();

    if (phase === "settled") {
      resetFlow();
      await refreshReadiness();
      return;
    }

    const state = wallet.getState();
    if (!state.connected) {
      try {
        await wallet.connect();
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    try {
      await startOnrampFlow();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      resetFlow();
    }
  }

  async function startOnrampFlow(): Promise<void> {
    setPhase("onramping");

    resolvedBaseAddress = await connectWaaPBaseAddress();
    const launched = launchOnramp({ recipientAddress: resolvedBaseAddress });
    launchedOnrampUrl = launched.url;

    launchEl.innerHTML = `Launched onramp on <code>${escapeHtml(launched.contractNetwork)}</code>. <a href="${escapeHtml(launched.url)}" target="_blank" rel="noopener">Open again ↗</a>`;
    launchEl.classList.remove("is-hidden");

    await refreshReadiness();
  }

  async function triggerSettlement(): Promise<void> {
    if (!resolvedBaseAddress) {
      showError("WaaP Base address is not linked.");
      return;
    }

    clearError();
    setPhase("settling");

    settlementCard.classList.remove("is-hidden");
    settlementSpinner.classList.remove("is-hidden");
    settlementResult.classList.add("is-hidden");

    try {
      const result = await executeSettlement({ baseAddress: resolvedBaseAddress });

      settlementSpinner.classList.add("is-hidden");
      settlementResult.classList.remove("is-hidden");

      $("#cc-settle-digest").textContent = result.digest ?? "unavailable";
      $("#cc-settle-path").textContent = result.path;
      $("#cc-settle-sponsor").textContent = shortAddress(result.sponsorAddress);
      $("#cc-settle-status").textContent = "Settled";
      $("#cc-settle-status").style.color = "var(--green)";

      setPhase("settled");
    } catch (err) {
      settlementSpinner.classList.add("is-hidden");
      settlementResult.classList.remove("is-hidden");
      $("#cc-settle-status").textContent = "Failed";
      $("#cc-settle-status").style.color = "var(--red)";
      showError(err instanceof Error ? err.message : String(err));
      setPhase("onramping");
    }

    await refreshReadiness();
  }

  function resetFlow(): void {
    setPhase("idle");
    launchedOnrampUrl = null;
    launchEl.classList.add("is-hidden");
    launchEl.textContent = "";
    settlementCard.classList.add("is-hidden");
    settlementSpinner.classList.remove("is-hidden");
    settlementResult.classList.add("is-hidden");
  }

  ctaBtn.addEventListener("click", () => {
    handleCta().catch((err) => {
      showError(err instanceof Error ? err.message : String(err));
    });
  });

  settleBtn.addEventListener("click", () => {
    if (!launchedOnrampUrl) {
      showError("Start the onramp flow before settlement.");
      return;
    }
    triggerSettlement().catch((err) => {
      showError(err instanceof Error ? err.message : String(err));
    });
  });

  const walletUnsub = wallet.subscribe(() => {
    if (phase !== "settling") {
      refreshReadiness().catch((err) => console.error("[crosschain] readiness refresh failed", err));
    }
  });

  const obs = new MutationObserver(() => {
    if (!document.contains(container)) {
      walletUnsub();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  refreshReadiness().catch((err) => {
    showError(err instanceof Error ? err.message : String(err));
  });
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}
