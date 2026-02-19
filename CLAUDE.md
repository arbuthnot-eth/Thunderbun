# Claude Development Guidelines for ThunderBun

## Project Structure

- `/package` — ThunderBun framework + CLI source
- `/kitchen` — Kitchen Sink desktop test app
- `/templates/` — App templates (hello-world, react-tailwind-vite, svelte, photo-booth, multitab-browser, sui-twa)
- `/move/ligetron-verifier` — Sui Move: Groth16 verifier + attestation contracts
- `/contracts/proof-verifier` — Sui Move: general-purpose Groth16 framework
- `/docs/` — Internal docs (BUILD.md, CEF.md, BETA_RELEASE.md)

## Building and Running

### Desktop framework (from `package/`)

**NEVER** run thunderbun directly from `bin/` or `node_modules/`.

```bash
cd package
bun dev              # Build framework + CLI, then build + run kitchen app (dev mode)
bun dev:canary       # Same but canary channel
bun build.ts         # Full build (all platforms)
bun build.ts --release  # Release build
bun run build:cli    # CLI binary only
bun run test:unit    # Unit tests (src/shared)
```

The build process vendors Bun, Zig, and CEF, compiles native wrappers, builds the CLI, then switches to the kitchen folder to build and run the test app.

### Sui TWA template (from `templates/sui-twa/`)

```bash
cd templates/sui-twa
bun install
bun run dev          # Vite dev server → localhost:5173
bun run build        # Production build
bun run deploy       # Cloudflare Workers deploy
bun run twa:init     # Bubblewrap wizard (Android)
bun run twa:build    # Android .aab for Play Store
```

### Move contracts

```bash
cd move/ligetron-verifier
sui move build
sui move test        # All tests should pass
sui client publish --gas-budget 100000000
```

## Sui RPC: gRPC Only

**JSON-RPC shuts down April 2026.** Do NOT write new code using JSON-RPC.

| Priority | Transport | When to use |
|----------|-----------|-------------|
| 1 | `SuiGrpcClient` from `@mysten/sui/grpc` | All new code. Public endpoints: `https://fullnode.{network}.sui.io:443` |
| 2 | `SuiGraphQLClient` from `@mysten/sui/graphql` | Complex queries needing GraphQL+Indexer |
| 3 | `SuiJsonRpcClient` from `@mysten/sui/jsonRpc` | DEPRECATED. Only when a third-party SDK requires it |

### Current state (sui-twa template)

- `dapp-kit.ts` uses `SuiGrpcClient` with MVR (`mvr: {}`). All Mysten SDKs (dapp-kit-core, deepbook-v3, seal, walrus, suins) accept `ClientWithCoreApi` — fully gRPC compatible.
- `@human.tech/waap-sdk` — client-agnostic (Wallet Standard only).
- `@ika.xyz/sdk` — bundles its own `@mysten/sui@1.45.2`, creates isolated JSON-RPC client via dynamic import. Pass clients via `as never` for type compatibility. Does not affect main app client.

## SDK Client Architecture (sui-twa)

- `src/sui-client.ts` provides lazy, network-aware singletons for SealClient, DeepBookClient, WalrusClient
- All clients auto-invalidate on network switch
- DeepBook uses `address: "0x0"` for read-only queries
- Seal key servers only configured for testnet — `getSealClient()` returns null on other networks
- Walrus SDK `writeBlob()` requires `Signer` keypair (not available in browser) — use HTTP publisher for writes, SDK for reads

## Coding Conventions

- **Vanilla TypeScript** in sui-twa sections — no React components, `innerHTML` + event handlers
- **No Tailwind** — vanilla CSS with design tokens
- **Move 2024.beta edition** — method syntax, named error constants
- **No narration comments** — only explain non-obvious intent
- **Explicit return types** on exported functions
- **Pipeline functions** accept config objects, never hardcode URLs or IDs
