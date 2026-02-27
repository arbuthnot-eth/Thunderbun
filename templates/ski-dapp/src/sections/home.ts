import type { CctpPhase, CctpProgress, RecoverableBurn } from "../lib/cctp";
import { wallet } from "../wallet";

// Lazy-load the full CCTP module — keeps viem + bridge logic out of the home chunk.
const cctp = () => import("../lib/cctp");

// Inlined lightweight sync helpers (avoid importing the full cctp module at render time)
const PENDING_KEY = "cctp-pending-bridge";
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_GAS_WEI = 5_000_000_000_000n;

function loadPendingBridge(): boolean {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { timestamp: number };
    if (Date.now() - parsed.timestamp > PENDING_TTL_MS) {
      sessionStorage.removeItem(PENDING_KEY);
      return false;
    }
    return true;
  } catch { return false; }
}


function getCctpMinBaseGasWei(): bigint {
  const raw = (import.meta.env as Record<string, string | undefined>)["VITE_CCTP_MIN_BASE_GAS_WEI"]?.trim();
  if (!raw) return DEFAULT_MIN_GAS_WEI;
  try { const v = BigInt(raw); return v >= 0n ? v : DEFAULT_MIN_GAS_WEI; } catch { return DEFAULT_MIN_GAS_WEI; }
}

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

  const sectionEl = container.querySelector<HTMLElement>(".section");
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
  let mounted = true;
  let bridgeInFlight = false;
  let activityFeed = loadBridgeActivityFeed();
  let activeGroupId: string | null = activityFeed[0]?.id ?? null;
  let recoveredBurns: RecoverableBurn[] = [];
  let recoveryScanBusy = false;
  let recoveryScanMessage = "";
  let recoveryScanError: string | null = null;
  let recoveryTxHashInput = "";
  let recoveryMintingIndex: number | null = null;
  let recoveryMintMessage = "";
  let recoveryMintError: string | null = null;
  let attestStartTime: number | null = null;
  let attestTimerId: ReturnType<typeof setInterval> | null = null;
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
      message: "Starting CCTP transfer…",
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
    sectionEl?.classList.remove("home-loading-section");

    if (s.hydrating || !s.connected || !s.address) {
      sectionEl?.classList.add("home-loading-section");
      body.innerHTML = "";
      return;
    }

    if (s.connected && s.address) {
      const isBusy = bridgePhase !== "idle" && bridgePhase !== "complete" && bridgePhase !== "error";
      const quickSend95Raw = s.waapBaseUsdcBalance !== null ? (s.waapBaseUsdcBalance * 95n) / 100n : null;
      const quickSend95Label = quickSend95Raw !== null && quickSend95Raw > 0n
        ? formatUsdFromUsdcRaw(quickSend95Raw)
        : "95%";
      const hasPending = !!loadPendingBridge();
      const mustResumePending = hasPending && bridgePhase === "idle";

      const phaseBadgeClass = bridgePhase === "complete"
        ? "badge-green"
        : bridgePhase === "error"
          ? "badge-red"
          : mustResumePending
            ? "badge-yellow"
            : bridgePhase === "idle"
              ? "badge-blue"
              : "badge-yellow";
      const phaseBadgeLabel = mustResumePending ? "Resume" : PHASE_LABELS[bridgePhase];
      const parsedAmount = parseUsdcInput(bridgeAmount);
      const minBaseGasWei = getCctpMinBaseGasWei();
      const baseGasLow = s.waapBaseAddress !== null
        && s.waapBaseBalance !== null
        && s.waapBaseBalance < minBaseGasWei;
      const activeGroup = getActiveGroup();
      const stepTxMap = activeGroup?.steps ?? activityFeed[0]?.steps ?? createEmptyStepTxMap();
      const abamGroup = activeGroup ?? activityFeed[0] ?? null;
      const abamPhase = abamGroup?.phase ?? bridgePhase;
      const abamStepTxMap = abamGroup?.steps ?? stepTxMap;
      const abamStatusClass = abamGroup
        ? (abamGroup.status === "complete" ? "badge-green" : abamGroup.status === "error" ? "badge-red" : "badge-yellow")
        : "badge-blue";

      const suiAddrFull = wallet.formatAddress(true);
      const baseAddrFull = s.waapBaseAddress ?? "";
      const suiDisplay = s.suiPrimaryName ? escapeHtml(s.suiPrimaryName) : truncAddr(suiAddrFull);
      const baseDisplay = s.waapBasePrimaryName ? escapeHtml(s.waapBasePrimaryName) : (baseAddrFull ? truncAddr(baseAddrFull) : "Not linked");
      const copyIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      const checkIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      const usdcIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#2775CA"/><path d="M12 5.5v13M15.6 8.7c-.8-.7-2-1.2-3.6-1.2-2 0-3.4 1-3.4 2.5 0 1.6 1.2 2.2 3.4 2.6 2.2.4 3.2.9 3.2 2.4 0 1.6-1.4 2.6-3.6 2.6-1.6 0-3-.5-4-1.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;
      const baseUsdcRaw = s.waapBaseUsdcBalance ?? 0n;
      const suiUsdcRaw = s.suiUsdcBalance ?? 0n;
      const totalUsdcRaw = baseUsdcRaw + suiUsdcRaw;
      const baseSharePct = ratioPercent(baseUsdcRaw, totalUsdcRaw);
      const suiSharePct = ratioPercent(suiUsdcRaw, totalUsdcRaw);
      const baseUsdcDollar = formatUsdFromUsdcRaw(baseUsdcRaw);
      const suiUsdcDollar = formatUsdFromUsdcRaw(suiUsdcRaw);
      const quickSend95Disabled = isBusy || !s.waapBaseAddress || quickSend95Raw === null || quickSend95Raw <= 0n;
      const sendAmountLabel = parsedAmount && parsedAmount > 0n ? formatUsdFromUsdcRaw(parsedAmount) : null;
      const bamAmountLabel = abamGroup ? `${safeFormatAmount(abamGroup.amountRaw)} USDC` : null;

      body.innerHTML = `
        <div class="home-layout">
          <div class="home-bridge-section">
              <div class="home-bridge-header">
                <div>
                  <div class="home-bridge-title">CCTP Transfer</div>
                </div>
                ${mustResumePending
                  ? `<button class="badge ${phaseBadgeClass} badge-btn" id="home-resume">${phaseBadgeLabel}</button>`
                  : `<span class="badge ${phaseBadgeClass}">${phaseBadgeLabel}</span>`}
              </div>

              ${baseGasLow ? `
                <div class="cctp-gas-banner">
                  <div class="cctp-gas-title">Base gas is low</div>
                  <div class="cctp-gas-subtitle">Swap a small USDC amount to ETH automatically.</div>
                  <div class="cctp-gas-actions">
                    <button class="btn btn-secondary btn--compact" id="home-copy-base-gas"${!s.waapBaseAddress ? " disabled" : ""}>Copy Base Address</button>
                    <button class="btn btn-primary btn--compact" id="home-topup-gas"${gasTopupBusy || !s.waapBaseAddress ? " disabled" : ""}>${gasTopupBusy ? "Topping Up…" : "Top Up Gas"}</button>
                  </div>
                  ${gasTopupMessage ? `<div class="cctp-gas-status code-text">${escapeHtml(gasTopupMessage)}</div>` : ""}
                  ${gasTopupError ? `<div class="cctp-gas-error">${escapeHtml(gasTopupError)}</div>` : ""}
                </div>
              ` : ""}

              <div class="cctp-amount-row">
                <div class="cctp-amount-group">
                  <div class="input-row">
                    <div class="cctp-amount-shell">
                      <span class="cctp-amount-prefix">$</span>
                      <input type="text" id="home-amount" class="input-field code-text cctp-amount-input"
                        placeholder="0.00" inputmode="decimal"
                        value="${escapeAttr(bridgeAmount)}"
                        ${isBusy ? "disabled" : ""} />
                    </div>
                    <button class="btn btn-secondary btn--compact" id="home-send-95" ${quickSend95Disabled ? "disabled" : ""}>95%</button>
                  </div>
                </div>
              </div>

              <!-- Circular progress -->
              <div class="cctp-circle-wrap">
                <div class="cctp-share-node cctp-share-node--base">
                  <div class="cctp-share-circle cctp-share-circle--base" style="--share:${baseSharePct.toFixed(2)}">
                    <div class="cctp-share-core">
                      <div class="cctp-share-value code-text">${escapeHtml(baseUsdcDollar)}</div>
                      <div class="cctp-share-percent">${formatPercent(baseSharePct)}</div>
                    </div>
                  </div>
                  <div class="home-id-row home-id-row--cctp">
                    <div class="home-id-chain">
                      <span class="home-id-dot home-id-dot--base"></span>
                      Base
                    </div>
                    <div class="home-id-detail">
                      <span class="home-id-name code-text" title="${escapeAttr(baseAddrFull)}">${baseDisplay}</span>
                    </div>
                    ${baseAddrFull ? `<button class="home-id-copy" data-copy-value="${escapeAttr(baseAddrFull)}" aria-label="Copy Base address" title="Copy">${copyIconSvg}</button>` : ""}
                  </div>
                </div>
                <div class="home-cctp-center-stack">
                  <img
                    class="home-cctp-logo"
                    src="/icons/tbai.svg"
                    alt=""
                    width="60"
                    height="60"
                    loading="lazy"
                  />
                  <div class="home-abam-core home-abam-core--cctp">
                    <div class="home-abam-head">
                      <span>BAM Events</span>
                      <div class="home-abam-head-right">
                        ${bamAmountLabel ? `<div class="home-abam-amount code-text">${usdcIconSvg}<span>${escapeHtml(bamAmountLabel)}</span></div>` : ""}
                        ${abamGroup ? `<span class="badge ${abamStatusClass}">${escapeHtml(abamGroup.status)}</span>` : `<span class="badge ${abamStatusClass}">idle</span>`}
                      </div>
                    </div>
                    <div class="home-abam-steps">
                      ${[
                        { id: "burn" as const, label: "Burn" },
                        { id: "attestation" as const, label: "Attest" },
                        { id: "mint" as const, label: "Mint" },
                      ].map((step, i) => {
                        const stepClass = getStepClass(abamPhase, STEP_IDS.indexOf(step.id));
                        const stepId = step.id;
                        const tx = abamStepTxMap[stepId];
                        const marker = stepClass === "is-complete"
                          ? `<span class="home-abam-marker home-abam-marker--check">${checkIconSvg}</span>`
                          : `<span class="home-abam-marker ${stepClass === "is-active" ? "is-active" : ""}">${i + 1}</span>`;
                        const label = tx
                          ? `<a class="home-abam-step-link" href="${escapeAttr(getExplorerTxUrl(tx.chain, tx.hash, s.network))}" target="_blank" rel="noopener">${step.label} ↗</a>`
                          : `<span>${step.label}</span>`;
                        return `<div class="home-abam-step ${stepClass}">${marker}${label}</div>`;
                      }).join("")}
                    </div>
                    <div class="home-abam-meta code-text">
                      ${abamGroup
                        ? `${escapeHtml(safeFormatAmount(abamGroup.amountRaw))} USDC · ${escapeHtml(formatTimestamp(abamGroup.startedAt))}`
                        : "No bridge activity yet."}
                    </div>
                  </div>
                </div>
                <div class="cctp-share-node cctp-share-node--sui">
                  <div class="cctp-share-circle cctp-share-circle--sui" style="--share:${suiSharePct.toFixed(2)}">
                    <div class="cctp-share-core">
                      <div class="cctp-share-value code-text">${escapeHtml(suiUsdcDollar)}</div>
                      <div class="cctp-share-percent">${formatPercent(suiSharePct)}</div>
                    </div>
                  </div>
                  <div class="home-id-row home-id-row--cctp">
                    <div class="home-id-chain">
                      <span class="home-id-dot home-id-dot--sui"></span>
                      Sui
                    </div>
                    <div class="home-id-detail">
                      <span class="home-id-name code-text" title="${escapeAttr(suiAddrFull)}">${suiDisplay}</span>
                    </div>
                    <button class="home-id-copy" data-copy-value="${escapeAttr(suiAddrFull)}" aria-label="Copy Sui address" title="Copy">${copyIconSvg}</button>
                  </div>
                </div>
              </div>

              ${bridgeMessage ? `<div class="cctp-status code-text">${escapeHtml(bridgeMessage)}${attestationAttempts > 0 ? ` (attempt ${attestationAttempts})` : ""}${bridgeDigest ? ` · <a class="cctp-digest code-text" href="${escapeAttr(getExplorerTxUrl("sui", bridgeDigest, s.network))}" target="_blank" rel="noopener">${shortDigest(bridgeDigest)}</a>` : ""}</div>` : ""}
              ${bridgeError ? `<div class="cctp-error">${escapeHtml(bridgeError)}</div>` : ""}

              <div class="home-bridge-actions">
                <button class="btn btn-secondary" id="home-bridge" ${isBusy || !s.waapBaseAddress ? "disabled" : ""}>${
                  isBusy ? "Processing…"
                  : bridgePhase === "complete" ? "Transfer Again"
                  : bridgePhase === "error" ? "Retry Transfer"
                  : sendAmountLabel ? `Send ${escapeHtml(sendAmountLabel)} to Sui` : "Send to Sui"
                }</button>
                <button class="btn btn-secondary" id="home-bridge-95" ${quickSend95Disabled ? "disabled" : ""}>${isBusy ? "95% in progress…" : `Send 95% (${escapeHtml(quickSend95Label)})`}</button>
              </div>
            </div>

          <!-- Sidebar: Activity + Recovery -->
          <aside class="home-sidebar">
            <div class="home-activity-section">
              <div class="spread-row" style="flex-wrap:wrap;gap:6px">
                <div class="home-bridge-title">Recent Transfers</div>
                <div class="inline-group--tight">
                  ${recoveredBurns.some((b) => b.attestationStatus === "complete")
                    ? `<button class="btn btn-primary btn--compact" id="home-mint-all" ${recoveryMintingIndex !== null ? "disabled" : ""}>${recoveryMintingIndex !== null ? "Minting…" : "Mint All"}</button>`
                    : ""}
                  <button class="btn btn-secondary btn--compact" id="home-scan-burns" ${recoveryScanBusy ? "disabled" : ""}>${recoveryScanBusy ? "Scanning…" : "Scan Burns"}</button>
                  <button class="btn btn-secondary btn--compact" id="home-clear-activity"${activityFeed.length === 0 ? " disabled" : ""}>Clear</button>
                </div>
              </div>
              <div class="recovery-tx-row">
                <input
                  type="text"
                  id="home-recover-tx"
                  class="input-field code-text"
                  placeholder="Base tx hash or Basescan URL"
                  value="${escapeAttr(recoveryTxHashInput)}"
                  ${recoveryScanBusy || recoveryMintingIndex !== null ? "disabled" : ""}
                />
                <button
                  class="btn btn-secondary btn--compact"
                  id="home-recover-by-tx"
                  ${recoveryScanBusy || recoveryMintingIndex !== null ? "disabled" : ""}
                >Load Tx</button>
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
                            ? burn.mintDigest
                              ? `<a class="badge badge-green" href="${escapeAttr(getExplorerTxUrl("sui", burn.mintDigest, s.network))}" target="_blank" rel="noopener">Minted ↗</a>`
                              : `<span class="badge badge-green">Minted</span>`
                            : burn.attestationStatus === "pending"
                              ? `<span class="badge badge-yellow">Pending</span>`
                              : `<span class="badge badge-red">Unknown</span>`
                        }
                      </div>
                    </div>
                  `).join("")}
                </div>
              ` : ""}
              ${activityFeed.length === 0
                ? `<div class="cctp-activity-empty">No transfers yet.</div>`
                : `<div class="cctp-activity-list">${activityFeed.map((group) => renderActivityGroup(group, s.network)).join("")}</div>`}
            </div>
          </aside>
        </div>
      `;

      // Event handlers
      body.querySelectorAll<HTMLButtonElement>(".home-id-copy").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const value = btn.dataset.copyValue;
          if (!value) return;
          try {
            await navigator.clipboard.writeText(value);
            btn.innerHTML = checkIconSvg;
            btn.classList.add("is-copied");
            setTimeout(() => {
              btn.innerHTML = copyIconSvg;
              btn.classList.remove("is-copied");
            }, 1200);
          } catch { /* ignore */ }
        });
      });
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

      // Amount input — preserve value in closure
      const amountInput = body.querySelector<HTMLInputElement>("#home-amount");
      amountInput?.addEventListener("input", () => {
        bridgeAmount = amountInput.value;
      });

      const runQuickBridge95 = () => {
        if (s.waapBaseUsdcBalance === null) return;
        const ninetyFive = (s.waapBaseUsdcBalance * 95n) / 100n;
        if (ninetyFive <= 0n) {
          bridgeError = "Not enough Base USDC to send 95%.";
          render();
          return;
        }
        bridgeAmount = formatUsdcDecimal(ninetyFive);
        if (amountInput) amountInput.value = bridgeAmount;
        if (bridgePhase === "complete" || bridgePhase === "error") {
          resetBridge();
        }
        void runCctpBridge();
      };
      body.querySelector("#home-send-95")?.addEventListener("click", runQuickBridge95);
      body.querySelector("#home-bridge-95")?.addEventListener("click", runQuickBridge95);

      // Bridge button
      body.querySelector("#home-bridge")?.addEventListener("click", () => {
        if (bridgePhase === "complete" || bridgePhase === "error") {
          resetBridge();
          render();
          return;
        }
        void runCctpBridge();
      });

      // Resume badge-button
      body.querySelector("#home-resume")?.addEventListener("click", () => {
        void runResume();
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
      const recoverTxInput = body.querySelector<HTMLInputElement>("#home-recover-tx");
      recoverTxInput?.addEventListener("input", () => {
        recoveryTxHashInput = recoverTxInput.value;
      });
      recoverTxInput?.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          void runRecoveryByTxHash();
        }
      });
      body.querySelector("#home-recover-by-tx")?.addEventListener("click", () => {
        void runRecoveryByTxHash();
      });
      body.querySelector("#home-mint-all")?.addEventListener("click", () => {
        void runRecoveryMintAll();
      });
      body.querySelectorAll<HTMLButtonElement>("[data-recovery-idx]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.recoveryIdx);
          if (!Number.isNaN(idx)) void runRecoveryMint(idx);
        });
      });

      // Ensure prior timer gets cleared as view re-renders.
      if (attestTimerId !== null) { clearInterval(attestTimerId); attestTimerId = null; }

    }
  };

  function onProgress(p: CctpProgress): void {
    if (p.phase === "attesting" && attestStartTime === null) {
      attestStartTime = Date.now();
    } else if (p.phase !== "attesting") {
      attestStartTime = null;
    }
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
    bridgeMessage = "Starting CCTP transfer…";
    beginActivityGroup(rawAmount.toString(), wallet.getState().network);
    render();

    try {
      const conn = wallet.getState();
      if (!conn.connected) await wallet.connect();
      if (!wallet.getState().waapBaseAddress) await wallet.linkWaaPBaseAddress();

      const mod = await cctp();
      const result = await mod.executeCctpBridge({ amount: rawAmount }, onProgress);
      bridgeDigest = result.digest;
      bridgePhase = "complete";
      bridgeMessage = "Transfer complete. Native USDC minted on Sui.";
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
      bridgeMessage = "Transfer failed.";
      updateActiveGroup((group) => {
        group.status = "error";
        group.phase = "error";
        group.error = message;
        group.message = bridgeMessage;
      });
      console.error("[home] CCTP transfer failed", err);
    } finally {
      bridgeInFlight = false;
    }

    if (mounted) render();
  }

  async function runResume(): Promise<void> {
    if (bridgeInFlight) return;
    bridgeInFlight = true;
    const mod = await cctp();
    const pending = mod.loadPendingBridge();
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
    attestStartTime = Date.now();
    bridgePhase = "attesting";
    bridgeMessage = "Resuming attestation polling…";
    render();

    try {
      const result = await mod.resumePendingBridge(onProgress);
      bridgeDigest = result.digest;
      bridgePhase = "complete";
      bridgeMessage = "Transfer complete (resumed). Native USDC minted on Sui.";
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
      const mod = await cctp();
      await mod.topUpBaseGasFromUsdc((message) => {
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
      const mod = await cctp();
      recoveredBurns = await mod.scanPastBurns((msg) => {
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

  async function runRecoveryByTxHash(): Promise<void> {
    if (recoveryScanBusy || recoveryMintingIndex !== null) return;

    const input = recoveryTxHashInput.trim();
    if (!input) {
      recoveryScanError = "Enter a Base tx hash or Basescan URL.";
      if (mounted) render();
      return;
    }

    recoveryScanBusy = true;
    recoveryScanError = null;
    recoveryScanMessage = "Loading burn transaction…";
    recoveryMintError = null;
    recoveryMintMessage = "";
    render();

    try {
      const mod = await cctp();
      const burn = await mod.recoverBurnByTxHash(input, (msg) => {
        recoveryScanMessage = msg;
        if (mounted) render();
      });

      const existingIndex = recoveredBurns.findIndex(
        (item) => item.burnTxHash.toLowerCase() === burn.burnTxHash.toLowerCase(),
      );
      if (existingIndex >= 0) {
        recoveredBurns[existingIndex] = burn;
      } else {
        recoveredBurns.unshift(burn);
      }
      recoveryTxHashInput = burn.burnTxHash;

      if (burn.attestationStatus === "complete") {
        recoveryScanMessage = `Loaded ${shortHash(burn.burnTxHash)}. Attestation is complete and ready to mint.`;
      } else if (burn.attestationStatus === "minted") {
        recoveryScanMessage = `Loaded ${shortHash(burn.burnTxHash)}. This burn is already minted on Sui.`;
      } else if (burn.attestationStatus === "pending") {
        recoveryScanMessage = `Loaded ${shortHash(burn.burnTxHash)}. Circle attestation is still pending.`;
      } else {
        recoveryScanMessage = `Loaded ${shortHash(burn.burnTxHash)}.`;
      }
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
      const mod = await cctp();
      const result = await mod.mintRecoveredBurn(burn, (p) => {
        recoveryMintMessage = p.message;
        if (mounted) render();
      });
      burn.attestationStatus = "minted";
      burn.mintDigest = result.digest;
      recoveryMintMessage = `Mint complete.`;
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

  async function runRecoveryMintAll(): Promise<void> {
    const mintable = recoveredBurns
      .map((b, i) => ({ burn: b, idx: i }))
      .filter((e) => e.burn.attestationStatus === "complete");
    if (mintable.length === 0) return;

    const mod = await cctp();
    let minted = 0;
    let failed = 0;
    for (const { burn, idx } of mintable) {
      recoveryMintingIndex = idx;
      recoveryMintMessage = `Minting ${minted + 1} of ${mintable.length}…`;
      recoveryMintError = null;
      render();

      try {
        const result = await mod.mintRecoveredBurn(burn, (p) => {
          recoveryMintMessage = `Minting ${minted + 1} of ${mintable.length}: ${p.message}`;
          if (mounted) render();
        });
        burn.attestationStatus = "minted";
        burn.mintDigest = result.digest;
        minted++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("nonce") || message.includes("already")) {
          burn.attestationStatus = "minted";
          minted++;
        } else {
          failed++;
          recoveryMintError = `Burn ${burn.nonce.toString()}: ${message}`;
          break;
        }
      }
    }

    recoveryMintingIndex = null;
    recoveryMintMessage = failed > 0
      ? `Minted ${minted} of ${mintable.length} (${failed} failed).`
      : `All ${minted} burns minted successfully.`;
    await wallet.refreshBalance();
    if (mounted) render();
  }

  function resetBridge(): void {
    bridgePhase = "idle";
    bridgeMessage = "";
    bridgeDigest = null;
    bridgeError = null;
    attestationAttempts = 0;
    attestStartTime = null;
    if (attestTimerId !== null) { clearInterval(attestTimerId); attestTimerId = null; }
  }

  const unsub = wallet.subscribe(() => {
    if (bridgePhase === "idle" || bridgePhase === "complete" || bridgePhase === "error") {
      render();
    }
  });
  cleanup(container, () => {
    mounted = false;
    unsub();
    if (attestTimerId !== null) { clearInterval(attestTimerId); attestTimerId = null; }
  });

}

// ── Step stepper logic ───────────────────────────────────────────────────

function truncAddr(addr: string): string {
  if (addr.length <= 18) return addr;
  return `${addr.slice(0, 9)}…${addr.slice(-7)}`;
}

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
  const normalized = trimmed.replace(/\$/g, "").replace(/,/g, "");
  if (!/^(\d+(\.\d{0,6})?|\.\d{1,6})$/.test(normalized)) return null;
  const canonical = normalized.startsWith(".") ? `0${normalized}` : normalized;
  const [whole, frac = ""] = canonical.split(".");
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

function formatUsdFromUsdcRaw(raw: bigint): string {
  const roundedCents = (raw + 5_000n) / 10_000n;
  const whole = roundedCents / 100n;
  const cents = roundedCents % 100n;
  return `$${whole.toString()}.${cents.toString().padStart(2, "0")}`;
}

function formatRecoveryUsdc(raw: bigint): string {
  const decimal = formatUsdcDecimal(raw);
  return `${decimal} USDC`;
}

function ratioPercent(part: bigint, total: bigint): number {
  if (part <= 0n || total <= 0n) return 0;
  const clampedPart = part > total ? total : part;
  const basisPoints = (clampedPart * 10_000n) / total;
  return Number(basisPoints) / 100;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
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

function renderActivityGroup(group: BridgeActivityGroup, _currentNetwork?: string): string {
  const statusClass = group.status === "complete"
    ? "badge-green"
    : group.status === "error"
      ? "badge-red"
      : "badge-yellow";
  const amount = safeFormatAmount(group.amountRaw);
  const net = group.network;

  const stepLinks = STEP_IDS.map((stepId, index) => {
    const label = STEP_NAMES[index];
    const tx = group.steps[stepId];
    if (tx) {
      return `<a class="cctp-activity-link" href="${escapeAttr(getExplorerTxUrl(tx.chain, tx.hash, net))}" target="_blank" rel="noopener">${escapeHtml(label)} ↗</a>`;
    }
    return `<span class="cctp-activity-step-pending">${escapeHtml(label)}</span>`;
  }).join("");

  return `
    <div class="cctp-activity-item">
      <div class="cctp-activity-head">
        <div class="cctp-activity-title">${escapeHtml(amount)} USDC</div>
        ${group.status === "complete" && group.digest
          ? `<a class="badge ${statusClass}" href="${escapeAttr(getExplorerTxUrl("sui", group.digest, net))}" target="_blank" rel="noopener">${escapeHtml(group.status)} ↗</a>`
          : `<span class="badge ${statusClass}">${escapeHtml(group.status)}</span>`}
      </div>
      <div class="cctp-activity-meta code-text">${escapeHtml(formatTimestamp(group.startedAt))}</div>
      <div class="cctp-activity-step-links">${stepLinks}</div>
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
