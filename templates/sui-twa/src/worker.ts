/**
 * ThunderBun Cloudflare Worker entry point (Hono)
 *
 * Responsibilities:
 *   1. /api/sponsor — opt-in gas station for sponsored transactions
 *   2. /api/paid/* — x402 scaffold (ready for @x402/sui when it ships)
 *   3. Serve all other requests from ASSETS binding (Vite-built PWA)
 *
 * Docs:
 *   Workers: https://developers.cloudflare.com/workers/
 *   Hono:    https://hono.dev
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

export interface Env {
  /** Bound to the Vite dist/ folder — serves static assets with SPA fallback */
  ASSETS: Fetcher;

  /** Plain var from wrangler.toml [vars] — "testnet" | "mainnet" */
  NETWORK: string;

  /** Bech32 `suiprivkey1q...` — opt-in gas station (wrangler secret put) */
  SPONSOR_PRIVATE_KEY?: string;

  /** Max gas budget in MIST — defaults to 50_000_000 (0.05 SUI) */
  MAX_GAS_BUDGET?: string;

  /** Optional EVM sponsor private key (0x...) for Base/Base Sepolia gas top-ups */
  BASE_SPONSOR_PRIVATE_KEY?: string;

  /** Optional override RPC URL for Base sponsor transactions */
  BASE_SPONSOR_RPC_URL?: string;

  /** Amount to sponsor in wei (default 0.0002 ETH) */
  BASE_SPONSOR_AMOUNT_WEI?: string;

  /** Per-recipient cooldown window for sponsor top-ups (default 1800000 ms) */
  BASE_SPONSOR_COOLDOWN_MS?: string;

  /** CACHE Sui package ID (0x...) */
  CACHE_SUI_PACKAGE_ID?: string;

  /** CACHE bridge shared object ID (0x...) */
  CACHE_SUI_BRIDGE_ID?: string;

  /** Base vault contract address (0x...) */
  CACHE_BASE_VAULT_ADDRESS?: string;

  /** Shared bearer token used by relayer/attester automation */
  CACHE_RELAY_AUTH_TOKEN?: string;
}

const app = new Hono<{ Bindings: Env }>();
const baseSponsorLastSent = new Map<string, number>();

app.use("*", cors());

// ── Gas Station — opt-in sponsored transactions ─────────────────────────────

app.get("/api/sponsor/status", async (c) => {
  const secretKey = c.env.SPONSOR_PRIVATE_KEY;
  if (!secretKey) {
    return c.json({
      configured: false,
      sponsorAddress: null,
      maxGasBudget: null,
    });
  }

  const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");

  const { secretKey: raw } = decodeSuiPrivateKey(secretKey);
  const keypair = Ed25519Keypair.fromSecretKey(raw);

  return c.json({
    configured: true,
    sponsorAddress: keypair.toSuiAddress(),
    maxGasBudget: c.env.MAX_GAS_BUDGET ?? "50000000",
  });
});

app.post("/api/sponsor", async (c) => {
  const secretKey = c.env.SPONSOR_PRIVATE_KEY;
  if (!secretKey) {
    return c.json({ error: "Gas station not configured" }, 501);
  }

  const body = await c.req.json<{ txBytes: string; requiredSponsor?: string }>();
  if (!body.txBytes) {
    return c.json({ error: "Missing txBytes" }, 400);
  }

  const maxBudget = BigInt(c.env.MAX_GAS_BUDGET ?? "50000000");
  // TODO: parse gas budget from transaction BCS and validate against maxBudget
  void maxBudget;

  const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");

  const { secretKey: raw } = decodeSuiPrivateKey(secretKey);
  const keypair = Ed25519Keypair.fromSecretKey(raw);
  const sponsorAddress = keypair.toSuiAddress();

  if (
    body.requiredSponsor &&
    sponsorAddress.toLowerCase() !== body.requiredSponsor.toLowerCase()
  ) {
    return c.json({
      error: `Configured sponsor ${sponsorAddress} does not match required sponsor ${body.requiredSponsor}`,
    }, 400);
  }

  const txBytes = Uint8Array.from(atob(body.txBytes), (ch) => ch.charCodeAt(0));
  const { signature } = await keypair.signTransaction(txBytes);

  return c.json({
    sponsorSignature: signature,
    sponsorAddress,
  });
});

// ── Base gas sponsor (optional) ──────────────────────────────────────────────

app.get("/api/base-sponsor/status", (c) => {
  const configured = Boolean(c.env.BASE_SPONSOR_PRIVATE_KEY);
  return c.json({
    configured,
    amountWei: configured ? (c.env.BASE_SPONSOR_AMOUNT_WEI ?? "200000000000000") : null,
    cooldownMs: Number(c.env.BASE_SPONSOR_COOLDOWN_MS ?? "1800000"),
    network: c.env.NETWORK === "mainnet" ? "base" : "baseSepolia",
  });
});

