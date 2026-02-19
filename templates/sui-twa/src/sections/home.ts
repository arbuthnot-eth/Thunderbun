import { wallet } from "../wallet";

export function renderHome(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-6 max-w-2xl mx-auto">
      <div class="mb-8 mt-4">
        <h1 class="section-header">Welcome to Sui ⚡</h1>
        <p class="section-desc">Connect your wallet to start interacting with the Sui blockchain.</p>
      </div>

      <div id="connect-section">
        <!-- Rendered dynamically -->
      </div>

      <div class="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4" id="stats-grid">
        <!-- Filled after connect -->
      </div>
    </div>
  `;

  const connectSection = container.querySelector<HTMLElement>("#connect-section")!;
  const statsGrid = container.querySelector<HTMLElement>("#stats-grid")!;

  const render = () => {
    const state = wallet.getState();

    if (state.connected && state.address) {
      connectSection.innerHTML = `
        <div class="card">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-gradient-to-br from-sui-blue to-sui-accent flex items-center justify-center text-white font-bold">S</div>
              <div>
                <p class="text-white font-medium text-sm">${wallet.formatAddress()}</p>
                <p class="text-xs text-sui-muted">${state.network}</p>
              </div>
            </div>
            <button id="disconnect-btn" class="btn-secondary text-xs px-3 py-1.5">Disconnect</button>
          </div>
          <div class="flex items-center justify-between p-3 bg-sui-dark rounded-lg">
            <span class="text-sui-muted text-sm">Balance</span>
            <span class="text-white font-semibold font-mono">${wallet.formatBalance()}</span>
          </div>
        </div>
      `;

      statsGrid.innerHTML = `
        <div class="card hover:border-sui-accent transition-colors">
          <p class="text-xs text-sui-muted mb-1">Network</p>
          <p class="text-white font-semibold capitalize">${state.network}</p>
        </div>
        <div class="card hover:border-sui-accent transition-colors cursor-pointer" id="refresh-btn">
          <p class="text-xs text-sui-muted mb-1">SUI Balance</p>
          <p class="text-white font-semibold font-mono">${wallet.formatBalance()}</p>
          <p class="text-xs text-sui-muted mt-1">↻ click to refresh</p>
        </div>
      `;

      connectSection.querySelector("#disconnect-btn")?.addEventListener("click", async () => {
        await wallet.disconnect();
      });

      statsGrid.querySelector("#refresh-btn")?.addEventListener("click", async () => {
        await wallet.refreshBalance();
      });
    } else {
      connectSection.innerHTML = `
        <div class="card text-center py-10">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-sui-blue to-sui-accent mx-auto mb-4 flex items-center justify-center text-3xl">⚡</div>
          <h2 class="text-white font-semibold text-lg mb-2">Connect Wallet</h2>
          <p class="text-sui-muted text-sm mb-6 max-w-xs mx-auto">
            Connect with WaaP embedded wallet, Sui Wallet extension, or any Sui-compatible wallet.
          </p>
          <button id="connect-btn" class="btn-primary mx-auto">
            Connect Wallet
          </button>
          <p class="text-xs text-sui-muted mt-4">
            Powered by <a href="https://docs.waap.xyz" target="_blank" class="text-sui-accent hover:underline">WaaP</a>
          </p>
        </div>
      `;
      statsGrid.innerHTML = "";

      connectSection.querySelector("#connect-btn")?.addEventListener("click", async () => {
        const btn = connectSection.querySelector<HTMLButtonElement>("#connect-btn")!;
        btn.disabled = true;
        btn.textContent = "Connecting…";
        try {
          await wallet.connect();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Connect Wallet";
          console.error(err);
        }
      });
    }
  };

  const unsub = wallet.subscribe(render);
  render();

  // Cleanup on navigation
  const observer = new MutationObserver(() => {
    if (!document.contains(container)) {
      unsub();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
