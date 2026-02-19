# AGENTS.md — ThunderBun AI Agent Guide

Read this before making edits. Covers architecture, design decisions, extension patterns, and open TODOs.

---

## Project overview

**ThunderBun** is a cross-platform desktop app framework built on Bun. It ships native webview wrappers (CEF or system WebKit/WebView2), a Bun runtime, embedded templates, and a CLI to scaffold and build apps.

The `sui-twa` template is a Sui-native PWA/TWA wired to the Mysten ecosystem with gRPC transport, Cloudflare Workers backend, and an on-chain ZK proof pipeline.

---

## Repository layout

```
Thunderbun/
├── AGENTS.md                          ← you are here
├── CLAUDE.md                          ← build/run instructions for AI agents
├── README.md                          ← user-facing project overview
├── docs/                              ← internal documentation
│   ├── BUILD.md                       ← build system + cross-platform compilation
│   ├── CEF.md                         ← CEF version management + caching
│   └── BETA_RELEASE.md               ← beta release workflow
├── package/                           ← ThunderBun framework + CLI
│   ├── build.ts                       ← build orchestrator (vendors Bun, Zig, CEF)
│   ├── src/
│   │   ├── cli/index.ts               ← CLI: init, build, dev commands
│   │   ├── cli/templates/embedded.ts  ← templates embedded into CLI binary
│   │   ├── bun/                       ← Bun-side runtime API (BrowserWindow, Tray, Updater, menus)
│   │   ├── browser/                   ← Browser-side API (RPC transport, webview tags)
│   │   ├── native/                    ← C++ native wrappers (macOS, Windows, Linux)
│   │   ├── extractor/                 ← Self-extracting installer (Zig)
│   │   ├── launcher/                  ← App startup + ASAR loading
│   │   ├── shared/                    ← Cross-platform utils (RPC, naming, platform detection)
│   │   └── npmbin/                    ← npm bin shim
│   └── scripts/
├── kitchen/                           ← Kitchen Sink test app
├── templates/
│   ├── hello-world/
│   ├── react-tailwind-vite/
│   ├── svelte/
│   ├── photo-booth/
│   ├── multitab-browser/
│   └── sui-twa/                       ← Sui TWA template (see below)
├── move/
│   └── ligetron-verifier/             ← Sui Move: Groth16 verifier + attestation
└── contracts/
    └── proof-verifier/                ← Sui Move: general Groth16 framework (BN254/BLS12-381)
```

---

## Framework architecture

### CLI (`package/src/cli/`)

~4,100 lines. Commands: `init`, `build`, `dev`.

- **init** — Scaffolds from embedded templates (interactive or `thunderbun init sui-twa`)
- **build** — Cross-platform compilation: config loading, platform detection, binary downloading (CEF, Bun, native wrappers), app bundling (ASAR), icon embedding, installers (DMG/EXE/AppImage), codesigning
- **dev** — Builds locally and launches without packaging

### Runtime API (`package/src/bun/`)

Desktop app API surface:

- `BrowserWindow` — Window creation/management, renderer choice (native WebKit or CEF), title bar, transparency, sandbox
- `BrowserView` — Embedded web views
- `Tray` — System tray
- `ApplicationMenu` / `ContextMenu` — Native menus
- `Updater` — Delta patching, version checking, progress tracking
- `Utils` — Message boxes, notifications, quit
- Type-safe RPC between Bun process and webviews (AES-GCM encrypted WebSocket)

### Browser API (`package/src/browser/`)

Available inside webviews: `Thunderview` class with WebSocket RPC to Bun process, per-webview encryption, `<webview>` tag support.

### Native wrappers (`package/src/native/`)

C++ per platform (~300-400KB each):
- **macOS** — Cocoa + WebKit, weak-linked CEF
- **Windows** — Win32 + WebView2, delay-loaded CEF
- **Linux** — GTK + WebKitGTK, dual-binary approach (with/without CEF via dlopen)

### Self-extractor (`package/src/extractor/`)

Zig implementation — creates self-extracting Windows installer EXE with embedded tar.zst payload.

---

## Sui TWA template (`templates/sui-twa/`)

### Source layout

