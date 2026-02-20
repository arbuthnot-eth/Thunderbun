import {
  executeCctpBridge,
  getBaseSponsorStatus,
  getCctpMinBaseGasWei,
  requestBaseGasSponsor,
  resumePendingBridge,
  loadPendingBridge,
  clearPendingBridge,
  topUpBaseGasFromUsdc,
  scanPastBurns,
  mintRecoveredBurn,
  type CctpPhase,
  type CctpProgress,
  type RecoverableBurn,
} from "../lib/cctp";
import { wallet } from "../wallet";

type BridgePhase = CctpPhase;
type StepId = "approve" | "burn" | "attestation" | "mint";
type TxChain = "base" | "sui";

interface StepTxRef {
  hash: string;
  chain: TxChain;
}

type StepTxMap = Record<StepId, StepTxRef | null>;

interface BridgeActivityGroup {
  id: string;
  startedAt: number;
  updatedAt: number;
  network: string;
  amountRaw: string;
  status: "running" | "complete" | "error";
  phase: BridgePhase;
  message: string;
  attestationAttempts: number;
  digest: string | null;
  error: string | null;
  steps: StepTxMap;
}

const PHASE_LABELS: Record<BridgePhase, string> = {
  idle: "Ready",
  approving: "Approving",
  burning: "Burning on Base",
  attesting: "Waiting for Attestation",
  minting: "Minting on Sui",
  complete: "Complete",
  error: "Error",
};

const STEP_NAMES = ["Approve", "Burn", "Attestation", "Mint"];
const STEP_IDS: StepId[] = ["approve", "burn", "attestation", "mint"];
const CCTP_ACTIVITY_STORAGE_KEY = "tb-cctp-activity-feed-v1";
const CCTP_ACTIVITY_LIMIT = 20;

