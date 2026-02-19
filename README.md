# ThunderBun ⚡

**Build ultra-fast, tiny, Sui-native desktop, PWA & TWA apps with TypeScript.**

ThunderBun is a fork of [Electrobun](https://github.com/blackboardsh/electrobun) supercharged for the Sui ecosystem — shipping native WaaP embedded wallets, SuiNS, Walrus, DeepBook, and Play Store TWA deployment out of the box.

> ~120 KB bundle · No React · Vanilla TypeScript · Mobile-first

---

## Quick Start

```bash
# Scaffold a Sui TWA (mobile-first, Play Store ready)
npx thunderbun init --template sui-twa

cd my-sui-twa-app
bun install
bun run dev       # Opens at localhost:5173
```

```bash
# Scaffold a desktop app
npx thunderbun init --template hello-world
```

---

## Templates

| Template | Description |
|----------|-------------|
| `sui-twa` | Vanilla TS · Vite · TailwindCSS · WaaP wallet · PWA/TWA → Play Store |
| `hello-world` | Minimal ThunderBun desktop app |
| `react-tailwind-vite` | React + Tailwind desktop app |
| `photo-booth` | Camera + native APIs demo |
| `multitab-browser` | Multi-window browser demo |

---

## Sui Ecosystem Included (sui-twa)

- **WaaP** — Embedded wallet from [docs.waap.xyz](https://docs.waap.xyz)
- **SuiNS** — Human-readable names
- **Walrus** — Decentralized storage
- **DeepBook** — On-chain order book
- **Ika** — Multi-party computation
- **Seal** — Threshold encryption
- **MVR** — Move package registry
- **TradePort** — NFT marketplace SDK
- **Sponsored gas** — Gasless transactions via Shinami/zkLogin

---

## TWA → Play Store (5 minutes)

```bash
cd my-sui-twa-app
bun run build
# Deploy dist/ to Vercel/Netlify → https://your-app.vercel.app

bun run twa:init   # bubblewrap wizard
bun run twa:build  # outputs app-release.aab
# Upload .aab to Google Play Console
```

**Prerequisites:** Java 17+ · `npm i -g @bubblewrap/cli`

---

## Platform Support

| Platform | Status |
|----------|--------|
| macOS 14+ | ✅ Desktop |
| Windows 11+ | ✅ Desktop |
| Ubuntu 22.04+ | ✅ Desktop |
| Android (TWA) | ✅ Play Store via bubblewrap |
| iOS (PWA) | ✅ Add to Home Screen |
| Web | ✅ Any browser |

---

## Development (package)

```bash
cd package
bun install
bun build:dev
bun build:cli
```

---

## Links

- [WaaP Docs](https://docs.waap.xyz)
- [Sui Developer Portal](https://sui.io/developers)
- [Bubblewrap CLI](https://github.com/GoogleChromeLabs/bubblewrap)
- [Original Electrobun](https://github.com/blackboardsh/electrobun)

---

MIT License · ThunderBun Team
