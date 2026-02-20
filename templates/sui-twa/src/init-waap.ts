/**
 * init-waap.ts — Registers WaaP with Wallet Standard before dApp Kit loads.
 *
 * Must be imported first (e.g. in main.ts) so WaaP appears in the connect modal.
 */

export interface WaapInitStatus {
  ready: boolean;
  reason: string | null;
  blockedLikely: boolean;
}

const WAAP_IFRAME_URL = "https://waap.xyz/iframe";
const WAAP_PRECHECK_TIMEOUT_MS = 4500;

const waapInitStatus: WaapInitStatus = {
  ready: false,
  reason: null,
  blockedLikely: false,
};

export function getWaapInitStatus(): WaapInitStatus {
  return waapInitStatus;
}

async function canReachWaapIframe(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), WAAP_PRECHECK_TIMEOUT_MS);
  try {
    await fetch(WAAP_IFRAME_URL, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      signal: ctrl.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export const waapReady = (async () => {
  try {
    const reachable = await canReachWaapIframe();
    if (!reachable) {
      waapInitStatus.ready = false;
      waapInitStatus.blockedLikely = true;
      waapInitStatus.reason = "WaaP iframe is unreachable (likely blocked by an ad/privacy extension or browser shield).";
      console.warn("[init-waap]", waapInitStatus.reason);
      return;
    }

    const { initWaaP, initWaaPSui } = await import("@human.tech/waap-sdk");
    const { registerWallet } = await import("@mysten/wallet-standard");

    // Boot EVM provider so window.waap is available for Base address linking.
    initWaaP({
      config: {
        authenticationMethods: ["email", "phone", "social"],
        allowedSocials: ["google", "twitter", "discord"],
        styles: { darkMode: true },
      },
      useStaging: false,
    });

    const w = initWaaPSui({
      config: {
        authenticationMethods: ["email", "phone", "social"],
        allowedSocials: ["google", "twitter", "discord"],
        styles: { darkMode: true },
      },
      useStaging: false,
    });

    registerWallet(w as unknown as Parameters<typeof registerWallet>[0]);
    waapInitStatus.ready = true;
    waapInitStatus.reason = null;
    waapInitStatus.blockedLikely = false;
  } catch (err) {
    waapInitStatus.ready = false;
    waapInitStatus.reason = "WaaP SDK failed to initialize.";
    waapInitStatus.blockedLikely = false;
    console.warn("[init-waap] WaaP SDK not available:", err);
  }
})();
