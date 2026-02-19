/**
 * zkproof.ts — Ligetron zkVM proof section
 *
 * This section demonstrates the full on-chain ZK proof lifecycle for ThunderBun:
 *
 *   1. Run the Ligetron WebGPU/WASM prover in a Web Worker
 *   2. (Placeholder) Wrap the IOP proof in a Groth16 circuit off-chain
 *   3. Serialize and store the raw IOP proof to Walrus decentralized storage
 *   4. Submit the Groth16 proof to the ligetron-verifier Move contract on Sui
 *   5. Emit a ProofVerified event — readable by any Sui indexer
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE  (two-layer proof system)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Browser (WebGPU)           Off-chain service            Sui on-chain
 *   ──────────────────         ─────────────────────        ─────────────────
 *   Ligetron WASM prover  -->  Groth16 wrapper circuit  --> ligetron_verifier
 *   (IOP proof, ~MB)           (256-byte proof)             verify_proof()
 *                              [TODO: Ligero Inc. circuit]
 *
 * The on-chain Move contract is at:
 *   move/ligetron-verifier/sources/ligetron_verifier.move
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OFF-CHAIN GROTH16 WRAPPER — STATUS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The Groth16 circuit that wraps the Ligetron IOP verifier does not yet exist.
 * It must be built by Ligero Inc. or the open-source community.  Until then,
 * this section demonstrates:
 *   - How the Ligetron WASM prover API would be called from the browser
 *   - How to store a proof blob on Walrus
 *   - How to call the on-chain verifier once the Groth16 wrapper is ready
 *
 * The stubs marked [PLACEHOLDER] will be replaced when the wrapper circuit ships.
 */

import { SuiClient }    from "@mysten/sui/client";
import { Transaction }  from "@mysten/sui/transactions";
import { bcs }          from "@mysten/sui/bcs";
import { wallet }       from "../wallet";

// ─── On-chain contract config ─────────────────────────────────────────────────
// Update these after deploying move/ligetron-verifier with `sui client publish`.

const LIGETRON_PACKAGE_ID =
  (import.meta as Record<string, unknown>)["env"]?.["VITE_LIGETRON_PACKAGE_ID"] as string ??
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const LIGETRON_REGISTRY_ID =
  (import.meta as Record<string, unknown>)["env"]?.["VITE_LIGETRON_REGISTRY_ID"] as string ??
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const WALRUS_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
const SUI_NODE         = "https://fullnode.testnet.sui.io";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LigetronIopProof {
  /** Raw IOP proof bytes (Boost serialization — samplings + Merkle decommitment). */
  proofBytes: Uint8Array;
  /** Merkle root commitment (32 bytes, SHA-256). */
  merkleRoot: Uint8Array;
  /** SHA-256 of the WASM program that was proved. */
  programDigest: Uint8Array;
  /** Canonical byte encoding of the public inputs passed to the prover. */
  publicInputsRaw: Uint8Array;
  /** Proving time in milliseconds. */
  provingTimeMs: number;
}

interface Groth16Proof {
  /** 256-byte Arkworks BN254 proof (πA 64 + πB 128 + πC 64). */
  proofBytes: Uint8Array;
}

interface ProofState {
  status: "idle" | "proving" | "uploading" | "submitting" | "done" | "error";
  message: string;
  iopProof: LigetronIopProof | null;
  groth16Proof: Groth16Proof | null;
  walrusBlobId: string | null;
  txDigest: string | null;
  proofNonce: string | null;
}

// ─── Renderer ────────────────────────────────────────────────────────────────

