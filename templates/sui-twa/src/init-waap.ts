/**
 * init-waap.ts — Registers WaaP with Wallet Standard before dApp Kit loads.
 *
 * Must be imported first (e.g. in main.ts) so WaaP appears in the connect modal.
 */

export const waapReady = (async () => {
  try {
    const { initWaaPSui } = await import("@human.tech/waap-sdk");
    const { registerWallet } = await import("@mysten/wallet-standard");

    const w = initWaaPSui({
      config: {
        authenticationMethods: ["email", "phone", "social"],
        allowedSocials: ["google", "twitter", "discord"],
        styles: { darkMode: true },
      },
      useStaging: false,
    });

    registerWallet(w as unknown as Parameters<typeof registerWallet>[0]);
  } catch (err) {
    console.warn("[init-waap] WaaP SDK not available:", err);
  }
})();
