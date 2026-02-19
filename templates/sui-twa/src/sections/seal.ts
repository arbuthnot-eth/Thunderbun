/**
 * Seal section — decentralised secrets management & threshold encryption
 * Docs: https://seal-docs.wal.app/
 * Package: @mysten/seal
 *
 * Seal encrypts data client-side and stores encryption keys in a threshold
 * committee of key servers. Access is controlled by Move smart contracts on Sui.
 *
 * This section includes:
 *   - Explainer (how Seal works)
 *   - Real SealClient.encrypt() demo (testnet only)
 *   - Local AES-GCM demo (any network, no key servers)
 *   - Decrypt explanation with PTB construction
 */

import { getSealClient } from "../sui-client";
import { wallet } from "../wallet";

export function renderSeal(container: HTMLElement) {
  const sealClient = getSealClient();
  const network = wallet.getState().network;

  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">Seal 🔒</h1>
          <p class="section-desc">Threshold encryption with on-chain access control powered by Sui Move.</p>
        </div>
        <div class="row gap-2">
          <span class="badge ${sealClient ? "badge-green" : "badge-yellow"}">${sealClient ? "SDK ready" : "No key servers (" + network + ")"}</span>
          <a href="https://seal-docs.wal.app" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Docs ↗</a>
        </div>
      </div>

      <!-- How it works -->
      <div class="card">
        <div class="card-title">How Seal works</div>
        <div class="seal-steps">
          <div class="seal-step">
            <div class="seal-step-num">1</div>
            <div class="seal-step-body">
              <div class="seal-step-title">Define access policy</div>
              <div class="seal-step-desc">
                Deploy a Move module with a <code>seal_approve</code> function.
                It controls who can decrypt — allowlists, subscriptions, token gates, time locks.
              </div>
            </div>
          </div>
          <div class="seal-step">
            <div class="seal-step-num">2</div>
            <div class="seal-step-body">
              <div class="seal-step-title">Encrypt data</div>
              <div class="seal-step-desc">
                Use <code>SealClient.encrypt()</code> to encrypt data against
                <em>t-out-of-n</em> key servers. Data never leaves the client.
              </div>
            </div>
          </div>
          <div class="seal-step">
            <div class="seal-step-num">3</div>
            <div class="seal-step-body">
              <div class="seal-step-title">Store ciphertext</div>
              <div class="seal-step-desc">
                Save the encrypted bytes to <a href="https://docs.wal.app" target="_blank">Walrus</a>,
                Sui objects, or any storage.
              </div>
            </div>
          </div>
          <div class="seal-step">
            <div class="seal-step-num">4</div>
            <div class="seal-step-body">
              <div class="seal-step-title">Decrypt with on-chain approval</div>
              <div class="seal-step-desc">
                Build a PTB calling your Move <code>seal_approve</code> function.
                Seal key servers validate the policy on-chain, then provide threshold keys
                for client-side decryption.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Seal SDK encrypt demo (testnet only) -->
      <div class="card">
        <div class="row-between" style="margin-bottom:14px">
          <div class="card-title" style="margin:0">Seal SDK Encrypt</div>
          <span class="badge ${sealClient ? "badge-green" : "badge-yellow"}">${sealClient ? "Testnet key servers" : "Requires testnet"}</span>
        </div>
        <p class="small muted" style="margin-bottom:12px">
          Encrypt data using the real Seal threshold encryption SDK.
          Requires a deployed Move package with <code>seal_approve</code> for decryption.
        </p>
        <div class="input-group">
          <label class="input-label">Plaintext</label>
          <input id="seal-sdk-plaintext" type="text" class="input-field" placeholder="Secret message…" ${!sealClient ? "disabled" : ""} />
        </div>
        <div class="input-group">
          <label class="input-label">Package ID (Move access-control package)</label>
          <input id="seal-sdk-pkg" type="text" class="input-field mono" placeholder="0x…" ${!sealClient ? "disabled" : ""} />
        </div>
        <div class="input-group">
          <label class="input-label">Identity (object ID or encoded id)</label>
          <input id="seal-sdk-id" type="text" class="input-field mono" placeholder="0x…" ${!sealClient ? "disabled" : ""} />
        </div>
        <div class="input-group">
          <label class="input-label">Threshold</label>
          <select id="seal-sdk-threshold" class="input-field" style="width:auto" ${!sealClient ? "disabled" : ""}>
            <option value="2" selected>2-of-3</option>
            <option value="1">1-of-3</option>
            <option value="3">3-of-3</option>
          </select>
        </div>
        <button id="seal-sdk-encrypt-btn" class="btn btn-primary" ${!sealClient ? "disabled" : ""}>
          ${sealClient ? "Encrypt with Seal" : "Switch to testnet to enable"}
        </button>

        <div class="result-box" id="seal-sdk-result">
          <div class="result-label">Encrypted output (hex)</div>
          <div class="result-value mono break-all small" id="seal-sdk-ciphertext"></div>
          <div class="result-label mt-3">Backup key (hex)</div>
          <div class="result-value mono break-all small" id="seal-sdk-key"></div>
          <button class="btn btn-secondary btn-sm mt-3" id="seal-sdk-copy">Copy ciphertext</button>
        </div>
        <div class="error-msg" id="seal-sdk-err"></div>
      </div>

      <!-- Decrypt explanation -->
      <div class="card">
        <div class="card-title">Decrypting with Seal</div>
        <p class="small muted" style="margin-bottom:12px">
          Decryption requires building a PTB that calls your Move <code>seal_approve</code>
          function. The key servers verify on-chain that the caller has permission,
          then return threshold decryption shares.
        </p>
        <pre style="font-size:11px;line-height:1.6">import { SealClient, SessionKey } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';

// Build approval PTB
const tx = new Transaction();
tx.moveCall({
  target: \`\${packageId}::allowlist::seal_approve\`,
  arguments: [
    tx.pure.vector("u8", [...idBytes]),
    tx.object(allowlistId),
  ],
});

const txBytes = await tx.build({
  client: suiClient,
  onlyTransactionKind: true,
});

// Create session key and decrypt
const sessionKey = new SessionKey({
  address: walletAddress,
  packageId,
  ttlMin: 10,
});

const plaintext = await sealClient.decrypt({
  data: encryptedBytes,
  sessionKey,
  txBytes,
});</pre>
      </div>

      <!-- Local AES-GCM demo -->
      <div class="card">
        <div class="card-title">Local encrypt demo</div>
        <p class="small muted" style="margin-bottom:12px">
          Encrypt a message locally using AES-GCM (browser native).
          Full threshold encryption requires deployed key servers — see the Seal SDK card above.
        </p>

        <div class="input-group">
          <label class="input-label">Plaintext message</label>
          <input id="seal-plaintext" type="text" class="input-field" placeholder="Enter a secret…" />
        </div>
        <div class="input-group">
          <label class="input-label">Passphrase (used as key material)</label>
          <input id="seal-pass" type="password" class="input-field" placeholder="Strong passphrase" />
        </div>
        <button id="seal-encrypt-btn" class="btn btn-primary">Encrypt</button>

        <div class="result-box" id="seal-enc-result">
          <div class="result-label">Ciphertext (hex)</div>
          <div class="result-value mono break-all small" id="seal-ciphertext"></div>
          <button class="btn btn-secondary btn-sm mt-3" id="seal-copy">Copy ciphertext</button>
        </div>
        <div class="error-msg" id="seal-enc-err"></div>
      </div>

      <!-- Decrypt card -->
      <div class="card">
        <div class="card-title">Local decrypt demo</div>
        <div class="input-group">
          <label class="input-label">Ciphertext (hex)</label>
          <input id="seal-ctxt" type="text" class="input-field mono" placeholder="Paste ciphertext hex…" />
        </div>
        <div class="input-group">
          <label class="input-label">Passphrase</label>
          <input id="seal-dec-pass" type="password" class="input-field" placeholder="Same passphrase used to encrypt" />
        </div>
        <button id="seal-decrypt-btn" class="btn btn-primary">Decrypt</button>
        <div class="result-box" id="seal-dec-result">
          <div class="result-label">Decrypted message</div>
          <div class="result-value green" id="seal-decrypted"></div>
        </div>
        <div class="error-msg" id="seal-dec-err"></div>
      </div>

      <div class="info-links">
        <div class="info-links-label">Resources</div>
        <div class="info-links-row">
          <a href="https://seal-docs.wal.app" target="_blank" rel="noopener" class="badge badge-blue">Seal docs ↗</a>
          <a href="https://seal-docs.wal.app/GettingStarted" target="_blank" rel="noopener" class="badge badge-blue">Getting started ↗</a>
          <a href="https://seal-docs.wal.app/ExamplePatterns" target="_blank" rel="noopener" class="badge badge-blue">Example patterns ↗</a>
          <a href="https://www.npmjs.com/package/@mysten/seal" target="_blank" rel="noopener" class="badge badge-blue">npm ↗</a>
        </div>
      </div>
    </div>
  `;

  // ── Seal SDK Encrypt ────────────────────────────────────────────────────
  container.querySelector("#seal-sdk-encrypt-btn")?.addEventListener("click", async () => {
    const client = getSealClient();
    if (!client) return;

    const plaintext = container.querySelector<HTMLInputElement>("#seal-sdk-plaintext")!.value;
    const packageId = container.querySelector<HTMLInputElement>("#seal-sdk-pkg")!.value.trim();
    const id = container.querySelector<HTMLInputElement>("#seal-sdk-id")!.value.trim();
    const threshold = parseInt(container.querySelector<HTMLSelectElement>("#seal-sdk-threshold")!.value, 10);
    const resultEl = container.querySelector<HTMLElement>("#seal-sdk-result")!;
    const errEl = container.querySelector<HTMLElement>("#seal-sdk-err")!;

    resultEl.classList.remove("visible");
    errEl.classList.remove("visible");

    if (!plaintext || !packageId || !id) {
      errEl.textContent = "Enter plaintext, package ID, and identity.";
      errEl.classList.add("visible");
      return;
    }

    const btn = container.querySelector<HTMLButtonElement>("#seal-sdk-encrypt-btn")!;
    btn.disabled = true;
    btn.textContent = "Encrypting…";

    try {
      const data = new TextEncoder().encode(plaintext);
      const { encryptedObject, key } = await client.encrypt({
        threshold,
        packageId,
        id,
        data,
      });

      const toHex = (arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
      container.querySelector<HTMLElement>("#seal-sdk-ciphertext")!.textContent = toHex(encryptedObject);
      container.querySelector<HTMLElement>("#seal-sdk-key")!.textContent = toHex(key);
      resultEl.classList.add("visible");
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.classList.add("visible");
    } finally {
      btn.disabled = false;
      btn.textContent = "Encrypt with Seal";
    }
  });

  container.querySelector("#seal-sdk-copy")?.addEventListener("click", () => {
    navigator.clipboard.writeText(
      container.querySelector<HTMLElement>("#seal-sdk-ciphertext")!.textContent ?? ""
    );
    const btn = container.querySelector<HTMLButtonElement>("#seal-sdk-copy")!;
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  // ── Encrypt (local AES-GCM demo) ─────────────────────────────────────────
  container.querySelector("#seal-encrypt-btn")?.addEventListener("click", async () => {
    const plaintext = container.querySelector<HTMLInputElement>("#seal-plaintext")!.value;
    const passphrase = container.querySelector<HTMLInputElement>("#seal-pass")!.value;
    const resultEl = container.querySelector<HTMLElement>("#seal-enc-result")!;
    const ctxtEl   = container.querySelector<HTMLElement>("#seal-ciphertext")!;
    const errEl    = container.querySelector<HTMLElement>("#seal-enc-err")!;

    resultEl.classList.remove("visible");
    errEl.classList.remove("visible");

    if (!plaintext || !passphrase) {
      errEl.textContent = "Enter both a message and passphrase.";
      errEl.classList.add("visible");
      return;
    }

    try {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(passphrase.padEnd(32, "0").slice(0, 32)), "AES-GCM", false, ["encrypt"]
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipherBuf = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        keyMaterial,
        enc.encode(plaintext)
      );
      const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(cipherBuf), iv.byteLength);
      const hex = Array.from(combined).map((b) => b.toString(16).padStart(2, "0")).join("");

      ctxtEl.textContent = hex;
      resultEl.classList.add("visible");

      // Pre-fill decrypt card
      container.querySelector<HTMLInputElement>("#seal-ctxt")!.value = hex;
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.classList.add("visible");
    }
  });

  container.querySelector("#seal-copy")?.addEventListener("click", () => {
    navigator.clipboard.writeText(
      container.querySelector<HTMLElement>("#seal-ciphertext")!.textContent ?? ""
    );
    const btn = container.querySelector<HTMLButtonElement>("#seal-copy")!;
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  // ── Decrypt (local AES-GCM demo) ─────────────────────────────────────────
  container.querySelector("#seal-decrypt-btn")?.addEventListener("click", async () => {
    const hexCtxt    = container.querySelector<HTMLInputElement>("#seal-ctxt")!.value.trim();
    const passphrase = container.querySelector<HTMLInputElement>("#seal-dec-pass")!.value;
    const resultEl   = container.querySelector<HTMLElement>("#seal-dec-result")!;
    const decEl      = container.querySelector<HTMLElement>("#seal-decrypted")!;
    const errEl      = container.querySelector<HTMLElement>("#seal-dec-err")!;

    resultEl.classList.remove("visible");
    errEl.classList.remove("visible");

    if (!hexCtxt || !passphrase) {
      errEl.textContent = "Enter both ciphertext and passphrase.";
      errEl.classList.add("visible");
      return;
    }

    try {
      const bytes = new Uint8Array(hexCtxt.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
      const iv = bytes.slice(0, 12);
      const ciphertext = bytes.slice(12);

      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(passphrase.padEnd(32, "0").slice(0, 32)), "AES-GCM", false, ["decrypt"]
      );
      const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, keyMaterial, ciphertext);
      decEl.textContent = new TextDecoder().decode(plainBuf);
      resultEl.classList.add("visible");
    } catch {
      errEl.textContent = "Decryption failed. Check the passphrase and ciphertext.";
      errEl.classList.add("visible");
    }
  });
}
