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

type RegisterWalletFn = (wallet: unknown) => void;

declare global {
  interface Window {
    __tbWaapReadyPromise?: Promise<void>;
    __tbWaapSuiWallet?: unknown;
    __tbWaapSuiRegistered?: boolean;
    __tbWaapEvmInitialized?: boolean;
    __tbWaapInitCount?: number;
    __tbRegisterWalletFn?: RegisterWalletFn;
  }
}

const WAAP_IFRAME_URL = "https://waap.xyz/iframe";
const WAAP_BOOT_TIMEOUT_MS = 7000;
const WAAP_IFRAME_IDS = ["waap-wallet-iframe", "silk-wallet-iframe"] as const;

const waapInitStatus: WaapInitStatus = {
  ready: false,
  reason: null,
  blockedLikely: false,
};

export function getWaapInitStatus(): WaapInitStatus {
  return waapInitStatus;
}

function isIframeBlockedOrSameOrigin(iframe: HTMLIFrameElement): boolean {
  try {
    const href = iframe.contentWindow?.location?.href ?? "";
    return (
      href === "" ||
      href === "about:blank" ||
      href.startsWith("about:srcdoc") ||
      href.startsWith(window.location.origin)
    );
  } catch {
    // Cross-origin access throws when iframe loaded correctly.
    return false;
  }
}

function getWaapIframe(): HTMLIFrameElement | null {
  for (const id of WAAP_IFRAME_IDS) {
    const node = document.getElementById(id);
    if (node instanceof HTMLIFrameElement) return node;
  }
  return null;
}

async function waitForBody(): Promise<void> {
  if (document.body) return;
  await new Promise<void>((resolve) => {
    window.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
  });
}

async function canBootWaapIframe(): Promise<boolean> {
  await waitForBody();

  return await new Promise<boolean>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.src = WAAP_IFRAME_URL;
    iframe.style.display = "none";
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");

    let settled = false;

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      iframe.onload = null;
      iframe.onerror = null;
      iframe.remove();
      resolve(ok);
    };

    const timer = window.setTimeout(() => finish(false), WAAP_BOOT_TIMEOUT_MS);

    iframe.onload = () => {
      window.setTimeout(() => {
        finish(!isIframeBlockedOrSameOrigin(iframe));
      }, 120);
    };

    iframe.onerror = () => finish(false);

    document.body.appendChild(iframe);
  });
}

async function waitForWaapIframeReady(timeoutMs = WAAP_BOOT_TIMEOUT_MS): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const iframe = getWaapIframe();
    if (iframe && !isIframeBlockedOrSameOrigin(iframe)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return false;
}

function createWaapReadyPromise(): Promise<void> {
  return (async () => {
    window.__tbWaapInitCount = (window.__tbWaapInitCount ?? 0) + 1;
    if (window.__tbWaapInitCount > 1) {
      console.warn(`[init-waap] duplicate init attempt detected (#${window.__tbWaapInitCount}); reusing singleton.`);
    }

  try {
    if (window.__tbWaapSuiWallet && window.__tbWaapSuiRegistered && window.__tbWaapEvmInitialized) {
      waapInitStatus.ready = true;
      waapInitStatus.reason = null;
      waapInitStatus.blockedLikely = false;
      return;
    }

    const booted = await canBootWaapIframe();
    if (!booted) {
      waapInitStatus.ready = false;
      waapInitStatus.blockedLikely = true;
      waapInitStatus.reason = "WaaP iframe could not boot (likely blocked by an ad/privacy extension or browser shield).";
      console.warn("[init-waap]", waapInitStatus.reason);
      return;
    }

    const { initWaaP, initWaaPSui } = await import("@human.tech/waap-sdk");
    const { registerWallet } = await import("@mysten/wallet-standard");
    window.__tbRegisterWalletFn = registerWallet as RegisterWalletFn;

    // Initialize Sui wallet first. Avoid extra config here because the SDK
    // currently pings the iframe immediately when config/project is present.
    const w = window.__tbWaapSuiWallet ?? initWaaPSui({
      useStaging: false,
    });
    window.__tbWaapSuiWallet = w;

    // Ensure iframe is actually cross-origin-loaded before booting EVM provider.
    // This avoids transient "target origin mismatch" failures during early boot.
    const iframeReady = await waitForWaapIframeReady();
    if (!iframeReady) {
      waapInitStatus.ready = false;
      waapInitStatus.blockedLikely = true;
      waapInitStatus.reason = "WaaP iframe did not finish loading (likely blocked by browser privacy settings or an extension).";
      console.warn("[init-waap]", waapInitStatus.reason);
      return;
    }

    if (!window.__tbWaapSuiRegistered) {
      registerWallet(w as unknown as Parameters<typeof registerWallet>[0]);
      window.__tbWaapSuiRegistered = true;
    }

    // Boot EVM provider so window.waap is available for Base address linking.
    if (!window.__tbWaapEvmInitialized) {
      initWaaP({
        useStaging: false,
      });
      window.__tbWaapEvmInitialized = true;
    }

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
}

export const waapReady = (() => {
  if (!window.__tbWaapReadyPromise) {
    window.__tbWaapReadyPromise = createWaapReadyPromise();
  }
  return window.__tbWaapReadyPromise;
})();