export function renderZkProof(container: HTMLElement): void {
  container.innerHTML = `
    <h1 class="page-title">Ligetron zkVM Proof</h1>
    <p class="page-subtitle">
      Generate a zero-knowledge proof of WASM execution in your browser,
      store it on Walrus, and verify it on Sui — all without a trusted setup.
    </p>

    <!-- Architecture diagram -->
    <div class="card" style="background: var(--surface-2);">
      <h3 class="card-title">How it works</h3>
      <div class="zkp-flow">
        <div class="zkp-step">
          <div class="zkp-step-icon">🖥</div>
          <div class="zkp-step-label">Browser</div>
          <div class="zkp-step-desc">Ligetron WASM prover<br>(WebGPU accelerated)</div>
        </div>
        <div class="zkp-arrow">→</div>
        <div class="zkp-step">
          <div class="zkp-step-icon">🔄</div>
          <div class="zkp-step-label">Off-chain</div>
          <div class="zkp-step-desc">Groth16 wrapper<br><span class="badge badge-warning">TODO</span></div>
        </div>
        <div class="zkp-arrow">→</div>
        <div class="zkp-step">
          <div class="zkp-step-icon">⛓</div>
          <div class="zkp-step-label">Sui chain</div>
          <div class="zkp-step-desc">ligetron_verifier<br>.verify_proof()</div>
        </div>
      </div>
    </div>

    <!-- Demo program selector -->
    <div class="card">
      <h3 class="card-title">Demo program</h3>
      <p class="card-body">
        Select a simple WASM program to prove. The prover runs entirely in your
        browser via WebGPU — no server, no trusted setup.
      </p>
      <div class="form-group">
        <label for="program-select">Program</label>
        <select id="program-select" class="input-field">
          <option value="fibonacci">Fibonacci(n=20) — compute the 20th Fibonacci number</option>
          <option value="sha256">SHA-256 preimage — hash "hello" and expose the digest</option>
          <option value="range">Range proof — prove x ∈ [0, 100] without revealing x</option>
        </select>
      </div>
      <div class="form-group">
        <label for="public-input">Public input</label>
        <input id="public-input" class="input-field" type="text" value="20"
               placeholder="Public input value" />
        <p class="form-hint">Visible on-chain as part of the proof statement.</p>
      </div>
      <button id="btn-prove" class="btn-primary">Generate ZK proof</button>
    </div>

    <!-- Status panel -->
    <div id="zkp-status" class="card hidden">
      <h3 class="card-title">Proof pipeline</h3>
      <div id="zkp-steps"></div>
    </div>

    <!-- Results -->
    <div id="zkp-result" class="card hidden">
      <h3 class="card-title">Proof verified on Sui</h3>
      <div id="zkp-result-body"></div>
    </div>

    <!-- Technical details accordion -->
    <details class="card">
      <summary style="cursor:pointer; font-weight:600; padding: var(--space-3);">
        Technical details &amp; code
      </summary>
      <div style="padding: 0 var(--space-4) var(--space-4);">
        ${renderTechDetails()}
      </div>
    </details>

    <!-- Contract info -->
    <div class="card" style="background: var(--surface-2);">
      <h3 class="card-title">Deployed contract</h3>
      <div class="info-row">
        <span class="info-label">Package ID</span>
        <code class="info-value mono" id="pkg-id">${LIGETRON_PACKAGE_ID}</code>
      </div>
      <div class="info-row">
        <span class="info-label">Registry ID</span>
        <code class="info-value mono" id="reg-id">${LIGETRON_REGISTRY_ID}</code>
      </div>
      <div class="info-row">
        <span class="info-label">Network</span>
        <code class="info-value">Testnet</code>
      </div>
      <p style="margin-top: var(--space-3); font-size: 0.8rem; color: var(--text-muted);">
        Deploy the contract first:
        <code>cd move/ligetron-verifier &amp;&amp; sui client publish</code>
        then set <code>VITE_LIGETRON_PACKAGE_ID</code> and
        <code>VITE_LIGETRON_REGISTRY_ID</code> in <code>.env</code>.
      </p>
    </div>
  `;

  attachStyles();
  attachHandlers(container);
}

// ─── Event handlers ───────────────────────────────────────────────────────────

function attachHandlers(container: HTMLElement): void {
  container.querySelector("#btn-prove")?.addEventListener("click", () => {
    const program     = (container.querySelector("#program-select") as HTMLSelectElement).value;
    const publicInput = (container.querySelector("#public-input") as HTMLInputElement).value;
    void runProofPipeline(program, publicInput);
  });
}

