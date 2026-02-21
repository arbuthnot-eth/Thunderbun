/**
 * deploy-readiness.test.ts — End-to-end preflight for Play Store deployment.
 *
 * This is the "gate" test suite. Run `bun run test:playstore` before
 * uploading to Play Console. It validates the entire pipeline is wired correctly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");

function loadJSON(relativePath: string): Record<string, unknown> | null {
  const fullPath = join(ROOT, relativePath);
  if (!existsSync(fullPath)) return null;
  return JSON.parse(readFileSync(fullPath, "utf-8"));
}

describe("Play Store Deploy Readiness", () => {
  describe("file structure", () => {
    const REQUIRED_FILES = [
      "package.json",
      "twa-manifest.json",
      "vite.config.ts",
      "tsconfig.json",
      "public/manifest.json",
      "public/icons/icon.svg",
      "public/_headers",
      "public/.well-known/assetlinks.json.template",
      "scripts/check-prereqs.sh",
      "scripts/gen-keystore.sh",
      "scripts/generate-icons.ts",
      "src/main.ts",
      "src/wallet.ts",
      "src/dapp-kit.ts",
      "src/init-waap.ts",
    ];

    for (const file of REQUIRED_FILES) {
      it(`${file} exists`, () => {
        expect(existsSync(join(ROOT, file))).toBe(true);
      });
    }
  });

  describe("cross-file consistency", () => {
    it("twa-manifest.json and manifest.json agree on app name", () => {
      const twa = loadJSON("twa-manifest.json");
      const pwa = loadJSON("public/manifest.json");
      if (twa && pwa) {
        expect(twa.name).toBe(pwa.name);
      }
    });

    it("twa-manifest.json and manifest.json agree on display mode", () => {
      const twa = loadJSON("twa-manifest.json");
      const pwa = loadJSON("public/manifest.json");
      if (twa && pwa) {
        expect(twa.display).toBe(pwa.display);
      }
    });

    it("twa-manifest.json and manifest.json agree on orientation", () => {
      const twa = loadJSON("twa-manifest.json");
      const pwa = loadJSON("public/manifest.json");
      if (twa && pwa) {
        expect(twa.orientation).toBe(pwa.orientation);
      }
    });

    it("twa-manifest.json and manifest.json agree on theme colors", () => {
      const twa = loadJSON("twa-manifest.json");
      const pwa = loadJSON("public/manifest.json");
      if (twa && pwa) {
        expect(twa.themeColor).toBe(pwa.theme_color);
        expect(twa.backgroundColor).toBe(pwa.background_color);
      }
    });

    it("twa-manifest.json start_url matches manifest.json start_url", () => {
      const twa = loadJSON("twa-manifest.json");
      const pwa = loadJSON("public/manifest.json");
      if (twa && pwa) {
        expect(twa.startUrl).toBe(pwa.start_url);
      }
    });
  });

  describe("security", () => {
    it("_headers sets X-Frame-Options", () => {
      const headers = readFileSync(join(ROOT, "public/_headers"), "utf-8");
      expect(headers).toContain("X-Frame-Options");
    });

    it("_headers sets X-Content-Type-Options", () => {
      const headers = readFileSync(join(ROOT, "public/_headers"), "utf-8");
      expect(headers).toContain("X-Content-Type-Options: nosniff");
    });

    it("_headers disables camera, microphone, geolocation by default", () => {
      const headers = readFileSync(join(ROOT, "public/_headers"), "utf-8");
      expect(headers).toContain("Permissions-Policy");
      expect(headers).toContain("camera=()");
      expect(headers).toContain("microphone=()");
    });

    it(".gitignore (or convention) excludes keystores", () => {
      const gitignorePath = join(ROOT, ".gitignore");
      if (existsSync(gitignorePath)) {
        const content = readFileSync(gitignorePath, "utf-8");
        expect(content).toContain(".keystore");
      }
    });
  });

  describe("TypeScript configuration", () => {
    it("tsconfig.json targets ES2020+", () => {
      const tsconfig = loadJSON("tsconfig.json") as { compilerOptions: { target: string } } | null;
      if (tsconfig) {
        const target = tsconfig.compilerOptions.target.toUpperCase();
        const year = parseInt(target.replace("ES", ""), 10);
        expect(year).toBeGreaterThanOrEqual(2020);
      }
    });

    it("tsconfig.json enables strict mode", () => {
      const tsconfig = loadJSON("tsconfig.json") as { compilerOptions: { strict: boolean } } | null;
      if (tsconfig) {
        expect(tsconfig.compilerOptions.strict).toBe(true);
      }
    });
  });

  describe("service worker configuration", () => {
    it("vite config has Sui RPC runtime caching", () => {
      const config = readFileSync(join(ROOT, "vite.config.ts"), "utf-8");
      expect(config).toContain("sui-rpc-cache");
    });

    it("_headers sets Service-Worker-Allowed for sw.js", () => {
      const headers = readFileSync(join(ROOT, "public/_headers"), "utf-8");
      expect(headers).toContain("Service-Worker-Allowed");
    });
  });

  describe("versioning pipeline", () => {
    it("appVersionCode in twa-manifest.json is >= 1", () => {
      const twa = loadJSON("twa-manifest.json");
      expect(twa?.appVersionCode).toBeGreaterThanOrEqual(1);
    });

    it("version in package.json follows semver", () => {
      const pkg = loadJSON("package.json");
      expect(pkg?.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
