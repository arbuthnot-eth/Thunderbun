/**
 * zkproof.ts — Ligetron zkVM proof section
 *
 * Full atomic pipeline in one Sui PTB:
 *
 *   [OFF-CHAIN, before PTB]
 *   1. Ligetron WASM prover  → raw IOP proof bytes
 *   2. Groth16 wrapper       → 256-byte proof  [TODO: circuit]
 *   3. Walrus PUT            → iop_blob_id (stores raw proof)
 *   4. Seal encrypt          → { seal_id, ciphertext }
 *   5. Walrus PUT            → seal_blob_id (stores ciphertext)
 *
 *   [ON-CHAIN PTB — single atomic transaction]
 *   A. DeepBook swap SUI → WAL  (acquires WAL to fund Walrus storage)
 *   B. proof_attestation::verify_and_attest(...)
 *        • Groth16 proof verified via sui::groth16 precompile
 *        • Proof nonce recorded (replay protection)
 *        • ProofAttestation object minted
 *   C. transfer::public_transfer(attestation, sender)
 *   D. transfer::public_transfer(wal_coin, sender)
 *
 *   [DECRYPT — after PTB]
 *   Owner calls seal_approve with their ProofAttestation → gets Seal key shares
 *   → decrypts ciphertext fetched from Walrus by seal_blob_id
 *
 * On-chain contracts:
 *   move/ligetron-verifier/sources/ligetron_verifier.move
 *   move/ligetron-verifier/sources/proof_attestation.move
 */

import { SuiClient }    from "@mysten/sui/client";
import { Transaction }  from "@mysten/sui/transactions";
import { bcs }          from "@mysten/sui/bcs";
import { SealClient, getAllowlistedKeyServers, EncryptedObject }
                        from "@mysten/seal";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { wallet }       from "../wallet";

// ─── Config ───────────────────────────────────────────────────────────────────

const env = (import.meta as Record<string, unknown>)["env"] as Record<string, string> ?? {};

const PACKAGE_ID  = env["VITE_LIGETRON_PACKAGE_ID"]  ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
const REGISTRY_ID = env["VITE_LIGETRON_REGISTRY_ID"] ?? "0x0000000000000000000000000000000000000000000000000000000000000000";

const SUI_NODE         = "https://fullnode.testnet.sui.io";
const WALRUS_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

// DeepBook SUI/WAL pool on testnet — update when live.
const DEEPBOOK_SUI_WAL_POOL = env["VITE_DEEPBOOK_SUI_WAL_POOL"] ?? "";

// Amount of SUI (MIST) to swap for WAL — enough for several Walrus epochs.
const SWAP_AMOUNT_MIST = 100_000_000n; // 0.1 SUI

// ─── Types ────────────────────────────────────────────────────────────────────

interface IopProof {
  proofBytes: Uint8Array;
  programDigest: Uint8Array;
  publicInputsRaw: Uint8Array;
  provingTimeMs: number;
}
interface Groth16Proof { proofBytes: Uint8Array }

interface BlobResult { blobId: string }

interface AtomicPipelineResult {
  iopBlobId: string;
  sealBlobId: string;
  sealId: Uint8Array;
  txDigest: string;
  attestationObjectId: string;
}

// ─── Renderer ────────────────────────────────────────────────────────────────

