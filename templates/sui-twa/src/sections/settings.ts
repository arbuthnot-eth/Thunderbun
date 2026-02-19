import { wallet, type Network } from "../wallet";

export function renderSettings(container: HTMLElement) {
  const state = wallet.getState();

  container.innerHTML = `
    <div class="p-6 max-w-2xl mx-auto">
      <div class="mb-6 mt-4">
        <h1 class="section-header">Settings ⚙️</h1>
        <p class="section-desc">Configure your network, wallet, and app preferences.</p>
      </div>

      <div class="card mb-4">
        <p class="text-sm font-semibold text-white mb-4">Network</p>
        <div class="space-y-2" id="network-options">
          ${(["mainnet", "testnet", "devnet"] as Network[]).map((n) => `
            <label class="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-sui-dark transition-colors ${state.network === n ? "bg-sui-dark" : ""}">
              <input type="radio" name="network" value="${n}" class="sr-only" ${state.network === n ? "checked" : ""} />
              <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center ${state.network === n ? "border-sui-blue" : "border-sui-border"}">
                ${state.network === n ? '<div class="w-2 h-2 rounded-full bg-sui-blue"></div>' : ""}
              </div>
              <div>
                <p class="text-sm font-medium text-white capitalize">${n}</p>
                <p class="text-xs text-sui-muted">${
                  n === "mainnet" ? "https://fullnode.mainnet.sui.io" :
                  n === "testnet" ? "https://fullnode.testnet.sui.io" :
                  "https://fullnode.devnet.sui.io"
                }</p>
              </div>
              ${state.network === n ? '<span class="ml-auto badge badge-blue">Active</span>' : ""}
            </label>
          `).join("")}
        </div>
      </div>

      <div class="card mb-4">
        <p class="text-sm font-semibold text-white mb-4">Wallet</p>
        ${state.connected && state.address ? `
          <div class="p-3 bg-sui-dark rounded-lg mb-3">
            <p class="text-xs text-sui-muted mb-1">Connected address</p>
            <p class="text-sm font-mono text-white break-all">${state.address}</p>
          </div>
          <div class="flex gap-2">
            <button id="copy-address-btn" class="btn-secondary text-xs flex-1">Copy address</button>
            <button id="disconnect-btn" class="btn-secondary text-xs flex-1 text-sui-error border-sui-error hover:border-sui-error">Disconnect</button>
          </div>
        ` : `
          <p class="text-sm text-sui-muted mb-3">No wallet connected.</p>
          <button id="connect-btn" class="btn-primary">Connect Wallet</button>
        `}
      </div>

      <div class="card mb-4">
        <p class="text-sm font-semibold text-white mb-4">About</p>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-sui-muted">Built with</span>
            <a href="https://github.com/arbuthnot-eth/thunderbun" target="_blank" class="text-sui-accent hover:underline">ThunderBun ↗</a>
          </div>
          <div class="flex justify-between">
            <span class="text-sui-muted">Wallet</span>
            <a href="https://docs.waap.xyz" target="_blank" class="text-sui-accent hover:underline">WaaP ↗</a>
          </div>
          <div class="flex justify-between">
            <span class="text-sui-muted">Chain</span>
            <a href="https://sui.io" target="_blank" class="text-sui-accent hover:underline">Sui ↗</a>
          </div>
        </div>
      </div>

      <div class="mt-4 card border-dashed">
        <p class="text-xs text-sui-muted mb-3 font-medium">Developer tools</p>
        <div class="flex flex-wrap gap-2">
          <a href="https://suiexplorer.com" target="_blank" rel="noopener" class="badge badge-blue">Sui Explorer ↗</a>
          <a href="https://suivision.xyz" target="_blank" rel="noopener" class="badge badge-blue">SuiVision ↗</a>
          <a href="https://docs.sui.io" target="_blank" rel="noopener" class="badge badge-blue">Sui Docs ↗</a>
        </div>
      </div>
    </div>
  `;

  // Network switching
  container.querySelectorAll('input[name="network"]').forEach((input) => {
    input.addEventListener("change", (e) => {
      const net = (e.target as HTMLInputElement).value as Network;
      wallet.setNetwork(net);
      // Re-render settings to update UI
      renderSettings(container);
    });
  });

  // Copy address
  container.querySelector("#copy-address-btn")?.addEventListener("click", () => {
    const addr = wallet.getState().address ?? "";
    navigator.clipboard.writeText(addr);
    const btn = container.querySelector<HTMLButtonElement>("#copy-address-btn")!;
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = orig), 1500);
  });

  // Disconnect
  container.querySelector("#disconnect-btn")?.addEventListener("click", async () => {
    await wallet.disconnect();
    renderSettings(container);
  });

  // Connect
  container.querySelector("#connect-btn")?.addEventListener("click", async () => {
    const btn = container.querySelector<HTMLButtonElement>("#connect-btn")!;
    btn.disabled = true;
    btn.textContent = "Connecting…";
    try {
      await wallet.connect();
      renderSettings(container);
    } catch {
      btn.disabled = false;
      btn.textContent = "Connect Wallet";
    }
  });
}
