#!/usr/bin/env bun
/**
 * Strip white background from Tb.svg and scale down by 95% (to 5% of original size).
 * Adds back a thick white outline via SVG filter (feMorphology dilate).
 * Usage: bun assets/process-svg.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const inPath = join(import.meta.dirname, "Tb.svg");
const outPath = join(import.meta.dirname, "Tb-transparent.svg");

// Outline radius in viewBox units. At 200px display size over a 4000-unit square canvas:
// scale = 4000/200 = 20. radius=60 → 3px white border at display size.
const OUTLINE_RADIUS = 60;

let svg = readFileSync(inPath, "utf-8");

// 1. Remove the full-canvas white background rectangle (first path, fill="#FEFEFE")
svg = svg.replace(
  /<path d="M0 0 [^"]*" fill="#FEFEFE" transform="translate\(0,0\)"\/>\n?/,
  ""
);

// 2. Center the logo in a 4000x4000 square canvas with padding for the white outline.
//    This prevents the outline from being clipped on any edge.
//    Logo is 2025 wide × 3687 tall. Center it: x offset = (4000-2025)/2 = 987.5, y = (4000-3687)/2 = 156.5
//    Add 100-unit outline buffer → final viewBox: "-1088 -257 4200 4200"  (display: 210×210px at 5%)
const CANVAS = 4200;
const LOGO_W = 2025, LOGO_H = 3687;
const PAD = 100; // extra buffer beyond centering for filter overflow
const vbX = -Math.round((CANVAS - LOGO_W) / 2 + PAD);
const vbY = -Math.round((CANVAS - LOGO_H) / 2 + PAD);
const displaySize = (CANVAS * 0.05).toFixed(0);

svg = svg.replace(
  /<svg version="1.1" xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+(?:\.\d+)?" height="\d+(?:\.\d+)?"(?:[^>]*)?>/,
  `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${displaySize}" height="${displaySize}" viewBox="${vbX} ${vbY} ${CANVAS} ${CANVAS}">`,
);

// 3. Inject white-outline filter into <defs> (or create <defs> if absent)
const filterDef = `<defs>
  <filter id="white-outline" x="-8%" y="-5%" width="116%" height="110%" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius="${OUTLINE_RADIUS}" result="expanded"/>
    <feFlood flood-color="white" result="white"/>
    <feComposite in="white" in2="expanded" operator="in" result="outline"/>
    <feMerge>
      <feMergeNode in="outline"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
</defs>`;

if (svg.includes("</defs>")) {
  // Append filter inside existing defs
  svg = svg.replace("</defs>", `  <filter id="white-outline" x="-8%" y="-5%" width="116%" height="110%" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius="${OUTLINE_RADIUS}" result="expanded"/>
    <feFlood flood-color="white" result="white"/>
    <feComposite in="white" in2="expanded" operator="in" result="outline"/>
    <feMerge>
      <feMergeNode in="outline"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
</defs>`);
} else {
  // Insert defs right after the opening <svg> tag
  svg = svg.replace(/(<svg[^>]*>)/, `$1\n${filterDef}`);
}

// 4. Wrap all logo content in a group with the white-outline filter applied
svg = svg.replace(/(<svg[^>]*>[\s\S]*?<\/defs>)\n?([\s\S]*)(<\/svg>)/, (_, header, content, close) => {
  return `${header}\n<g filter="url(#white-outline)">\n${content}</g>\n${close}`;
});

writeFileSync(outPath, svg, "utf-8");
console.log(`Written: ${outPath}`);
console.log(`Background removed, white outline (radius=${OUTLINE_RADIUS}) added, scaled to 5%.`);
