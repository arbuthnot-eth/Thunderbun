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
const WAAP_BOOT_TIMEOUT_MS = 7000;

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

export const waapReady = (async () => {
  try {
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
