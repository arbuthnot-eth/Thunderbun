import { wallet } from "../wallet";
import { getSectionSource, getInfraSource } from "../source-files";
import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";
import {
  depositStatusLabel,
  formatUsdcFromRaw,
  getIkaDepositConfig,
  getIkaDepositStatus,
  registerIkaDepositProfile,
  shortHash,
  syncIkaDeposit,
  type IkaDepositConfigResponse,
  type IkaDepositSnapshot,
  type IkaProfileSnapshot,
} from "../lib/ika-deposit";

type BusyAction = "setup" | "sync" | "force-sync" | null;

export function renderIka(container: HTMLElement): void {
  let config: IkaDepositConfigResponse | null = null;
  let profile: IkaProfileSnapshot | null = null;
  let deposits: IkaDepositSnapshot[] = [];
  let errorMessage: string | null = null;
  let busy: BusyAction = null;
  let loading = true;
  let policyMaxUsdc = "5000";
  let policySessionMinutes = "0";
  let autoSyncTimer: number | null = null;

  function getWalletContext() {
    const state = wallet.getState();
    return {
      connected: state.connected && Boolean(state.address),
      network: state.network,
      suiAddress: state.address,
    };
  }

  function canUseFlow(): boolean {
    const ctx = getWalletContext();
    return ctx.network === "mainnet" || ctx.network === "testnet";
  }

  function hasPendingDeposits(): boolean {
    return deposits.some((d) => d.status === "detected" || d.status === "burn_submitted" || d.status === "attesting" || d.status === "attested");
  }

  function baseExplorerBase(): string {
    return config?.network === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";
  }

  function baseTxUrl(hash: string | null): string | null {
    if (!hash) return null;
    return `${baseExplorerBase()}/tx/${hash}`;
  }

  function suiTxUrl(digest: string | null): string | null {
    if (!digest) return null;
    const network = getWalletContext().network;
    if (network === "mainnet") {
      return `https://suivision.xyz/txblock/${digest}`;
    }
    return `https://testnet.suivision.xyz/txblock/${digest}`;
  }

  function parseUsdcInputToRaw(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (!/^\d+(\.\d{0,6})?$/.test(trimmed)) return null;
    const [wholeRaw, fracRaw = ""] = trimmed.split(".");
    const whole = BigInt(wholeRaw || "0");
    const frac = BigInt((fracRaw + "000000").slice(0, 6) || "0");
    return (whole * 1_000_000n + frac).toString();
  }

  function statusBadgeClass(status: IkaDepositSnapshot["status"]): string {
    if (status === "minted") return "badge-green";
    if (status === "failed" || status === "policy_blocked") return "badge-red";
    if (status === "attested") return "badge-blue";
    return "badge-yellow";
  }

  function render(): void {
    const ctx = getWalletContext();
    const configured = Boolean(config?.configured);
    const flowReady = configured && canUseFlow();

    const setupBtnLabel = busy === "setup"
      ? "Saving Policy..."
      : profile
        ? "Update Policy"
        : "Enable Policy + Get Deposit Address";

    const syncBtnLabel = busy === "sync"
      ? "Syncing..."
      : "Sync Deposits";

    const forceSyncBtnLabel = busy === "force-sync"
      ? "Retrying..."
      : "Force Retry Failed";

    const setupDisabled =
      !ctx.connected || !flowReady || busy !== null;

    const syncDisabled =
      !ctx.connected || !flowReady || !profile || busy !== null;

    const policySummary = profile
      ? `${formatUsdcFromRaw(profile.policy.maxBurnRaw)} USDC max / transfer${profile.policy.expiresAtMs ? ` · session expires ${new Date(profile.policy.expiresAtMs).toLocaleString()}` : " · no session expiry"}`
      : "No policy registered yet.";

    const pipelineSummary = !profile
      ? "Set up policy to start monitoring your Base deposit address."
      : hasPendingDeposits()
        ? "Pending transfers detected. Auto-sync is active while this page stays open."
        : "No pending transfers. Send USDC to your deposit address to trigger burn + attestation + mint.";

    const depositsHtml = deposits.length === 0
      ? '<div class="status-hint" style="font-size:12px">No deposits detected yet.</div>'
      : `<div style="display:grid;gap:8px">${deposits.map((deposit) => {
        const burnUrl = baseTxUrl(deposit.burnTxHash);
        const depositUrl = baseTxUrl(deposit.txHash);
        const mintUrl = suiTxUrl(deposit.mintDigest);

        return `
          <div style="background:var(--bg);border-radius:var(--r-sm);padding:10px 12px;display:grid;gap:8px">
            <div class="spread-row">
              <div style="display:flex;gap:8px;align-items:center">
                <span class="badge ${statusBadgeClass(deposit.status)}">${escapeHtml(depositStatusLabel(deposit.status))}</span>
                <span class="code-text" style="font-size:12px">${escapeHtml(formatUsdcFromRaw(deposit.amountRaw))} USDC</span>
              </div>
              <span class="code-text" style="font-size:11px">${new Date(deposit.createdAtMs).toLocaleString()}</span>
            </div>
            <div class="code-text" style="font-size:11px;display:grid;gap:4px">
              <div>Deposit: ${depositUrl ? `<a href="${escapeAttr(depositUrl)}" target="_blank" rel="noopener">${escapeHtml(shortHash(deposit.txHash))} ↗</a>` : escapeHtml(shortHash(deposit.txHash))}</div>
              <div>Burn: ${burnUrl ? `<a href="${escapeAttr(burnUrl)}" target="_blank" rel="noopener">${escapeHtml(shortHash(deposit.burnTxHash))} ↗</a>` : "-"}</div>
              <div>Mint: ${mintUrl ? `<a href="${escapeAttr(mintUrl)}" target="_blank" rel="noopener">${escapeHtml(shortHash(deposit.mintDigest))} ↗</a>` : "-"}</div>
              <div>Attestation: ${escapeHtml(deposit.attestationStatus ?? "pending")}${deposit.attestationDelayReason ? ` (${escapeHtml(deposit.attestationDelayReason.replace(/_/g, " "))})` : ""}</div>
              ${deposit.failureReason ? `<div style="color:var(--red)">Error: ${escapeHtml(deposit.failureReason)}</div>` : ""}
            </div>
          </div>
        `;
      }).join("")}</div>`;

    container.innerHTML = `
      <div class="section">
        <div class="section-top">
          <div>
            <h1 class="section-title">Ika Invisible Deposit</h1>
            <p class="section-desc">User sends native Base USDC once. Worker policy handles burn, attestation, and Sui native USDC mint.</p>
          </div>
          <div class="inline-group--tight">
            <span class="badge ${configured ? "badge-green" : "badge-red"}">${configured ? "Worker Ready" : "Worker Not Configured"}</span>
            <a href="https://docs.ika.xyz" target="_blank" rel="noopener" class="btn btn-secondary btn--compact">Docs ↗</a>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Flow</div>
          <div class="seal-steps">
            <div class="seal-step">
              <div class="seal-step-num">1</div>
              <div class="seal-step-body">
                <div class="seal-step-title">Policy setup</div>
                <div class="seal-step-desc">Register your Sui address and burn policy once.</div>
              </div>
            </div>
            <div class="seal-step">
              <div class="seal-step-num">2</div>
              <div class="seal-step-body">
                <div class="seal-step-title">User transfer</div>
                <div class="seal-step-desc">Send native Base USDC to your personal deposit address.</div>
              </div>
            </div>
            <div class="seal-step">
              <div class="seal-step-num">3</div>
              <div class="seal-step-body">
                <div class="seal-step-title">Server settlement</div>
                <div class="seal-step-desc">Burn + Circle attestation + sponsored Sui mint happen automatically.</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="spread-row" style="margin-bottom:14px">
            <div class="card-title" style="margin:0">Setup</div>
            <span class="badge ${ctx.connected ? "badge-green" : "badge-yellow"}">${ctx.connected ? "Wallet Connected" : "Connect Wallet"}</span>
          </div>
          <div class="status-hint" style="font-size:12px;margin-bottom:8px">Sui address: <span class="code-text">${ctx.suiAddress ? escapeHtml(shortHash(ctx.suiAddress, 12, 8)) : "-"}</span></div>
          <div class="input-group">
            <label class="input-label">Max burn per transfer (USDC)</label>
            <input id="ika-policy-max" class="input-field" type="text" inputmode="decimal" value="${escapeAttr(policyMaxUsdc)}" ${busy ? "disabled" : ""} />
          </div>
          <div class="input-group">
            <label class="input-label">Session expiry (minutes, 0 = permanent)</label>
            <input id="ika-policy-session" class="input-field" type="number" min="0" step="1" value="${escapeAttr(policySessionMinutes)}" ${busy ? "disabled" : ""} />
          </div>
          <div class="card-description" style="margin-bottom:10px">${escapeHtml(policySummary)}</div>
          <div class="inline-group" style="gap:8px">
            <button id="ika-connect" class="btn btn-secondary btn--compact" ${ctx.connected ? "disabled" : ""}>Connect</button>
            <button id="ika-setup" class="btn btn-primary btn--compact" ${setupDisabled ? "disabled" : ""}>${setupBtnLabel}</button>
          </div>
        </div>

        <div class="card">
          <div class="spread-row" style="margin-bottom:14px">
            <div class="card-title" style="margin:0">Deposit Address</div>
            <span class="badge ${profile ? "badge-green" : "badge-yellow"}">${profile ? "Active" : "Not Set"}</span>
          </div>
          <div class="code-text" style="font-size:12px;word-break:break-all;background:var(--bg);padding:10px;border-radius:var(--r-sm);margin-bottom:10px">${profile ? escapeHtml(profile.depositAddress) : "-"}</div>
          <div class="inline-group" style="gap:8px;margin-bottom:10px">
            <button id="ika-copy-address" class="btn btn-secondary btn--compact" ${!profile ? "disabled" : ""}>Copy Address</button>
            <button id="ika-sync" class="btn btn-secondary btn--compact" ${syncDisabled ? "disabled" : ""}>${syncBtnLabel}</button>
            <button id="ika-force-sync" class="btn btn-secondary btn--compact" ${syncDisabled ? "disabled" : ""}>${forceSyncBtnLabel}</button>
          </div>
          <div class="status-hint" style="font-size:12px">${escapeHtml(pipelineSummary)}</div>
        </div>

        <div class="card">
          <div class="card-title">Deposits</div>
          ${depositsHtml}
        </div>

        <div class="card">
          <div class="card-title">Runtime Config</div>
          <div class="stat-grid">
            <div class="stat-box"><div class="stat-label">Base Network</div><div class="stat-value">${escapeHtml(config?.network ?? "-")}</div></div>
            <div class="stat-box"><div class="stat-label">Base USDC</div><div class="stat-value code-text" style="font-size:11px">${escapeHtml(shortHash(config?.cctp.baseUsdc ?? "-", 10, 8))}</div></div>
            <div class="stat-box"><div class="stat-label">Token Messenger</div><div class="stat-value code-text" style="font-size:11px">${escapeHtml(shortHash(config?.cctp.tokenMessenger ?? "-", 10, 8))}</div></div>
            <div class="stat-box"><div class="stat-label">Auto Settle</div><div class="stat-value">${config?.policyDefaults.autoSettle ? "On" : "Off"}</div></div>
          </div>
        </div>

        ${errorMessage ? `<div class="error-msg visible">${escapeHtml(errorMessage)}</div>` : ""}
      </div>
    `;

    const src = getSectionSource("ika");
    if (src) {
      const cfg = {
        id: "ika-src",
        label: "ika.ts",
        source: src,
        secondaryLabel: "lib/ika-deposit.ts",
        secondarySource: getInfraSource("lib/ika-deposit.ts") ?? undefined,
      };
      container.querySelector(".section")?.insertAdjacentHTML("beforeend", codeViewerHTML(cfg));
      attachCodeViewer(container, cfg);
    }

    container.querySelector("#ika-connect")?.addEventListener("click", () => {
      wallet.openConnectModal();
    });

    container.querySelector<HTMLInputElement>("#ika-policy-max")?.addEventListener("input", (event) => {
      policyMaxUsdc = (event.currentTarget as HTMLInputElement).value;
    });

    container.querySelector<HTMLInputElement>("#ika-policy-session")?.addEventListener("input", (event) => {
      policySessionMinutes = (event.currentTarget as HTMLInputElement).value;
    });

    container.querySelector("#ika-setup")?.addEventListener("click", () => {
      void handleSetup();
    });

    container.querySelector("#ika-sync")?.addEventListener("click", () => {
      void handleSync(false);
    });

    container.querySelector("#ika-force-sync")?.addEventListener("click", () => {
      void handleSync(true);
    });

    container.querySelector("#ika-copy-address")?.addEventListener("click", async () => {
      if (!profile?.depositAddress) return;
      try {
        await navigator.clipboard.writeText(profile.depositAddress);
      } catch {
        errorMessage = "Could not copy address.";
        render();
      }
    });
  }

  async function loadConfig(): Promise<void> {
    try {
      config = await getIkaDepositConfig();
      errorMessage = null;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async function loadStatus(): Promise<void> {
    const ctx = getWalletContext();
    if (!ctx.suiAddress || !ctx.connected) {
      profile = null;
      deposits = [];
      updateAutoSync();
      return;
    }

    try {
      const status = await getIkaDepositStatus(ctx.suiAddress);
      profile = status.profile;
      deposits = status.deposits;
      errorMessage = null;
      updateAutoSync();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleSetup(): Promise<void> {
    const ctx = getWalletContext();
    if (!ctx.suiAddress || !ctx.connected) {
      errorMessage = "Connect your Sui wallet first.";
      render();
      return;
    }

    const maxBurnRaw = parseUsdcInputToRaw(policyMaxUsdc);
    if (!maxBurnRaw) {
      errorMessage = "Max burn amount must be a valid USDC value.";
      render();
      return;
    }

    let sessionMs: number | null = null;
    if (policySessionMinutes.trim()) {
      const minutes = Number(policySessionMinutes);
      if (!Number.isFinite(minutes) || minutes < 0) {
        errorMessage = "Session expiry must be 0 or a positive integer.";
        render();
        return;
      }
      sessionMs = minutes > 0 ? Math.floor(minutes * 60_000) : null;
    }

    busy = "setup";
    errorMessage = null;
    render();

    try {
      const res = await registerIkaDepositProfile({
        suiAddress: ctx.suiAddress,
        maxBurnRaw,
        sessionMs,
      });
      profile = res.profile;
      await handleSync(false);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      busy = null;
      render();
    }
  }

  async function handleSync(force: boolean): Promise<void> {
    const ctx = getWalletContext();
    if (!ctx.suiAddress || !ctx.connected) return;

    busy = force ? "force-sync" : "sync";
    errorMessage = null;
    render();

    try {
      const res = await syncIkaDeposit({
        suiAddress: ctx.suiAddress,
        force,
        maxProcess: force ? 8 : 4,
      });
      profile = res.profile;
      deposits = res.deposits;
      busy = null;
      updateAutoSync();
      render();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      busy = null;
      render();
    }
  }

  function updateAutoSync(): void {
    if (autoSyncTimer !== null) {
      window.clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }

    const ctx = getWalletContext();
    if (!ctx.connected || !ctx.suiAddress || !profile || !hasPendingDeposits()) {
      return;
    }

    autoSyncTimer = window.setInterval(() => {
      if (busy !== null) return;
      void handleSync(false);
    }, 10_000);
  }

  function cleanup(): void {
    if (autoSyncTimer !== null) {
      window.clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
    window.clearInterval(lifecycleTimer);
    unsubscribeWallet();
  }

  const unsubscribeWallet = wallet.subscribe(() => {
    if (!document.body.contains(container)) return;
    void loadStatus().then(() => render());
  });

  const lifecycleTimer = window.setInterval(() => {
    if (!document.body.contains(container)) {
      cleanup();
    }
  }, 1_000);

  void (async () => {
    loading = true;
    await loadConfig();
    await loadStatus();
    loading = false;
    render();
  })();

  if (loading) render();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