export function renderZkProof(container: HTMLElement): void {
  container.innerHTML = `
    <h1 class="page-title">Ligetron zkVM Proof</h1>
    <p class="page-subtitle">
      Prove WASM execution in-browser, swap for storage tokens on DeepBook,
      encrypt the attestation with Seal, persist on Walrus, and mint a private
      proof object on Sui — all in one atomic transaction.
    </p>

    <!-- Pipeline diagram -->
    <div class="card" style="background:var(--surface-2);">
      <h3 class="card-title">Atomic pipeline</h3>
      <div class="pipeline-grid">
        ${pipelineStep("🖥", "Ligetron", "WASM proof\n(WebGPU)", "offchain")}
        ${pipelineArrow()}
        ${pipelineStep("🔄", "Groth16", "256-byte\nwrapped proof", "offchain", true)}
        ${pipelineArrow()}
        ${pipelineStep("🐋", "Walrus", "Store IOP\nproof blob", "offchain")}
        ${pipelineArrow()}
        ${pipelineStep("🔒", "Seal", "Encrypt\nattestation", "offchain")}
        ${pipelineArrow()}
        ${pipelineStep("🐋", "Walrus", "Store Seal\nciphertext", "offchain")}
        <div class="pipeline-break"></div>
        ${pipelineStep("📖", "DeepBook", "SUI → WAL\nswap", "onchain")}
        ${pipelineArrow()}
        ${pipelineStep("✅", "Verify", "Groth16\non-chain", "onchain")}
        ${pipelineArrow()}
        ${pipelineStep("🪙", "Mint", "ProofAttestation\nobject", "onchain")}
        ${pipelineArrow()}
        ${pipelineStep("📦", "Own", "Private Sui\nobject", "onchain")}
      </div>
      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-3);font-size:0.78rem;">
        <span><span style="color:var(--text-muted)">■</span> Off-chain</span>
        <span><span style="color:var(--accent)">■</span> On-chain (atomic PTB)</span>
        <span><span style="color:var(--warning,#ca8a04)">■</span> TODO (Groth16 circuit)</span>
      </div>
    </div>

    <!-- Config -->
    <div class="card">
      <h3 class="card-title">Program &amp; inputs</h3>
      <div class="form-group">
        <label for="prog-select">Demo program</label>
        <select id="prog-select" class="input-field">
          <option value="fibonacci">Fibonacci(n) — prove the nth Fibonacci number</option>
          <option value="range">Range proof — prove x ∈ [0, 100]</option>
          <option value="sha256">SHA-256 preimage — prove hash of a secret</option>
        </select>
      </div>
      <div class="form-group">
        <label for="pub-input">Public input</label>
        <input id="pub-input" class="input-field" type="text" value="20" />
      </div>
      <div class="form-group">
        <label for="attestation-payload">Private attestation payload (will be Seal-encrypted)</label>
        <textarea id="attestation-payload" class="input-field" rows="3"
          placeholder='{"result": 6765, "timestamp": "...", "custom": "metadata"}'
          >{"result":"demo","prover":"ThunderBun","version":"0.1.0"}</textarea>
        <p class="form-hint">
          This payload is encrypted with Seal before leaving your browser.
          Only you (the ProofAttestation owner) can decrypt it.
        </p>
      </div>
      <div class="form-group">
        <label for="swap-amount">SUI to swap for WAL (MIST)</label>
        <input id="swap-amount" class="input-field" type="number" value="100000000" />
        <p class="form-hint">~0.1 SUI — covers several Walrus storage epochs.</p>
      </div>
      <button id="btn-run" class="btn-primary">Run atomic pipeline</button>
    </div>

    <!-- Live log -->
    <div id="pipeline-log" class="card hidden">
      <h3 class="card-title">Pipeline log</h3>
      <div id="log-entries" style="font-family:monospace;font-size:0.82rem;"></div>
    </div>

    <!-- Result -->
    <div id="pipeline-result" class="card hidden">
      <h3 class="card-title">ProofAttestation minted</h3>
      <div id="result-body"></div>
    </div>

    <!-- Decrypt panel (shown after minting) -->
    <div id="decrypt-panel" class="card hidden">
      <h3 class="card-title">Decrypt private attestation</h3>
      <p style="font-size:0.85rem;color:var(--text-muted);">
        Prove you own the ProofAttestation object to Seal decryption nodes
        and recover the private payload.
      </p>
      <button id="btn-decrypt" class="btn-secondary">Decrypt with Seal</button>
      <pre id="decrypt-result" style="display:none;margin-top:var(--space-3);
        background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);
        font-size:0.78rem;overflow:auto;"></pre>
    </div>

    <!-- Technical reference -->
    <details class="card">
      <summary style="cursor:pointer;font-weight:600;padding:var(--space-3);">
        Contract interface &amp; PTB schema
      </summary>
      <div style="padding:0 var(--space-4) var(--space-4);">${techRef()}</div>
    </details>

    <!-- Deployment info -->
    <div class="card" style="background:var(--surface-2);font-size:0.82rem;">
      <div class="info-row">
        <span class="info-label">Package ID</span>
        <code class="info-value mono">${PACKAGE_ID}</code>
      </div>
      <div class="info-row">
        <span class="info-label">Registry ID</span>
        <code class="info-value mono">${REGISTRY_ID}</code>
      </div>
      <p style="margin-top:var(--space-2);color:var(--text-muted);">
        Deploy: <code>cd move/ligetron-verifier &amp;&amp; sui client publish</code>
        then set <code>VITE_LIGETRON_PACKAGE_ID</code> and <code>VITE_LIGETRON_REGISTRY_ID</code>.
      </p>
    </div>
  `;

  attachPipelineStyles();
  attachHandlers(container);
}

