/**
 * zkproof.ts — Ligetron zkVM proof section (config-driven UI)
 *
 * All pipeline logic lives in src/lib/zkproof-pipeline.ts.
 * This file is a thin UI wrapper:
 *   1. Reads user-toggled options → builds a ZkProofConfig
 *   2. Calls runPipeline() with progress callbacks
 *   3. Renders the result + Seal decrypt panel
 *
 * To use the pipeline programmatically (no UI):
 *   import { runPipeline, FULL_CONFIG } from "../lib/zkproof-pipeline";
 *   const result = await runPipeline(FULL_CONFIG, { program: "fibonacci", input: "20" }, wallet);
 */

import {
  runPipeline,
  sealDecrypt,
  contractFromEnv,
  TESTNET_NETWORK,
  DEFAULT_WALRUS_TESTNET,
  DEFAULT_SEAL_TESTNET,
  DEFAULT_DEEPBOOK_TESTNET,
  ZkProofConfig,
  PipelineResult,
  SealResult,
  OnChainResult,
  hex,
} from "../lib/zkproof-pipeline";
import { wallet } from "../wallet";

// ─── Renderer ─────────────────────────────────────────────────────────────────

export function renderZkProof(container: HTMLElement): void {
  container.innerHTML = `
    <h1 class="page-title">Ligetron zkVM Proof</h1>
    <p class="page-subtitle">
      Prove WASM execution in-browser, then compose DeepBook, Seal, and Walrus
      into one atomic Sui transaction — minting a private, ownable proof object.
    </p>

    <!-- Step toggle panel -->
    <div class="card">
      <h3 class="card-title">Pipeline options</h3>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:var(--space-3);">
        Each step is independent.  Toggle off steps you don't need.
      </p>
      <div class="options-grid">
        ${optionToggle("opt-walrus",    "🐋 Walrus storage",   "Store the raw IOP proof blob off-chain on Walrus", true)}
        ${optionToggle("opt-seal",      "🔒 Seal encryption",  "Encrypt the private attestation payload (requires Walrus)", true)}
        ${optionToggle("opt-deepbook",  "📖 DeepBook swap",    "Swap SUI → WAL in the same PTB (requires pool ID in .env)", false)}
        ${optionToggle("opt-attest",    "🪙 Mint attestation", "Mint a ProofAttestation Sui object (requires Walrus + Seal)", true)}
        ${optionToggle("opt-dev",       "🔧 Dev / stub mode",  "Use stub prover and stub Groth16 (no GPU, no circuit needed)", true)}
      </div>
    </div>

    <!-- Inputs -->
    <div class="card">
      <h3 class="card-title">Proof inputs</h3>
      <div class="form-group">
        <label for="prog-select">Program</label>
        <select id="prog-select" class="input-field">
          <option value="fibonacci">Fibonacci(n) — prove the nth number</option>
          <option value="range">Range proof — prove x ∈ [0, 100]</option>
          <option value="sha256">SHA-256 preimage — prove hash of a secret</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label for="pub-input">Public input</label>
          <input id="pub-input" class="input-field" value="20" />
        </div>
        <div class="form-group" style="flex:1;" id="swap-group">
          <label for="swap-mist">Swap amount (MIST)</label>
          <input id="swap-mist" class="input-field" type="number" value="100000000" />
        </div>
      </div>
      <div class="form-group" id="payload-group">
        <label for="priv-payload">Private payload (Seal-encrypted)</label>
        <textarea id="priv-payload" class="input-field" rows="2"
          >{"note":"my private attestation","version":"1.0"}</textarea>
        <p class="form-hint">Encrypted client-side before leaving your browser.</p>
      </div>
      <div class="form-group">
        <label for="seal-thresh" id="seal-thresh-label">Seal threshold (1-of-N)</label>
        <input id="seal-thresh" class="input-field" type="number" value="1" min="1" max="10" />
        <p class="form-hint" id="seal-thresh-hint">
          Number of Seal key-server shares required to decrypt.
          1-of-N = any single server (dev); M-of-N = requires M servers (production).
        </p>
      </div>
      <button id="btn-run" class="btn-primary">Run pipeline</button>
    </div>

    <!-- Live log -->
    <div id="log-card" class="card hidden">
      <h3 class="card-title">Pipeline log</h3>
      <div id="log-body" style="font-family:monospace;font-size:0.82rem;max-height:220px;overflow:auto;"></div>
    </div>

    <!-- Result -->
    <div id="result-card" class="card hidden">
      <h3 class="card-title">Result</h3>
      <div id="result-body"></div>
    </div>

    <!-- Decrypt -->
    <div id="decrypt-card" class="card hidden">
      <h3 class="card-title">Decrypt private attestation</h3>
      <p style="font-size:0.85rem;color:var(--text-muted);">
        Prove ownership of the ProofAttestation to Seal decryption nodes
        and recover your private payload.
      </p>
      <button id="btn-decrypt" class="btn-secondary">Decrypt with Seal</button>
      <pre id="decrypt-out" style="display:none;margin-top:var(--space-3);
        background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);
        font-size:0.78rem;overflow:auto;white-space:pre-wrap;"></pre>
    </div>

    <!-- Composability reference -->
    <details class="card">
      <summary style="cursor:pointer;font-weight:600;padding:var(--space-3);">
        How to use programmatically
      </summary>
      <div style="padding:0 var(--space-4) var(--space-4);">${composabilityRef()}</div>
    </details>

    <!-- Config summary -->
    <div id="config-preview" class="card" style="background:var(--surface-2);font-size:0.78rem;">
      <h3 class="card-title" style="font-size:0.85rem;">Effective config (live preview)</h3>
      <pre id="config-json" style="background:var(--surface-3);padding:var(--space-2);
        border-radius:var(--radius);overflow:auto;max-height:180px;"></pre>
    </div>
  `;

  attachOptionStyles();
  watchOptions(container);
  updateConfigPreview(container);
  attachHandlers(container);
}

