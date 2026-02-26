/**
 * ski-widget.ts — mounts the sui.ski v2 wallet widget.
 *
 * sui.ski auto-initializes on import: discovers Wallet Standard wallets,
 * renders the .SKI button + modal, and establishes a signed .SKI session
 * (device fingerprint + personal message) stored in localStorage.
 *
 * Bridge: ski:wallet-connected → tb:ski-wallet-connected so the existing
 * wallet.ts (dApp Kit + WaaP) syncs its state for transaction signing.
 */

export async function mountSkiWalletWidget(): Promise<boolean> {
  if (!document.getElementById("wallet-widget")) return false;

  try {
    // sui.ski auto-inits: reads DOM elements, renders widget, starts auto-reconnect
    await import("sui.ski");

    // Bridge to tb: event system so wallet.ts bridges the Wallet Standard
    // connection into dApp Kit (bridgeSkiWidgetConnection polls until it appears)
    window.addEventListener("ski:wallet-connected", () => {
      window.dispatchEvent(new CustomEvent("tb:ski-wallet-connected"));
    });
    window.addEventListener("ski:wallet-disconnected", () => {
      window.dispatchEvent(new CustomEvent("tb:ski-wallet-disconnected"));
    });

    // Wire the fallback ".SKI" button (shown before ski.ski hydrates) to
    // open the ski.ski modal directly
    document.getElementById("wallet-widget-connect")?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("ski:open-modal"));
    });

    document.body.classList.add("ski-widget-native");
    return true;
  } catch (error) {
    console.warn("[ski-widget] failed to mount sui.ski:", error);
    return false;
  }
}
