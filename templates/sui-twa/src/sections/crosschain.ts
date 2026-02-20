import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";
import {
  getOnrampState,
  getZkp2pContractSnapshot,
  getZkp2pSdkState,
  connectZkp2pSdk,
  openZkp2pSdkInstallPage,
  connectWaaPBaseAddress,
  launchOnramp,
  onZkp2pProofComplete,
  executeSettlement,
  type Zkp2pProofCompleteResult,
  type Zkp2pSdkState,
} from "../lib/crosschain";
import { buildProvidersLink, getZkp2pRuntimeConfig } from "../lib/zkp2p-config";
import { getInfraSource, getSectionSource } from "../source-files";
import { wallet } from "../wallet";

type Phase = "idle" | "onramping" | "awaitingProof" | "settling" | "settled";

const PHASE_LABELS: Record<Phase, string> = {
  idle: "Ready",
  onramping: "Onramp Opened",
  awaitingProof: "Awaiting Proof",
  settling: "Settling",
  settled: "Settled",
};

const PHASE_BADGE: Record<Phase, string> = {
  idle: "badge-blue",
  onramping: "badge-yellow",
  awaitingProof: "badge-yellow",
  settling: "badge-yellow",
  settled: "badge-green",
};

export function renderCrosschain(container: HTMLElement): void {
  let phase: Phase = "idle";
  let resolvedBaseAddress: string | null = null;
  let launchedOnrampUrl: string | null = null;
  let launchMode: "sdk" | "providers-url" | null = null;
  let proofUnsub: (() => void) | null = null;

  const cfg = getZkp2pRuntimeConfig();

  container.innerHTML = `
    <div class="section section-wide crosschain-shell">
      <div class="crosschain-hero">
        <div class="crosschain-hero-kicker">Web4 Rail</div>
        <div class="crosschain-hero-title">Base USDC to native Sui USDC, with WaaP identity and sponsor-verified execution.</div>
        <div class="crosschain-hero-copy">Thunderbun now prefers zkp2p extension SDK inside the app. Proof events can auto-advance settlement while fallback providers links remain available when needed.</div>
        <div class="crosschain-hero-actions">
          <span class="badge badge-blue" id="cc-phase">Ready</span>
          <span class="badge badge-blue" id="cc-sdk-badge">SDK: Checking…</span>
          <a href="https://github.com/zkp2p/zkp2p-contracts" target="_blank" rel="noopener" class="btn btn-secondary btn--compact">Contracts ↗</a>
        </div>

        <div class="crosschain-stepper" id="cc-stepper">
          <div class="crosschain-step" id="cc-step-1"><span class="crosschain-step-num">1</span><span>Link WaaP Base</span></div>
          <div class="crosschain-step" id="cc-step-2"><span class="crosschain-step-num">2</span><span>Launch zkp2p SDK</span></div>
          <div class="crosschain-step" id="cc-step-3"><span class="crosschain-step-num">3</span><span>Proof Callback</span></div>
          <div class="crosschain-step" id="cc-step-4"><span class="crosschain-step-num">4</span><span>Sponsored Sui Settle</span></div>
        </div>

        <div class="crosschain-log code-text" id="cc-log"></div>
      </div>

      <div class="crosschain-grid">
        <div class="card">
          <div class="card-title">Readiness</div>
          <div class="stat-grid">
            <div class="stat-box" id="cc-stat-wallet">
              <div class="stat-label">Sui Wallet</div>
              <div class="stat-value">Checking…</div>
            </div>
            <div class="stat-box" id="cc-stat-sdk">
              <div class="stat-label">zkp2p SDK</div>
              <div class="stat-value">Checking…</div>
            </div>
            <div class="stat-box" id="cc-stat-contracts">
              <div class="stat-label">zkp2p Contracts</div>
              <div class="stat-value">Checking…</div>
            </div>
            <div class="stat-box" id="cc-stat-waap">
              <div class="stat-label">WaaP Base</div>
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
      </div>

      <div class="card" id="cc-onramp-card">
        <div class="card-title">Onramp</div>
        <div id="cc-waap-recipient" class="card-description is-hidden"></div>
        <div id="cc-onramp-launch" class="card-description is-hidden"></div>
        <button id="cc-cta" class="btn btn-primary btn--block">Checking…</button>
        <button id="cc-settle" class="btn btn-secondary btn--block is-hidden" type="button">Execute Settlement Now</button>
        <div class="error-msg" id="cc-error"></div>
      </div>

      <div class="card is-hidden" id="cc-proof-card">
        <div class="card-title">Proof Callback</div>
        <div class="stat-grid">
          <div class="stat-box">
            <div class="stat-label">Status</div>
            <div class="stat-value" id="cc-proof-status">Waiting…</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Intent Hash</div>
            <div class="stat-value code-text" id="cc-proof-intent">—</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Proof ID</div>
            <div class="stat-value code-text" id="cc-proof-id">—</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Platform</div>
            <div class="stat-value" id="cc-proof-platform">—</div>
          </div>
        </div>
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
          <a href="https://www.npmjs.com/package/@zkp2p/sdk" target="_blank" rel="noopener" class="badge badge-blue">zkp2p SDK ↗</a>
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
  const sdkBadge = $("#cc-sdk-badge");
  const ctaBtn = $("#cc-cta") as HTMLButtonElement;
  const settleBtn = $("#cc-settle") as HTMLButtonElement;
  const errorEl = $("#cc-error");
  const logEl = $("#cc-log");
  const waapRecipientEl = $("#cc-waap-recipient");
  const launchEl = $("#cc-onramp-launch");
  const proofCard = $("#cc-proof-card");
  const settlementCard = $("#cc-settlement-card");
  const settlementSpinner = $("#cc-settlement-spinner");
  const settlementResult = $("#cc-settlement-result");

  const flowLog: string[] = [];
  const autoSettleEnabled = ((import.meta.env.VITE_ZKP2P_AUTO_SETTLE_ON_BASE_USDC as string | undefined)?.trim() ?? "true") !== "false";
  const autoSettleMinUsdcRaw = parseUsdcRaw(import.meta.env.VITE_ZKP2P_AUTO_SETTLE_MIN_USDC as string | undefined) ?? 1_000_000n;
  let lastObservedBaseUsdc: bigint | null = wallet.getState().waapBaseUsdcBalance;

  function setPhase(next: Phase): void {
    phase = next;
    phaseBadge.className = `badge ${PHASE_BADGE[next]}`;
    phaseBadge.textContent = PHASE_LABELS[next];
    renderSteps();
  }

  function renderSteps(): void {
    const s1 = $("#cc-step-1");
    const s2 = $("#cc-step-2");
    const s3 = $("#cc-step-3");
    const s4 = $("#cc-step-4");

    s1.className = "crosschain-step";
    s2.className = "crosschain-step";
    s3.className = "crosschain-step";
    s4.className = "crosschain-step";

    if (resolvedBaseAddress) s1.classList.add("is-complete");
    if (launchMode) s2.classList.add("is-complete");

    if (phase === "awaitingProof") s3.classList.add("is-active");
    if (phase === "settling") s4.classList.add("is-active");

    if (phase === "onramping" || phase === "awaitingProof" || phase === "settling" || phase === "settled") {
      s2.classList.add("is-active");
    }
    if (phase === "settling" || phase === "settled") {
      s3.classList.add("is-complete");
    }
    if (phase === "settled") {
      s4.classList.add("is-complete");
    }
  }

  function appendLog(message: string): void {
    const stamp = new Date().toLocaleTimeString();
    flowLog.unshift(`${stamp}  ${message}`);
    if (flowLog.length > 12) flowLog.pop();
    logEl.innerHTML = flowLog.map((line) => escapeHtml(line)).join("<br />");
  }

  function showError(msg: string): void {
    errorEl.textContent = msg;
    errorEl.classList.add("visible");
    appendLog(`ERROR: ${msg}`);
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

  function setSdkBadge(sdkState: Zkp2pSdkState): void {
    if (sdkState === "ready") {
      sdkBadge.className = "badge badge-green";
      sdkBadge.textContent = "SDK: Connected";
      return;
    }
    if (sdkState === "needs_connection") {
      sdkBadge.className = "badge badge-yellow";
      sdkBadge.textContent = "SDK: Connect Needed";
      return;
    }
    if (sdkState === "needs_install") {
      sdkBadge.className = "badge badge-yellow";
      sdkBadge.textContent = "SDK: Install Needed";
      return;
    }
    sdkBadge.className = "badge badge-red";
    sdkBadge.textContent = "SDK: Unavailable";
  }

  async function refreshReadiness(): Promise<void> {
    const state = wallet.getState();
    const onrampState = await getOnrampState();
    const sdkState = await getZkp2pSdkState();

    setSdkBadge(sdkState);

    const walletStat = $("#cc-stat-wallet .stat-value");
    if (state.connected && state.address) {
      walletStat.textContent = shortAddress(state.address);
      walletStat.style.color = "var(--green)";
    } else {
      walletStat.textContent = "Not connected";
      walletStat.style.color = "var(--yellow)";
    }

    const sdkStat = $("#cc-stat-sdk .stat-value");
    if (sdkState === "ready") {
      sdkStat.textContent = "Connected";
      sdkStat.style.color = "var(--green)";
    } else if (sdkState === "needs_connection") {
      sdkStat.textContent = "Needs connection";
      sdkStat.style.color = "var(--yellow)";
    } else if (sdkState === "needs_install") {
      sdkStat.textContent = "Extension missing";
      sdkStat.style.color = "var(--yellow)";
    } else {
      sdkStat.textContent = "Unavailable";
      sdkStat.style.color = "var(--red)";
    }

    const networkStat = $("#cc-stat-network .stat-value");
    networkStat.textContent = state.network;
    const isValidNetwork = state.network === "mainnet" || state.network === "testnet";
    networkStat.style.color = isValidNetwork ? "var(--green)" : "var(--yellow)";

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
    maybeAutoSettleFromBaseUsdc(state.waapBaseUsdcBalance);

    setContractFields();
    updateButtons(state.connected, onrampState, sdkState);
  }

  function maybeAutoSettleFromBaseUsdc(nextBalance: bigint | null): void {
    if (!autoSettleEnabled) return;

    if (lastObservedBaseUsdc === null) {
      lastObservedBaseUsdc = nextBalance;
      return;
    }

    if (nextBalance === null) {
      lastObservedBaseUsdc = null;
      return;
    }

    if (nextBalance <= lastObservedBaseUsdc) {
      lastObservedBaseUsdc = nextBalance;
      return;
    }

    const delta = nextBalance - lastObservedBaseUsdc;
    lastObservedBaseUsdc = nextBalance;

    if (delta < autoSettleMinUsdcRaw) {
      appendLog(`Base USDC increased by ${formatUsdcRaw(delta)} (below auto-settle threshold).`);
      return;
    }

    if (phase !== "idle") {
      appendLog(`Base USDC increased by ${formatUsdcRaw(delta)} but flow is busy (${PHASE_LABELS[phase]}).`);
      return;
    }

    const state = wallet.getState();
    if (!state.connected || !state.waapBaseAddress) {
      appendLog("Base USDC detected but WaaP address is not ready for auto-settlement.");
      return;
    }

    resolvedBaseAddress = state.waapBaseAddress;
    launchMode = "providers-url";
    launchedOnrampUrl = "auto://base-usdc-detected";
    setPhase("onramping");
    appendLog(`Detected ${formatUsdcRaw(delta)} incoming on Base. Auto-triggering Sui settlement.`);
    void triggerSettlement(true);
  }

  function updateButtons(walletConnected: boolean, onrampState: string, sdkState: Zkp2pSdkState): void {
    settleBtn.classList.toggle("is-hidden", phase !== "onramping" && phase !== "awaitingProof");

    if (phase === "settling") {
      ctaBtn.textContent = "Processing…";
      ctaBtn.disabled = true;
      settleBtn.disabled = true;
      return;
    }

    if (phase === "settled") {
      ctaBtn.textContent = "Start New Flow";
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

    if (phase === "awaitingProof") {
      ctaBtn.textContent = "Awaiting SDK Proof…";
      ctaBtn.disabled = true;
      settleBtn.textContent = "Settle Manually";
      settleBtn.disabled = false;
      return;
    }

    if (phase === "onramping") {
      ctaBtn.textContent = "Onramp Opened";
      ctaBtn.disabled = true;
      settleBtn.textContent = "Execute Settlement Now";
      settleBtn.disabled = false;
      return;
    }

    if (sdkState === "needs_install") {
      ctaBtn.textContent = "Install zkp2p Extension";
      ctaBtn.disabled = false;
      settleBtn.disabled = true;
      return;
    }

    if (sdkState === "needs_connection") {
      ctaBtn.textContent = "Connect zkp2p SDK";
      ctaBtn.disabled = false;
      settleBtn.disabled = true;
      return;
    }

    ctaBtn.textContent = "Start SDK Onramp";
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
        appendLog("Connected Sui wallet.");
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const onrampState = await getOnrampState();
    if (onrampState !== "ready") {
      showError("zkp2p contract route is not configured.");
      return;
    }

    const sdkState = await getZkp2pSdkState();
    if (sdkState === "needs_install") {
      await openZkp2pSdkInstallPage();
      appendLog("Opened zkp2p extension install page.");
      return;
    }

    if (sdkState === "needs_connection") {
      const connected = await connectZkp2pSdk();
      appendLog(connected === "ready" ? "zkp2p SDK connected." : `zkp2p SDK state: ${connected}`);
      await refreshReadiness();
      if (connected !== "ready") return;
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
    appendLog(`WaaP Base linked: ${shortAddress(resolvedBaseAddress)}`);

    if (proofUnsub) {
      proofUnsub();
      proofUnsub = null;
    }

    const launched = await launchOnramp({ recipientAddress: resolvedBaseAddress });
    launchedOnrampUrl = launched.url;
    launchMode = launched.mode;

    launchEl.innerHTML = `Launch mode: <code>${escapeHtml(launched.mode)}</code> on <code>${escapeHtml(launched.contractNetwork)}</code>. <a href="${escapeHtml(launched.url)}" target="_blank" rel="noopener">Open again ↗</a>`;
    launchEl.classList.remove("is-hidden");
    appendLog(`Onramp launched via ${launched.mode}.`);

    if (launched.mode === "sdk") {
      setPhase("awaitingProof");
      proofCard.classList.remove("is-hidden");
      $("#cc-proof-status").textContent = "Waiting for callback…";
      $("#cc-proof-status").style.color = "var(--yellow)";

      proofUnsub = await onZkp2pProofComplete((result) => {
        handleProofResult(result);
      });

      if (!proofUnsub) {
        appendLog("SDK proof callback listener unavailable; manual settlement enabled.");
      }
    }

    await refreshReadiness();
  }

  function handleProofResult(result: Zkp2pProofCompleteResult): void {
    proofCard.classList.remove("is-hidden");

    $("#cc-proof-intent").textContent = result.intentHash ? shortAddress(result.intentHash) : "—";
    $("#cc-proof-id").textContent = result.proofId ?? "—";
    $("#cc-proof-platform").textContent = result.proof?.platform ?? "—";

    if (result.status === "success") {
      $("#cc-proof-status").textContent = "Success";
      $("#cc-proof-status").style.color = "var(--green)";
      appendLog("Proof callback received. Auto-settling on Sui.");
      void triggerSettlement(true);
      return;
    }

    const message = result.error?.message ?? `Proof callback status: ${result.status}`;
    $("#cc-proof-status").textContent = message;
    $("#cc-proof-status").style.color = "var(--red)";
    showError(message);
    setPhase("onramping");
  }

  async function triggerSettlement(fromAuto: boolean): Promise<void> {
    if (!resolvedBaseAddress) {
      showError("WaaP Base address is not linked.");
      return;
    }

    clearError();
    setPhase("settling");
    appendLog(fromAuto ? "Starting automatic settlement." : "Starting manual settlement.");

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

      appendLog(`Settlement completed (${result.path}).`);
      setPhase("settled");
    } catch (err) {
      settlementSpinner.classList.add("is-hidden");
      settlementResult.classList.remove("is-hidden");
      $("#cc-settle-status").textContent = "Failed";
      $("#cc-settle-status").style.color = "var(--red)";

      const msg = err instanceof Error ? err.message : String(err);
      showError(msg);
      setPhase(launchMode === "sdk" ? "awaitingProof" : "onramping");
    }

    await refreshReadiness();
  }

  function resetFlow(): void {
    setPhase("idle");
    launchedOnrampUrl = null;
    launchMode = null;

    if (proofUnsub) {
      proofUnsub();
      proofUnsub = null;
    }

    proofCard.classList.add("is-hidden");
    settlementCard.classList.add("is-hidden");
    settlementSpinner.classList.remove("is-hidden");
    settlementResult.classList.add("is-hidden");
    launchEl.classList.add("is-hidden");
    launchEl.textContent = "";

    appendLog("Flow reset.");
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
    triggerSettlement(false).catch((err) => {
      showError(err instanceof Error ? err.message : String(err));
    });
  });

  const walletUnsub = wallet.subscribe(() => {
    if (phase !== "settling") {
      refreshReadiness().catch((err) => console.error("[crosschain] readiness refresh failed", err));
    }
  });

  let pollInterval = 0;

  const obs = new MutationObserver(() => {
    if (!document.contains(container)) {
      walletUnsub();
      if (proofUnsub) {
        proofUnsub();
        proofUnsub = null;
      }
      clearInterval(pollInterval);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  pollInterval = window.setInterval(() => {
    if (document.contains(container)) {
      wallet.refreshBalance().catch((err) => {
        console.warn("[crosschain] auto balance poll failed:", err);
      });
    }
  }, 12_000);

  appendLog("Cross-chain console ready.");
  if (autoSettleEnabled) {
    appendLog(`Auto-settle armed at >= ${formatUsdcRaw(autoSettleMinUsdcRaw)} incoming Base USDC.`);
  }
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

function parseUsdcRaw(value: string | undefined): bigint | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded);
}

function formatUsdcRaw(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const fractional = raw % 1_000_000n;
  if (fractional === 0n) return `${whole} USDC`;
  const padded = fractional.toString().padStart(6, "0");
  const trimmed = padded.slice(0, 2).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed} USDC` : `${whole} USDC`;
}
