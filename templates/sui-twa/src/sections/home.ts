import { wallet } from "../wallet";
import { getSectionSource, getInfraSource } from "../source-files";
import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";

export function renderHome(container: HTMLElement) {
  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">Home ⚡</h1>
          <p class="section-desc">Live SDK playground for the Sui ecosystem.</p>
        </div>
      </div>
      <div id="home-body"></div>
    </div>
  `;

  // Code viewer (static, outside of re-rendered #home-body)
  const homeSrc = getSectionSource("home");
  if (homeSrc) {
    const cfg = { id: "home-src", label: "home.ts", source: homeSrc, secondaryLabel: "wallet.ts", secondarySource: getInfraSource("wallet.ts") ?? undefined };
    container.querySelector(".section")!.insertAdjacentHTML("beforeend", codeViewerHTML(cfg));
    attachCodeViewer(container, cfg);
  }

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

        <div class="card mt-4">
          <div class="card-title">Explore SDK Demos</div>
          <div class="stat-grid quick-links">
            <div class="stat-box quick-link" data-goto="suins">
              <div class="quick-link-icon">🔖</div>
              <div class="quick-link-label">SuiNS</div>
              <div class="quick-link-desc">Name resolution</div>
            </div>
            <div class="stat-box quick-link" data-goto="walrus">
              <div class="quick-link-icon">🐋</div>
              <div class="quick-link-label">Walrus</div>
              <div class="quick-link-desc">Blob storage</div>
            </div>
            <div class="stat-box quick-link" data-goto="deepbook">
              <div class="quick-link-icon">📖</div>
              <div class="quick-link-label">DeepBook</div>
              <div class="quick-link-desc">On-chain CLOB</div>
            </div>
            <div class="stat-box quick-link" data-goto="seal">
              <div class="quick-link-icon">🔒</div>
              <div class="quick-link-label">Seal</div>
              <div class="quick-link-desc">Encryption</div>
            </div>
          </div>
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

      body.querySelectorAll<HTMLElement>("[data-goto]").forEach((el) => {
        el.addEventListener("click", () => {
          const app = (window as unknown as Record<string, { showSection: (id: string) => void }>).__app;
          if (app) app.showSection(el.dataset["goto"]!);
        });
      });
    } else {
      body.innerHTML = `
        <div class="card">
          <div class="connect-hero">
            <img src="/icons/thunderbun-logo.png" alt="Thunderbun" class="connect-hero-icon-img" />
            <h2>Sui SDK Playground</h2>
            <p>
              Thunderbun is a live SDK playground for the Sui ecosystem.
              Connect a wallet to interact with every demo, view source code, and build your own template.
            </p>
            <button class="btn btn-primary" id="home-connect">Connect Wallet</button>
            <p class="small muted mt-3">
              Powered by <a href="https://docs.waap.xyz" target="_blank">WaaP</a>
              · <a href="https://sdk.mystenlabs.com/dapp-kit" target="_blank">dApp Kit</a>
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
