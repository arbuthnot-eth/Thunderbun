#!/usr/bin/env bun
/**
 * Reduce SVG path data by scaling coordinate space down 4x.
 * At display size (101x184), coordinate resolution of 506x922 is still sub-pixel.
 * This eliminates nearly-coincident points without visible quality loss.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const inPath = join(import.meta.dirname, "tbai.svg");
const outPath = join(import.meta.dirname, "tbai-small.svg");

const SCALE = 0.25; // 4x reduction in coordinate precision

let svg = readFileSync(inPath, "utf-8");

// Scale viewBox dimensions
svg = svg.replace(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/, (_, w, h) => {
  const nw = Math.round(Number(w) * SCALE);
  const nh = Math.round(Number(h) * SCALE);
  return `viewBox="0 0 ${nw} ${nh}"`;
});

// Scale all numeric values inside path d="..." attributes
// Strategy: wrap all path-bearing elements in a <g transform="scale(SCALE)">
// and also adjust the viewBox, then let the numbers stay as-is.
// BUT to actually reduce file size we must scale the coordinate values themselves.
//
// Simpler approach: scale every number in path d attributes by SCALE, then re-round to int.
svg = svg.replace(/ d="([^"]+)"/g, (_, d) => {
  // Scale every float/int number in the path data
  const scaled = d.replace(/[-+]?[0-9]*\.?[0-9]+/g, (n: string) => {
    const v = parseFloat(n) * SCALE;
    return Math.round(v).toString();
  });
  return ` d="${scaled}"`;
});

// Also scale feMorphology radius proportionally
svg = svg.replace(/radius="(\d+(?:\.\d+)?)"/, (_, r) => {
  return `radius="${Math.round(Number(r) * SCALE)}"`;
});

writeFileSync(outPath, svg, "utf-8");

const origSize = readFileSync(inPath).byteLength;
const newSize = readFileSync(outPath).byteLength;
console.log(`Input:  ${(origSize / 1024).toFixed(1)} KB`);
console.log(`Output: ${(newSize / 1024).toFixed(1)} KB  (${((1 - newSize / origSize) * 100).toFixed(1)}% smaller)`);
const orig = 3581635;
console.log(`Total reduction from original 3.5MB: ${((1 - newSize / orig) * 100).toFixed(1)}%`);
