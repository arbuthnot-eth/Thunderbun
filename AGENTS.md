# AGENTS.md — ThunderBun AI Agent Guide

This file describes the codebase for AI coding agents (Claude, Codex, Cursor, etc.).
Read this before making any edits. It covers architecture, key design decisions,
extension patterns, and how to complete the major open TODOs.

---

## Project overview

**ThunderBun** is a Sui-native app framework + template suite. It forks Electrobun
(a Bun-based desktop app framework) and adds a `sui-twa` template — a vanilla
TypeScript PWA/TWA wired to the Sui ecosystem with an on-chain ZK proof pipeline.

The headline feature is an **atomic ZK proof lifecycle**:

```
[Browser]              [Off-chain]                [Sui on-chain, one PTB]
Ligetron WASM prover → Groth16 wrapper* → Walrus → DeepBook + verify_and_attest → ProofAttestation
                                                   Seal encrypt ↗
* circuit not yet built — see TODO #1
```

---

## Repository layout

```
Thunderbun/
├── AGENTS.md                          ← you are here
├── CLAUDE.md                          ← build/run instructions (Electrobun legacy)
├── README.md                          ← user-facing project overview
├── package/                           ← ThunderBun CLI + framework source (Bun/TS)
│   ├── src/cli/index.ts               ← CLI: `npx thunderbun init --template sui-twa`
│   └── build.ts                       ← embeds templates into the CLI binary
├── templates/
│   └── sui-twa/                       ← THE MAIN TEMPLATE (vanilla TS PWA/TWA)
│       ├── package.json               ← @mysten/* deps, deepbook-v3, seal, vite
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.ts                ← navigation, section registry
│           ├── wallet.ts              ← WaaP + wallet-standard connection
│           ├── style.css              ← vanilla CSS design tokens
│           ├── lib/
│           │   └── zkproof-pipeline.ts ← ★ composable pipeline logic
│           └── sections/
│               ├── home.ts
│               ├── suins.ts           ← SuiNS name resolution
│               ├── walrus.ts          ← Walrus upload/download demo
│               ├── deepbook.ts        ← DeepBook pool query demo
│               ├── seal.ts            ← Seal AES-GCM demo
│               ├── nft.ts             ← TradePort NFT fetch
│               ├── settings.ts        ← network, MVR, Ika, Nautilus info
│               └── zkproof.ts         ← ZK proof UI (thin wrapper over lib/)
└── move/
    └── ligetron-verifier/             ← ★ Sui Move smart contract package
        ├── Move.toml
        └── sources/
            ├── ligetron_verifier.move  ← Groth16 verifier + VK registry + replay protection
            ├── merkle.move             ← SHA-256 Merkle path verifier (IOP defense-in-depth)
            └── proof_attestation.move  ← ProofAttestation object + seal_approve gate
```

---

## Key design decisions

### 1. No React, no dapp-kit — vanilla TypeScript
All sections use `document.createElement` / innerHTML.  No framework overhead.
The wallet connects via `@mysten/wallet-standard` (WaaP or browser extension).
When editing sections, maintain this pattern.

### 2. Pipeline library pattern
`src/lib/zkproof-pipeline.ts` exports individual async step functions AND a
`runPipeline()` orchestrator.  The section file (`zkproof.ts`) is a thin UI
wrapper.  If you add a new protocol integration:
- Add the step function to `zkproof-pipeline.ts` with its own config type
- Add the config key to `ZkProofConfig`
- Add the preset configs (FULL_CONFIG, DEV_CONFIG)
- Add a toggle to the `zkproof.ts` UI

### 3. Move package is in-repo
`move/ligetron-verifier/` is a publishable Sui Move package.  Tests use
`sui move test`.  The three modules have clear responsibilities:
- `ligetron_verifier` — verification only (no objects minted)
- `merkle`           — IOP-level cryptographic checks (independent)
- `proof_attestation` — composes verifier + mints the Sui object + Seal gate

### 4. Groth16 compression (not direct IOP verification)
Ligetron's verifier re-executes the WASM program — infeasible on-chain.
The pattern: Ligetron IOP → off-chain Groth16 circuit → 256-byte proof → `sui::groth16`.
This is the same pattern as the SP1 Sui verifier.

### 5. Atomic PTB composition
All on-chain steps (DeepBook swap, proof verify, object mint) run in one PTB.
If any step fails, the entire transaction reverts — including the token swap.

---

## Environment variables

Create `templates/sui-twa/.env` to configure the deployed contract:

```env
# Required — from `sui client publish` in move/ligetron-verifier/
VITE_LIGETRON_PACKAGE_ID=0x...
VITE_LIGETRON_REGISTRY_ID=0x...

# Optional — DeepBook SUI/WAL pool for the atomic swap
VITE_DEEPBOOK_SUI_WAL_POOL=0x...
VITE_DEEPBOOK_PACKAGE_ID=0x...
VITE_WAL_TOKEN_TYPE=0x...::wal::WAL
```

