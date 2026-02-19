/**
 * Seal section — decentralised secrets management & threshold encryption
 * Docs: https://seal-docs.wal.app/
 * Package: npm install @mysten/seal
 *
 * Seal encrypts data client-side and stores encryption keys in a threshold
 * committee of key servers. Access is controlled by Move smart contracts on Sui.
 *
 * Flow:
 *   encrypt(data, threshold, packageId, id) → { encryptedBytes, backupKey }
 *   store encryptedBytes on Walrus / any storage
 *   decrypt(encryptedBytes, sessionKey, txBytes) → plaintext
 *
 * Note: full Seal usage requires a deployed Move access-control package.
 * This demo shows the encrypt / decrypt API and links to example patterns.
 */

export function renderSeal(container: HTMLElement) {
  container.innerHTML = `
    <div class="section">
      <div class="section-top">
        <div>
          <h1 class="section-title">Seal 🔒</h1>
          <p class="section-desc">Threshold encryption with on-chain access control powered by Sui Move.</p>
        </div>
        <a href="https://seal-docs.wal.app" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Docs ↗</a>
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

      <!-- SDK snippet -->
      <div class="card">
        <div class="card-title">SDK usage</div>
        <pre style="font-size:11px;line-height:1.6">import { SealClient, SessionKey, getAllowlistedKeyServers } from '@mysten/seal';
import { fromHEX } from '@mysten/sui/utils';

// 1. Create a Seal client (uses testnet key servers)
const sealClient = new SealClient({
  suiClient,
  serverObjectIds: getAllowlistedKeyServers('testnet'),
  verifyKeyServers: false, // set true for production
});

// 2. Encrypt
const data = new TextEncoder().encode("secret message");
const { encryptedObject, key: backupKey } = await sealClient.encrypt({
  threshold: 2,
  packageId: fromHEX(YOUR_MOVE_PACKAGE_ID),
  id: fromHEX(YOUR_OBJECT_ID),
  data,
});

// 3. Decrypt (after building a tx that calls seal_approve)
const tx = new Transaction();
tx.moveCall({
  target: \`\${packageId}::allowlist::seal_approve\`,
  arguments: [tx.pure.vector("u8", fromHEX(id)), tx.object(allowlistId)],
});
const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
const sessionKey = new SessionKey({ address, packageId, ttlMin: 10 });
const decrypted = await sealClient.decrypt({ data: encryptedObject, sessionKey, txBytes });</pre>
      </div>

      <!-- Interactive demo (local encrypt only — no key servers needed) -->
      <div class="card">
        <div class="card-title">Local encrypt demo</div>
        <p class="small muted" style="margin-bottom:12px">
          Encrypt a message locally using AES-GCM (browser native).
          Full threshold encryption requires deployed key servers — see the SDK snippet above.
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
      // Prepend IV to ciphertext for later decryption
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