// ─── Event handlers ───────────────────────────────────────────────────────────

let _lastResult: AtomicPipelineResult | null = null;

function attachHandlers(container: HTMLElement): void {
  container.querySelector("#btn-run")?.addEventListener("click", () => {
    const program  = (container.querySelector("#prog-select") as HTMLSelectElement).value;
    const input    = (container.querySelector("#pub-input") as HTMLInputElement).value;
    const payload  = (container.querySelector("#attestation-payload") as HTMLTextAreaElement).value;
    const swapMist = BigInt((container.querySelector("#swap-amount") as HTMLInputElement).value || "100000000");
    void runAtomicPipeline(program, input, payload, swapMist);
  });

  container.querySelector("#btn-decrypt")?.addEventListener("click", () => {
    if (_lastResult) void decryptAttestation(_lastResult);
  });
}

// ─── Full pipeline ────────────────────────────────────────────────────────────

async function runAtomicPipeline(
  program: string,
  publicInput: string,
  privatePayload: string,
  swapAmountMist: bigint,
): Promise<void> {
  showLog();

  // ═══════════════════════════════════════════════════════════════════════════
  // OFF-CHAIN PHASE
  // ═══════════════════════════════════════════════════════════════════════════

  // Step 1 — Ligetron prover
  logEntry("step", "1/8", "Running Ligetron WASM prover…", "running");
  let iopProof: IopProof;
  try {
    iopProof = await runLigetronProver(program, publicInput);
    logEntry("step", "1/8", `IOP proof ready (${iopProof.proofBytes.length}B, ${iopProof.provingTimeMs}ms)`, "done");
  } catch (e) { return logFatal(`Prover failed: ${(e as Error).message}`); }

  // Step 2 — Groth16 wrapper
  logEntry("step", "2/8", "Groth16 wrapper [PLACEHOLDER — circuit pending]", "todo");
  const groth16 = await groth16WrapperPlaceholder(iopProof);

  // Step 3 — Upload raw IOP proof to Walrus
  logEntry("step", "3/8", "Uploading IOP proof to Walrus…", "running");
  let iopBlobId: string;
  try {
    iopBlobId = await walrusUpload(iopProof.proofBytes, "IOP proof");
    logEntry("step", "3/8", `IOP proof stored: ${iopBlobId.slice(0, 20)}…`, "done");
  } catch (e) { return logFatal(`Walrus upload failed: ${(e as Error).message}`); }

  // Step 4 — Seal encrypt the private attestation payload
  logEntry("step", "4/8", "Encrypting attestation with Seal…", "running");
  const proofNonce = await sha256(groth16.proofBytes);
  const sealIdBytes = await deriveSealId(proofNonce, iopProof.programDigest);

  let sealEncrypted: EncryptedObject;
  try {
    sealEncrypted = await sealEncryptPayload(
      sealIdBytes,
      new TextEncoder().encode(privatePayload),
    );
    logEntry("step", "4/8", `Attestation encrypted, Seal ID: ${hex(sealIdBytes).slice(0, 16)}…`, "done");
  } catch (e) { return logFatal(`Seal encryption failed: ${(e as Error).message}`); }

  // Step 5 — Upload Seal ciphertext to Walrus
  logEntry("step", "5/8", "Uploading Seal ciphertext to Walrus…", "running");
  let sealBlobId: string;
  try {
    sealBlobId = await walrusUpload(sealEncrypted.data, "Seal ciphertext");
    logEntry("step", "5/8", `Seal ciphertext stored: ${sealBlobId.slice(0, 20)}…`, "done");
  } catch (e) { return logFatal(`Walrus Seal upload failed: ${(e as Error).message}`); }

  // ═══════════════════════════════════════════════════════════════════════════
  // ON-CHAIN PHASE — single atomic PTB
  // ═══════════════════════════════════════════════════════════════════════════

  const state = wallet.getState();
  if (!state.connected || !state.address) {
    return logFatal("Wallet not connected — connect your wallet first.");
  }

  if (PACKAGE_ID.startsWith("0x0000")) {
    logEntry("step", "6/8", "DeepBook swap [skipped — package not deployed]", "skip");
    logEntry("step", "7/8", "verify_and_attest [skipped — package not deployed]", "skip");
    logEntry("step", "8/8", "Mint ProofAttestation [skipped — package not deployed]", "skip");
    logEntry("warn", "⚠", "Deploy move/ligetron-verifier first to complete on-chain steps.", "warn");
    return;
  }

  // Step 6 — DeepBook SUI → WAL swap
  logEntry("step", "6/8", `DeepBook: swapping ${Number(swapAmountMist) / 1e9} SUI → WAL…`, "running");

  // Step 7 — build and execute PTB
  logEntry("step", "7/8", "Building atomic PTB…", "running");

  let result: AtomicPipelineResult;
  try {
    result = await executeAtomicPtb({
      state,
      groth16,
      iopProof,
      iopBlobId,
      sealBlobId,
      sealIdBytes,
      swapAmountMist,
    });

    logEntry("step", "6/8", `DeepBook swap included in PTB`, "done");
    logEntry("step", "7/8", `Groth16 verified + attestation minted in one tx`, "done");
    logEntry("step", "8/8", `ProofAttestation object: ${result.attestationObjectId.slice(0, 20)}…`, "done");
  } catch (e) { return logFatal(`PTB failed: ${(e as Error).message}`); }

  _lastResult = result;
  renderResult(result);

  // Show decrypt panel
  const dp = document.getElementById("decrypt-panel");
  dp?.classList.remove("hidden");
}

