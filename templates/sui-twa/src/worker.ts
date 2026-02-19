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
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// ── Gas Station — opt-in sponsored transactions ─────────────────────────────

app.post("/api/sponsor", async (c) => {
  const secretKey = c.env.SPONSOR_PRIVATE_KEY;
  if (!secretKey) {
    return c.json({ error: "Gas station not configured" }, 501);
  }

  const body = await c.req.json<{ txBytes: string }>();
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

  const txBytes = Uint8Array.from(atob(body.txBytes), (ch) => ch.charCodeAt(0));
  const { signature } = await keypair.signTransaction(txBytes);

  return c.json({
    sponsorSignature: signature,
    sponsorAddress: keypair.toSuiAddress(),
  });
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

// ── Static assets fallback ──────────────────────────────────────────────────

app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
