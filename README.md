# ThunderBun ⚡

**Sui-native TWA framework — gRPC-first, Cloudflare Workers + Agents, Play Store in one scaffold.**

The first Sui dApp template built entirely on `SuiGrpcClient`. JSON-RPC shuts down April 2026 — ThunderBun is already migrated.

---

## JSON-RPC → gRPC Migration

Sui is deprecating JSON-RPC. ThunderBun ships with the full migration already done:

| Layer | Before (deprecated) | After (ThunderBun) |
|-------|--------------------|--------------------|
| **Client** | `SuiClient` / `SuiJsonRpcClient` | `SuiGrpcClient` from `@mysten/sui/grpc` |
| **Endpoint** | `getFullnodeUrl("testnet")` | `https://fullnode.testnet.sui.io:443` |
| **Name resolution** | MVR over JSON-RPC | MVR over gRPC (`mvr: {}`) |
| **Balance** | `res.totalBalance` | `res.balance.balance` |
| **Object listing** | `getOwnedObjects` + `showDisplay` | `listOwnedObjects` + `include: { json: true }` |
| **Object fields** | `o.data?.display?.data?.name` | `o.json?.name` |
| **SuiNS forward** | `resolveNameServiceAddress` | `SuinsClient.getNameRecord()` |
| **SuiNS reverse** | `resolveNameServiceNames` (paginated) | `defaultNameServiceName()` (single default) |
| **Transaction exec** | `executeTransactionBlock` | `executeTransaction` |

### How ThunderBun handles it

```ts
// src/dapp-kit.ts — the core client
import { SuiGrpcClient } from "@mysten/sui/grpc";

const client = new SuiGrpcClient({
  baseUrl: `https://fullnode.${network}.sui.io:443`,
  network,
  mvr: {},  // Move Registry name resolution
});
```

All Mysten ecosystem SDKs accept `ClientWithCoreApi` and work with gRPC out of the box:

- `@mysten/dapp-kit-core` — connect modal, wallet standard
- `@mysten/deepbook-v3` — order book queries
- `@mysten/seal` — threshold encryption
- `@mysten/walrus` — blob storage
- `@mysten/suins` — name service

### Migrating your existing dApp

1. Replace `SuiClient` → `SuiGrpcClient` (from `@mysten/sui/grpc`)
2. Replace `url:` → `baseUrl:` in constructor
3. Replace `getFullnodeUrl()` → `https://fullnode.${network}.sui.io:443`
4. Add `network` and `mvr: {}` to constructor options
5. Update response destructuring (`totalBalance` → `balance.balance`, etc.)
6. Replace `getOwnedObjects` → `listOwnedObjects` with `include: { json: true }`

### Third-party SDK compatibility

| SDK | Status | Notes |
|-----|--------|-------|
| `@human.tech/waap-sdk` | Works | Wallet Standard only — client-agnostic |
| `@ika.xyz/sdk` | Isolated | Bundles own `@mysten/sui@1.x`, uses dynamic import — does not touch main client |
| `@x402/core` + `@x402/hono` | Works | HTTP-level protocol, no Sui client dependency |

---

## Quick Start

```bash
npx thunderbun init

cd thunder
bun install
bun run dev       # Opens at localhost:5173
```

---

## What's Included

| Category | Feature | SDK / Tool |
|----------|---------|------------|
| **Transport** | gRPC + MVR name resolution | `@mysten/sui/grpc` |
| **Connect** | dApp Kit connect modal | `@mysten/dapp-kit-core` |
| **Wallet** | WaaP embedded wallet | `@human.tech/waap-sdk` |
| **Wallet** | Passkeys (WebAuthn, cross-subdomain) | `@mysten/sui/keypairs/passkey` |
| **Wallet** | Sponsored transactions (client + gas station) | `@mysten/sui` native |
| **Names** | SuiNS forward + reverse lookup | `@mysten/suins` |
| **Storage** | Walrus blob read/write | `@mysten/walrus` |
| **Trading** | DeepBook v3 order book queries | `@mysten/deepbook-v3` |
| **Encryption** | Seal threshold encryption | `@mysten/seal` |
| **MPC** | Ika 2PC / dWallets | `@ika.xyz/sdk` |
| **NFTs** | TradePort browsing | REST API |
| **Proofs** | ZK proof verifier | Groth16 / Ligetron |
| **Payments** | x402 scaffold (ready for `@x402/sui`) | `@x402/core` + `@x402/hono` |
| **Workers** | Hono router + static assets | `hono` + Cloudflare Workers |
| **Agents** | ProofAgent Durable Object | `agents` SDK |
| **PWA** | Service worker, offline-ready | `vite-plugin-pwa` |

---

## Cloudflare Workers + Agents

The Worker (`src/worker.ts`) is a Hono app that handles everything:

```
/agents/*        → Durable Object routing (WebSocket + RPC)
/api/sponsor     → Gas station (opt-in, Ed25519 signing)
/api/paid/*      → x402 paywalled routes (scaffold)
/*               → Static PWA assets (Vite build)
```

### Deploy

```bash
wrangler login             # one-time
bun run deploy             # builds + deploys Worker + static assets
```

### Gas Station (opt-in)

```bash
wrangler secret put SPONSOR_PRIVATE_KEY   # Bech32 suiprivkey1q...
wrangler secret put MAX_GAS_BUDGET        # optional, default 50_000_000 (0.05 SUI)
```

### ProofAgent

Each user gets a persistent Durable Object with SQLite storage, real-time WebSocket state sync, and `@callable` RPC methods:

```ts
// Browser
const agent = new AgentClient({ agent: "ProofAgent", name: suiAddress });
const { proofId } = await agent.call("recordProof", [{ programDigest, txDigest }]);
const history = await agent.call("getHistory", [{ limit: 20 }]);
```

---

## TWA → Play Store

```bash
bun run build
bun run deploy             # deploy to Cloudflare Workers

bun run twa:init           # bubblewrap wizard
bun run twa:build          # outputs app-release.aab
# Upload .aab to Google Play Console
```

**Prerequisites:** Java 17+ · `npm i -g @bubblewrap/cli`

---

## Project Layout

| Path | Purpose |
|------|---------|
| `src/dapp-kit.ts` | `SuiGrpcClient` instance with MVR — the core gRPC client |
| `src/worker.ts` | Hono router — agents, gas station, x402, static assets |
| `src/agents/ProofAgent.ts` | Durable Object with SQLite + WebSocket state sync |
| `src/wallet.ts` | WaaP + connect modal + sponsored tx helpers |
| `src/sui-client.ts` | Lazy singletons for Seal, DeepBook, Walrus (all via gRPC) |
| `src/sections/` | Page sections (vanilla TS render functions) |
| `wrangler.toml` | Worker config, Durable Object bindings, env vars |
| `vite.config.ts` | PWA manifest, Workbox caching |

---

## Links

- [Sui gRPC Migration](https://docs.sui.io) · [dApp Kit](https://sdk.mystenlabs.com/dapp-kit) · [WaaP](https://docs.waap.xyz)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) · [Agents SDK](https://github.com/cloudflare/agents)
- [Hono](https://hono.dev) · [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)

---

MIT · [ThunderBun](https://github.com/arbuthnot-eth/thunderbun)
