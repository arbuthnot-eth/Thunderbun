/**
 * scripts.test.ts — Validates that deployment scripts exist and are correct.
 *
 * These tests ensure the scripts/ directory has everything needed
 * for the Play Store deployment pipeline.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, accessSync, constants } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const SCRIPTS = join(ROOT, "scripts");

describe("Deployment scripts", () => {
  describe("check-prereqs.sh", () => {
    const path = join(SCRIPTS, "check-prereqs.sh");

    it("exists", () => {
      expect(existsSync(path)).toBe(true);
    });

    it("is executable", () => {
      expect(() => accessSync(path, constants.X_OK)).not.toThrow();
    });

    it("checks for Java", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("java");
    });

    it("checks for bubblewrap", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("bubblewrap");
    });

    it("checks twa-manifest.json host", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("YOUR_APP_DOMAIN_HERE");
    });

    it("checks for PNG icons", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("pwa-192x192.png");
      expect(content).toContain("pwa-512x512.png");
    });

    it("checks for assetlinks.json", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("assetlinks.json");
    });

    it("exits with non-zero on failure", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("exit 1");
    });
  });

  describe("gen-keystore.sh", () => {
    const path = join(SCRIPTS, "gen-keystore.sh");

    it("exists", () => {
      expect(existsSync(path)).toBe(true);
    });

    it("is executable", () => {
      expect(() => accessSync(path, constants.X_OK)).not.toThrow();
    });

    it("supports debug mode", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain('"debug"');
    });

    it("supports release mode", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain('"release"');
    });

    it("generates SHA256 fingerprint", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("SHA256");
    });

    it("writes assetlinks.json", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("assetlinks.json");
    });

    it("reads packageId from twa-manifest.json", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("packageId");
    });

    it("uses RSA 2048-bit key", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("RSA");
      expect(content).toContain("2048");
    });
  });

  describe("generate-icons.ts", () => {
    const path = join(SCRIPTS, "generate-icons.ts");

    it("exists", () => {
      expect(existsSync(path)).toBe(true);
    });

    it("generates 192x192 icon", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("192");
    });

    it("generates 512x512 icon", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("512");
    });

    it("reads from public/icons/icon.svg", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("icon.svg");
    });

    it("outputs PNG format", () => {
      const content = readFileSync(path, "utf-8");
      expect(content).toContain(".png()");
    });
  });
});

describe("package.json scripts", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const scripts = pkg.scripts as Record<string, string>;

  const REQUIRED_SCRIPTS = [
    "dev",
    "build",
    "twa:prereqs",
    "twa:setup",
    "twa:keystore:debug",
    "twa:keystore:release",
    "twa:init",
    "twa:build",
    "deploy",
    "test",
    "validate",
  ];

  for (const name of REQUIRED_SCRIPTS) {
    it(`has "${name}" script`, () => {
      expect(scripts).toHaveProperty(name);
      expect(scripts[name].length).toBeGreaterThan(0);
    });
  }

  it("build runs tsc before vite", () => {
    expect(scripts.build).toMatch(/tsc.*&&.*vite/);
  });

  it("deploy runs build before wrangler", () => {
    expect(scripts.deploy).toContain("build");
    expect(scripts.deploy).toContain("wrangler");
  });

  it("twa:build uses --skipPwaValidation (bubblewrap handles validation)", () => {
    expect(scripts["twa:build"]).toContain("--skipPwaValidation");
  });
});
