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
        theme_color: "#FFB800",
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
        // Only precache the app shell — HTML, CSS, main entry JS, and icons.
        // Section chunks + vendor splits are cached at runtime on first use.
        globPatterns: [
          "index.html",
          "manifest.webmanifest",
          "registerSW.js",
          "assets/index-*.css",
          "icons/*.png",
        ],
        runtimeCaching: [
          {
            // Lazy-loaded JS chunks — cache on first use, serve from cache after
            urlPattern: /\/assets\/.+\.js$/,
            handler: "CacheFirst",
            options: {
              cacheName: "js-chunks",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/fullnode\.(mainnet|testnet|devnet)\.sui\.io\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "sui-rpc-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
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
    rollupOptions: {
      external: ["@ika.xyz/sdk"],
      output: {
        manualChunks(id) {
          // All @mysten/sui internal modules must land in the same chunk
          // to avoid "Class extends undefined" from split base classes.
          if (id.includes("node_modules/@mysten/sui/")) return "vendor-sui";
          if (id.includes("node_modules/@mysten/dapp-kit")) return "vendor-dappkit";
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/@tanstack/react-query/")
          ) return "vendor-react";
          if (id.includes("node_modules/viem/")) return "vendor-viem";
        },
      },
    },
  },
});