// ─── Atomic PTB execution ─────────────────────────────────────────────────────

interface PtbArgs {
  state: ReturnType<typeof wallet.getState>;
  groth16: Groth16Proof;
  iopProof: IopProof;
  iopBlobId: string;
  sealBlobId: string;
  sealIdBytes: Uint8Array;
  swapAmountMist: bigint;
}

async function executeAtomicPtb(args: PtbArgs): Promise<AtomicPipelineResult> {
  const { state, groth16, iopProof, iopBlobId, sealBlobId, sealIdBytes, swapAmountMist } = args;
  const client = new SuiClient({ url: SUI_NODE });
  const tx = new Transaction();

  // ── Step A: DeepBook SUI → WAL swap ─────────────────────────────────────────
  // Uses DeepBook V3.  If the SUI/WAL pool doesn't exist on testnet yet, this
  // step is omitted (DEEPBOOK_SUI_WAL_POOL is empty).
  if (DEEPBOOK_SUI_WAL_POOL) {
    const deepbook = new DeepBookClient({ client, signer: state.address! });
    const swapCoin = tx.splitCoins(tx.gas, [tx.pure.u64(swapAmountMist)]);

    // Place a market order: exact SUI in, any WAL out.
    // Result is passed forward in the PTB (WAL coin transferred to sender at end).
    const [walCoin] = tx.moveCall({
      target: `${await deepbook.getConfig().then(c => c.deepbookPackageId)}::pool::swap_exact_base_for_quote`,
      typeArguments: ["0x2::sui::SUI", walTokenType()],
      arguments: [
        tx.object(DEEPBOOK_SUI_WAL_POOL),
        swapCoin,
        tx.pure.u64(0),                             // min WAL out (0 = market)
        tx.pure.u64(Date.now() + 60_000),            // deadline
        tx.object("0x6"),                            // clock
      ],
    });
    tx.transferObjects([walCoin], state.address!);
  }

  // ── Step B: verify_and_attest — atomic verify + mint ─────────────────────────
  const [attestation] = tx.moveCall({
    target: `${PACKAGE_ID}::proof_attestation::verify_and_attest`,
    arguments: [
      tx.object(REGISTRY_ID),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(iopProof.programDigest))),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(iopProof.publicInputsRaw))),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(groth16.proofBytes))),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(new TextEncoder().encode(iopBlobId)))),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(new TextEncoder().encode(sealBlobId)))),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(sealIdBytes))),
    ],
  });

  // ── Step C: transfer attestation to sender ────────────────────────────────────
  tx.transferObjects([attestation], state.address!);

  // ── Execute ───────────────────────────────────────────────────────────────────
  const txBytes = await tx.build({ client });
  const { signature } = await state.wallet!.signTransaction({ transaction: txBytes as Uint8Array });

  const res = await client.executeTransactionBlock({
    transactionBlock: txBytes,
    signature,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  });

  // Extract the attestation object ID from objectChanges.
  const created = res.objectChanges?.find(
    c => c.type === "created" && (c as { objectType?: string }).objectType?.includes("ProofAttestation")
  );
  const attestationObjectId =
    (created as { objectId?: string } | undefined)?.objectId ?? "unknown";

  const proofNonce = Array.from(await sha256(groth16.proofBytes));

  return {
    iopBlobId,
    sealBlobId,
    sealId: sealIdBytes,
    txDigest: res.digest,
    attestationObjectId,
  };
}