---

## Common tasks for AI agents

### Deploy the Move contract

```bash
cd move/ligetron-verifier
sui move build          # must pass before publishing
sui move test           # 23 tests, all should pass
sui client publish --gas-budget 100000000
# → copy Package ID and VerifierRegistry object ID to .env
```

### Register a program VK (after deploying)

```bash
# program_digest: sha256(wasm_bytes), hex-encoded, 32 bytes
# vk_bytes:       Arkworks BN254 Groth16 VK from trusted setup
sui client call \
  --package $PACKAGE_ID \
  --module ligetron_verifier \
  --function register_program \
  --args $ADMIN_CAP_ID $REGISTRY_ID \
    "0x<program_digest_32_bytes>" \
    "0x<vk_bytes>" \
    "my-program-v1.0" \
  --gas-budget 10000000
```

### Add a new template section

1. Create `templates/sui-twa/src/sections/mysection.ts`
   - Export `renderMySection(container: HTMLElement): void`
   - Follow the `innerHTML` + `attachHandlers` pattern from other sections

2. Register in `templates/sui-twa/src/main.ts`:
   ```typescript
   import { renderMySection } from "./sections/mysection";
   // Add to SectionId union type
   // Add to NAV array
   // Add to RENDERERS record
   ```

### Add a new pipeline step

1. Define config type in `zkproof-pipeline.ts`:
   ```typescript
   export interface MyStepConfig { enabled: boolean; /* ... */ }
   ```

2. Add to `ZkProofConfig`:
   ```typescript
   myStep: MyStepConfig;
   ```

3. Write the step function:
   ```typescript
   export async function runMyStep(args: ..., cfg: MyStepConfig): Promise<MyStepResult> { ... }
   ```

4. Insert into `runPipeline()` and update `FULL_CONFIG` / `DEV_CONFIG`.

5. Add a toggle to the `zkproof.ts` UI using `optionToggle()`.

### Run the dev server

```bash
cd templates/sui-twa
bun install       # or npm install
bun run dev       # Vite dev server → http://localhost:5173
```

### Scaffold a new app from the template

```bash
npx thunderbun init --template sui-twa my-app
cd my-app
bun install
bun run dev
```

---

## Open TODOs (in priority order)

### TODO #1 — Groth16 wrapping circuit ⚠ CRITICAL

**What**: A Groth16 circuit over BN254 that takes a Ligetron IOP proof as its
private witness and exposes two public signals:
- `signal[0]` = `sha256(wasm_bytes)[0..30] ++ 0x00`  (program_digest)
- `signal[1]` = `sha256(public_inputs)[0..30] ++ 0x00` (inputs_digest)

**Where to start**:
- Reference: the SP1 Groth16 wrapper (Succinct Labs)
- The Ligetron verifier algorithm is in `include/zkp/nonbatch_context.hpp`
- Circuits typically written in circom, gnark, or bellman

**Integration point**: `zkproof-pipeline.ts` → `wrapGroth16()` → switch
`groth16.mode` from `"stub"` to `"service"` and set `groth16.serviceUrl`.

**On-chain**: No Move changes needed — `ligetron_verifier.move` already
accepts any 256-byte Arkworks BN254 proof.

### TODO #2 — Ligetron WASM prover integration

**What**: Build `ligeroinc/ligero-prover` to WASM using Emscripten and
integrate it as a Web Worker in the template.

**Steps**:
```bash
git clone https://github.com/ligeroinc/ligero-prover
cd ligero-prover
emcmake cmake -DCMAKE_BUILD_TYPE=Release .
emmake make ligetron_wasm
# Copy ligetron.{js,wasm} → templates/sui-twa/public/wasm/ligetron/
```

**Create**: `templates/sui-twa/src/workers/ligetron.worker.ts`:
```typescript
import init, { LigetronProver } from "/wasm/ligetron/ligetron.js";

self.onmessage = async ({ data }) => {
  await init();
  const prover = new LigetronProver(data.wasmBytes);
  const proof  = prover.prove(data.publicInputs);
  self.postMessage({
    proofBytes:      proof.iop_bytes(),
    programDigest:   proof.program_digest(),
    publicInputsRaw: data.publicInputs,
  });
};
```

**Integration point**: `zkproof-pipeline.ts` → `proveWasmReal()` — replace
the `throw` with a Web Worker invocation.

### TODO #3 — DeepBook SUI/WAL pool ID

The DeepBook SUI/WAL pool may not be live on testnet yet.  When it is:
1. Set `VITE_DEEPBOOK_SUI_WAL_POOL` in `.env`
2. Set `VITE_DEEPBOOK_PACKAGE_ID` to the DeepBook v3 package
3. Enable the DeepBook toggle in the UI
4. The `executeOnChain()` function in `zkproof-pipeline.ts` already handles it

