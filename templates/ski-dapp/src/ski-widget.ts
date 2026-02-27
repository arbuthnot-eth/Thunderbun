/**
 * ski-widget.ts — mounts the sui.ski wallet widget.
 *
 * sui.ski auto-initializes on import: discovers Wallet Standard wallets,
 * renders the .SKI pill + Key-In modal, and establishes a signed session.
 *
 * Bridge: ski:wallet-connected → tb:ski-wallet-connected so wallet.ts
 * syncs Sui connection state for transaction signing.
 */

export async function mountSkiWalletWidget(): Promise<boolean> {
  if (!document.getElementById("wallet-widget")) return false;

  try {
    await import("sui.ski");

    window.addEventListener("ski:wallet-connected", () => {
      window.dispatchEvent(new CustomEvent("tb:ski-wallet-connected"));
    });
    window.addEventListener("ski:wallet-disconnected", () => {
      window.dispatchEvent(new CustomEvent("tb:ski-wallet-disconnected"));
    });

    return true;
  } catch (error) {
    console.warn("[ski-widget] failed to mount sui.ski:", error);
    return false;
  }
}
