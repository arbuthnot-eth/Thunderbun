import { wallet } from "../wallet";

export function renderHome(container: HTMLElement) {
  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">Home ⚡</h1>
          <p class="section-desc">Connect your wallet to interact with Sui.</p>
        </div>
      </div>
      <div id="home-body"></div>
    </div>
  `;

  const body = container.querySelector<HTMLElement>("#home-body")!;

  const render = () => {
    const s = wallet.getState();

    if (s.connected && s.address) {
      body.innerHTML = `
        <div class="card">
          <div class="wallet-connected-card">
            <div class="row gap-3">
              <div class="wallet-avatar">S</div>
              <div class="wallet-info">
                <div class="wallet-info-addr">${wallet.formatAddress()}</div>
                <div class="wallet-info-network">${s.network}</div>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" id="home-disconnect">Disconnect</button>
          </div>
          <div class="balance-row">
            <span class="balance-label">SUI Balance</span>
            <span class="balance-value" id="home-balance">${wallet.formatBalance()}</span>
          </div>
        </div>

        <div class="stat-grid mt-4">
          <div class="stat-box">
            <div class="stat-label">Network</div>
            <div class="stat-value" style="text-transform:capitalize">${s.network}</div>
          </div>
          <div class="stat-box" id="home-refresh" style="cursor:pointer">
            <div class="stat-label">Balance ↻</div>
            <div class="stat-value mono">${wallet.formatBalance()}</div>
          </div>
        </div>

        <div class="info-links mt-6">
          <div class="info-links-label">Full address</div>
          <div class="mono small break-all" style="color:var(--text)">${s.address}</div>
          <button class="btn btn-secondary btn-sm mt-3" id="home-copy">Copy address</button>
        </div>
      `;

      body.querySelector("#home-disconnect")?.addEventListener("click", () => wallet.disconnect());
      body.querySelector("#home-refresh")?.addEventListener("click", () => wallet.refreshBalance());
      body.querySelector("#home-copy")?.addEventListener("click", () => {
        navigator.clipboard.writeText(s.address ?? "");
        const btn = body.querySelector<HTMLButtonElement>("#home-copy")!;
        const orig = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    } else {
      body.innerHTML = `
        <div class="card">
          <div class="connect-hero">
            <div class="connect-hero-icon">⚡</div>
            <h2>Connect your wallet</h2>
            <p>
              WaaP embedded wallet works right in this page — no extension needed.
              Or use any Sui Wallet Standard extension you already have installed.
            </p>
            <button class="btn btn-primary" id="home-connect">Connect Wallet</button>
            <p class="small muted mt-3">
              Powered by <a href="https://docs.waap.xyz" target="_blank">WaaP</a>
              · <a href="https://docs.sui.io/standards/wallet-standard" target="_blank">Wallet Standard</a>
            </p>
          </div>
        </div>
      `;

      const btn = body.querySelector<HTMLButtonElement>("#home-connect")!;
      btn.addEventListener("click", async () => {
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
  cleanup(container, unsub);
}

/** Cleans up subscriptions when the section is removed from the DOM */
function cleanup(container: HTMLElement, unsub: () => void) {
  const obs = new MutationObserver(() => {
    if (!document.contains(container)) { unsub(); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