async function runProofPipeline(program: string, publicInput: string): Promise<void> {
  const state: ProofState = {
    status: "idle", message: "", iopProof: null, groth16Proof: null,
    walrusBlobId: null, txDigest: null, proofNonce: null,
  };

  setStatus(state, "proving", `Generating Ligetron proof for ${program}(${publicInput})…`);

  // ── Step 1: Run Ligetron WASM prover in a Web Worker ────────────────────────
  let iopProof: LigetronIopProof;
  try {
    iopProof = await runLigetronProver(program, publicInput);
    state.iopProof = iopProof;
    logStep("prove", `Proof generated in ${iopProof.provingTimeMs}ms`, "success");
  } catch (e) {
    setStatus(state, "error", `Prover failed: ${(e as Error).message}`);
    return;
  }

  // ── Step 2: Groth16 wrapper [PLACEHOLDER] ────────────────────────────────────
  //
  // This step will call an off-chain service (or in-browser circuit) that:
  //   1. Accepts the raw IOP proof bytes
  //   2. Runs the Groth16 circuit over the Ligetron IOP verification
  //   3. Returns a 256-byte Arkworks BN254 proof
  //
  // For now, we show the placeholder clearly and skip to Walrus storage.
  //
  logStep("groth16", "Groth16 wrapping [PLACEHOLDER — circuit not yet built]", "pending");
  const groth16Proof = await wrapWithGroth16Placeholder(iopProof);
  state.groth16Proof = groth16Proof;

  // ── Step 3: Store the raw IOP proof on Walrus ────────────────────────────────
  setStatus(state, "uploading", "Storing IOP proof bytes on Walrus…");
  try {
    const blobId = await uploadToWalrus(iopProof.proofBytes);
    state.walrusBlobId = blobId;
    logStep("walrus", `Stored on Walrus: ${blobId.slice(0, 16)}…`, "success");
  } catch (e) {
    // Walrus upload failure is non-fatal; the proof can still be verified on-chain.
    logStep("walrus", `Walrus upload skipped: ${(e as Error).message}`, "warning");
  }

  // ── Step 4: Submit Groth16 proof to Sui ──────────────────────────────────────
  setStatus(state, "submitting", "Submitting Groth16 proof to Sui…");
  try {
    const result = await submitProofToSui(
      iopProof.programDigest,
      iopProof.publicInputsRaw,
      groth16Proof.proofBytes,
    );
    state.txDigest   = result.txDigest;
    state.proofNonce = result.proofNonce;
    logStep("sui", `Verified on Sui! Tx: ${result.txDigest.slice(0, 16)}…`, "success");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("contract not deployed") || LIGETRON_PACKAGE_ID.startsWith("0x000")) {
      logStep("sui", "Contract not deployed yet — deploy move/ligetron-verifier first", "warning");
    } else {
      setStatus(state, "error", `Submission failed: ${msg}`);
      return;
    }
  }

  setStatus(state, "done", "Pipeline complete.");
  renderResult(state);
}

// ─── Ligetron prover (Web Worker stub) ───────────────────────────────────────

/**
 * Runs the Ligetron WASM prover in a Web Worker.
 *
 * INTEGRATION STEPS:
 *   1. Build ligetron-prover to WASM:
 *      git clone https://github.com/ligeroinc/ligero-prover
 *      emcmake cmake . && make ligero_wasm
 *
 *   2. Place the .wasm + .js glue in public/wasm/ligetron/
 *
 *   3. Create a Web Worker at src/workers/ligetron.worker.ts:
 *      import init, { prove } from "/wasm/ligetron/ligetron.js";
 *      self.onmessage = async ({ data }) => {
 *        await init();
 *        const proof = prove(data.wasmBytes, data.publicInputs);
 *        self.postMessage({ proof });
 *      };
 *
 *   4. Replace this stub with:
 *      const worker = new Worker(new URL("../workers/ligetron.worker.ts", import.meta.url), { type: "module" });
 *      worker.postMessage({ wasmBytes, publicInputs });
 *      const { proof } = await new Promise(res => worker.onmessage = e => res(e.data));
 */
async function runLigetronProver(
  program: string,
  publicInput: string,
): Promise<LigetronIopProof> {
  // [PLACEHOLDER] Simulate prover latency for the demo.
  const start = Date.now();
  await sleep(800 + Math.random() * 400);

  // In production, these would come from the actual WASM prover output.
  const programBytes   = new TextEncoder().encode(`wasm:${program}`);
  const publicInputBytes = new TextEncoder().encode(publicInput);

  const programDigest  = await sha256(programBytes);
  const merkleRoot     = await sha256(new TextEncoder().encode(`root:${program}:${publicInput}`));
  const proofBytes     = crypto.getRandomValues(new Uint8Array(64)); // placeholder

  return {
    proofBytes,
    merkleRoot,
    programDigest,
    publicInputsRaw: publicInputBytes,
    provingTimeMs: Date.now() - start,
  };
}

// ─── Groth16 wrapper placeholder ─────────────────────────────────────────────

/**
 * [PLACEHOLDER] Off-chain Groth16 wrapping service.
 *
 * When the Groth16 circuit for Ligetron is built, replace this with a call to
 * either:
 *   a) A hosted proving service endpoint (e.g., POST /api/groth16-wrap)
 *   b) An in-browser Groth16 prover compiled to WASM (if small enough)
 *
 * The circuit public inputs MUST match the on-chain encoding:
 *   signal[0] = sha256(program_bytes)[0..30] ++ 0x00  (as LE BN254 scalar)
 *   signal[1] = sha256(public_input_bytes)[0..30] ++ 0x00
 *
 * Reference circuit implementation: [TODO — community contribution welcome]
 * See: move/ligetron-verifier/README.md → "Off-chain tooling still needed"
 */