app.post("/api/base-sponsor", async (c) => {
  const privateKey = c.env.BASE_SPONSOR_PRIVATE_KEY;
  if (!privateKey) {
    return c.json({ error: "Base sponsor is not configured." }, 501);
  }

  const rawBody = await c.req.json<{ recipient?: string }>().catch(() => null);
  const recipient = (rawBody?.recipient ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
    return c.json({ error: "Invalid recipient address." }, 400);
  }

  const now = Date.now();
  const cooldownMs = Number(c.env.BASE_SPONSOR_COOLDOWN_MS ?? "1800000");
  const lastSent = baseSponsorLastSent.get(recipient.toLowerCase()) ?? 0;
  if (cooldownMs > 0 && now - lastSent < cooldownMs) {
    const waitMs = cooldownMs - (now - lastSent);
    return c.json({ error: `Sponsor cooldown active. Try again in ${Math.ceil(waitMs / 1000)}s.` }, 429);
  }

  let amountWei: bigint;
  try {
    amountWei = BigInt(c.env.BASE_SPONSOR_AMOUNT_WEI ?? "200000000000000");
  } catch {
    return c.json({ error: "Invalid BASE_SPONSOR_AMOUNT_WEI." }, 500);
  }
  if (amountWei <= 0n) {
    return c.json({ error: "BASE_SPONSOR_AMOUNT_WEI must be > 0." }, 500);
  }

  try {
    const [{ createWalletClient, createPublicClient, http }, { privateKeyToAccount }, { base, baseSepolia }] = await Promise.all([
      import("viem"),
      import("viem/accounts"),
      import("viem/chains"),
    ]);

    const chain = c.env.NETWORK === "mainnet" ? base : baseSepolia;
    const rpcUrl = c.env.BASE_SPONSOR_RPC_URL?.trim() || chain.rpcUrls.default.http[0];
    const account = privateKeyToAccount(asHexPrivateKey(privateKey));

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const txHash = await walletClient.sendTransaction({
      account,
      to: recipient as `0x${string}`,
      value: amountWei,
      chain,
    });

    baseSponsorLastSent.set(recipient.toLowerCase(), now);

    void publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 60_000,
    }).catch(() => undefined);

    return c.json({
      txHash,
      recipient,
      amountWei: amountWei.toString(),
      network: chain.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Base sponsor failed: ${message}` }, 500);
  }
});

// ── x402 paywalled routes (scaffold — ready for @x402/sui) ─────────────────

app.use("/api/paid/*", async (c, next) => {
  // TODO: x402 Hono middleware when @x402/sui ships
  c.header("X-X402-Ready", "scaffold");
  await next();
});

app.get("/api/paid/example", (c) => {
  return c.json({
    message: "This endpoint will be paywalled via x402 + Sui USDC",
  });
});

// ── CACHE relay scaffold ─────────────────────────────────────────────────────

app.get("/api/cache-relay/status", (c) => {
  const configured = Boolean(
    c.env.CACHE_SUI_PACKAGE_ID &&
    c.env.CACHE_SUI_BRIDGE_ID &&
    c.env.CACHE_BASE_VAULT_ADDRESS,
  );

  return c.json({
    configured,
    network: c.env.NETWORK,
    packageId: c.env.CACHE_SUI_PACKAGE_ID ?? null,
    bridgeObjectId: c.env.CACHE_SUI_BRIDGE_ID ?? null,
    baseVaultAddress: c.env.CACHE_BASE_VAULT_ADDRESS ?? null,
    relayAuthConfigured: Boolean(c.env.CACHE_RELAY_AUTH_TOKEN),
  });
});

app.post("/api/cache-relay/mint", async (c) => {
  if (!isCacheRelayAuthorized(c.req.header("authorization"), c.env.CACHE_RELAY_AUTH_TOKEN)) {
    return c.json({ error: "Unauthorized cache relay request." }, 401);
  }

  const body = await c.req.json<{
    sourceChainId?: number;
    sourceNonce?: number;
    sourceTxHash?: string;
    recipient?: string;
    amount?: string;
    publicKeys?: string[];
    signatures?: string[];
  }>().catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  // This route intentionally remains a scaffold until attester verification,
  // event finality policy, and Sui tx submission are wired.
  return c.json({
    ok: false,
    status: "not_implemented",
    message: "CACHE mint relay scaffold is live; submission logic not wired yet.",
    received: {
      sourceChainId: body.sourceChainId ?? null,
      sourceNonce: body.sourceNonce ?? null,
      sourceTxHash: body.sourceTxHash ?? null,
      recipient: body.recipient ?? null,
      amount: body.amount ?? null,
      publicKeyCount: Array.isArray(body.publicKeys) ? body.publicKeys.length : 0,
      signatureCount: Array.isArray(body.signatures) ? body.signatures.length : 0,
    },
  }, 501);
});

// ── Static assets fallback ──────────────────────────────────────────────────

app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

function asHexPrivateKey(value: string): `0x${string}` {
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
    throw new Error("Invalid BASE_SPONSOR_PRIVATE_KEY format.");
  }
  return trimmed as `0x${string}`;
}

function isCacheRelayAuthorized(
  authorizationHeader: string | undefined,
  configuredToken: string | undefined,
): boolean {
  if (!configuredToken) return false;
  const header = authorizationHeader?.trim() ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return false;
  return token === configuredToken.trim();
}