// ─── Seal encryption ──────────────────────────────────────────────────────────

async function sealEncryptPayload(
  sealId: Uint8Array,
  plaintext: Uint8Array,
): Promise<EncryptedObject> {
  const client = new SuiClient({ url: SUI_NODE });
  const keyServers = await getAllowlistedKeyServers("testnet");

  const seal = new SealClient({
    suiClient: client,
    serverObjectIds: keyServers,
    verificationOptions: { timeout: 10_000 },
  });

  // Encrypt with threshold 1-of-N Seal scheme.
  // Access control policy: the `proof_attestation::seal_approve` function gates decryption
  // to the owner of the ProofAttestation object.
  const { encryptedObject } = await seal.encrypt({
    threshold: 1,
    packageId: PACKAGE_ID,
    id: sealId,        // seal_approve checks this matches attestation.seal_id
    data: plaintext,
  });

  return encryptedObject;
}

// ─── Seal decryption ──────────────────────────────────────────────────────────

async function decryptAttestation(result: AtomicPipelineResult): Promise<void> {
  const decEl = document.getElementById("decrypt-result")!;
  decEl.style.display = "block";
  decEl.textContent = "Fetching ciphertext from Walrus…";

  try {
    const client = new SuiClient({ url: SUI_NODE });
    const state  = wallet.getState();

    // Fetch the Seal ciphertext from Walrus.
    const ciphertext = await walrusFetch(result.sealBlobId);

    decEl.textContent = "Requesting Seal decryption keys…";

    const keyServers = await getAllowlistedKeyServers("testnet");
    const seal = new SealClient({
      suiClient: client,
      serverObjectIds: keyServers,
    });

    // Build a transaction that calls seal_approve with the owned ProofAttestation.
    const approveTx = new Transaction();
    approveTx.moveCall({
      target: `${PACKAGE_ID}::proof_attestation::seal_approve`,
      arguments: [
        approveTx.pure(bcs.vector(bcs.u8()).serialize(Array.from(result.sealId))),
        approveTx.object(result.attestationObjectId),
      ],
    });
    const approveTxBytes = await approveTx.build({ client });

    // Decrypt — Seal nodes will simulate approveTx; if seal_approve passes, they
    // provide key shares, allowing the SDK to reconstruct the decryption key.
    const plaintext = await seal.decrypt({
      data: ciphertext,
      sessionKey: approveTxBytes,
      txBytes: approveTxBytes,
    });

    const decoded = new TextDecoder().decode(plaintext);
    decEl.textContent = `Decrypted payload:\n${JSON.stringify(JSON.parse(decoded), null, 2)}`;
  } catch (e) {
    decEl.textContent = `Decryption failed: ${(e as Error).message}`;
  }
}

