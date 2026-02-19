/**
 * grpc-migration.test.ts — Validates the JSON-RPC → gRPC migration.
 *
 * Verifies:
 *   1. Core client uses SuiGrpcClient (not SuiJsonRpcClient)
 *   2. wallet.ts types and balance API match gRPC response shape
 *   3. SuiNS uses SDK getNameRecord() for forward, gRPC defaultNameServiceName for reverse
 *   4. NFTs use listOwnedObjects with json include (not getOwnedObjects/showDisplay)
 *   5. Ika keeps isolated JSON-RPC (expected exception)
 *   6. Settings MVR example references gRPC
 *   7. sui-client.ts SDK clients are unaffected (no JSON-RPC dependency)
 *   8. No stale JSON-RPC references leak into main app code
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = join(__dirname, "../src");

function readSrc(file: string): string {
  return readFileSync(join(SRC, file), "utf-8");
}

// ── Phase 1: dapp-kit.ts ────────────────────────────────────────────────────

describe("dapp-kit.ts — core client", () => {
  const src = readSrc("dapp-kit.ts");

  it("imports SuiGrpcClient from @mysten/sui/grpc", () => {
    expect(src).toContain('import { SuiGrpcClient } from "@mysten/sui/grpc"');
  });

  it("does NOT import from @mysten/sui/jsonRpc", () => {
    expect(src).not.toContain("@mysten/sui/jsonRpc");
  });

  it("does NOT reference SuiJsonRpcClient", () => {
    expect(src).not.toContain("SuiJsonRpcClient");
  });

  it("does NOT reference getJsonRpcFullnodeUrl", () => {
    expect(src).not.toContain("getJsonRpcFullnodeUrl");
  });

  it("constructs SuiGrpcClient with baseUrl (not url)", () => {
    expect(src).toContain("new SuiGrpcClient");
    expect(src).toContain("baseUrl:");
    // Ensure old `url:` key isn't used (ignoring comments/docs)
    const constructorBlock = src.slice(src.indexOf("new SuiGrpcClient"));
    expect(constructorBlock).not.toMatch(/\burl:/);
  });

  it("uses template literal for fullnode endpoint", () => {
    expect(src).toMatch(/`https:\/\/fullnode\.\$\{.+\}\.sui\.io:443`/);
  });

  it("enables MVR via mvr: {}", () => {
    expect(src).toContain("mvr: {}");
  });

  it("passes network to constructor", () => {
    expect(src).toMatch(/network:\s*net/);
  });
});

// ── Phase 2: wallet.ts ──────────────────────────────────────────────────────

describe("wallet.ts — types and balance", () => {
  const src = readSrc("wallet.ts");

  it("imports SuiGrpcClient type from @mysten/sui/grpc", () => {
    expect(src).toContain("@mysten/sui/grpc");
    expect(src).toContain("SuiGrpcClient");
  });

  it("does NOT import from @mysten/sui/jsonRpc", () => {
    expect(src).not.toContain("@mysten/sui/jsonRpc");
  });

  it("getClient() returns SuiGrpcClient", () => {
    expect(src).toMatch(/getClient\(\):\s*SuiGrpcClient/);
  });

  it("uses gRPC balance response shape (balance.balance, not totalBalance)", () => {
    expect(src).not.toContain("totalBalance");
    expect(src).toContain("balance.balance");
  });

  it("still calls getBalance with owner and coinType", () => {
    expect(src).toContain("client.getBalance");
    expect(src).toContain("0x2::sui::SUI");
  });
});

// ── Phase 3: suins.ts ───────────────────────────────────────────────────────

describe("suins.ts — SuiNS resolution", () => {
  const src = readSrc("sections/suins.ts");

  describe("forward lookup", () => {
    it("uses getSuinsClient().getNameRecord() for forward lookup", () => {
      expect(src).toContain("getSuinsClient().getNameRecord(");
    });

    it("extracts targetAddress from name record", () => {
      expect(src).toContain("targetAddress");
    });

    it("does NOT use resolveNameServiceAddress", () => {
      expect(src).not.toContain("resolveNameServiceAddress");
    });
  });

  describe("reverse lookup", () => {
    it("uses defaultNameServiceName for reverse lookup", () => {
      expect(src).toContain("defaultNameServiceName");
    });

    it("does NOT use resolveNameServiceNames (paginated JSON-RPC)", () => {
      expect(src).not.toContain("resolveNameServiceNames");
    });

    it("does NOT have pagination logic (cursor/hasMore/hasNextPage)", () => {
      expect(src).not.toContain("hasNextPage");
      expect(src).not.toContain("nextCursor");
      // "cursor" may appear in other contexts, so check for the paginated pattern
      expect(src).not.toMatch(/let\s+cursor/);
    });
  });

  describe("UI text", () => {
    it("does NOT reference suix_resolveNameServiceAddress", () => {
      expect(src).not.toContain("suix_resolveNameServiceAddress");
    });

    it("does NOT reference suix_resolveNameServiceNames", () => {
      expect(src).not.toContain("suix_resolveNameServiceNames");
    });

    it("mentions getNameRecord in a card note", () => {
      expect(src).toContain("getNameRecord()");
    });

    it("mentions defaultNameServiceName in a card note", () => {
      expect(src).toContain("defaultNameServiceName()");
    });

    it("describes reverse as 'default name' not 'all names'", () => {
      expect(src).toContain("default name");
      expect(src).not.toMatch(/all names pointing to/i);
    });
  });

  describe("module header", () => {
    it("doc comment references SuiNS SDK + gRPC", () => {
      const header = src.slice(0, src.indexOf("import"));
      expect(header).toContain("SuinsClient.getNameRecord");
      expect(header).toContain("defaultNameServiceName");
    });
  });
});

// ── Phase 4: nft.ts ─────────────────────────────────────────────────────────

describe("nft.ts — NFT browsing", () => {
  const src = readSrc("sections/nft.ts");

  it("uses listOwnedObjects (gRPC) instead of getOwnedObjects (JSON-RPC)", () => {
    expect(src).toContain("listOwnedObjects");
    expect(src).not.toContain("getOwnedObjects");
  });

  it("uses include: { json: true } (gRPC) instead of options/showDisplay", () => {
    expect(src).toContain("include:");
    expect(src).toContain("json: true");
    expect(src).not.toContain("showDisplay");
    expect(src).not.toContain("showType");
  });

  it("destructures { objects } from response (not { data })", () => {
    expect(src).toMatch(/const\s*\{\s*objects\s*\}/);
    // Make sure we're not doing `const { data }` for the listing response
    // (data is fine elsewhere, e.g. TradePort)
    const listBlock = src.slice(src.indexOf("listOwnedObjects"), src.indexOf("listOwnedObjects") + 200);
    expect(listBlock).not.toMatch(/const\s*\{\s*data\s*\}/);
  });

  it("reads NFT fields from o.json (not o.data?.display?.data)", () => {
    expect(src).toContain("o.json");
    expect(src).not.toContain("display?.data");
    expect(src).not.toContain(".display.");
  });

  it("reads objectId from o.objectId (not o.data?.objectId)", () => {
    expect(src).toContain("o.objectId");
    // Ensure we're not using old nested path for object listing
    expect(src).not.toMatch(/o\.data\?\.objectId/);
  });

  it("includes url as fallback for image (gRPC struct fields)", () => {
    // gRPC json may have "url" instead of "image_url"
    expect(src).toContain('"url"');
  });
});

// ── Phase 5: sui-client.ts — SDK clients ────────────────────────────────────

describe("sui-client.ts — SDK client singletons", () => {
  const src = readSrc("sui-client.ts");

  it("does NOT import from @mysten/sui/jsonRpc", () => {
    expect(src).not.toContain("@mysten/sui/jsonRpc");
  });

  it("does NOT reference SuiJsonRpcClient", () => {
    expect(src).not.toContain("SuiJsonRpcClient");
  });

  it("passes wallet.getClient() to SealClient", () => {
    expect(src).toContain("suiClient: wallet.getClient()");
  });

  it("passes wallet.getClient() to DeepBookClient", () => {
    expect(src).toContain("client: wallet.getClient()");
  });

  it("passes wallet.getClient() to WalrusClient", () => {
    expect(src).toContain("suiClient: wallet.getClient()");
  });

  it("exports getSealClient, getDeepBookClient, getWalrusClient", () => {
    expect(src).toContain("export function getSealClient");
    expect(src).toContain("export function getDeepBookClient");
    expect(src).toContain("export function getWalrusClient");
  });
});

// ── Phase 6: ika.ts — isolated JSON-RPC (expected) ─────────────────────────

describe("ika.ts — isolated JSON-RPC exception", () => {
  const src = readSrc("sections/ika.ts");

  it("uses dynamic import for @mysten/sui/jsonRpc", () => {
    expect(src).toMatch(/await import\(["']@mysten\/sui\/jsonRpc["']\)/);
  });

  it("has isolation comment explaining why JSON-RPC is used", () => {
    expect(src).toMatch(/Ika SDK.*requires.*v1\.x.*isolated/i);
  });

  it("uses SuiJsonRpcClient with getJsonRpcFullnodeUrl (inside dynamic import)", () => {
    expect(src).toContain("new SuiJsonRpcClient");
    expect(src).toContain("getJsonRpcFullnodeUrl");
  });

  it("passes client as never for type compatibility", () => {
    expect(src).toContain("as never");
  });

  it("does NOT import SuiJsonRpcClient at the top level", () => {
    // Only top-level imports should be wallet
    const topImports = src.slice(0, src.indexOf("export function") || src.indexOf("interface"));
    expect(topImports).not.toContain("SuiJsonRpcClient");
    expect(topImports).not.toContain("@mysten/sui/jsonRpc");
  });
});

// ── Phase 7: settings.ts — MVR code example ─────────────────────────────────

describe("settings.ts — MVR code example", () => {
  const src = readSrc("sections/settings.ts");

  it("references SuiGrpcClient in MVR description", () => {
    expect(src).toContain("SuiGrpcClient");
  });

  it("does NOT reference SuiJsonRpcClient", () => {
    expect(src).not.toContain("SuiJsonRpcClient");
  });

  it("shows baseUrl in code example (not url)", () => {
    expect(src).toContain("baseUrl:");
  });

  it("does NOT reference getJsonRpcFullnodeUrl", () => {
    expect(src).not.toContain("getJsonRpcFullnodeUrl");
  });

  it("MVR example shows fullnode endpoint with network variable", () => {
    expect(src).toContain("fullnode.");
    expect(src).toContain(".sui.io:443");
    expect(src).toContain("network");
  });
});

// ── Phase 8: passkeys.ts ─────────────────────────────────────────────────────

describe("passkeys.ts — WebAuthn passkeys", () => {
  const src = readSrc("sections/passkeys.ts");

  it("dynamically imports from @mysten/sui/keypairs/passkey", () => {
    expect(src).toContain("@mysten/sui/keypairs/passkey");
  });

  it("uses BrowserPasskeyProvider with rp.id for cross-subdomain", () => {
    expect(src).toContain("BrowserPasskeyProvider");
    expect(src).toContain("rp: { id:");
  });

  it("uses PasskeyKeypair.getPasskeyInstance for registration", () => {
    expect(src).toContain("PasskeyKeypair");
    expect(src).toContain("getPasskeyInstance");
  });

  it("uses signAndRecover for authentication", () => {
    expect(src).toContain("signAndRecover");
  });

  it("extracts root domain for rpId", () => {
    expect(src).toContain("getRootDomain");
    expect(src).toContain("rpId");
  });

  it("does NOT import from @mysten/sui/jsonRpc", () => {
    expect(src).not.toContain("@mysten/sui/jsonRpc");
  });
});

// ── Phase 9: wallet.ts — sponsored transactions ─────────────────────────────

describe("wallet.ts — sponsored transactions", () => {
  const src = readSrc("wallet.ts");

  it("has buildSponsoredTx method", () => {
    expect(src).toContain("buildSponsoredTx");
  });

  it("has executeSponsoredTx method", () => {
    expect(src).toContain("executeSponsoredTx");
  });

  it("sets gasOwner in buildSponsoredTx", () => {
    expect(src).toContain("setGasOwner");
  });

  it("dynamically imports Transaction from @mysten/sui/transactions", () => {
    expect(src).toContain("@mysten/sui/transactions");
  });
});

// ── Phase 10: worker.ts — Hono router ───────────────────────────────────────

describe("worker.ts — Hono router", () => {
  const src = readSrc("worker.ts");

  it("uses Hono router", () => {
    expect(src).toContain('import { Hono } from "hono"');
  });

  it("has /api/sponsor endpoint", () => {
    expect(src).toContain("/api/sponsor");
  });

  it("uses Ed25519Keypair for sponsor signing", () => {
    expect(src).toContain("Ed25519Keypair");
  });

  it("has x402 scaffold routes", () => {
    expect(src).toContain("/api/paid");
    expect(src).toContain("X-X402-Ready");
  });

  it("exports Env interface with SPONSOR_PRIVATE_KEY", () => {
    expect(src).toContain("SPONSOR_PRIVATE_KEY");
  });

  it("routes agents via routeAgentRequest", () => {
    expect(src).toContain("routeAgentRequest");
  });

  it("does NOT use manual if/else routing", () => {
    expect(src).not.toContain("if (url.pathname.startsWith");
  });
});

// ── Cross-cutting: no stale JSON-RPC in main app code ───────────────────────

describe("cross-cutting — no stale JSON-RPC references", () => {
  const appFiles = [
    "dapp-kit.ts",
    "wallet.ts",
    "sui-client.ts",
    "sections/suins.ts",
    "sections/nft.ts",
    "sections/settings.ts",
    "sections/deepbook.ts",
    "sections/seal.ts",
    "sections/walrus.ts",
    "sections/home.ts",
    "sections/passkeys.ts",
  ];

  for (const file of appFiles) {
    describe(file, () => {
      let src: string;
      try {
        src = readSrc(file);
      } catch {
        // File may not exist (e.g. home.ts) — skip
        return;
      }

      it("does NOT import from @mysten/sui/jsonRpc", () => {
        expect(src).not.toContain("from \"@mysten/sui/jsonRpc\"");
        expect(src).not.toContain("from '@mysten/sui/jsonRpc'");
      });

      it("does NOT reference getJsonRpcFullnodeUrl", () => {
        expect(src).not.toContain("getJsonRpcFullnodeUrl");
      });
    });
  }

  it("ika.ts is the ONLY file using SuiJsonRpcClient", () => {
    const allSources = appFiles.map((f) => {
      try { return { file: f, src: readSrc(f) }; }
      catch { return null; }
    }).filter(Boolean) as { file: string; src: string }[];

    const filesWithJsonRpc = allSources.filter((s) =>
      s.src.includes("SuiJsonRpcClient")
    );
    expect(filesWithJsonRpc.map((f) => f.file)).toEqual([]);
  });
});