export function renderHome(container: HTMLElement) {
  container.innerHTML = `
    <div class="section">
      <div id="home-body"></div>
    </div>
  `;

  const body = container.querySelector<HTMLElement>("#home-body")!;

  let bridgePhase: BridgePhase = "idle";
  let bridgeMessage = "";
  let bridgeDigest: string | null = null;
  let bridgeError: string | null = null;
  let bridgeAmount = "1";
  let attestationAttempts = 0;
  let gasTopupBusy = false;
  let gasTopupMessage = "";
  let gasTopupError: string | null = null;
  let sponsorBusy = false;
  let sponsorMessage = "";
  let sponsorError: string | null = null;
  let sponsorConfigured = false;
  let mounted = true;
  let bridgeInFlight = false;
  let activityFeed = loadBridgeActivityFeed();
  let activeGroupId: string | null = activityFeed[0]?.id ?? null;
  let recoveredBurns: RecoverableBurn[] = [];
  let recoveryScanBusy = false;
  let recoveryScanMessage = "";
  let recoveryScanError: string | null = null;
  let recoveryMintingIndex: number | null = null;
  let recoveryMintMessage = "";
  let recoveryMintError: string | null = null;

  const getActiveGroup = (): BridgeActivityGroup | null => {
    if (!activeGroupId) return null;
    return activityFeed.find((group) => group.id === activeGroupId) ?? null;
  };

  const persistActivityFeed = (): void => {
    saveBridgeActivityFeed(activityFeed);
  };

  const upsertActivityGroup = (group: BridgeActivityGroup): void => {
    const idx = activityFeed.findIndex((item) => item.id === group.id);
    if (idx >= 0) {
      activityFeed[idx] = group;
    } else {
      activityFeed.unshift(group);
    }
    activityFeed.sort((a, b) => b.updatedAt - a.updatedAt);
    if (activityFeed.length > CCTP_ACTIVITY_LIMIT) {
      activityFeed = activityFeed.slice(0, CCTP_ACTIVITY_LIMIT);
    }
    persistActivityFeed();
  };

  const updateActiveGroup = (mutator: (group: BridgeActivityGroup) => void): void => {
    const group = getActiveGroup();
    if (!group) return;
    mutator(group);
    group.updatedAt = Date.now();
    upsertActivityGroup(group);
  };

  const beginActivityGroup = (amountRaw: string, network: string): BridgeActivityGroup => {
    const next: BridgeActivityGroup = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      network,
      amountRaw,
      status: "running",
      phase: "approving",
      message: "Starting CCTP bridge…",
      attestationAttempts: 0,
      digest: null,
      error: null,
      steps: createEmptyStepTxMap(),
    };
    activeGroupId = next.id;
    upsertActivityGroup(next);
    return next;
  };

  const attachStepTx = (step: StepId, hash: string, chain: TxChain): void => {
    updateActiveGroup((group) => {
      group.steps[step] = { hash, chain };
      if (step === "burn" && !group.steps.attestation) {
        group.steps.attestation = { hash, chain };
      }
    });
  };

  const render = () => {
    const s = wallet.getState();

    if (s.connected && s.address) {
      const phaseBadgeClass = bridgePhase === "complete"
        ? "badge-green"
        : bridgePhase === "error"
          ? "badge-red"
          : bridgePhase === "idle"
            ? "badge-blue"
            : "badge-yellow";

      const isBusy = bridgePhase !== "idle" && bridgePhase !== "complete" && bridgePhase !== "error";
      const maxUsdc = s.waapBaseUsdcBalance !== null ? formatUsdcDecimal(s.waapBaseUsdcBalance) : "";
      const hasPending = !!loadPendingBridge();
      const mustResumePending = hasPending && bridgePhase === "idle";
      const parsedAmount = parseUsdcInput(bridgeAmount);
      const isDefaultDollar = parsedAmount === 1_000_000n;
      const minBaseGasWei = getCctpMinBaseGasWei();
      const baseGasLow = s.waapBaseAddress !== null
        && s.waapBaseBalance !== null
        && s.waapBaseBalance < minBaseGasWei;
      const activeGroup = getActiveGroup();
      const stepTxMap = activeGroup?.steps ?? activityFeed[0]?.steps ?? createEmptyStepTxMap();

      body.innerHTML = `
        <div class="card home-minimal">
          <div class="spread-row">
            <div>
              <div class="card-title">Portfolio</div>
              <div class="card-description">Sui + Base wallet overview.</div>
            </div>
            <button class="btn btn-secondary btn--compact" id="home-refresh">Refresh</button>
          </div>

          <div class="home-minimal-grid">
            <div class="home-minimal-item">
              <div class="home-minimal-label">Sui Balance</div>
              <div class="home-minimal-value code-text">${wallet.formatBalance()}</div>
              <div class="home-minimal-subvalue code-text">Sui USDC: ${wallet.formatSuiUsdcBalance()}</div>
            </div>
            <div class="home-minimal-item">
              <div class="home-minimal-label">Base USDC</div>
              <div class="home-minimal-value code-text">${wallet.formatBaseUsdcBalance()}</div>
            </div>
            <div class="home-minimal-item">
              <div class="home-minimal-label">Sui Address</div>
              <div class="home-minimal-value code-text">${wallet.formatAddress(true)}</div>
              <div class="home-minimal-subvalue code-text">SuiNS: ${s.suiPrimaryName ? escapeHtml(s.suiPrimaryName) : "—"}</div>
            </div>
            <div class="home-minimal-item">
              <div class="home-minimal-label">Base Address</div>
              <div class="home-minimal-value code-text">${s.waapBaseAddress ?? "Not linked"}</div>
            </div>
          </div>

          <div class="card home-transfer-card">
            <div class="spread-row">
              <div>
                <div class="card-title">CCTP Bridge: Base USDC → Sui USDC</div>
                <div class="card-description">Burns USDC on Base, Circle attests, mints native USDC on Sui. No wrapping.</div>
              </div>
              <span class="badge ${phaseBadgeClass}">${PHASE_LABELS[bridgePhase]}</span>
            </div>

            ${hasPending && bridgePhase === "idle" ? `
              <div class="cctp-resume-banner">
                <span>Pending bridge found from earlier session.</span>
                <button class="btn btn-primary btn--compact" id="home-resume">Resume</button>
                <button class="btn btn-secondary btn--compact" id="home-dismiss">Dismiss</button>
              </div>
            ` : ""}

            ${baseGasLow ? `
              <div class="cctp-gas-banner">
                <div class="cctp-gas-title">Base gas is low for bridge execution.</div>
                <div class="cctp-gas-subtitle">Thunderbun can swap a small USDC dust amount to ETH automatically.</div>
                <div class="cctp-gas-actions">
                  <button class="btn btn-secondary btn--compact" id="home-copy-base-gas"${!s.waapBaseAddress ? " disabled" : ""}>Copy Base Address</button>
                  ${sponsorConfigured ? `<button class="btn btn-primary btn--compact" id="home-request-sponsor"${sponsorBusy || !s.waapBaseAddress ? " disabled" : ""}>${sponsorBusy ? "Requesting…" : "Request Sponsor"}</button>` : ""}
                  <button class="btn btn-primary btn--compact" id="home-topup-gas"${gasTopupBusy || !s.waapBaseAddress ? " disabled" : ""}>${gasTopupBusy ? "Topping Up…" : "Top Up Gas (USDC)"}</button>
                </div>
                ${sponsorMessage ? `<div class="cctp-gas-status code-text">${escapeHtml(sponsorMessage)}</div>` : ""}
                ${sponsorError ? `<div class="cctp-gas-error">${escapeHtml(sponsorError)}</div>` : ""}
                ${gasTopupMessage ? `<div class="cctp-gas-status code-text">${escapeHtml(gasTopupMessage)}</div>` : ""}
                ${gasTopupError ? `<div class="cctp-gas-error">${escapeHtml(gasTopupError)}</div>` : ""}
              </div>
            ` : ""}

            <div class="cctp-amount-row">
              <div class="cctp-amount-group">
                <label class="input-label" for="home-amount">Amount (USDC)</label>
                <div class="input-row">
                  <input type="text" id="home-amount" class="input-field code-text"
                    placeholder="1.00" inputmode="decimal"
                    value="${escapeAttr(bridgeAmount)}"
                    ${isBusy || mustResumePending ? "disabled" : ""} />
                  <button class="btn btn-secondary btn--compact" id="home-max" ${isBusy || mustResumePending || !maxUsdc ? "disabled" : ""}>Max</button>
                </div>
              </div>
            </div>

            <div class="cctp-stepper">
              ${STEP_NAMES.map((name, i) => {
                const stepId = STEP_IDS[i];
                const stepClass = getStepClass(bridgePhase, i);
                const tx = stepTxMap[stepId];
                const txHtml = tx
                  ? `<a class="cctp-step-tx-link code-text" href="${escapeAttr(getExplorerTxUrl(tx.chain, tx.hash, s.network))}" target="_blank" rel="noopener">${escapeHtml(shortHash(tx.hash))}</a>`
                  : `<span class="cctp-step-tx-empty">No tx yet</span>`;
                return `
                  <div class="cctp-step ${stepClass}">
                    <div class="cctp-step-tx">${txHtml}</div>
                    <div class="cctp-step-main">
                      <span class="cctp-step-num">${i + 1}</span>
                      <span>${name}</span>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>

            ${bridgeMessage ? `<div class="cctp-status code-text">${escapeHtml(bridgeMessage)}${attestationAttempts > 0 ? ` (attempt ${attestationAttempts})` : ""}${bridgeDigest ? ` · <span class="cctp-digest">${shortDigest(bridgeDigest)}</span>` : ""}</div>` : ""}
            ${bridgeError ? `<div class="cctp-error">${escapeHtml(bridgeError)}</div>` : ""}

            <div class="cctp-activity-feed">
              <div class="spread-row">
                <div class="card-title">Recent Bridge Activity</div>
                <button class="btn btn-secondary btn--compact" id="home-clear-activity"${activityFeed.length === 0 ? " disabled" : ""}>Clear</button>
              </div>
              ${activityFeed.length === 0
                ? `<div class="cctp-activity-empty">No bridge groups yet.</div>`
                : `<div class="cctp-activity-list">${activityFeed.map((group) => renderActivityGroup(group)).join("")}</div>`}
            </div>

            <div class="home-minimal-actions">
              <button class="btn btn-primary" id="home-bridge" ${isBusy || !s.waapBaseAddress ? "disabled" : ""}>${
                isBusy ? "Processing…"
                : mustResumePending ? "Resume Pending Bridge"
                : bridgePhase === "complete" ? "Bridge Again"
                : bridgePhase === "error" ? "Retry Bridge"
                : isDefaultDollar ? "Send $1 to Sui" : "Bridge to Sui"
              }</button>
              <button class="btn btn-secondary" id="home-sdk-route"${!s.connected ? " disabled" : ""}>Use SDK Route (Ika/WaaP)</button>
            </div>
            <div class="card-description">Fallback: SDK route in Cross-Chain section (Ika/WaaP path).</div>
          </div>

          <div class="card">
            <div class="spread-row">
              <div>
                <div class="card-title">Burn Recovery</div>
                <div class="card-description">Scan Base for past USDC burns and mint any with completed attestations.</div>
              </div>
              <button class="btn btn-primary btn--compact" id="home-scan-burns" ${recoveryScanBusy ? "disabled" : ""}>${recoveryScanBusy ? "Scanning…" : "Scan Burns"}</button>
            </div>
            ${recoveryScanMessage ? `<div class="cctp-status code-text">${escapeHtml(recoveryScanMessage)}</div>` : ""}
            ${recoveryScanError ? `<div class="cctp-error">${escapeHtml(recoveryScanError)}</div>` : ""}
            ${recoveryMintMessage ? `<div class="recovery-mint-status code-text">${escapeHtml(recoveryMintMessage)}</div>` : ""}
            ${recoveryMintError ? `<div class="recovery-mint-error">${escapeHtml(recoveryMintError)}</div>` : ""}
            ${recoveredBurns.length > 0 ? `
              <div class="recovery-burn-list">
                ${recoveredBurns.map((burn, i) => `
                  <div class="recovery-burn-item">
                    <div class="recovery-burn-info">
                      <div class="recovery-burn-tx code-text">${escapeHtml(shortHash(burn.burnTxHash))} · ${escapeHtml(formatRecoveryUsdc(burn.amount))}</div>
                      <div class="recovery-burn-meta">Nonce ${burn.nonce.toString()} · Block ${burn.blockNumber.toLocaleString()}</div>
                    </div>
                    <div>
                      ${burn.attestationStatus === "complete"
                        ? `<button class="btn btn-primary btn--compact" data-recovery-idx="${i}" ${recoveryMintingIndex !== null ? "disabled" : ""}>${recoveryMintingIndex === i ? "Minting…" : "Mint on Sui"}</button>`
                        : burn.attestationStatus === "minted"
                          ? `<span class="badge badge-green">Minted</span>`
                          : burn.attestationStatus === "pending"
                            ? `<span class="badge badge-yellow">Pending</span>`
                            : `<span class="badge badge-red">Unknown</span>`
                      }
                    </div>
                  </div>
                `).join("")}
              </div>
            ` : ""}
          </div>

          <div class="home-minimal-actions">
            <button class="btn btn-primary btn--compact" id="home-link-base">${s.waapBaseAddress ? "Re-link Base" : "Link Base"}</button>
            <button class="btn btn-secondary btn--compact" id="home-open-suins">Open SuiNS</button>
            <button class="btn btn-secondary btn--compact" id="home-disconnect-waap">Disconnect WaaP</button>
          </div>
        </div>
      `;

      // Event handlers
      body.querySelector("#home-disconnect-waap")?.addEventListener("click", () => {
        wallet.disconnectWaaP().catch((err) => console.error("[home] failed disconnecting WaaP", err));
      });
      body.querySelector("#home-refresh")?.addEventListener("click", async () => {
        await wallet.refreshBalance();
      });
      body.querySelector<HTMLButtonElement>("#home-link-base")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = "Linking…";
        try {
          await wallet.linkWaaPBaseAddress();
        } catch (err) {
          console.error("[home] failed linking WaaP Base", err);
        } finally {
          btn.disabled = false;
          btn.textContent = original ?? "Link Base";
        }
      });
      body.querySelector("#home-open-suins")?.addEventListener("click", () => gotoSection("suins"));
      body.querySelector<HTMLButtonElement>("#home-copy-base-gas")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget as HTMLButtonElement;
        const baseAddress = wallet.getState().waapBaseAddress;
        if (!baseAddress) return;
        try {
          await navigator.clipboard.writeText(baseAddress);
          const original = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = original ?? "Copy Base Address";
          }, 900);
        } catch {
          gasTopupError = "Failed to copy Base address.";
          render();
        }
      });
      body.querySelector<HTMLButtonElement>("#home-topup-gas")?.addEventListener("click", () => {
        void runGasTopup();
      });
      body.querySelector<HTMLButtonElement>("#home-request-sponsor")?.addEventListener("click", () => {
        void runBaseSponsor();
      });

      // Amount input — preserve value in closure
      const amountInput = body.querySelector<HTMLInputElement>("#home-amount");
      amountInput?.addEventListener("input", () => {
        bridgeAmount = amountInput.value;
      });

      // Max button
      body.querySelector("#home-max")?.addEventListener("click", () => {
        if (s.waapBaseUsdcBalance !== null) {
          bridgeAmount = formatUsdcDecimal(s.waapBaseUsdcBalance);
          if (amountInput) amountInput.value = bridgeAmount;
        }
      });

      // Bridge button
      body.querySelector("#home-bridge")?.addEventListener("click", () => {
        if (mustResumePending) {
          void runResume();
          return;
        }
        if (bridgePhase === "complete" || bridgePhase === "error") {
          resetBridge();
          render();
          return;
        }
        void runCctpBridge();
      });
      body.querySelector("#home-sdk-route")?.addEventListener("click", () => {
        gotoSection("crosschain");
      });

      // Resume button
      body.querySelector("#home-resume")?.addEventListener("click", () => {
        void runResume();
      });

      // Dismiss pending
      body.querySelector("#home-dismiss")?.addEventListener("click", () => {
        clearPendingBridge();
        render();
      });

      body.querySelector("#home-clear-activity")?.addEventListener("click", () => {
        activityFeed = [];
        activeGroupId = null;
        saveBridgeActivityFeed(activityFeed);
        render();
      });

      body.querySelector("#home-scan-burns")?.addEventListener("click", () => {
        void runRecoveryScan();
      });
      body.querySelectorAll<HTMLButtonElement>("[data-recovery-idx]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.recoveryIdx);
          if (!Number.isNaN(idx)) void runRecoveryMint(idx);
        });
      });

    } else {
      body.innerHTML = `
        <div class="card home-minimal">
          <div class="card-title">Connect Wallet</div>
          <div class="card-description">Use WaaP to load Sui + Base balances and bridge Base USDC to Sui via CCTP.</div>
          <button class="btn btn-primary" id="home-connect">Connect WaaP</button>
        </div>
      `;

      const btn = body.querySelector<HTMLButtonElement>("#home-connect");
      btn?.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Connecting…";
        try {
          await wallet.connect();
        } catch (err) {
          console.error(err);
        } finally {
          btn.disabled = false;
          btn.textContent = "Connect WaaP";
        }
      });
    }
  };

  function onProgress(p: CctpProgress): void {
    bridgePhase = p.phase;
    bridgeMessage = p.message;
    if (p.attemptCount !== undefined) attestationAttempts = p.attemptCount;
    updateActiveGroup((group) => {
      group.phase = p.phase;
      group.message = p.message;
      if (p.attemptCount !== undefined) {
        group.attestationAttempts = p.attemptCount;
      }
      if (p.txHash && p.step) {
        const chain = p.txChain ?? (p.step === "mint" ? "sui" : "base");
        group.steps[p.step] = { hash: p.txHash, chain };
        if (p.step === "burn" && !group.steps.attestation) {
          group.steps.attestation = { hash: p.txHash, chain };
        }
      }
      if (p.phase === "complete") {
        group.status = "complete";
      }
    });
    if (mounted) render();
  }

  async function runCctpBridge(): Promise<void> {
    if (bridgeInFlight) return;
    if (bridgePhase !== "idle" && bridgePhase !== "complete" && bridgePhase !== "error") return;
    if (!mounted) return;

    const normalizedInput = bridgeAmount.trim() ? bridgeAmount : "1";
    if (!bridgeAmount.trim()) {
      bridgeAmount = normalizedInput;
    }

    const rawAmount = parseUsdcInput(normalizedInput);
    if (rawAmount === null || rawAmount <= 0n) {
      bridgeError = "Enter a valid USDC amount.";
      render();
      return;
    }

    bridgeInFlight = true;
    bridgeError = null;
    bridgeDigest = null;
    attestationAttempts = 0;
    bridgePhase = "approving";
    bridgeMessage = "Starting CCTP bridge…";
    beginActivityGroup(rawAmount.toString(), wallet.getState().network);
    render();

    try {
      const conn = wallet.getState();
      if (!conn.connected) await wallet.connect();
      if (!wallet.getState().waapBaseAddress) await wallet.linkWaaPBaseAddress();

      const result = await executeCctpBridge({ amount: rawAmount }, onProgress);
      bridgeDigest = result.digest;
      bridgePhase = "complete";
      bridgeMessage = "Bridge complete. Native USDC minted on Sui.";
      bridgeError = null;
      attachStepTx("mint", result.digest, "sui");
      updateActiveGroup((group) => {
        group.status = "complete";
        group.phase = "complete";
        group.digest = result.digest;
        group.error = null;
        group.message = bridgeMessage;
      });

      await wallet.refreshBalance();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bridgePhase = "error";
      bridgeError = message;
      bridgeMessage = "Bridge failed.";
      updateActiveGroup((group) => {
        group.status = "error";
        group.phase = "error";
        group.error = message;
        group.message = bridgeMessage;
      });
      console.error("[home] CCTP bridge failed", err);
    } finally {
      bridgeInFlight = false;
    }

    if (mounted) render();
  }

  async function runResume(): Promise<void> {
    if (bridgeInFlight) return;
    bridgeInFlight = true;
    const pending = loadPendingBridge();
    if (pending) {
      const existing = activityFeed.find((group) => group.steps.burn?.hash.toLowerCase() === pending.burnTxHash.toLowerCase());
      if (existing) {
        activeGroupId = existing.id;
      } else {
        const resumed = beginActivityGroup(pending.amount, pending.network);
        resumed.phase = "attesting";
        resumed.message = "Resuming attestation polling…";
        resumed.steps.burn = { hash: pending.burnTxHash, chain: "base" };
        resumed.steps.attestation = { hash: pending.burnTxHash, chain: "base" };
        upsertActivityGroup(resumed);
      }
    }

    bridgeError = null;
    bridgeDigest = null;
    attestationAttempts = 0;
    bridgePhase = "attesting";
    bridgeMessage = "Resuming attestation polling…";
    render();

    try {
      const result = await resumePendingBridge(onProgress);
      bridgeDigest = result.digest;
      bridgePhase = "complete";
      bridgeMessage = "Bridge complete (resumed). Native USDC minted on Sui.";
      bridgeError = null;
      attachStepTx("mint", result.digest, "sui");
      updateActiveGroup((group) => {
        group.status = "complete";
        group.phase = "complete";
        group.digest = result.digest;
        group.error = null;
        group.message = bridgeMessage;
      });

      await wallet.refreshBalance();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bridgePhase = "error";
      bridgeError = message;
      bridgeMessage = "Resume failed.";
      updateActiveGroup((group) => {
        group.status = "error";
        group.phase = "error";
        group.error = message;
        group.message = bridgeMessage;
      });
      console.error("[home] CCTP resume failed", err);
    } finally {
      bridgeInFlight = false;
    }

    if (mounted) render();
  }

  async function runGasTopup(): Promise<void> {
    if (gasTopupBusy) return;
    gasTopupBusy = true;
    gasTopupError = null;
    gasTopupMessage = "Preparing USDC dust swap…";
    render();

    try {
      await topUpBaseGasFromUsdc((message) => {
        gasTopupMessage = message;
        if (mounted) render();
      });
      gasTopupMessage = "Gas top-up flow completed.";
      gasTopupError = null;
      await wallet.refreshBalance();
    } catch (err) {
      gasTopupError = err instanceof Error ? err.message : String(err);
      gasTopupMessage = "";
    } finally {
      gasTopupBusy = false;
      if (mounted) render();
    }
  }

  async function runBaseSponsor(): Promise<void> {
    if (sponsorBusy) return;
    sponsorBusy = true;
    sponsorError = null;
    sponsorMessage = "Requesting sponsored gas transfer…";
    render();

    try {
      const res = await requestBaseGasSponsor((message) => {
        sponsorMessage = message;
        if (mounted) render();
      });
      sponsorMessage = `Sponsor tx submitted: ${shortHash(res.txHash)}`;
      sponsorError = null;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await wallet.refreshBalance();
    } catch (err) {
      sponsorError = err instanceof Error ? err.message : String(err);
      sponsorMessage = "";
    } finally {
      sponsorBusy = false;
      if (mounted) render();
    }
  }

  async function runRecoveryScan(): Promise<void> {
    if (recoveryScanBusy) return;
    recoveryScanBusy = true;
    recoveryScanError = null;
    recoveryScanMessage = "Starting scan…";
    recoveredBurns = [];
    recoveryMintMessage = "";
    recoveryMintError = null;
    recoveryMintingIndex = null;
    render();

    try {
      recoveredBurns = await scanPastBurns((msg) => {
        recoveryScanMessage = msg;
        if (mounted) render();
      });
      recoveryScanError = null;
    } catch (err) {
      recoveryScanError = err instanceof Error ? err.message : String(err);
      recoveryScanMessage = "";
    } finally {
      recoveryScanBusy = false;
      if (mounted) render();
    }
  }

  async function runRecoveryMint(index: number): Promise<void> {
    const burn = recoveredBurns[index];
    if (!burn || burn.attestationStatus !== "complete") return;
    if (recoveryMintingIndex !== null) return;

    recoveryMintingIndex = index;
    recoveryMintError = null;
    recoveryMintMessage = "Building Sui mint transaction…";
    render();

    try {
      const result = await mintRecoveredBurn(burn, (p) => {
        recoveryMintMessage = p.message;
        if (mounted) render();
      });
      burn.attestationStatus = "minted";
      recoveryMintMessage = `Mint complete. Digest: ${shortDigest(result.digest)}`;
      recoveryMintError = null;
      await wallet.refreshBalance();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("nonce") || message.includes("already")) {
        burn.attestationStatus = "minted";
        recoveryMintMessage = "Already minted on Sui.";
        recoveryMintError = null;
      } else {
        recoveryMintError = message;
        recoveryMintMessage = "";
      }
    } finally {
      recoveryMintingIndex = null;
      if (mounted) render();
    }
  }

  function resetBridge(): void {
    bridgePhase = "idle";
    bridgeMessage = "";
    bridgeDigest = null;
    bridgeError = null;
    attestationAttempts = 0;
  }

  const unsub = wallet.subscribe(() => {
    if (bridgePhase === "idle" || bridgePhase === "complete" || bridgePhase === "error") {
      render();
    }
  });
  cleanup(container, () => {
    mounted = false;
    unsub();
  });

  void (async () => {
    const status = await getBaseSponsorStatus();
    sponsorConfigured = status.configured;
    if (mounted) render();
  })();
}

// ── Step stepper logic ───────────────────────────────────────────────────

function getStepClass(phase: BridgePhase, stepIndex: number): string {
  const phaseOrder: BridgePhase[] = ["approving", "burning", "attesting", "minting"];
  const currentIdx = phaseOrder.indexOf(phase);

  if (phase === "complete") return "is-complete";
  if (phase === "idle" || phase === "error") return "";
  if (currentIdx < 0) return "";
  if (stepIndex < currentIdx) return "is-complete";
  if (stepIndex === currentIdx) return "is-active";
  return "";
}

// ── Helpers ──────────────────────────────────────────────────────────────

function gotoSection(id: string): void {
  const app = (window as unknown as Record<string, { showSection: (sectionId: string) => void }>).__app;
  app?.showSection(id);
}

function cleanup(container: HTMLElement, unsub: () => void) {
  const obs = new MutationObserver(() => {
    if (!document.contains(container)) {
      unsub();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

function shortDigest(digest: string): string {
  if (digest.length < 18) return digest;
  return `${digest.slice(0, 10)}…${digest.slice(-6)}`;
}

function shortHash(hash: string): string {
  if (hash.length < 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function parseUsdcInput(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{0,6})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded);
}

function formatUsdcDecimal(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const fractional = raw % 1_000_000n;
  if (fractional === 0n) return whole.toString();
  const padded = fractional.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${padded}`;
}

function formatRecoveryUsdc(raw: bigint): string {
  const decimal = formatUsdcDecimal(raw);
  return `${decimal} USDC`;
}

function createEmptyStepTxMap(): StepTxMap {
  return {
    approve: null,
    burn: null,
    attestation: null,
    mint: null,
  };
}

function loadBridgeActivityFeed(): BridgeActivityGroup[] {
  try {
    const raw = localStorage.getItem(CCTP_ACTIVITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BridgeActivityGroup[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object" && typeof item.id === "string")
      .slice(0, CCTP_ACTIVITY_LIMIT);
  } catch {
    return [];
  }
}

function saveBridgeActivityFeed(feed: BridgeActivityGroup[]): void {
  try {
    localStorage.setItem(CCTP_ACTIVITY_STORAGE_KEY, JSON.stringify(feed.slice(0, CCTP_ACTIVITY_LIMIT)));
  } catch {
    // ignore localStorage failures
  }
}

function renderActivityGroup(group: BridgeActivityGroup): string {
  const statusClass = group.status === "complete"
    ? "badge-green"
    : group.status === "error"
      ? "badge-red"
      : "badge-yellow";
  const amount = safeFormatAmount(group.amountRaw);

  return `
    <div class="cctp-activity-item">
      <div class="cctp-activity-head">
        <div class="cctp-activity-title">${escapeHtml(amount)} USDC</div>
        <span class="badge ${statusClass}">${escapeHtml(group.status)}</span>
      </div>
      <div class="cctp-activity-meta code-text">${escapeHtml(formatTimestamp(group.startedAt))} · ${escapeHtml(group.network)}</div>
      <div class="cctp-activity-step-row">
        ${STEP_IDS.map((stepId, index) => {
          const stepLabel = STEP_NAMES[index];
          const tx = group.steps[stepId];
          const txLine = tx
            ? `<a class="cctp-activity-link code-text" href="${escapeAttr(getExplorerTxUrl(tx.chain, tx.hash, group.network))}" target="_blank" rel="noopener">${escapeHtml(shortHash(tx.hash))}</a>`
            : `<span class="cctp-activity-empty-tx">—</span>`;
          return `<div class="cctp-activity-step"><span class="cctp-activity-step-label">${escapeHtml(stepLabel)}</span>${txLine}</div>`;
        }).join("")}
      </div>
      ${group.error ? `<div class="cctp-activity-error">${escapeHtml(group.error)}</div>` : ""}
    </div>
  `;
}

function getExplorerTxUrl(chain: TxChain, hash: string, network: string): string {
  if (chain === "base") {
    return network === "mainnet"
      ? `https://basescan.org/tx/${hash}`
      : `https://sepolia.basescan.org/tx/${hash}`;
  }
  if (network === "mainnet") return `https://suiscan.xyz/tx/${hash}`;
  if (network === "testnet") return `https://suiscan.xyz/testnet/tx/${hash}`;
  return `https://suiscan.xyz/devnet/tx/${hash}`;
}

function formatTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return String(timestamp);
  }
}

function safeFormatAmount(raw: string): string {
  try {
    return formatUsdcDecimal(BigInt(raw));
  } catch {
    return raw;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
