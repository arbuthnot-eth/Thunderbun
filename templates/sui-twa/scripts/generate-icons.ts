#!/usr/bin/env bun
/**
 * Generate icon.iconset + PWA icons from public/icons/icon.svg
 * Run: bun run scripts/generate-icons.ts
 * Requires: @resvg/resvg-js
 */
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const root = join(import.meta.dirname, "..");
const SVG_PATH = join(root, "public/icons/icon.svg");
const ICONSET_DIR = join(root, "public/icons/icon.iconset");

const ICONSET_SIZES = [
  { name: "icon_16x16.png",      width: 16 },
  { name: "icon_16x16@2x.png",   width: 32 },
  { name: "icon_32x32.png",      width: 32 },
  { name: "icon_32x32@2x.png",   width: 64 },
  { name: "icon_128x128.png",    width: 128 },
  { name: "icon_128x128@2x.png", width: 256 },
  { name: "icon_256x256.png",    width: 256 },
  { name: "icon_256x256@2x.png", width: 512 },
  { name: "icon_512x512.png",    width: 512 },
  { name: "icon_512x512@2x.png", width: 1024 },
];

const PWA_SIZES = [192, 512];

const svg = readFileSync(SVG_PATH, "utf-8");

function render(svg: string, width: number): Buffer {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return Buffer.from(resvg.render().asPng());
}

// icon.iconset
mkdirSync(ICONSET_DIR, { recursive: true });
console.log("icon.iconset/");
for (const { name, width } of ICONSET_SIZES) {
  const png = render(svg, width);
  writeFileSync(join(ICONSET_DIR, name), png);
  console.log(`  ${name.padEnd(24)} ${width}x${width}  (${(png.byteLength / 1024).toFixed(1)} KB)`);
}

// PWA icons
console.log("\nPWA icons/");
const iconsDir = join(root, "public/icons");
for (const size of PWA_SIZES) {
  const png = render(svg, size);
  writeFileSync(join(iconsDir, `pwa-${size}x${size}.png`), png);
  console.log(`  pwa-${size}x${size}.png`.padEnd(26) + ` ${size}x${size}  (${(png.byteLength / 1024).toFixed(1)} KB)`);
}

console.log("\nDone.");
