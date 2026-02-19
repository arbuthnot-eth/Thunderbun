import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        name: "Thunderbun — Web4 dApp Portal",
        short_name: "Thunderbun",
        description: "The Sui-native framework for launching dApps. Built-in SDKs, Cloudflare Agents, PWA-ready.",
        theme_color: "#3B8BFF",
        background_color: "#09090F",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "icons/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fullnode\.(mainnet|testnet|devnet)\.sui\.io\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "sui-rpc-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
      devOptions: { enabled: true },
    }),
  ],
  build: {
    target: "es2020",
    outDir: "dist",
  },
});
