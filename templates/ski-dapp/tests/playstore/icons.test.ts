/**
 * icons.test.ts — Validates PWA icons for Play Store requirements.
 *
 * Play Store requires 512x512 PNG icon minimum.
 * TWA also needs 192x192 for the launcher.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const ICONS_DIR = join(ROOT, "public/icons");

describe("PWA Icons", () => {
  describe("source SVG", () => {
    const svgPath = join(ICONS_DIR, "icon.svg");

    it("icon.svg exists", () => {
      expect(existsSync(svgPath)).toBe(true);
    });

    it("icon.svg is valid SVG", () => {
      const content = readFileSync(svgPath, "utf-8");
      expect(content).toContain("<svg");
      expect(content).toContain("</svg>");
    });

    it("icon.svg is not empty", () => {
      const stat = statSync(svgPath);
      expect(stat.size).toBeGreaterThan(100);
    });
  });

  describe("icon generation script", () => {
    const scriptPath = join(ROOT, "scripts/generate-icons.ts");

    it("generate-icons.ts exists", () => {
      expect(existsSync(scriptPath)).toBe(true);
    });

    it("script generates both required sizes", () => {
      const content = readFileSync(scriptPath, "utf-8");
      expect(content).toContain("192");
      expect(content).toContain("512");
    });

    it("script outputs to correct directory", () => {
      const content = readFileSync(scriptPath, "utf-8");
      expect(content).toContain("public/icons");
    });
  });

  describe("generated PNGs (if present)", () => {
    const png192 = join(ICONS_DIR, "pwa-192x192.png");
    const png512 = join(ICONS_DIR, "pwa-512x512.png");
    const has192 = existsSync(png192);
    const has512 = existsSync(png512);

    it.skipIf(!has192)("pwa-192x192.png has valid PNG header", () => {
      const buf = readFileSync(png192);
      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50); // P
      expect(buf[2]).toBe(0x4e); // N
      expect(buf[3]).toBe(0x47); // G
    });

    it.skipIf(!has512)("pwa-512x512.png has valid PNG header", () => {
      const buf = readFileSync(png512);
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
      expect(buf[2]).toBe(0x4e);
      expect(buf[3]).toBe(0x47);
    });

    it.skipIf(!has192)("pwa-192x192.png is > 1KB (not a stub)", () => {
      const stat = statSync(png192);
      expect(stat.size).toBeGreaterThan(1024);
    });

    it.skipIf(!has512)("pwa-512x512.png is > 1KB (not a stub)", () => {
      const stat = statSync(png512);
      expect(stat.size).toBeGreaterThan(1024);
    });
  });

  describe("manifest icon references", () => {
    it("PWA manifest references icons that match file structure", () => {
      const manifestPath = join(ROOT, "public/manifest.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        const icons = manifest.icons as { src: string }[];
        for (const icon of icons) {
          // Icon src should point to /icons/ directory
          expect(icon.src).toContain("icons/pwa-");
        }
      }
    });
  });
});
