/**
 * vite-pwa.test.ts — Validates Vite + PWA configuration for Play Store TWA.
 *
 * The Vite config defines the service worker, PWA manifest output,
 * and build target. These must be correct for the TWA to work.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");

describe("vite.config.ts (PWA configuration)", () => {
  const configPath = join(ROOT, "vite.config.ts");

  it("vite.config.ts exists", () => {
    expect(existsSync(configPath)).toBe(true);
  });

  const content = readFileSync(configPath, "utf-8");

  it("imports VitePWA plugin", () => {
    expect(content).toContain("VitePWA");
    expect(content).toContain("vite-plugin-pwa");
  });

  it("uses autoUpdate register type", () => {
    expect(content).toContain('registerType: "autoUpdate"');
  });

  it("includes PNG and SVG assets", () => {
    expect(content).toContain("*.png");
    expect(content).toContain("*.svg");
  });

  describe("manifest config", () => {
    it("defines app name", () => {
      expect(content).toContain("name:");
    });

    it("defines display mode as standalone", () => {
      expect(content).toContain('"standalone"');
    });

    it("defines start_url", () => {
      expect(content).toContain("start_url:");
    });

    it("defines icons array with 192 and 512 sizes", () => {
      expect(content).toContain("192x192");
      expect(content).toContain("512x512");
    });
  });

  describe("workbox config", () => {
    it("configures workbox glob patterns", () => {
      expect(content).toContain("globPatterns");
    });

    it("caches HTML, JS, CSS, and images", () => {
      expect(content).toContain("js");
      expect(content).toContain("css");
      expect(content).toContain("html");
      expect(content).toContain("png");
    });

    it("has runtime caching for Sui RPC", () => {
      expect(content).toMatch(/sui/i);
      expect(content).toContain("sui-rpc-cache");
      expect(content).toContain("NetworkFirst");
    });
  });

  describe("build target", () => {
    it("targets ES2020 or newer", () => {
      // ES2020 is the minimum for BigInt, optional chaining, etc.
      expect(content).toMatch(/target.*es20[2-9]\d/i);
    });

    it("outputs to dist/", () => {
      expect(content).toContain('"dist"');
    });
  });
});