async function wrapWithGroth16Placeholder(
  _iopProof: LigetronIopProof,
): Promise<Groth16Proof> {
  // Return 256 zero bytes as a placeholder proof.
  // On Sui, submitting this will fail the pairing check (expected — no real VK registered).
  return { proofBytes: new Uint8Array(256) };
}

// ─── Walrus storage ───────────────────────────────────────────────────────────

async function uploadToWalrus(data: Uint8Array): Promise<string> {
  const res = await fetch(`${WALRUS_PUBLISHER}/v1/blobs?epochs=5`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: data,
  });
  if (!res.ok) throw new Error(`Walrus ${res.status}: ${await res.text()}`);
  const json = await res.json() as { blobId?: string; newlyCreated?: { blobObject?: { blobId?: string } } };
  const blobId =
    json.blobId ??
    json.newlyCreated?.blobObject?.blobId;
  if (!blobId) throw new Error("Walrus response missing blobId");
  return blobId as string;
}

// ─── On-chain Sui submission ──────────────────────────────────────────────────

async function submitProofToSui(
  programDigest: Uint8Array,
  publicInputsRaw: Uint8Array,
  groth16ProofBytes: Uint8Array,
): Promise<{ txDigest: string; proofNonce: string }> {
  if (LIGETRON_PACKAGE_ID.startsWith("0x0000")) {
    throw new Error("contract not deployed");
  }

  const state = wallet.getState();
  if (!state.connected || !state.address) {
    throw new Error("Wallet not connected — please connect your wallet first");
  }

  const client = new SuiClient({ url: SUI_NODE });
  const tx = new Transaction();

  tx.moveCall({
    target: `${LIGETRON_PACKAGE_ID}::ligetron_verifier::verify_proof`,
    arguments: [
      tx.object(LIGETRON_REGISTRY_ID),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(programDigest))),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(publicInputsRaw))),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(groth16ProofBytes))),
    ],
  });

  // Sign via the connected wallet (WaaP or extension wallet).
  const txBytes = await tx.build({ client });
  const { signature } = await state.wallet!.signTransaction({ transaction: txBytes as Uint8Array });

  const result = await client.executeTransactionBlock({
    transactionBlock: txBytes,
    signature,
    options: { showEvents: true },
  });

  const event = result.events?.find(e => e.type.includes("ProofVerified"));
  const nonce = (event?.parsedJson as Record<string, unknown> | undefined)?.["proof_nonce"] as string ?? "unknown";

  return { txDigest: result.digest, proofNonce: nonce };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(state: ProofState, status: ProofState["status"], message: string): void {
  state.status  = status;
  state.message = message;

  const panel = document.getElementById("zkp-status");
  const steps = document.getElementById("zkp-steps");
  if (!panel || !steps) return;

  panel.classList.remove("hidden");

  const spinner = status === "proving" || status === "uploading" || status === "submitting"
    ? `<span class="spinner" style="display:inline-block;width:14px;height:14px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;margin-right:6px;"></span>`
    : "";

  steps.innerHTML = `<p style="color: var(--text-muted); font-size:0.88rem;">${spinner}${message}</p>` + steps.innerHTML;
}

function logStep(id: string, text: string, type: "success" | "warning" | "pending" | "error"): void {
  const steps = document.getElementById("zkp-steps");
  if (!steps) return;

  const icons: Record<string, string> = { success: "✅", warning: "⚠️", pending: "⏳", error: "❌" };
  const el = document.createElement("div");
  el.id = `step-${id}`;
  el.className = "zkp-log-entry";
  el.innerHTML = `<span>${icons[type]}</span> <span>${text}</span>`;
  steps.appendChild(el);
}

function renderResult(state: ProofState): void {
  const panel = document.getElementById("zkp-result");
  const body  = document.getElementById("zkp-result-body");
  if (!panel || !body) return;

  panel.classList.remove("hidden");
  body.innerHTML = `
    <div class="info-row"><span class="info-label">IOP proof size</span>
      <code class="info-value">${state.iopProof?.proofBytes.length ?? 0} bytes</code></div>
    <div class="info-row"><span class="info-label">Proving time</span>
      <code class="info-value">${state.iopProof?.provingTimeMs ?? 0}ms</code></div>
    ${state.walrusBlobId
      ? `<div class="info-row"><span class="info-label">Walrus blob ID</span>
           <code class="info-value mono" style="font-size:0.78rem;">${state.walrusBlobId}</code></div>`
      : ""}
    ${state.txDigest
      ? `<div class="info-row"><span class="info-label">Sui tx digest</span>
           <a href="https://suiscan.xyz/testnet/tx/${state.txDigest}" target="_blank" rel="noopener"
              class="info-value mono" style="font-size:0.78rem;">${state.txDigest.slice(0, 20)}…</a></div>
         <div class="info-row"><span class="info-label">Proof nonce</span>
           <code class="info-value mono" style="font-size:0.78rem;">${state.proofNonce}</code></div>`
      : `<p style="color:var(--text-muted);font-size:0.85rem;margin-top:var(--space-3);">
           On-chain submission skipped — deploy the contract and set VITE_LIGETRON_PACKAGE_ID.
         </p>`}
  `;
}

