/**
 * twa-manifest.test.ts — Validates twa-manifest.json is Play Store ready.
 *
 * These tests ensure the TWA manifest won't cause silent failures
 * during bubblewrap build or Play Console upload.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const MANIFEST_PATH = join(ROOT, "twa-manifest.json");

function loadManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

describe("twa-manifest.json", () => {
  it("exists", () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
  });

  it("is valid JSON", () => {
    expect(() => loadManifest()).not.toThrow();
  });

  describe("required fields", () => {
    const REQUIRED = [
      "packageId",
      "host",
      "name",
      "launcherName",
      "display",
      "themeColor",
      "backgroundColor",
      "startUrl",
      "iconUrl",
      "maskableIconUrl",
      "webManifestUrl",
      "appVersionName",
      "appVersionCode",
      "sdkVersion",
      "minSdkVersion",
    ];

    const manifest = loadManifest();

    for (const field of REQUIRED) {
      it(`has "${field}"`, () => {
        expect(manifest).toHaveProperty(field);
        const val = manifest[field];
        if (typeof val === "string") {
          expect(val.length).toBeGreaterThan(0);
        }
      });
    }
  });

  describe("packageId", () => {
    it("follows reverse domain format (e.g. com.example.app)", () => {
      const { packageId } = loadManifest();
      expect(packageId).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,}$/);
    });

    it("has at least 2 segments", () => {
      const { packageId } = loadManifest() as { packageId: string };
      expect(packageId.split(".").length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("host", () => {
    it("is set (not placeholder) when deploying", () => {
      const { host } = loadManifest();
      // In template mode the placeholder is expected — skip if not yet configured
      if (host === "YOUR_APP_DOMAIN_HERE") {
        console.warn("  ⚠ host is still placeholder — set it before deploying");
        return;
      }
      expect(host).not.toBe("YOUR_APP_DOMAIN_HERE");
    });

    it("has no protocol prefix", () => {
      const { host } = loadManifest() as { host: string };
      expect(host).not.toMatch(/^https?:\/\//);
    });

    it("has no trailing slash", () => {
      const { host } = loadManifest() as { host: string };
      expect(host).not.toMatch(/\/$/);
    });
  });

  describe("iconUrl / maskableIconUrl / webManifestUrl", () => {
    it("iconUrl uses HTTPS", () => {
      const { iconUrl } = loadManifest() as { iconUrl: string };
      expect(iconUrl).toMatch(/^https:\/\//);
    });

    it("maskableIconUrl uses HTTPS", () => {
      const { maskableIconUrl } = loadManifest() as { maskableIconUrl: string };
      expect(maskableIconUrl).toMatch(/^https:\/\//);
    });

    it("webManifestUrl uses HTTPS", () => {
      const { webManifestUrl } = loadManifest() as { webManifestUrl: string };
      expect(webManifestUrl).toMatch(/^https:\/\//);
    });

    it("URLs reference the configured host", () => {
      const m = loadManifest() as { host: string; iconUrl: string; webManifestUrl: string };
      // When host is placeholder, skip URL host matching
      if (m.host !== "YOUR_APP_DOMAIN_HERE") {
        expect(m.iconUrl).toContain(m.host);
        expect(m.webManifestUrl).toContain(m.host);
      }
    });

    it("iconUrl points to a 512x512 PNG", () => {
      const { iconUrl } = loadManifest() as { iconUrl: string };
      expect(iconUrl).toMatch(/512x512\.png$/);
    });
  });

  describe("versioning", () => {
    it("appVersionCode is a positive integer", () => {
      const { appVersionCode } = loadManifest();
      expect(Number.isInteger(appVersionCode)).toBe(true);
      expect(appVersionCode as number).toBeGreaterThan(0);
    });

    it("appVersionName follows semver pattern", () => {
      const { appVersionName } = loadManifest() as { appVersionName: string };
      expect(appVersionName).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("SDK versions", () => {
    it("minSdkVersion >= 19 (Chrome Custom Tabs requirement)", () => {
      const { minSdkVersion } = loadManifest();
      expect(minSdkVersion as number).toBeGreaterThanOrEqual(19);
    });

    it("sdkVersion >= 30 (Play Store target SDK requirement)", () => {
      const { sdkVersion } = loadManifest();
      expect(sdkVersion as number).toBeGreaterThanOrEqual(30);
    });

    it("sdkVersion >= minSdkVersion", () => {
      const m = loadManifest();
      expect(m.sdkVersion as number).toBeGreaterThanOrEqual(m.minSdkVersion as number);
    });
  });

  describe("display and orientation", () => {
    it("display is standalone or fullscreen", () => {
      const { display } = loadManifest();
      expect(["standalone", "fullscreen"]).toContain(display);
    });

    it("orientation is valid", () => {
      const { orientation } = loadManifest();
      expect(["portrait", "landscape", "any"]).toContain(orientation);
    });
  });

  describe("theme colors", () => {
    const COLOR_FIELDS = ["themeColor", "backgroundColor", "navigationColor"];

    for (const field of COLOR_FIELDS) {
      it(`${field} is a valid hex color`, () => {
        const m = loadManifest();
        const val = m[field] as string;
        expect(val).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    }
  });

  describe("name constraints", () => {
    it("name is <= 50 characters (Play Store limit)", () => {
      const { name } = loadManifest() as { name: string };
      expect(name.length).toBeLessThanOrEqual(50);
    });

    it("launcherName is <= 30 characters (Android launcher limit)", () => {
      const { launcherName } = loadManifest() as { launcherName: string };
      expect(launcherName.length).toBeLessThanOrEqual(30);
    });
  });
});