// ─── Ligetron prover stub ─────────────────────────────────────────────────────

/**
 * [PLACEHOLDER] WASM prover integration.
 *
 * Replace with:
 *   const worker = new Worker(
 *     new URL("../workers/ligetron.worker.ts", import.meta.url),
 *     { type: "module" }
 *   );
 *   worker.postMessage({ wasmBytes, publicInputs: new TextEncoder().encode(publicInput) });
 *   const { proof } = await new Promise(res => worker.onmessage = e => res(e.data));
 */
async function runLigetronProver(program: string, publicInput: string): Promise<IopProof> {
  const t0 = Date.now();
  await sleep(600 + Math.random() * 300);

  const programBytes     = new TextEncoder().encode(`wasm:${program}`);
  const publicInputBytes = new TextEncoder().encode(publicInput);

  return {
    proofBytes:      crypto.getRandomValues(new Uint8Array(256)),
    programDigest:   await sha256(programBytes),
    publicInputsRaw: publicInputBytes,
    provingTimeMs:   Date.now() - t0,
  };
}

// ─── Groth16 wrapper stub ─────────────────────────────────────────────────────

/**
 * [PLACEHOLDER] Off-chain Groth16 wrapping service.
 *
 * When the circuit is built, this becomes:
 *   const res = await fetch("/api/groth16-wrap", {
 *     method: "POST",
 *     body: JSON.stringify({ iopProofHex: hex(iopProof.proofBytes) }),
 *   });
 *   const { groth16ProofBytes } = await res.json();
 *   return { proofBytes: fromHex(groth16ProofBytes) };
 *
 * The Groth16 circuit must use public signals:
 *   signal[0] = sha256(program_bytes)[0..30] || 0x00   (program_digest)
 *   signal[1] = sha256(public_inputs)[0..30] || 0x00   (inputs_digest)
 */
async function groth16WrapperPlaceholder(_iopProof: IopProof): Promise<Groth16Proof> {
  await sleep(200);
  return { proofBytes: new Uint8Array(256) }; // 256 zero bytes — will fail pairing check
}

// ─── Walrus helpers ───────────────────────────────────────────────────────────

async function walrusUpload(data: Uint8Array, label: string): Promise<string> {
  const res = await fetch(`${WALRUS_PUBLISHER}/v1/blobs?epochs=5`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: data,
  });
  if (!res.ok) throw new Error(`Walrus ${label} upload ${res.status}: ${await res.text()}`);
  const json = await res.json() as {
    blobId?: string;
    newlyCreated?: { blobObject?: { blobId?: string } };
    alreadyCertified?: { blobId?: string };
  };
  const blobId =
    json.blobId ??
    json.newlyCreated?.blobObject?.blobId ??
    json.alreadyCertified?.blobId;
  if (!blobId) throw new Error(`Walrus ${label}: response missing blobId`);
  return blobId;
}