// ─── Option state helpers ─────────────────────────────────────────────────────

function getOpts(el: Element) {
  return {
    walrus:   (el.querySelector("#opt-walrus")   as HTMLInputElement).checked,
    seal:     (el.querySelector("#opt-seal")     as HTMLInputElement).checked,
    deepbook: (el.querySelector("#opt-deepbook") as HTMLInputElement).checked,
    attest:   (el.querySelector("#opt-attest")   as HTMLInputElement).checked,
    dev:      (el.querySelector("#opt-dev")      as HTMLInputElement).checked,
    program:  (el.querySelector("#prog-select")  as HTMLSelectElement).value,
    pubInput: (el.querySelector("#pub-input")    as HTMLInputElement).value,
    payload:  (el.querySelector("#priv-payload") as HTMLTextAreaElement).value,
    swapMist: BigInt((el.querySelector("#swap-mist") as HTMLInputElement).value || "100000000"),
    threshold: Number((el.querySelector("#seal-thresh") as HTMLInputElement).value || "1"),
  };
}

function buildConfig(opts: ReturnType<typeof getOpts>): ZkProofConfig {
  const sealEnabled = opts.seal && opts.walrus;
  const attestMode  = opts.attest && sealEnabled ? "object" : "event";

  return {
    network:     TESTNET_NETWORK,
    contract:    contractFromEnv(),
    prover:      { mode: opts.dev ? "stub" : "real", wasmPath: "/wasm/ligetron/ligetron.js" },
    groth16:     { mode: "stub" },  // update to "service" + serviceUrl when circuit ships
    walrus:      { ...DEFAULT_WALRUS_TESTNET, enabled: opts.walrus },
    seal:        { ...DEFAULT_SEAL_TESTNET, enabled: sealEnabled, threshold: opts.threshold },
    deepbook:    { ...DEFAULT_DEEPBOOK_TESTNET, enabled: opts.deepbook, swapAmountMist: opts.swapMist },
    attestation: { mode: attestMode },
  };
}

function watchOptions(container: HTMLElement): void {
  container.querySelectorAll(".opt-toggle input, #seal-thresh, #swap-mist")
    .forEach(el => el.addEventListener("change", () => {
      updateConfigPreview(container);
      updateFieldVisibility(container);
    }));
  updateFieldVisibility(container);
}