```
src/
├── main.ts              ← App class, section-based navigation, nav groups
├── worker.ts            ← Cloudflare Worker (Hono): agents, gas station, x402, static assets
├── wallet.ts            ← WalletManager: WaaP + dApp Kit + extensions, sponsored tx
├── dapp-kit.ts          ← SuiGrpcClient config, MVR, auto-connect
├── sui-client.ts        ← Lazy singletons for Seal/DeepBook/Walrus, auto-invalidate on network switch
├── init-waap.ts         ← WaaP Wallet Standard registration (must import first)
├── agents/
│   └── ProofAgent.ts    ← Durable Object: SQLite storage, WebSocket state sync, @callable RPC
├── sections/
│   ├── home.ts          ← Wallet connection dashboard
│   ├── settings.ts      ← Network switcher, ecosystem overview (MVR, Ika, Nautilus, Passkeys)
│   ├── passkeys.ts      ← WebAuthn registration/auth, cross-subdomain RP ID
│   ├── suins.ts         ← SuiNS forward/reverse lookup, name records, pricing
│   ├── deepbook.ts      ← SUI/USDC pool stats, order book, limit order form
│   ├── walrus.ts        ← Blob store (HTTP publisher) + retrieve (SDK or HTTP aggregator)
│   ├── seal.ts          ← Threshold encryption demo (testnet) + local AES-GCM fallback
│   ├── ika.ts           ← 2PC MPC / dWallets (dynamic import)
│   ├── nft.ts           ← NFT gallery (listOwnedObjects) + TradePort GraphQL search
│   └── zkproof.ts       ← On-chain Groth16 verifier UI, Ligetron pipeline (disabled)
└── lib/
    └── zkproof-pipeline.ts.disabled  ← Full end-to-end proving pipeline (awaiting SDK updates)
```

### Worker routes

```
/agents/*        → Durable Object routing (WebSocket + RPC)
/api/sponsor     → Gas station (opt-in, Ed25519 signing)
/api/paid/*      → x402 paywalled routes (scaffold)
/*               → Static PWA assets (Vite build)
```

### Transport

`SuiGrpcClient` from `@mysten/sui/grpc` — fully migrated off JSON-RPC. Public endpoints: `https://fullnode.{network}.sui.io:443`. MVR enabled (`mvr: {}`).

All Mysten ecosystem SDKs accept `ClientWithCoreApi` and work with gRPC:
- `@mysten/dapp-kit-core`, `@mysten/deepbook-v3`, `@mysten/seal`, `@mysten/walrus`, `@mysten/suins`

Third-party SDKs (`@human.tech/waap-sdk`, `@ika.xyz/sdk`) are isolated — WaaP is client-agnostic (Wallet Standard only), Ika bundles its own `@mysten/sui@1.x` via dynamic import.

---

## Move contracts

### `move/ligetron-verifier/` (edition 2024.beta)

| Module | Purpose |
|--------|---------|
| `ligetron_verifier` | Groth16 BN254 verification via `sui::groth16`, VK registry, replay protection (nonce = SHA-256(proof_bytes)) |
| `merkle` | SHA-256 binary Merkle tree verifier for Ligetron IOP column openings (8192 leaves, depth 13) |
| `proof_attestation` | Composes verifier + mints `ProofAttestation` owned object + Seal decryption gate |

Key entry functions:
- `verify_proof(registry, program_digest, public_inputs_raw, proof_bytes)` — verifies + records nonce
- `verify_and_attest(...)` — verifies + mints `ProofAttestation` with Walrus/Seal references
- `seal_approve(id, attestation)` — Seal threshold-decryption gate (ownership check)

Error codes:

| Module | Code | Constant | Meaning |
|--------|------|----------|---------|
| ligetron_verifier | 0 | E_INVALID_PROOF_LEN | proof_bytes != 256 bytes |
| ligetron_verifier | 2 | E_PROGRAM_NOT_REGISTERED | no VK for program_digest |
| ligetron_verifier | 3 | E_PROOF_ALREADY_USED | replay — nonce seen before |
| ligetron_verifier | 4 | E_INVALID_DIGEST_LEN | digest != 32 bytes |
| ligetron_verifier | 5 | E_PROOF_VERIFICATION_FAILED | Groth16 pairing check failed |
| ligetron_verifier | 6 | E_PROGRAM_ALREADY_EXISTS | duplicate register_program |
| ligetron_verifier | 7 | E_EMPTY_VK | vk_bytes is empty |
| merkle | 5 | E_ROOT_MISMATCH | Merkle path invalid |
| proof_attestation | 3 | E_SEAL_ID_MISMATCH | seal_id mismatch in seal_approve |

### `contracts/proof-verifier/` (edition 2024.beta)

General-purpose Groth16 verification framework supporting BN254 and BLS12-381 curves. Separate `VerificationKeyRegistry` with 4-component prepared VK storage. No replay protection (delegated to caller). Events for audit trail.

---

## Design decisions

