import { wallet } from "../wallet";

export function renderHome(container: HTMLElement) {
  container.innerHTML = `
    <div class="section">
      <div id="home-body"></div>
    </div>
  `;

  const body = container.querySelector<HTMLElement>("#home-body")!;

  const render = () => {
    const s = wallet.getState();

    if (s.connected && s.address) {
      body.innerHTML = `
        <div class="card home-minimal">
          <div class="spread-row">
            <div>
              <div class="card-title">Portfolio Snapshot</div>
              <div class="card-description">Minimal wallet status for Sui + Base.</div>
            </div>
            <button class="btn btn-secondary btn--compact" id="home-refresh">Refresh</button>
          </div>

          <div class="home-minimal-grid">
            <div class="home-minimal-item">
              <div class="home-minimal-label">Sui Balance</div>
              <div class="home-minimal-value code-text">${wallet.formatBalance()}</div>
            </div>
            <div class="home-minimal-item">
              <div class="home-minimal-label">Base Balance</div>
              <div class="home-minimal-value code-text">${wallet.formatBaseBalance()}</div>
            </div>
            <div class="home-minimal-item">
              <div class="home-minimal-label">Primary SuiNS</div>
              <div class="home-minimal-value code-text">${s.suiPrimaryName ?? "Not set"}</div>
            </div>
            <div class="home-minimal-item">
              <div class="home-minimal-label">Primary Base Name</div>
              <div class="home-minimal-value code-text">${s.waapBasePrimaryName ?? "Not set"}</div>
            </div>
            <div class="home-minimal-item">
              <div class="home-minimal-label">Sui Address</div>
              <div class="home-minimal-value code-text">${wallet.formatAddress(true)}</div>
            </div>
            <div class="home-minimal-item">
              <div class="home-minimal-label">Base Address</div>
              <div class="home-minimal-value code-text">${s.waapBaseAddress ?? "Not linked"}</div>
            </div>
          </div>

          <div class="home-minimal-actions">
            <button class="btn btn-primary btn--compact" id="home-link-base">${s.waapBaseAddress ? "Re-link Base" : "Link Base"}</button>
            <button class="btn btn-secondary btn--compact" id="home-open-suins">Open SuiNS</button>
            <button class="btn btn-secondary btn--compact" id="home-disconnect-waap">Disconnect WaaP</button>
          </div>
        </div>
      `;

      body.querySelector("#home-disconnect-waap")?.addEventListener("click", () => {
        wallet.disconnectWaaP().catch((err) => console.error("[home] failed disconnecting WaaP", err));
      });
      body.querySelector("#home-refresh")?.addEventListener("click", async () => {
        await wallet.refreshBalance();
      });
      body.querySelector<HTMLButtonElement>("#home-link-base")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = "Linking…";
        try {
          await wallet.linkWaaPBaseAddress();
        } catch (err) {
          console.error("[home] failed linking WaaP Base", err);
        } finally {
          btn.disabled = false;
          btn.textContent = original ?? "Link Base";
        }
      });
      body.querySelector("#home-open-suins")?.addEventListener("click", () => gotoSection("suins"));
    } else {
      body.innerHTML = `
        <div class="card home-minimal">
          <div class="card-title">Connect Wallet</div>
          <div class="card-description">Use WaaP to load Sui + Base balances and primary names.</div>
          <button class="btn btn-primary" id="home-connect">Connect WaaP</button>
        </div>
      `;

      const btn = body.querySelector<HTMLButtonElement>("#home-connect");
      btn?.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Connecting…";
        try {
          await wallet.connect();
        } catch (err) {
          console.error(err);
        } finally {
          btn.disabled = false;
          btn.textContent = "Connect WaaP";
        }
      });
    }
  };

  const unsub = wallet.subscribe(render);
  cleanup(container, unsub);
}

function gotoSection(id: string): void {
  const app = (window as unknown as Record<string, { showSection: (sectionId: string) => void }>).__app;
  app?.showSection(id);
}

function cleanup(container: HTMLElement, unsub: () => void) {
  const obs = new MutationObserver(() => {
    if (!document.contains(container)) {
      unsub();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
