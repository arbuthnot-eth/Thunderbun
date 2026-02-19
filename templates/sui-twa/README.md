# Thunderbun

Sui dApp as a TWA — run in browser, ship to the Play Store. Vanilla TypeScript · Sui dApp Kit · PWA-ready.

> **Note on React:** `react` / `react-dom` are peer dependencies of `@mysten/dapp-kit-core` — they are **not** used in application code. All sections are vanilla TypeScript with zero framework overhead.

---

## ⚡ Quick start (local)

```bash
bun install
bun run dev
```

Opens at `http://localhost:5173`.

---

## 📱 Ship to Google Play — Internal Testing (≈20 min)

**Internal testing** = no review, no waiting. Add your Gmail as a tester and install in seconds.

### One-time prerequisites

| Tool | Install |
|------|---------|
| [Google Play Developer account](https://play.google.com/console/signup) | $25 once |
| Java 17+ | `sudo apt install openjdk-17-jdk` / [adoptium.net](https://adoptium.net) |
| Bubblewrap | `bun run twa:setup` (or `npm install -g @bubblewrap/cli`) |

Verify everything is ready at any time:

```bash
bun run twa:prereqs
```

---

### Step 1 — Generate PNG icons

```bash
bun run icons:generate
```

This creates `public/icons/pwa-192x192.png` and `pwa-512x512.png` from the SVG.
To customise the icon, edit `public/icons/icon.svg` first.

---

### Step 2 — Configure your TWA

Edit **`twa-manifest.json`** in the project root (two fields to change):

```json
{
  "packageId": "com.yourname.app",
  "host":      "your-app.vercel.app"
}
```

> `host` is your domain only — no `https://`, no trailing slash.
> `packageId` must be globally unique on Play Store (`com.yourname.app` works for testing).

---

### Step 3 — Build and deploy to Cloudflare Pages

```bash
npx wrangler login          # one-time: opens browser to authenticate
bun run deploy              # builds + deploys in one command
```

The first deploy creates your project and prints the live URL:

```
✨  Deployment complete! Take a peek over at https://thunderbun.pages.dev
```

Put that domain (without `https://`) in `twa-manifest.json` → `host`:

```json
"host": "thunderbun.pages.dev"
```

> **Custom domain?** Go to Cloudflare Dashboard → Pages → your project → Custom domains.
> Update `host` and `iconUrl`/`maskableIconUrl`/`webManifestUrl` in `twa-manifest.json` to match.

---

### Step 4 — Generate signing keystore + Asset Links

```bash
bun run twa:keystore:debug
```

This:
1. Creates `android-debug.keystore`
2. Writes your SHA256 fingerprint into `public/.well-known/assetlinks.json`
3. Prints the fingerprint so you can verify

Then **redeploy** so the assetlinks file goes live:

```bash
bun run deploy
```

Verify it works: `curl https://thunderbun.pages.dev/.well-known/assetlinks.json`

---

### Step 5 — Build the Android bundle

```bash
bun run twa:build
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

> First run: bubblewrap downloads the Android SDK (~500 MB). Grab a coffee.

---

### Step 6 — Upload to Play Console

1. [play.google.com/console](https://play.google.com/console) → **Create app**
   - App name: `ThunderBun` · Default language: English · App / Free
2. Left sidebar → **Release** → **Testing** → **Internal testing**
3. **Create new release** → Upload `app-release.aab`
4. **Testers** tab → **Create email list** → add your Gmail address
5. **Save** → **Review release** → **Start rollout to Internal testing**

---

### Step 7 — Install on your phone

1. Open Play Console → **Internal testing** → copy the **opt-in URL**
2. Open that URL on your phone → **Accept invite**
3. Install from Play Store — done

---

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| App opens Chrome instead of TWA | assetlinks.json not deployed, wrong fingerprint, or `host` mismatch in `twa-manifest.json` |
| `curl /.well-known/assetlinks.json` returns 404 | Run `bun run deploy` — the `public/.well-known/` folder must be re-deployed |
| assetlinks.json served as wrong content-type | The `public/_headers` file fixes this for Cloudflare Pages — check it was deployed |
| `keytool not found` | Java not installed — see prerequisites |
| `bubblewrap: command not found` | Run `bun run twa:setup` |
| Build fails with Gradle error | Make sure Java 17 is active: `java -version` |
| Icons missing on Play Console | Re-run `bun run icons:generate` and `bun run deploy` |

---

### Upgrading the app

Bump `appVersionCode` (integer, must increase) and `appVersionName` in `twa-manifest.json`, then:

```bash
bun run deploy            # rebuild + redeploy to Cloudflare Pages
bun run twa:build         # new .aab
# upload new .aab to Play Console
```

---

## What's included

### SDK Integrations

| Feature | SDK | Status |
|---------|-----|--------|
| **WaaP** | `@human.tech/waap-sdk` | Embedded wallet (email/social) — prioritized, works in TWA |
| **dApp Kit** | `@mysten/dapp-kit-core` | Connect modal (WaaP + Sui Wallet, etc.) with gRPC + MVR |
| **Passkeys** | `@mysten/sui/keypairs/passkey` | WebAuthn passkeys for passwordless Sui signing, cross-subdomain |
| **Sponsored Tx** | `@mysten/sui` native | Client-side helpers + opt-in server gas station (`/api/sponsor`) |
| **SuiNS** | `@mysten/suins` | Forward lookup via SDK, reverse via gRPC `defaultNameServiceName` |
| **Walrus** | `@mysten/walrus` | SDK `readBlob()` + HTTP publisher fallback for writes |
| **DeepBook** | `@mysten/deepbook-v3` | SDK queries: `midPrice`, `getLevel2TicksFromMid`, pool params |
| **Seal** | `@mysten/seal` | Real `SealClient.encrypt()` on testnet + local AES-GCM demo |
| **Ika MPC** | `@ika.xyz/sdk` | Network status, dWallet info, dynamic import for code splitting |
| **TradePort** | REST API | NFT browsing |
| **Proof Verifier** | — | Link to on-chain Groth16 / Ligetron verification |
| **x402 Scaffold** | `@x402/core` + `@x402/hono` | Paywalled endpoints ready for `@x402/sui` |
| **Hono Router** | `hono` | Worker routing (agents, /api/sponsor, /api/paid/*, static assets) |
| **PWA** | `vite-plugin-pwa` | Service worker, offline-ready, add to home screen |

### Web4 Roadmap (Batch 2)

- `@x402/sui` payment scheme — activate x402 Hono middleware when it ships
- CommerceAgent (Cloudflare Durable Object with autonomous payments)
- Agent dashboard with real-time WebSocket state

---

## Project layout

| Path | Purpose |
|------|---------|
| `src/dapp-kit.ts` | dApp Kit instance with gRPC transport and MVR enabled |
| `src/wallet.ts` | WaaP + dApp Kit connect modal + Wallet Standard |
| `src/sui-client.ts` | Shared SDK client accessors (Seal, DeepBook, Walrus) |
| `src/sections/` | Page sections (each is a vanilla TS render function) |
| `src/sections/passkeys.ts` | Passkey registration, auth, cross-subdomain iframe demo |
| `src/worker.ts` | Hono router — agents, gas station, x402 scaffold, static assets |
| `public/icons/` | PWA icons (replace before publish) |
| `vite.config.ts` | PWA manifest, Workbox |

---

## Links

- [WaaP](https://docs.waap.xyz) · [dApp Kit](https://sdk.mystenlabs.com/dapp-kit) · [Sui Docs](https://docs.sui.io) · [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) · [Play Console](https://play.google.com/console)

---

## Gas Station Setup (Optional)

The Worker includes an opt-in gas station at `POST /api/sponsor`. To enable it:

```bash
# Set the sponsor private key (Bech32 suiprivkey1q... format)
wrangler secret put SPONSOR_PRIVATE_KEY

# Optionally set max gas budget in MIST (default: 50_000_000 = 0.05 SUI)
wrangler secret put MAX_GAS_BUDGET
```

When configured, clients can send base64-encoded transaction bytes to `/api/sponsor` and receive a sponsor signature back. See the Settings section in the app for the full client-side flow.

---

## x402 Payment Scaffold

The Worker includes scaffolded routes at `/api/paid/*` with an `X-X402-Ready: scaffold` header. These endpoints are ready to be paywalled using the x402 Hono middleware once `@x402/sui` ships. The `@x402/core` and `@x402/hono` packages are already installed as dependencies.

---

MIT · [Thunderbun](https://github.com/arbuthnot-eth/thunderbun)