function renderTechDetails(): string {
  return `
    <h4 style="margin:var(--space-3) 0 var(--space-2);">Ligetron IOP parameters</h4>
    <div class="info-row"><span class="info-label">Field</span><code class="info-value">BN254 scalar (254-bit)</code></div>
    <div class="info-row"><span class="info-label">Code length</span><code class="info-value">n = 8192</code></div>
    <div class="info-row"><span class="info-label">Message length</span><code class="info-value">k = 8000</code></div>
    <div class="info-row"><span class="info-label">Column queries</span><code class="info-value">t = 192</code></div>
    <div class="info-row"><span class="info-label">Hash function</span><code class="info-value">SHA-256</code></div>
    <div class="info-row"><span class="info-label">Trusted setup</span><code class="info-value">None (IOP layer)</code></div>

    <h4 style="margin:var(--space-4) 0 var(--space-2);">Groth16 wrapper (when built)</h4>
    <div class="info-row"><span class="info-label">Curve</span><code class="info-value">BN254</code></div>
    <div class="info-row"><span class="info-label">Proof size</span><code class="info-value">256 bytes</code></div>
    <div class="info-row"><span class="info-label">Public inputs</span><code class="info-value">program_digest, inputs_digest</code></div>
    <div class="info-row"><span class="info-label">On-chain gas</span><code class="info-value">~2 000–5 000 SUI compute units</code></div>

    <h4 style="margin:var(--space-4) 0 var(--space-2);">Contract</h4>
    <pre style="background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);font-size:0.75rem;overflow:auto;"><code>// move/ligetron-verifier/sources/ligetron_verifier.move
public fun verify_proof(
    registry:         &mut VerifierRegistry,
    program_digest:   vector&lt;u8&gt;,   // 32 bytes: SHA-256(wasm)
    public_inputs_raw: vector&lt;u8&gt;,  // any length
    proof_bytes:      vector&lt;u8&gt;,   // 256 bytes: Arkworks BN254 Groth16
    ctx:              &amp;mut TxContext,
)</code></pre>

    <h4 style="margin:var(--space-4) 0 var(--space-2);">References</h4>
    <ul style="font-size:0.82rem;line-height:1.8;">
      <li><a href="https://github.com/ligeroinc/ligero-prover" target="_blank" rel="noopener">Ligetron prover (C++ / WebGPU)</a></li>
      <li><a href="https://eprint.iacr.org/2022/1608" target="_blank" rel="noopener">Ligero paper — Ames et al., CCS 2017</a></li>
      <li><a href="https://soundness.xyz/blog/sp1sui" target="_blank" rel="noopener">SP1 Sui verifier (reference architecture)</a></li>
      <li><a href="https://docs.sui.io/references/framework/sui-framework/groth16" target="_blank" rel="noopener">sui::groth16 module docs</a></li>
    </ul>
  `;
}

function attachStyles(): void {
  if (document.getElementById("zkp-styles")) return;
  const s = document.createElement("style");
  s.id = "zkp-styles";
  s.textContent = `
    .zkp-flow {
      display: flex; align-items: center; gap: var(--space-3);
      flex-wrap: wrap; margin-top: var(--space-3);
    }
    .zkp-step {
      flex: 1; min-width: 100px; text-align: center;
      background: var(--surface-3); border-radius: var(--radius);
      padding: var(--space-3);
    }
    .zkp-step-icon  { font-size: 1.5rem; margin-bottom: var(--space-1); }
    .zkp-step-label { font-weight: 600; font-size: 0.85rem; }
    .zkp-step-desc  { font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; }
    .zkp-arrow      { font-size: 1.4rem; color: var(--accent); }
    .zkp-log-entry  {
      display: flex; gap: var(--space-2); align-items: flex-start;
      font-size: 0.85rem; padding: var(--space-1) 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .badge { display:inline-block; font-size:0.7rem; padding:1px 6px;
             border-radius:99px; font-weight:600; }
    .badge-warning { background: rgba(234,179,8,0.2); color: #ca8a04; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(s);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(buf);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