function updateFieldVisibility(container: HTMLElement): void {
  const opts = getOpts(container);

  // Payload only needed when Seal is on
  const payloadGroup = container.querySelector("#payload-group") as HTMLElement;
  if (payloadGroup) payloadGroup.style.display = opts.seal ? "" : "none";

  // Seal threshold only needed when Seal is on
  const threshLabel = container.querySelector("#seal-thresh-label") as HTMLElement;
  const threshInput = container.querySelector("#seal-thresh") as HTMLElement;
  const threshHint  = container.querySelector("#seal-thresh-hint") as HTMLElement;
  [threshLabel, threshInput, threshHint].forEach(el => {
    if (el) el.style.opacity = opts.seal ? "1" : "0.4";
  });

  // Swap amount only when DeepBook is on
  const swapGroup = container.querySelector("#swap-group") as HTMLElement;
  if (swapGroup) swapGroup.style.display = opts.deepbook ? "" : "none";

  // Seal toggle disabled if Walrus is off (Seal requires Walrus)
  const sealToggle = container.querySelector("#opt-seal") as HTMLInputElement;
  if (sealToggle) {
    sealToggle.disabled = !opts.walrus;
    if (!opts.walrus) sealToggle.checked = false;
  }

  // Attest toggle disabled if Seal is off
  const attestToggle = container.querySelector("#opt-attest") as HTMLInputElement;
  if (attestToggle) {
    attestToggle.disabled = !(opts.walrus && opts.seal);
    if (!(opts.walrus && opts.seal)) attestToggle.checked = false;
  }
}

