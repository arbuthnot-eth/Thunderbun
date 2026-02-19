# Sui TWA App

A vanilla TypeScript Sui dApp template — PWA-ready, Play Store-ready via TWA.

Built with ThunderBun · ~120KB bundle · No React · No dapp-kit

## Features

- WaaP embedded wallet (works in TWA without a browser extension)
- SuiNS name resolution
- Walrus decentralized storage (store & retrieve blobs)
- DeepBook order book (query + place orders)
- TradePort NFT browsing
- Network switcher (mainnet / testnet / devnet)
- PWA service worker + manifest
- TailwindCSS dark theme

## Quick Start

```bash
bun install
bun run dev        # http://localhost:5173
```

## Build

```bash
bun run build      # outputs to dist/
bun run preview    # preview the production build
```

## Deploy to Play Store via TWA

### Prerequisites

- Java 17+
- `npm install -g @bubblewrap/cli`
- A deployed HTTPS URL (e.g. Vercel, Netlify, Cloudflare Pages)

### Steps

1. Deploy `dist/` to your hosting provider.

2. Add your signing key fingerprint to `public/manifest.json` under `"assetlinks"`:
   ```bash
   bubblewrap fingerprint add
   ```

3. Initialise the TWA project:
   ```bash
   bun run twa:init
   ```
   Enter your deployed URL when prompted. Bubblewrap will generate an `android/` project.

4. Build the Android App Bundle:
   ```bash
   bun run twa:build
   ```

5. Upload `android/app-release-bundle/app-release.aab` to the [Google Play Console](https://play.google.com/console).

### Asset Links (required for TWA)

Add a `/.well-known/assetlinks.json` to your deployed site. Bubblewrap generates this for you via:
```bash
bubblewrap fingerprint add
```

## Customise

| File | Purpose |
|------|---------|
| `src/wallet.ts` | WaaP / wallet integration |
| `src/sections/` | Individual page sections |
| `public/icons/` | App icons (replace placeholders) |
| `vite.config.ts` | PWA manifest + Workbox config |
| `tailwind.config.ts` | Design tokens / colours |

## Ecosystem Links

- [WaaP](https://docs.waap.xyz) — Embedded wallet
- [SuiNS](https://suins.io) — Name service
- [Walrus](https://docs.walrus.site) — Decentralized storage
- [DeepBook](https://deepbook.tech) — On-chain order book
- [TradePort](https://tradeport.xyz) — NFT marketplace
- [Ika](https://ika.xyz) — Multi-party computation
- [Seal](https://seal.sui.io) — Threshold encryption
- [MVR](https://mvr.app) — Move package registry
- [Shinami](https://shinami.com) — Sponsored gas / zkLogin

## License

MIT
