/**
 * pwa-manifest.test.ts — Validates PWA manifest for Play Store TWA requirements.
 *
 * A TWA wraps a PWA — so the web manifest must meet Play Store standards:
 * correct icons, display mode, start_url, etc.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const MANIFEST_PATH = join(ROOT, "public/manifest.json");

function loadManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

describe("public/manifest.json (PWA)", () => {
  it("exists", () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
  });

  it("is valid JSON", () => {
    expect(() => loadManifest()).not.toThrow();
  });

  describe("required PWA fields", () => {
    const REQUIRED = ["name", "short_name", "start_url", "display", "icons"];
    const manifest = loadManifest();

    for (const field of REQUIRED) {
      it(`has "${field}"`, () => {
        expect(manifest).toHaveProperty(field);
      });
    }
  });

  describe("display mode", () => {
    it("is standalone or fullscreen (required for TWA)", () => {
      const { display } = loadManifest();
      expect(["standalone", "fullscreen"]).toContain(display);
    });
  });

  describe("icons", () => {
    const manifest = loadManifest();
    const icons = manifest.icons as { src: string; sizes: string; type: string; purpose?: string }[];

    it("has at least 2 icons", () => {
      expect(icons.length).toBeGreaterThanOrEqual(2);
    });

    it("includes a 192x192 icon", () => {
      const has192 = icons.some((i) => i.sizes === "192x192");
      expect(has192).toBe(true);
    });

    it("includes a 512x512 icon", () => {
      const has512 = icons.some((i) => i.sizes === "512x512");
      expect(has512).toBe(true);
    });

    it("all icons are PNG type", () => {
      for (const icon of icons) {
        expect(icon.type).toBe("image/png");
      }
    });

    it("512x512 icon has maskable purpose (Play Store adaptive icon)", () => {
      const icon512 = icons.find((i) => i.sizes === "512x512");
      expect(icon512?.purpose).toContain("maskable");
    });
  });

  describe("start_url and scope", () => {
    it('start_url is "/" or a valid path', () => {
      const { start_url } = loadManifest() as { start_url: string };
      expect(start_url).toMatch(/^\//);
    });

    it('scope is "/" or a valid path', () => {
      const { scope } = loadManifest() as { scope: string };
      expect(scope).toMatch(/^\//);
    });

    it("start_url is within scope", () => {
      const m = loadManifest() as { start_url: string; scope: string };
      expect(m.start_url.startsWith(m.scope)).toBe(true);
    });
  });

  describe("theme consistency", () => {
    it("theme_color matches twa-manifest.json themeColor", () => {
      const pwa = loadManifest() as { theme_color: string };
      const twaPath = join(ROOT, "twa-manifest.json");
      if (existsSync(twaPath)) {
        const twa = JSON.parse(readFileSync(twaPath, "utf-8"));
        expect(pwa.theme_color).toBe(twa.themeColor);
      }
    });

    it("background_color matches twa-manifest.json backgroundColor", () => {
      const pwa = loadManifest() as { background_color: string };
      const twaPath = join(ROOT, "twa-manifest.json");
      if (existsSync(twaPath)) {
        const twa = JSON.parse(readFileSync(twaPath, "utf-8"));
        expect(pwa.background_color).toBe(twa.backgroundColor);
      }
    });
  });

  describe("name constraints", () => {
    it("name is <= 50 characters", () => {
      const { name } = loadManifest() as { name: string };
      expect(name.length).toBeLessThanOrEqual(50);
    });

    it("short_name is <= 12 characters (recommended for launcher)", () => {
      const { short_name } = loadManifest() as { short_name: string };
      expect(short_name.length).toBeLessThanOrEqual(12);
    });
  });

  describe("orientation", () => {
    it("matches twa-manifest.json orientation", () => {
      const pwa = loadManifest() as { orientation: string };
      const twaPath = join(ROOT, "twa-manifest.json");
      if (existsSync(twaPath)) {
        const twa = JSON.parse(readFileSync(twaPath, "utf-8"));
        expect(pwa.orientation).toBe(twa.orientation);
      }
    });
  });
});