1. **Vanilla TypeScript** — All sections use `document.createElement` / innerHTML. No UI framework (dApp Kit bundles React internally, but sections don't use it). When editing sections, maintain this pattern.

2. **Observable wallet state** — `WalletManager` uses subscriber pattern (`wallet.subscribe(listener)`). Sections auto-re-render on state changes.

3. **Network-aware singletons** — `sui-client.ts` provides lazy-loaded SDK clients that auto-invalidate on network switch. Seal is testnet-only. DeepBook mainnet+testnet. Walrus devnet returns null.

4. **Groth16 compression** — Ligetron IOP verification is infeasible on-chain. Pattern: Ligetron IOP → off-chain Groth16 circuit → 256-byte proof → `sui::groth16`.

5. **Atomic PTBs** — All on-chain steps (DeepBook swap, proof verify, object mint) in one PTB. Any failure reverts everything.

6. **Dual-renderer desktop** — CEF for production cross-platform, system WebKit/WebView2 for lightweight dev builds. Linux uses dual binaries (with/without CEF).

---

## Environment variables

### sui-twa template (`templates/sui-twa/.env`)

```env
# Required — from `sui client publish` in move/ligetron-verifier/
VITE_LIGETRON_PACKAGE_ID=0x...
VITE_LIGETRON_REGISTRY_ID=0x...

# Optional — DeepBook SUI/WAL pool for the atomic swap
VITE_DEEPBOOK_SUI_WAL_POOL=0x...
VITE_DEEPBOOK_PACKAGE_ID=0x...
VITE_WAL_TOKEN_TYPE=0x...::wal::WAL
```

### Worker secrets (Cloudflare)

```bash
wrangler secret put SPONSOR_PRIVATE_KEY   # Bech32 suiprivkey1q...
wrangler secret put MAX_GAS_BUDGET        # optional, default 50_000_000 (0.05 SUI)
```

---

## Common tasks

### Run the sui-twa dev server

```bash
cd templates/sui-twa
bun install
bun run dev       # Vite dev server → http://localhost:5173
```

### Build + run the desktop Kitchen Sink app

```bash
cd package
bun dev           # builds framework + CLI, then builds + runs kitchen app
```

### Deploy sui-twa to Cloudflare Workers

```bash
cd templates/sui-twa
bun run deploy    # builds + deploys Worker + static assets
```

### Deploy the Move contract

```bash
cd move/ligetron-verifier
sui move build
sui move test
sui client publish --gas-budget 100000000
# → copy Package ID and VerifierRegistry object ID to .env
```

### Add a new template section

1. Create `templates/sui-twa/src/sections/mysection.ts`
   - Export `renderMySection(container: HTMLElement): void`
   - Follow the `innerHTML` + `attachHandlers` pattern

2. Register in `templates/sui-twa/src/main.ts`:
   - Add to `SectionId` union type
   - Add to `NAV` array (with id, label, icon, group)
   - Add to `RENDERERS` record

### Scaffold a new app

```bash
npx thunderbun init
cd thunder
bun install
bun run dev
```

---

## Open TODOs

### TODO #1 — Groth16 wrapping circuit

Groth16 circuit over BN254 that takes a Ligetron IOP proof as private witness and exposes two public signals:
- `signal[0]` = `sha256(wasm_bytes)[0..30] ++ 0x00` (program_digest)
- `signal[1]` = `sha256(public_inputs)[0..30] ++ 0x00` (inputs_digest)

Reference: SP1 Groth16 wrapper (Succinct Labs). Integration point: `zkproof-pipeline.ts` → `wrapGroth16()`.

### TODO #2 — Ligetron WASM prover

Build `ligeroinc/ligero-prover` to WASM via Emscripten, integrate as Web Worker. Integration point: `zkproof-pipeline.ts` → `proveWasmReal()`.

### TODO #3 — DeepBook SUI/WAL pool

When live on testnet: set `VITE_DEEPBOOK_SUI_WAL_POOL` and `VITE_DEEPBOOK_PACKAGE_ID` in `.env`, enable toggle in UI.

### TODO #4 — Groth16 service endpoint

Deploy proving service, set `VITE_GROTH16_SERVICE_URL`, switch `groth16.mode` from `"stub"` to `"service"`.

### TODO #5 — Mainnet deployment

Update Walrus publisher/aggregator URLs, use `getAllowlistedKeyServers("mainnet")` for Seal, re-publish Move package.

---

## Coding conventions

- **Vanilla TS** — No React components, no class components. Sections use `innerHTML` + event handlers.
- **No Tailwind** — Vanilla CSS with `var(--space-N)`, `var(--accent)` design tokens.
- **Move 2024.beta** — Method syntax (`v.length()`, `v.borrow(i)`), named error constants.
- **No narration comments** — Only explain non-obvious intent.
- **Pipeline functions** — Accept config objects, never hardcode URLs or IDs.
- **Explicit return types** on exported TypeScript functions.

---

## Testing

```bash
# Move tests
cd move/ligetron-verifier
sui move test

# TypeScript (Vite build check)
cd templates/sui-twa
bun run build && bun run preview

# Desktop framework
cd package
bun run test:unit    # unit tests in src/shared
bun run test         # full integration (builds + runs test app)
```