### TODO #4 — Groth16 service endpoint

When the circuit (TODO #1) is built, deploy a proving service and set:
- `VITE_GROTH16_SERVICE_URL=https://your-service/groth16-wrap`
- Change `groth16.mode` from `"stub"` to `"service"` in `buildConfig()`

### TODO #5 — Mainnet deployment

The current config targets Sui testnet. For mainnet:
1. Update `MAINNET_NETWORK` in `zkproof-pipeline.ts` (already defined)
2. Change `walrus` publisher/aggregator URLs to mainnet endpoints
3. Use `getAllowlistedKeyServers("mainnet")` for Seal
4. Re-run `sui client publish` against mainnet

---

## Move contract reference

### Error codes

| Module | Code | Constant | Meaning |
|--------|------|----------|---------|
| ligetron_verifier | 0 | E_INVALID_PROOF_LEN | proof_bytes ≠ 256 bytes |
| ligetron_verifier | 2 | E_PROGRAM_NOT_REGISTERED | no VK for program_digest |
| ligetron_verifier | 3 | E_PROOF_ALREADY_USED | replay — nonce seen before |
| ligetron_verifier | 4 | E_INVALID_DIGEST_LEN | digest ≠ 32 bytes |
| ligetron_verifier | 5 | E_PROOF_VERIFICATION_FAILED | Groth16 pairing check failed |
| ligetron_verifier | 6 | E_PROGRAM_ALREADY_EXISTS | duplicate register_program |
| ligetron_verifier | 7 | E_EMPTY_VK | vk_bytes is empty |
| merkle | 5 | E_ROOT_MISMATCH | Merkle path invalid |
| proof_attestation | 3 | E_SEAL_ID_MISMATCH | seal_id mismatch in seal_approve |

### Shared object IDs

The `VerifierRegistry` is a **shared object** — anyone can call `verify_proof`.
The `AdminCap` is **owned** — only the holder can register/revoke programs.

### Proof nonce scheme

`proof_nonce = SHA-256(proof_bytes)` — unique per proof submission.
`seal_id     = SHA-256(proof_nonce || program_digest)` — ties Seal blob to proof.

---

## Coding conventions

- **No React, no class components** — vanilla TS functions only
- **No Tailwind** — vanilla CSS with `var(--space-N)`, `var(--accent)` design tokens
- **Move 2024.beta edition** — use method syntax (`v.length()`, `v.borrow(i)`)
- **Move errors** — use named integer constants (e.g., `E_PROOF_ALREADY_USED`)
- **No comments narrating what the code does** — only explain non-obvious intent
- **Move modules** — one clear responsibility per module; cross-module calls OK within package
- **TypeScript** — prefer explicit return types on exported functions
- **Pipeline functions** — always accept a config object; never hardcode URLs or IDs

---

## Testing

### Move tests
```bash
cd move/ligetron-verifier
sui move test           # 23 unit tests
```

End-to-end tests (Groth16 required) live in `templates/sui-twa/src/` and run
against a local Sui node with the package deployed.

### TypeScript (Vite preview)
```bash
cd templates/sui-twa
bun run build && bun run preview
```

---

## Architecture diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER (PWA)                            │
│                                                                   │
│  wallet.ts ──→ WaaP SDK / wallet-standard                        │
│                                                                   │
│  zkproof.ts (UI) ──→ lib/zkproof-pipeline.ts (logic)            │
│                           │                                       │
│       ┌───────────────────┼───────────────────────┐              │
│       ▼                   ▼                       ▼              │
│  Ligetron WASM      Walrus PUT              Seal SDK             │
│  (Web Worker)       (blob IDs)             (encrypt)            │
│       │                   │                       │              │
│       └────────┬──────────┘                       │              │
│                ▼                                   │              │
│          Groth16 wrapper service                   │              │
│          (TODO #1)                                 │              │
│                │                                   │              │
└────────────────┼───────────────────────────────────┼─────────────┘
                 │                 Sui PTB            │
                 ▼                                    ▼
     ┌───────────────────────────────────────────────────────┐
     │  DeepBook::swap()  +  proof_attestation::verify_and_attest()  │
     │                                                               │
     │  move/ligetron-verifier/sources/                             │
     │    ligetron_verifier.move  (Groth16 + VK registry)           │
     │    proof_attestation.move  (ProofAttestation object)         │
     │    merkle.move             (IOP Merkle checker)              │
     └───────────────────────────────────────────────────────┘
                                  │
                                  ▼
                       ProofAttestation (Sui owned object)
                       ├── program_digest
                       ├── inputs_digest
                       ├── proof_nonce
                       ├── iop_blob_id    → Walrus (raw IOP proof)
                       ├── seal_blob_id   → Walrus (Seal ciphertext)
                       └── seal_id        → Seal decryption gate
```