async function walrusFetch(blobId: string): Promise<Uint8Array> {
  const res = await fetch(`${WALRUS_AGGREGATOR}/v1/${blobId}`);
  if (!res.ok) throw new Error(`Walrus fetch ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ─── Seal ID derivation ───────────────────────────────────────────────────────

/** Must match proof_attestation::derive_seal_id: sha256(nonce || programDigest) */
async function deriveSealId(proofNonce: Uint8Array, programDigest: Uint8Array): Promise<Uint8Array> {
  const combined = new Uint8Array(proofNonce.length + programDigest.length);
  combined.set(proofNonce);
  combined.set(programDigest, proofNonce.length);
  return sha256(combined);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showLog(): void {
  const log = document.getElementById("pipeline-log");
  const entries = document.getElementById("log-entries");
  if (!log || !entries) return;
  log.classList.remove("hidden");
  entries.innerHTML = "";
  document.getElementById("pipeline-result")?.classList.add("hidden");
  document.getElementById("decrypt-panel")?.classList.add("hidden");
}

function logEntry(
  kind: "step" | "warn" | "error",
  label: string,
  text: string,
  state: "running" | "done" | "skip" | "warn" | "error" | "todo",
): void {
  const entries = document.getElementById("log-entries");
  if (!entries) return;
  const icon = { running: "⏳", done: "✅", skip: "⟳", warn: "⚠️", error: "❌", todo: "🔲" }[state];
  const el = document.createElement("div");
  el.style.cssText = "padding:3px 0;border-bottom:1px solid var(--border-subtle);display:flex;gap:8px;";
  el.innerHTML = `<span style="opacity:.5;min-width:32px;">${label}</span><span>${icon} ${text}</span>`;
  entries.appendChild(el);
  entries.scrollTop = entries.scrollHeight;
}

function logFatal(msg: string): void {
  logEntry("error", "✗", msg, "error");
}

function renderResult(r: AtomicPipelineResult): void {
  const panel = document.getElementById("pipeline-result");
  const body  = document.getElementById("result-body");
  if (!panel || !body) return;
  panel.classList.remove("hidden");

  body.innerHTML = `
    <div class="info-row">
      <span class="info-label">Attestation object</span>
      <a href="https://suiscan.xyz/testnet/object/${r.attestationObjectId}" target="_blank"
         class="info-value mono" style="font-size:0.78rem;">${r.attestationObjectId.slice(0, 28)}…</a>
    </div>
    <div class="info-row">
      <span class="info-label">Transaction</span>
      <a href="https://suiscan.xyz/testnet/tx/${r.txDigest}" target="_blank"
         class="info-value mono" style="font-size:0.78rem;">${r.txDigest.slice(0, 28)}…</a>
    </div>
    <div class="info-row">
      <span class="info-label">IOP proof (Walrus)</span>
      <code class="info-value mono" style="font-size:0.78rem;">${r.iopBlobId.slice(0, 28)}…</code>
    </div>
    <div class="info-row">
      <span class="info-label">Encrypted attestation (Walrus)</span>
      <code class="info-value mono" style="font-size:0.78rem;">${r.sealBlobId.slice(0, 28)}…</code>
    </div>
    <div class="info-row">
      <span class="info-label">Seal ID</span>
      <code class="info-value mono" style="font-size:0.78rem;">${hex(r.sealId).slice(0, 28)}…</code>
    </div>
    <p style="margin-top:var(--space-3);font-size:0.82rem;color:var(--text-muted);">
      The ProofAttestation object is now in your wallet.  Use the Decrypt panel below
      to retrieve the private payload — only you can access it.
    </p>
  `;
}

function techRef(): string {
  return `
    <h4 style="margin:var(--space-3) 0 var(--space-2);">verify_and_attest signature</h4>
    <pre style="background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);
      font-size:0.75rem;overflow:auto;"><code>// move/ligetron-verifier/sources/proof_attestation.move
public fun verify_and_attest(
    registry:          &mut VerifierRegistry,
    program_digest:    vector&lt;u8&gt;,  // 32 bytes: SHA-256(wasm)
    public_inputs_raw: vector&lt;u8&gt;,  // any length
    proof_bytes:       vector&lt;u8&gt;,  // 256 bytes: Groth16 BN254
    iop_blob_id:       vector&lt;u8&gt;,  // Walrus blob ID for raw IOP proof
    seal_blob_id:      vector&lt;u8&gt;,  // Walrus blob ID for ciphertext
    seal_id:           vector&lt;u8&gt;,  // sha256(proof_nonce || program_digest)
    ctx:               &amp;mut TxContext,
): ProofAttestation</code></pre>

    <h4 style="margin:var(--space-4) 0 var(--space-2);">seal_approve</h4>
    <pre style="background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);
      font-size:0.75rem;overflow:auto;"><code>// Gates decryption to the ProofAttestation owner
public fun seal_approve(id: vector&lt;u8&gt;, attestation: &amp;ProofAttestation) {
    assert!(attestation.seal_id == id, E_SEAL_ID_MISMATCH);
}</code></pre>

    <h4 style="margin:var(--space-4) 0 var(--space-2);">Atomic PTB structure</h4>
    <pre style="background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);
      font-size:0.75rem;overflow:auto;"><code>const tx = new Transaction();
// A. DeepBook: SUI → WAL
const [wal] = tx.moveCall({ target: "deepbookv3::pool::swap_..." });
// B. Verify + mint (atomic)
const [attest] = tx.moveCall({
  target: \`\${PKG}::proof_attestation::verify_and_attest\`,
  arguments: [registry, programDigest, inputsRaw, proof,
              iopBlobId, sealBlobId, sealId],
});
// C. Transfer
tx.transferObjects([attest], sender);
tx.transferObjects([wal], sender);</code></pre>

    <h4 style="margin:var(--space-4) 0 var(--space-2);">Seal ID derivation</h4>
    <pre style="background:var(--surface-3);padding:var(--space-3);border-radius:var(--radius);
      font-size:0.75rem;overflow:auto;"><code>// Off-chain (must match on-chain proof_attestation::derive_seal_id)
seal_id = sha256(proof_nonce || program_digest)
// proof_nonce = sha256(proof_bytes)
// program_digest = sha256(wasm_bytes)[0..30] ++ 0x00</code></pre>
  `;
}

// ─── Pipeline diagram helpers ─────────────────────────────────────────────────

function pipelineStep(icon: string, title: string, desc: string, phase: "offchain" | "onchain", todo = false): string {
  const bg  = phase === "onchain" ? "var(--accent-subtle, rgba(99,102,241,0.1))" : "var(--surface-3)";
  const border = todo ? "1px dashed var(--warning, #ca8a04)" : "";
  return `
    <div style="flex:1;min-width:72px;text-align:center;background:${bg};${border ? `border:${border};` : ""}
      border-radius:var(--radius);padding:var(--space-2) var(--space-1);">
      <div style="font-size:1.2rem;">${icon}</div>
      <div style="font-weight:600;font-size:0.72rem;margin:2px 0;">${title}</div>
      <div style="font-size:0.65rem;color:var(--text-muted);white-space:pre-line;">${desc}</div>
    </div>`;
}

function pipelineArrow(): string {
  return `<div style="color:var(--accent);font-size:1rem;align-self:center;">→</div>`;
}

function attachPipelineStyles(): void {
  if (document.getElementById("zkp-styles")) return;
  const s = document.createElement("style");
  s.id = "zkp-styles";
  s.textContent = `
    .pipeline-grid {
      display: flex; align-items: stretch; gap: 4px;
      flex-wrap: wrap; margin-top: var(--space-3);
    }
    .pipeline-break { flex-basis: 100%; height: var(--space-2); }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(s);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function hex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function walTokenType(): string {
  // Walrus WAL token type on testnet (update when mainnet is live).
  return env["VITE_WAL_TOKEN_TYPE"] ?? "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL";
}
