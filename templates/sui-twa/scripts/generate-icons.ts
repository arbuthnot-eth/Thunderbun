#!/usr/bin/env bun
/**
 * Generate PWA icons (192x192, 512x512) from public/icons/icon.svg
 * Run: bun run scripts/generate-icons.ts
 * Requires: bun add -d sharp
 */
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";

const sharp = await import("sharp").catch(() => null);
if (!sharp) {
  console.warn("Install sharp: bun add -d sharp. Using placeholder icons.");
  process.exit(0);
}

const root = join(import.meta.dirname ?? import.meta.path.replace(/\/[^/]+$/, ""), "..");
const svgPath = join(root, "public/icons/icon.svg");
const outDir = join(root, "public/icons");

if (!existsSync(svgPath)) {
  console.error("Missing public/icons/icon.svg");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
await sharp.default(svgPath).resize(192, 192).png().toFile(join(outDir, "pwa-192x192.png"));
await sharp.default(svgPath).resize(512, 512).png().toFile(join(outDir, "pwa-512x512.png"));
console.log("Generated pwa-192x192.png and pwa-512x512.png");
