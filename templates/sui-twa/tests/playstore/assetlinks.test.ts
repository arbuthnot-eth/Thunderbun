/**
 * assetlinks.test.ts — Validates Digital Asset Links configuration.
 *
 * Digital Asset Links (assetlinks.json) establish trust between your domain
 * and the Android app. Without correct assetlinks, the TWA opens in Chrome
 * instead of as a standalone app.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const TEMPLATE_PATH = join(ROOT, "public/.well-known/assetlinks.json.template");
const LIVE_PATH = join(ROOT, "public/.well-known/assetlinks.json");
const TWA_MANIFEST_PATH = join(ROOT, "twa-manifest.json");

describe("Digital Asset Links (assetlinks.json)", () => {
  describe("template", () => {
    it("template file exists", () => {
      expect(existsSync(TEMPLATE_PATH)).toBe(true);
    });

    it("template is valid JSON", () => {
      const content = readFileSync(TEMPLATE_PATH, "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it("template has correct structure", () => {
      const links = JSON.parse(readFileSync(TEMPLATE_PATH, "utf-8"));
      expect(Array.isArray(links)).toBe(true);
      expect(links.length).toBe(1);
      expect(links[0]).toHaveProperty("relation");
      expect(links[0]).toHaveProperty("target");
      expect(links[0].target).toHaveProperty("namespace", "android_app");
      expect(links[0].target).toHaveProperty("package_name");
      expect(links[0].target).toHaveProperty("sha256_cert_fingerprints");
    });

    it("template relation is delegate_permission/common.handle_all_urls", () => {
      const links = JSON.parse(readFileSync(TEMPLATE_PATH, "utf-8"));
      expect(links[0].relation).toContain("delegate_permission/common.handle_all_urls");
    });
  });

  describe("live assetlinks.json (if generated)", () => {
    // These tests only run if assetlinks.json has been generated
    const liveExists = existsSync(LIVE_PATH);

    it.skipIf(!liveExists)("is valid JSON", () => {
      const content = readFileSync(LIVE_PATH, "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it.skipIf(!liveExists)("has correct structure", () => {
      const links = JSON.parse(readFileSync(LIVE_PATH, "utf-8"));
      expect(Array.isArray(links)).toBe(true);
      expect(links[0].target.namespace).toBe("android_app");
    });

    it.skipIf(!liveExists)("package_name is not the placeholder", () => {
      const links = JSON.parse(readFileSync(LIVE_PATH, "utf-8"));
      expect(links[0].target.package_name).not.toBe("REPLACE_WITH_YOUR_PACKAGE_ID");
    });

    it.skipIf(!liveExists)("sha256 fingerprint is not the placeholder", () => {
      const links = JSON.parse(readFileSync(LIVE_PATH, "utf-8"));
      const fp = links[0].target.sha256_cert_fingerprints[0];
      expect(fp).not.toBe("REPLACE_WITH_YOUR_SHA256_FINGERPRINT");
    });

    it.skipIf(!liveExists)("sha256 fingerprint matches hex colon-separated format", () => {
      const links = JSON.parse(readFileSync(LIVE_PATH, "utf-8"));
      const fp = links[0].target.sha256_cert_fingerprints[0];
      if (fp !== "REPLACE_WITH_YOUR_SHA256_FINGERPRINT") {
        // SHA256 fingerprint = 32 bytes = 64 hex chars separated by colons
        expect(fp).toMatch(/^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/);
      }
    });

    it.skipIf(!liveExists)("package_name matches twa-manifest.json packageId", () => {
      const links = JSON.parse(readFileSync(LIVE_PATH, "utf-8"));
      if (existsSync(TWA_MANIFEST_PATH)) {
        const twa = JSON.parse(readFileSync(TWA_MANIFEST_PATH, "utf-8"));
        expect(links[0].target.package_name).toBe(twa.packageId);
      }
    });
  });

  describe("Cloudflare headers", () => {
    const headersPath = join(ROOT, "public/_headers");

    it("_headers file exists", () => {
      expect(existsSync(headersPath)).toBe(true);
    });

    it("serves assetlinks.json with application/json content-type", () => {
      const content = readFileSync(headersPath, "utf-8");
      expect(content).toContain("/.well-known/assetlinks.json");
      expect(content).toContain("Content-Type: application/json");
    });

    it("disables caching for assetlinks.json", () => {
      const content = readFileSync(headersPath, "utf-8");
      // The _headers file should have no-cache for assetlinks
      const lines = content.split("\n");
      const assetlinksIdx = lines.findIndex((l) => l.includes("assetlinks.json"));
      if (assetlinksIdx !== -1) {
        // Check lines after the assetlinks path for Cache-Control
        const section = lines.slice(assetlinksIdx, assetlinksIdx + 5).join("\n");
        expect(section).toContain("no-cache");
      }
    });
  });
});
