# PWA Icons

Replace `pwa-192x192.png` and `pwa-512x512.png` with your app's icon before deploying.

## Generate from SVG

```bash
# Install sharp CLI
npm install -g sharp-cli

# Generate from icon.svg
sharp -i icon.svg -o pwa-192x192.png resize 192 192
sharp -i icon.svg -o pwa-512x512.png resize 512 512
```

Or use https://maskable.app to create a maskable version.

## Requirements

- `pwa-192x192.png` — 192×192 pixels, PNG
- `pwa-512x512.png` — 512×512 pixels, PNG (used as maskable icon for Play Store)

The 512×512 icon is required for TWA (Android) submission to the Play Store.
