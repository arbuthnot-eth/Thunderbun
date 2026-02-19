# Deploy Thunderbun TWA to Google Play Store

**Quick path:** See the [README](README.md) for the ~15 min Internal Testing flow.

This document is the full reference with troubleshooting.

## Prerequisites

- **Google Play Developer account** — $25 one-time [register](https://play.google.com/console/signup)
- **Java 17+** — `java -version`
- **Bubblewrap** — `npm install -g @bubblewrap/cli`
- **Deployed HTTPS URL** — Vercel, Netlify, Cloudflare Pages, or any static host

## Step 1: Generate PWA icons

Play Store requires 512×512 PNG. Generate from your SVG:

```bash
bun add -d sharp
bun run scripts/generate-icons.ts
```

Or use [maskable.app](https://maskable.app) for maskable icons.

## Step 2: Build and deploy

```bash
bun run build
```

Deploy the `dist/` folder to your host. Example (Vercel):

```bash
npx vercel dist --prod
```

You'll get a URL like `https://my-sui-app.vercel.app`.

## Step 3: Add Digital Asset Links (TWA requirement)

Create `dist/.well-known/assetlinks.json` **before** or **after** deploy. Bubblewrap can generate it:

```bash
cd android  # after twa:init
bubblewrap fingerprint add
# Copy the output to your site at /.well-known/assetlinks.json
```

Or manually add `/.well-known/assetlinks.json` to your deployed site with:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "YOUR_PACKAGE_ID",
    "sha256_cert_fingerprints": ["YOUR_SHA256_FINGERPRINT"]
  }
}]
```

Get your SHA-256 fingerprint:

```bash
keytool -list -v -keystore path/to/your.keystore -alias your-key-alias
```

## Step 4: Initialize TWA project

```bash
bun run build
bun run twa:init
```

When prompted:
- **Hosting URL**: `https://your-deployed-url.com` (no trailing slash)
- **Package ID**: e.g. `com.yourcompany.suiapp`
- **App name**: Thunderbun
- **Launcher name**: Thunderbun
- **Theme color**: `#4DA2FF`
- **Background color**: `#0D1117`

Bubblewrap generates an `android/` folder.

## Step 5: Build the App Bundle

```bash
bun run twa:build
```

Output: `android/app-release-bundle/app-release.aab`

## Step 6: Upload to Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Create app → Fill store listing (name, description, screenshots)
3. Release → Production (or Internal testing)
4. Create new release → Upload `app-release.aab`
5. Add release notes → Review and rollout

## Troubleshooting

### Manifest URL

If `twa:init` fails on manifest, use the full URL:

```bash
bubblewrap init --manifest=https://your-deployed-url.com/manifest.webmanifest
```

### Asset Links 404

Ensure `/.well-known/assetlinks.json` is served with `Content-Type: application/json`. Vercel/Netlify usually handle this if the file exists in `public/.well-known/`.

### Icon missing

The build warns if `pwa-192x192.png` or `pwa-512x512.png` are missing. Run `scripts/generate-icons.ts` or add them manually to `public/icons/`.