function updateConfigPreview(container: HTMLElement): void {
  const opts = getOpts(container);
  const cfg  = buildConfig(opts);
  const preview = container.querySelector("#config-json");
  if (!preview) return;

  const summary = {
    prover:      cfg.prover.mode,
    groth16:     cfg.groth16.mode,
    walrus:      cfg.walrus.enabled ? `enabled (${cfg.walrus.epochs} epochs)` : "disabled",
    seal:        cfg.seal.enabled   ? `enabled (${cfg.seal.threshold}-of-N)`   : "disabled",
    deepbook:    cfg.deepbook.enabled ? `enabled (${cfg.deepbook.swapAmountMist} MIST)` : "disabled",
    attestation: cfg.attestation.mode,
    packageId:   cfg.contract.packageId.slice(0, 20) + "…",
    registryId:  cfg.contract.registryId.slice(0, 20) + "…",
  };
  preview.textContent = JSON.stringify(summary, null, 2);
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

let _lastResult: PipelineResult | null = null;

function attachHandlers(container: HTMLElement): void {
  container.querySelector("#btn-run")?.addEventListener("click", () => {
    const opts = getOpts(container);
    const cfg  = buildConfig(opts);
    void runWithUI(opts, cfg, container);
  });

  container.querySelector("#btn-decrypt")?.addEventListener("click", () => {
    if (_lastResult) void handleDecrypt(_lastResult, container);
  });
}

async function runWithUI(
  opts: ReturnType<typeof getOpts>,
  cfg: ZkProofConfig,
  container: HTMLElement,
): Promise<void> {
  showLog(container);

  const walletState = wallet.getState();
  const walletAdapter = walletState.connected && walletState.address && walletState.wallet
    ? {
        address: walletState.address,
        signTransaction: async (args: { transaction: Uint8Array }) =>
          walletState.wallet!.signTransaction({ transaction: args.transaction }),
      }
    : undefined;

  if (!walletAdapter && cfg.attestation.mode !== "stateless") {
    appendLog(container, "⚠", "Wallet not connected — on-chain steps will be skipped.", "warn");
  }

  try {
    const result = await runPipeline(
      cfg,
      { program: opts.program, publicInput: opts.pubInput, privatePayload: opts.payload },
      walletAdapter,
      (step, total, label, status, detail) => {
        const icons = { running: "⏳", done: "✅", skipped: "⟳", error: "❌" } as const;
        appendLog(container, `${step}/${total}`, `${icons[status] ?? "•"} ${label}${detail ? ` — ${detail}` : ""}`, status);
      },
    );

    _lastResult = result;
    renderResult(result, container);

    const onChain = result.onChain;
    if (!onChain.skipped && (result.seal as SealResult).blobId && (onChain as OnChainResult).attestationObjectId) {
      container.querySelector("#decrypt-card")?.classList.remove("hidden");
    }
  } catch (e) {
    appendLog(container, "✗", `Pipeline failed: ${(e as Error).message}`, "error");
  }
}

async function handleDecrypt(result: PipelineResult, container: HTMLElement): Promise<void> {
  const out = container.querySelector("#decrypt-out") as HTMLPreElement;
  out.style.display = "block";
  out.textContent = "Requesting Seal decryption keys…";

  try {
    const sealResult = result.seal as SealResult;
    const onChain    = result.onChain as OnChainResult;
    if (!onChain.attestationObjectId) throw new Error("No attestation object ID");

    const cfg = buildConfig(getOpts(container));
    const plaintext = await sealDecrypt(
      sealResult,
      onChain.attestationObjectId,
      cfg.contract.packageId,
      cfg.network.suiNodeUrl,
      cfg.walrus,
      cfg.seal,
    );
    const decoded = new TextDecoder().decode(plaintext);
    try {
      out.textContent = `Decrypted:\n${JSON.stringify(JSON.parse(decoded), null, 2)}`;
    } catch {
      out.textContent = `Decrypted (raw):\n${decoded}`;
    }
  } catch (e) {
    out.textContent = `Decryption failed: ${(e as Error).message}`;
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showLog(container: HTMLElement): void {
  const log = container.querySelector("#log-card");
  const body = container.querySelector("#log-body");
  log?.classList.remove("hidden");
  if (body) body.innerHTML = "";
  container.querySelector("#result-card")?.classList.add("hidden");
  container.querySelector("#decrypt-card")?.classList.add("hidden");
}

function appendLog(
  container: HTMLElement,
  label: string,
  text: string,
  state: "running" | "done" | "skipped" | "error" | "warn",
): void {
  const body = container.querySelector("#log-body");
  if (!body) return;
  const colors = { running: "inherit", done: "var(--success,#16a34a)", skipped: "var(--text-muted)", error: "var(--danger,#dc2626)", warn: "var(--warning,#ca8a04)" };
  const el = document.createElement("div");
  el.style.cssText = `padding:2px 0;border-bottom:1px solid var(--border-subtle);display:flex;gap:8px;color:${colors[state]};`;
  el.innerHTML = `<span style="opacity:.5;min-width:28px;font-size:0.78rem;">${label}</span><span>${text}</span>`;
  body.appendChild(el);
  (body as HTMLElement).scrollTop = (body as HTMLElement).scrollHeight;
}

function renderResult(result: PipelineResult, container: HTMLElement): void {
  const card = container.querySelector("#result-card");
  const body = container.querySelector("#result-body");
  if (!card || !body) return;
  card.classList.remove("hidden");

  const onChain = result.onChain;
  const walrus  = result.walrus;
  const seal    = result.seal;

  body.innerHTML = `
    <div class="info-row">
      <span class="info-label">Proving time</span>
      <code class="info-value">${result.iop.provingTimeMs}ms</code>
    </div>
    <div class="info-row">
      <span class="info-label">Proof nonce</span>
      <code class="info-value mono" style="font-size:0.74rem;">${hex(result.groth16.proofNonce).slice(0, 32)}…</code>
    </div>
    ${!walrus.skipped ? `<div class="info-row">
      <span class="info-label">IOP blob (Walrus)</span>
      <code class="info-value mono" style="font-size:0.74rem;">${walrus.blobId.slice(0, 32)}…</code>
    </div>` : ""}
    ${!seal.skipped ? `<div class="info-row">
      <span class="info-label">Seal blob (Walrus)</span>
      <code class="info-value mono" style="font-size:0.74rem;">${(seal as SealResult).blobId.slice(0, 32)}…</code>
    </div>` : ""}
    ${!onChain.skipped ? `
    <div class="info-row">
      <span class="info-label">Transaction</span>
      <a href="https://suiscan.xyz/testnet/tx/${(onChain as OnChainResult).txDigest}"
         target="_blank" class="info-value mono" style="font-size:0.74rem;">
        ${(onChain as OnChainResult).txDigest.slice(0, 32)}…
      </a>
    </div>
    ${(onChain as OnChainResult).attestationObjectId ? `<div class="info-row">
      <span class="info-label">Attestation object</span>
      <a href="https://suiscan.xyz/testnet/object/${(onChain as OnChainResult).attestationObjectId}"
         target="_blank" class="info-value mono" style="font-size:0.74rem;">
        ${(onChain as OnChainResult).attestationObjectId!.slice(0, 32)}…
      </a>
    </div>` : ""}` : `
    <p style="color:var(--text-muted);font-size:0.82rem;margin-top:var(--space-2);">
      On-chain steps skipped — connect wallet and deploy contract to complete.
    </p>`}
  `;
}

function optionToggle(id: string, label: string, hint: string, defaultOn: boolean): string {
  return `
    <label class="opt-toggle" for="${id}">
      <input type="checkbox" id="${id}" ${defaultOn ? "checked" : ""} />
      <div>
        <span class="opt-label">${label}</span>
        <span class="opt-hint">${hint}</span>
      </div>
    </label>`;
}

function composabilityRef(): string {
  return `
    <h4 style="margin:var(--space-3) 0 var(--space-2);">Verify only (minimal)</h4>
    <pre style="background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);font-size:0.75rem;overflow:auto;"><code>import { runPipeline, VERIFY_ONLY_CONFIG } from "../lib/zkproof-pipeline";

const result = await runPipeline(
  { ...VERIFY_ONLY_CONFIG, contract: { packageId, registryId } },
  { program: "fibonacci", publicInput: "20" },
  walletAdapter,
);</code></pre>

    <h4 style="margin:var(--space-4) 0 var(--space-2);">Full pipeline (object mode)</h4>
    <pre style="background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);font-size:0.75rem;overflow:auto;"><code>import { runPipeline, FULL_CONFIG } from "../lib/zkproof-pipeline";

const result = await runPipeline(
  FULL_CONFIG,
  { program: "fibonacci", publicInput: "20", privatePayload: '{"score":42}' },
  walletAdapter,
  (step, total, label, status) => console.log(step, label, status),
);

console.log(result.onChain.attestationObjectId); // Sui object ID</code></pre>

    <h4 style="margin:var(--space-4) 0 var(--space-2);">Compose individual steps</h4>
    <pre style="background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);font-size:0.75rem;overflow:auto;"><code>import {
  proveWasm, wrapGroth16, uploadToWalrus,
  deriveSealId, sealEncrypt, executeOnChain,
} from "../lib/zkproof-pipeline";

const iop     = await proveWasm({ program, publicInput }, proverCfg);
const groth16 = await wrapGroth16(iop, groth16Cfg);
const walrus  = await uploadToWalrus(iop.proofBytes, walrusCfg);
const sealId  = await deriveSealId(groth16.proofNonce, iop.programDigest);
const seal    = await sealEncrypt(payload, sealId, sealCfg, suiUrl, pkg, walrusCfg);
const onChain = await executeOnChain({ wallet, iop, groth16, iopWalrus: walrus, sealResult: seal }, cfg);</code></pre>

    <h4 style="margin:var(--space-4) 0 var(--space-2);">Environment variables (.env)</h4>
    <pre style="background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);font-size:0.75rem;overflow:auto;"><code>VITE_LIGETRON_PACKAGE_ID=0x...    # from: sui client publish
VITE_LIGETRON_REGISTRY_ID=0x...   # VerifierRegistry shared object
VITE_DEEPBOOK_SUI_WAL_POOL=0x...  # DeepBook SUI/WAL pool (optional)
VITE_DEEPBOOK_PACKAGE_ID=0x...    # DeepBook package (optional)
VITE_WAL_TOKEN_TYPE=0x...::wal::WAL  # WAL token type (optional)</code></pre>`;
}

function attachOptionStyles(): void {
  if (document.getElementById("zkp-opt-styles")) return;
  const s = document.createElement("style");
  s.id = "zkp-opt-styles";
  s.textContent = `
    .options-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: var(--space-2);
    }
    .opt-toggle {
      display: flex; align-items: flex-start; gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      background: var(--surface-3); border-radius: var(--radius);
      cursor: pointer; border: 1px solid transparent;
      transition: border-color .15s;
    }
    .opt-toggle:has(input:checked) { border-color: var(--accent); }
    .opt-toggle input { margin-top: 3px; cursor: pointer; flex-shrink: 0; }
    .opt-toggle input:disabled + div { opacity: .45; }
    .opt-label { display: block; font-weight: 600; font-size: 0.83rem; }
    .opt-hint  { display: block; font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; }
    .form-row  { display: flex; gap: var(--space-3); }
  `;
  document.head.appendChild(s);
}
