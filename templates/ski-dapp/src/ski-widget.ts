/**
 * ski-widget.ts — mounts the sui.ski wallet widget.
 *
 * Static import ensures ski.ski initializes synchronously with the module,
 * so ski:open-modal listeners are ready before any user interaction.
 *
 * Bridge: ski:wallet-connected → tb:ski-wallet-connected so wallet.ts
 * syncs Sui connection state for transaction signing.
 */
import "sui.ski";

export function mountSkiWalletWidget(): boolean {
  if (!document.getElementById("wallet-widget")) return false;

  window.addEventListener("ski:wallet-connected", () => {
    window.dispatchEvent(new CustomEvent("tb:ski-wallet-connected"));
  });
  window.addEventListener("ski:wallet-disconnected", () => {
    window.dispatchEvent(new CustomEvent("tb:ski-wallet-disconnected"));
  });

  return true;
}
