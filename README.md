# ThunderBun

Cross-platform desktop app framework built on [Bun](https://bun.sh). Build fast, tiny native apps with TypeScript.

ThunderBun packages your app with native webview wrappers (CEF or system WebKit/WebView2), a Bun runtime, and a self-extracting installer — all from a single `thunderbun.config.ts`.

## Web3 & Web4 Native

Unlike other lightweight Electron alternatives, **ThunderBun** is built from the ground up to be highly composable with modern decentralized tech. It is shipped with first-class support for:
- **Agents SDK** (`npm i agents`) for AI-driven multi-agent systems
- **WaaP** (`@human.tech/waap-sdk`) for seamless Wallet as a Service
- **Ika** (`@ika.xyz/sdk`) for MPC and dWallets
- **x402** (`@x402/core` & `@x402/hono`) for frictionless HTTP 402 AI micropayments

The included `sui-twa` template provides a comprehensive starting point to leverage these packages immediately while remaining tiny and cross-platform.

---

## Quick Start

```bash
npx thunderbun init    # scaffold from a template
cd my-app
bun install
bun run dev
```

## Templates

| Template | Description |
|----------|-------------|
| `hello-world` | Minimal starter |
| `react-tailwind-vite` | React + Tailwind + Vite |
| `svelte` | Svelte app |
| `photo-booth` | Camera / media capture demo |
| `multitab-browser` | Tabbed browser shell |
| `sui-twa` | Sui blockchain TWA — gRPC, dApp Kit, WaaP, ZK proofs, Cloudflare Workers |

## Platform Support

| Platform | Architectures | Webview |
|----------|---------------|---------|
| macOS | ARM64 (Apple Silicon), x64 (Intel) | CEF or WebKit (weak-linked) |
| Windows | x64 (ARM runs via emulation) | CEF or WebView2 |
| Linux | x64, ARM64 | CEF or WebKitGTK (dual-binary) |

CEF is optional — set `bundleCEF: false` in your config to ship a smaller binary using the system webview.

## Architecture

```
thunderbun/
├── package/              CLI + framework source
│   ├── src/cli/          CLI — `npx thunderbun init`, build, package
│   ├── src/native/       Native wrappers (macOS, Windows, Linux)
│   ├── src/extractor/    Self-extracting installer (Zig)
│   ├── src/bun/          Bun-side runtime API
│   ├── src/browser/      Browser-side runtime API
│   └── build.ts          Build orchestrator (vendors Bun, Zig, CEF)
├── kitchen/              Kitchen Sink test app
├── templates/            App templates (embedded into CLI)
│   ├── hello-world/
│   ├── react-tailwind-vite/
│   ├── svelte/
│   ├── photo-booth/
│   ├── multitab-browser/
│   └── sui-twa/          Sui blockchain TWA template
├── move/                 Sui Move smart contracts
│   └── ligetron-verifier/
├── contracts/            Additional on-chain contracts
│   └── proof-verifier/
└── docs/                 Internal documentation
```

## Building from Source

All build commands run from the `package/` directory:

```bash
cd package
bun install

bun dev              # build + run kitchen sink app (dev mode)
bun build.ts         # full build (all platforms)
bun build.ts --release  # release build
bun run build:cli    # CLI binary only
```

The build system vendors Bun, Zig, and optionally CEF, then compiles native wrappers for the target platform.

## Sui TWA Template

The `sui-twa` template is a Sui-native PWA/TWA wired to the full Mysten ecosystem, ready for Play Store distribution via Bubblewrap.

**Transport**: `SuiGrpcClient` from `@mysten/sui/grpc` — fully migrated off JSON-RPC (shuts down April 2026).

Included SDKs:

| Category | SDK |
|----------|-----|
| Connect | `@mysten/dapp-kit-core` |
| Wallet | `@human.tech/waap-sdk` (embedded) + passkeys |
| Names | `@mysten/suins` |
| Storage | `@mysten/walrus` |
| Trading | `@mysten/deepbook-v3` |
| Encryption | `@mysten/seal` |
| MPC | `@ika.xyz/sdk` |
| Workers | Hono + Cloudflare Workers + Agents SDK |
| Payments | x402 scaffold |

```bash
cd templates/sui-twa
bun install
bun run dev          # localhost:5173
bun run deploy       # Cloudflare Workers
bun run twa:build    # Android .aab for Play Store
```

## Publishing

```bash
cd package
bun run npm:publish         # stable release
bun run npm:publish:beta    # beta release
```

## Docs

- [AI Agent Guide](AGENTS.md) — codebase overview for AI coding agents
- [Build System](docs/BUILD.md) — cross-platform compilation, native wrappers
- [CEF Management](docs/CEF.md) — versioning, caching, custom CEF builds
- [Beta Releases](docs/BETA_RELEASE.md) — beta workflow for maintainers

## Links

- [thunderbun.dev](https://thunderbun.dev)
- [GitHub](https://github.com/arbuthnot-eth/thunderbun)
- [Sui gRPC Docs](https://docs.sui.io) · [dApp Kit](https://sdk.mystenlabs.com/dapp-kit) · [WaaP](https://docs.waap.xyz)

---

MIT
