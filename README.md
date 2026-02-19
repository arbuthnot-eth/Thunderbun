# ThunderBun ⚡

**Sui-native TWA framework — Cloudflare Workers, Agents, and Play Store in one scaffold.**

Vanilla TypeScript · WaaP wallet · gRPC + MVR · Hono router · Durable Object agents · PWA/TWA

> No React · No Enoki · No JSON-RPC

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
| **Wallet** | WaaP embedded wallet | `@human.tech/waap-sdk` |
| **Wallet** | Passkeys (WebAuthn, cross-subdomain) | `@mysten/sui/keypairs/passkey` |
| **Wallet** | Sponsored transactions (client + gas station) | `@mysten/sui` native |
| **Transport** | gRPC + MVR name resolution | `@mysten/sui/grpc` |
| **Connect** | dApp Kit connect modal | `@mysten/dapp-kit-core` |
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
| `src/worker.ts` | Hono router — agents, gas station, x402, static assets |
| `src/agents/ProofAgent.ts` | Durable Object with SQLite + WebSocket state sync |
| `src/dapp-kit.ts` | dApp Kit instance with gRPC transport and MVR |
| `src/wallet.ts` | WaaP + connect modal + sponsored tx helpers |
| `src/sui-client.ts` | Lazy singletons for Seal, DeepBook, Walrus |
| `src/sections/` | Page sections (vanilla TS render functions) |
| `wrangler.toml` | Worker config, Durable Object bindings, env vars |
| `vite.config.ts` | PWA manifest, Workbox caching |

---

## Links

- [WaaP](https://docs.waap.xyz) · [dApp Kit](https://sdk.mystenlabs.com/dapp-kit) · [Sui Docs](https://docs.sui.io)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) · [Agents SDK](https://github.com/cloudflare/agents)
- [Hono](https://hono.dev) · [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)

---

MIT · [ThunderBun](https://github.com/arbuthnot-eth/thunderbun)
