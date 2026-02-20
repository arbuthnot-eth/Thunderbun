import {
  executeCctpBridge,
  getBaseSponsorStatus,
  getCctpMinBaseGasWei,
  requestBaseGasSponsor,
  resumePendingBridge,
  loadPendingBridge,
  clearPendingBridge,
  topUpBaseGasFromUsdc,
  type CctpPhase,
  type CctpProgress,
} from "../lib/cctp";
import { wallet } from "../wallet";

type BridgePhase = CctpPhase;

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
      const parsedAmount = parseUsdcInput(bridgeAmount);
      const isDefaultDollar = parsedAmount === 1_000_000n;
      const minBaseGasWei = getCctpMinBaseGasWei();
      const baseGasLow = s.waapBaseAddress !== null
        && s.waapBaseBalance !== null
        && s.waapBaseBalance < minBaseGasWei;

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
                    ${isBusy ? "disabled" : ""} />
                  <button class="btn btn-secondary btn--compact" id="home-max" ${isBusy || !maxUsdc ? "disabled" : ""}>Max</button>
                </div>
              </div>
            </div>

            <div class="cctp-stepper">
              ${STEP_NAMES.map((name, i) => {
                const stepClass = getStepClass(bridgePhase, i);
                return `<div class="cctp-step ${stepClass}"><span class="cctp-step-num">${i + 1}</span><span>${name}</span></div>`;
              }).join("")}
            </div>

            ${bridgeMessage ? `<div class="cctp-status code-text">${escapeHtml(bridgeMessage)}${attestationAttempts > 0 ? ` (attempt ${attestationAttempts})` : ""}${bridgeDigest ? ` · <span class="cctp-digest">${shortDigest(bridgeDigest)}</span>` : ""}</div>` : ""}
            ${bridgeError ? `<div class="cctp-error">${escapeHtml(bridgeError)}</div>` : ""}

            <div class="home-minimal-actions">
              <button class="btn btn-primary" id="home-bridge" ${isBusy || !s.waapBaseAddress ? "disabled" : ""}>${
                isBusy ? "Processing…"
                : bridgePhase === "complete" ? "Bridge Again"
                : bridgePhase === "error" ? "Retry Bridge"
                : isDefaultDollar ? "Send $1 to Sui" : "Bridge to Sui"
              }</button>
            </div>
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
        if (bridgePhase === "complete" || bridgePhase === "error") {
          resetBridge();
          render();
          return;
        }
        void runCctpBridge();
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
    if (mounted) render();
  }

  async function runCctpBridge(): Promise<void> {
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

    bridgeError = null;
    bridgeDigest = null;
    attestationAttempts = 0;
    bridgePhase = "approving";
    bridgeMessage = "Starting CCTP bridge…";
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

      await wallet.refreshBalance();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bridgePhase = "error";
      bridgeError = message;
      bridgeMessage = "Bridge failed.";
      console.error("[home] CCTP bridge failed", err);
    }

    if (mounted) render();
  }

  async function runResume(): Promise<void> {
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

      await wallet.refreshBalance();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bridgePhase = "error";
      bridgeError = message;
      bridgeMessage = "Resume failed.";
      console.error("[home] CCTP resume failed", err);
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
