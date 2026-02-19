/**
 * Passkeys section — WebAuthn passkey registration + authentication for Sui
 *
 * Uses BrowserPasskeyProvider + PasskeyKeypair from @mysten/sui/keypairs/passkey.
 * Cross-subdomain portability: set rpId to root domain (e.g. thunderbun.ai).
 *
 * Docs: https://sdk.mystenlabs.com/typescript/cryptography/keypairs/passkey
 */

import { getSectionSource } from "../source-files";
import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";

/** Extract root domain for cross-subdomain passkey portability */
function getRootDomain(): string {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "localhost";
  const parts = host.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : host;
}

export function renderPasskeys(container: HTMLElement) {
  const rpId = getRootDomain();

  container.innerHTML = `
    <div class="section">
      <div class="section-top" style="margin-bottom:24px">
        <div>
          <h1 class="section-title">Passkeys</h1>
          <p class="section-desc">WebAuthn passkeys for Sui — passwordless signing, cross-subdomain portability.</p>
        </div>
      </div>

      <!-- How It Works -->
      <div class="card">
        <div class="card-title">How Passkeys Work on Sui</div>
        <p class="small muted" style="margin-bottom:12px">
          Passkeys use your device's biometrics (Face ID, fingerprint, PIN) to sign Sui transactions.
          Each passkey derives a unique Sui address — no seed phrase, no extension, no password.
        </p>
        <ul class="small muted" style="margin-bottom:12px;padding-left:18px">
          <li>Credentials are bound to an <strong>RP ID</strong> (relying party identifier)</li>
          <li>By setting <code>rpId</code> to the root domain, passkeys work across subdomains</li>
          <li>A passkey created on <code>sub.thunderbun.ai</code> works on <code>app.thunderbun.ai</code></li>
        </ul>
        <div style="background:var(--bg);border-radius:var(--r-md);padding:10px 14px;margin-bottom:8px">
          <span class="result-label">Current RP ID</span>
          <span class="mono small" style="margin-left:8px">${rpId}</span>
        </div>
      </div>

      <!-- Register / Authenticate -->
      <div class="card">
        <div class="card-title">Try It</div>
        <p class="small muted" style="margin-bottom:12px">
          Register a new passkey or authenticate with an existing one.
          The derived Sui address will be displayed below.
        </p>
        <div class="row gap-2" style="margin-bottom:12px">
          <button id="pk-register" class="btn btn-primary" style="flex:1">Register Passkey</button>
          <button id="pk-auth" class="btn btn-secondary" style="flex:1">Authenticate</button>
        </div>
        <div id="pk-result" style="display:none">
          <div style="background:var(--bg);border-radius:var(--r-md);padding:12px 14px">
            <div class="result-label">Passkey Sui Address</div>
            <div id="pk-address" class="mono small break-all" style="color:var(--text);margin-top:4px"></div>
          </div>
        </div>
        <div id="pk-error" class="small" style="color:var(--red);display:none;margin-top:8px"></div>
      </div>

      <!-- Cross-Subdomain Architecture -->
      <div class="card">
        <div class="card-title">Cross-Subdomain Iframe Architecture</div>
        <p class="small muted" style="margin-bottom:12px">
          For production apps, serve a tiny passkey auth iframe from the root domain.
          Subdomains embed this iframe and communicate via <code>postMessage</code>.
        </p>
        <pre style="font-size:11px">// 1. Root domain hosts /passkey-auth.html
//    (tiny page with WebAuthn logic, rpId: "${rpId}")

// 2. Subdomain embeds iframe
const iframe = document.createElement("iframe");
iframe.src = "https://${rpId}/passkey-auth.html";
iframe.style.display = "none";
document.body.appendChild(iframe);

// 3. Request registration via postMessage
iframe.contentWindow.postMessage(
  { action: "register", rpName: "ThunderBun" },
  "https://${rpId}"
);

// 4. Receive credential back
window.addEventListener("message", (e) => {
  if (e.origin !== "https://${rpId}") return;
  const { credential } = e.data;
  // Use credential to construct PasskeyKeypair
});</pre>
      </div>

      <!-- SDK Usage -->
      <div class="card">
        <div class="card-title">SDK Usage</div>
        <pre style="font-size:11px">import {
  BrowserPasskeyProvider,
  PasskeyKeypair,
} from "@mysten/sui/keypairs/passkey";

// Configure for cross-subdomain portability
const provider = new BrowserPasskeyProvider(
  "ThunderBun",  // RP name
  { rp: { id: "${rpId}" } }
);

// Register a new passkey
const keypair = await PasskeyKeypair.getPasskeyInstance(provider);

// Get the derived Sui address
const address = keypair.toSuiAddress();

// Sign data (e.g. for transaction signing)
const signed = await keypair.signWithIntent(txBytes, "TransactionData");</pre>
        <div class="info-links-row mt-3">
          <a href="https://sdk.mystenlabs.com/typescript/cryptography/keypairs/passkey" target="_blank" rel="noopener" class="badge badge-blue">Passkey docs ↗</a>
          <a href="https://webauthn.guide" target="_blank" rel="noopener" class="badge badge-blue">WebAuthn guide ↗</a>
        </div>
      </div>
    </div>
  `;

  // Code viewer
  const src = getSectionSource("passkeys");
  if (src) {
    const cfg = { id: "passkeys-src", label: "passkeys.ts", source: src };
    container.querySelector(".section")!.insertAdjacentHTML("beforeend", codeViewerHTML(cfg));
    attachCodeViewer(container, cfg);
  }

  // Register passkey
  container.querySelector("#pk-register")?.addEventListener("click", async () => {
    const btn = container.querySelector<HTMLButtonElement>("#pk-register")!;
    const errEl = container.querySelector<HTMLElement>("#pk-error")!;
    const resEl = container.querySelector<HTMLElement>("#pk-result")!;
    errEl.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Registering\u2026";
    try {
      const { BrowserPasskeyProvider, PasskeyKeypair } = await import(
        "@mysten/sui/keypairs/passkey"
      );
      const provider = new BrowserPasskeyProvider("ThunderBun", { rp: { id: rpId } });
      const keypair = await PasskeyKeypair.getPasskeyInstance(provider);
      resEl.style.display = "block";
      container.querySelector<HTMLElement>("#pk-address")!.textContent =
        keypair.toSuiAddress();
    } catch (e) {
      errEl.textContent =
        e instanceof Error ? e.message : "Passkey registration failed";
      errEl.style.display = "block";
      resEl.style.display = "none";
    } finally {
      btn.disabled = false;
      btn.textContent = "Register Passkey";
    }
  });

  // Authenticate with existing passkey
  container.querySelector("#pk-auth")?.addEventListener("click", async () => {
    const btn = container.querySelector<HTMLButtonElement>("#pk-auth")!;
    const errEl = container.querySelector<HTMLElement>("#pk-error")!;
    const resEl = container.querySelector<HTMLElement>("#pk-result")!;
    errEl.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Authenticating\u2026";
    try {
      const { BrowserPasskeyProvider, PasskeyKeypair } = await import(
        "@mysten/sui/keypairs/passkey"
      );
      const provider = new BrowserPasskeyProvider("ThunderBun", { rp: { id: rpId } });
      const publicKeys = await PasskeyKeypair.signAndRecover(
        provider,
        new Uint8Array([0]),
      );
      if (!publicKeys.length) throw new Error("No passkey credential found");
      resEl.style.display = "block";
      container.querySelector<HTMLElement>("#pk-address")!.textContent =
        publicKeys[0].toSuiAddress();
    } catch (e) {
      errEl.textContent =
        e instanceof Error ? e.message : "Passkey authentication failed";
      errEl.style.display = "block";
      resEl.style.display = "none";
    } finally {
      btn.disabled = false;
      btn.textContent = "Authenticate";
    }
  });
}
