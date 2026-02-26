/**
 * Thunderbun Cloudflare Worker entry point (Hono)
 *
 * Responsibilities:
 *   1. /api/sponsor — opt-in gas station for sponsored transactions
 *   2. /api/ika-deposit/* — managed dWallet-style Base->Sui USDC flow
 *   3. /api/paid/* — x402 scaffold (ready for @x402/sui when it ships)
 *   4. /agents/* — sui.ski SessionAgent Durable Object WebSocket proxy
 *   5. Serve all other requests from ASSETS binding (Vite-built PWA)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { agentsMiddleware } from "hono-agents";

// Re-export the .SKI session Durable Object so wrangler can bind it.
// Add to wrangler.toml:
//   [[durable_objects.bindings]]
//   name = "SESSION_AGENT"
//   class_name = "SessionAgent"
//   [[migrations]]
//   tag = "v1"
//   new_sqlite_classes = ["SessionAgent"]
// @ts-expect-error — sui.ski doesn't export src/ paths in package.json but wrangler/esbuild resolve them fine
export { SessionAgent } from "sui.ski/src/server/agents/session";

export interface Env {
  /** Bound to the Vite dist/ folder — serves static assets with SPA fallback */
  ASSETS: Fetcher;

  /** .SKI session Durable Object — optional, enables server-side session persistence */
  SESSION_AGENT?: DurableObjectNamespace;

  /** Plain var from wrangler.toml [vars] — "testnet" | "mainnet" */
  NETWORK: string;

  /** Bech32 `suiprivkey1q...` — opt-in gas station + Ika settlement signer */
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

  /** Required for deterministic per-user managed Base deposit signers */
  IKA_DWALLET_MASTER_SEED?: string;

  /** Optional Base RPC override for Ika deposit scan/settle */
  IKA_BASE_RPC_URL?: string;

  /** Optional max burn per deposit in raw USDC (6 decimals) */
  IKA_POLICY_MAX_BURN_RAW?: string;

  /** Optional policy session TTL (ms). 0 or missing means no expiry */
  IKA_POLICY_SESSION_MS?: string;

  /** Optional scan lookback in blocks for first sync */
  IKA_SCAN_LOOKBACK_BLOCKS?: string;

  /** Optional minimum confirmations before burn (default 2) */
  IKA_MIN_BASE_CONFIRMATIONS?: string;

  /** Optional min deposit amount in raw USDC (default 1_000) */
  IKA_MIN_DEPOSIT_RAW?: string;

  /** Enable automatic Sui mint after attestation (default true) */
  IKA_AUTO_SETTLE?: string;

  /** Optional Sui fullnode URL for mint execution */
  IKA_SUI_FULLNODE_URL?: string;

  /** Optional mint gas budget in MIST (default 50_000_000) */
  IKA_MINT_GAS_BUDGET?: string;

  /** Optional CCTP overrides */
  IKA_BASE_USDC_ADDRESS?: string;
  IKA_BASE_TOKEN_MESSENGER?: string;
  IKA_BASE_DOMAIN?: string;
  IKA_SUI_DOMAIN?: string;
  IKA_CIRCLE_IRIS_URL?: string;
  IKA_SUI_MESSAGE_TRANSMITTER_PKG?: string;
  IKA_SUI_TOKEN_MESSENGER_MINTER_PKG?: string;
  IKA_SUI_MESSAGE_TRANSMITTER_STATE?: string;
  IKA_SUI_TOKEN_MESSENGER_MINTER_STATE?: string;
  IKA_SUI_USDC_TREASURY?: string;
  IKA_SUI_DENY_LIST?: string;
  IKA_SUI_USDC_TYPE?: string;
}

// Keep legacy Durable Object class name exported so Cloudflare can accept new versions.
export class ProofAgent {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(): Promise<Response> {
    void this.state;
    void this.env;
    return new Response("ProofAgent is not configured in this deployment.", {
      status: 410,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

const app = new Hono<{ Bindings: Env }>();
const baseSponsorLastSent = new Map<string, number>();

const ikaProfiles = new Map<string, IkaDepositProfile>();
const ikaDeposits = new Map<string, Map<string, IkaDepositRecord>>();

const BASE_USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_USDC_TESTNET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TOKEN_MESSENGER_MAINNET = "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962";
const TOKEN_MESSENGER_TESTNET = "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5";

const SUI_MT_PKG_MAINNET = "0x08d87d37ba49e785dde270a83f8e979605b03dc552b5548f26fdf2f49bf7ed1b";
const SUI_TMM_PKG_MAINNET = "0x2aa6c5d56376c371f88a6cc42e852824994993cb9bab8d3e6450cbe3cb32b94e";
const SUI_MT_STATE_MAINNET = "0xf68268c3d9b1df3215f2439400c1c4ea08ac4ef4bb7d6f3ca6a2a239e17510af";
const SUI_TMM_STATE_MAINNET = "0x45993eecc0382f37419864992c12faee2238f5cfe22b98ad3bf455baf65c8a2f";
const SUI_USDC_TREASURY_MAINNET = "0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7";

const SUI_MT_PKG_TESTNET = "0x4931e06dce648b3931f890035bd196920770e913e43e45990b383f6486fdd0a5";
const SUI_TMM_PKG_TESTNET = "0x31cc14d80c175ae39777c0238f20594c6d4869cfab199f40b69f3319956b8beb";
const SUI_MT_STATE_TESTNET = "0x98234bd0fa9ac12cc0a20a144a22e36d6a32f7e0a97baaeaf9c76cdc6d122d2e";
const SUI_TMM_STATE_TESTNET = "0x5252abd1137094ed1db3e0d75bc36abcd287aee4bc310f8e047727ef5682e7c2";
const SUI_USDC_TREASURY_TESTNET = "0x7170137d4a6431bf83351ac025baf462909bffe2877d87716374fb42b9629ebe";

const SUI_USDC_TYPE = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a22f7c92c4e";
const MESSAGE_SENT_TOPIC = "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";
const APPROVE_SELECTOR = "0x095ea7b3";
const ALLOWANCE_SELECTOR = "0xdd62ed3e";
const MAX_UINT256 = (1n << 256n) - 1n;

const DEFAULT_POLICY_MAX_BURN_RAW = 5_000_000_000n;
const DEFAULT_SCAN_LOOKBACK_BLOCKS = 60_000n;
const DEFAULT_MIN_CONFIRMATIONS = 2n;
const DEFAULT_MIN_DEPOSIT_RAW = 1_000n;
const DEFAULT_MINT_GAS_BUDGET = 50_000_000n;

type IkaDepositStatus =
  | "detected"
  | "policy_blocked"
  | "burn_submitted"
  | "attesting"
  | "attested"
  | "minted"
  | "failed";

interface IkaPolicy {
  active: boolean;
  approvedAtMs: number;
  maxBurnRaw: bigint;
  sessionMs: number | null;
  expiresAtMs: number | null;
  allowedToken: `0x${string}`;
  allowedBurnContract: `0x${string}`;
  destinationDomain: number;
}

interface IkaDepositProfile {
  suiAddress: string;
  managedSignerMode: "deterministic-managed";
  managedPrivateKey: `0x${string}`;
  depositAddress: `0x${string}`;
  network: "base" | "baseSepolia";
  baseRpcUrl: string;
  baseDomain: number;
  suiDomain: number;
  irisApiUrl: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastScannedBlock: bigint | null;
  policy: IkaPolicy;
}

interface IkaDepositRecord {
  id: string;
  txHash: `0x${string}`;
  logIndexHex: string;
  blockNumber: bigint;
  from: `0x${string}`;
  to: `0x${string}`;
  amountRaw: bigint;
  status: IkaDepositStatus;
  createdAtMs: number;
  updatedAtMs: number;
  burnTxHash: `0x${string}` | null;
  messageHash: `0x${string}` | null;
  messageBytesHex: `0x${string}` | null;
  attestation: `0x${string}` | null;
  attestationStatus: string | null;
  attestationDelayReason: string | null;
  mintDigest: string | null;
  failureReason: string | null;
  burnAttempts: number;
  attestationChecks: number;
  mintAttempts: number;
}

interface IkaSyncReport {
  profile: ReturnType<typeof serializeIkaProfile>;
  deposits: ReturnType<typeof serializeIkaDeposit>[];
  newlyDetected: number;
  processed: number;
  latestBlock: string;
  autoSettle: boolean;
  sponsorReady: boolean;
}

interface IkaRegisterBody {
  suiAddress?: string;
  policy?: {
    maxBurnRaw?: string;
    sessionMs?: number | null;
    active?: boolean;
  };
}

interface IkaSyncBody {
  suiAddress?: string;
  force?: boolean;
  maxProcess?: number;
}

interface EthLogEntry {
  transactionHash?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  logIndex?: string;
}

interface IrisV2Message {
  status: string;
  attestation: `0x${string}` | null;
  message: `0x${string}` | null;
  delayReason: string | null;
  cctpVersion: number;
  destinationTxHash: string | null;
}

app.use("*", cors());

// ── .SKI session agent (Durable Object WebSocket proxy) ─────────────────────
// Handles WS upgrades for ski.ski's AgentClient session persistence.
// Requires SESSION_AGENT binding in wrangler.toml to be active.
app.use("/agents/*", agentsMiddleware());

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

// ── Ika deposit flow (managed signer adapter) ───────────────────────────────

app.get("/api/ika-deposit/config", async (c) => {
  const cfg = resolveIkaConfig(c.env);
  const sponsorAddress = await resolveSuiSponsorAddress(c.env.SPONSOR_PRIVATE_KEY);

  return c.json({
    configured: cfg.enabled,
    reason: cfg.enabled ? null : "IKA_DWALLET_MASTER_SEED is required.",
    signerMode: "deterministic-managed",
    network: cfg.network,
    baseRpcUrl: cfg.baseRpcUrl,
    baseDomain: cfg.baseDomain,
    suiDomain: cfg.suiDomain,
    minDepositRaw: cfg.minDepositRaw.toString(),
    minConfirmations: cfg.minConfirmations.toString(),
    policyDefaults: {
      maxBurnRaw: cfg.policyMaxBurnRaw.toString(),
      sessionMs: cfg.policySessionMs,
      autoSettle: cfg.autoSettle,
    },
    cctp: {
      baseUsdc: cfg.baseUsdc,
      tokenMessenger: cfg.baseTokenMessenger,
      irisApiUrl: cfg.irisApiUrl,
      suiMessageTransmitterPkg: cfg.suiMessageTransmitterPkg,
      suiTokenMessengerMinterPkg: cfg.suiTokenMessengerMinterPkg,
    },
    sponsor: {
      configured: Boolean(c.env.SPONSOR_PRIVATE_KEY),
      address: sponsorAddress,
    },
    profileCount: ikaProfiles.size,
  });
});

app.post("/api/ika-deposit/register", async (c) => {
  const cfg = resolveIkaConfig(c.env);
  if (!cfg.enabled) {
    return c.json({ error: "IKA_DWALLET_MASTER_SEED is not configured." }, 501);
  }

  const body = await c.req.json<IkaRegisterBody>().catch(() => null);
  const normalized = normalizeSuiAddress(body?.suiAddress ?? "");
  if (!normalized) {
    return c.json({ error: "suiAddress is required." }, 400);
  }

  const existing = ikaProfiles.get(normalized);
  const profile = existing
    ? applyPolicyUpdate(existing, body?.policy, cfg)
    : await createIkaProfile({
      suiAddress: normalized,
      cfg,
      policyOverride: body?.policy,
    });

  ikaProfiles.set(normalized, profile);

  if (!ikaDeposits.has(normalized)) {
    ikaDeposits.set(normalized, new Map());
  }

  return c.json({
    ok: true,
    profile: serializeIkaProfile(profile),
  });
});

app.get("/api/ika-deposit/status", (c) => {
  const normalized = normalizeSuiAddress(c.req.query("suiAddress") ?? "");
  if (!normalized) {
    return c.json({ error: "suiAddress is required." }, 400);
  }

  const profile = ikaProfiles.get(normalized);
  if (!profile) {
    return c.json({
      exists: false,
      profile: null,
      deposits: [],
    });
  }

  const deposits = Array.from((ikaDeposits.get(normalized)?.values() ?? []))
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .map(serializeIkaDeposit);

  return c.json({
    exists: true,
    profile: serializeIkaProfile(profile),
    deposits,
  });
});

app.post("/api/ika-deposit/sync", async (c) => {
  const cfg = resolveIkaConfig(c.env);
  if (!cfg.enabled) {
    return c.json({ error: "IKA_DWALLET_MASTER_SEED is not configured." }, 501);
  }

  const body = await c.req.json<IkaSyncBody>().catch(() => null);
  const normalized = normalizeSuiAddress(body?.suiAddress ?? "");
  if (!normalized) {
    return c.json({ error: "suiAddress is required." }, 400);
  }

  const profile = ikaProfiles.get(normalized);
  if (!profile) {
    return c.json({ error: "No policy profile for this address. Register first." }, 404);
  }

  const maxProcess = clampInt(body?.maxProcess ?? 4, 1, 10);

  try {
    const report = await syncIkaProfile(c.env, profile, {
      force: Boolean(body?.force),
      maxProcess,
    });
    return c.json({ ok: true, ...report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Ika sync failed: ${message}` }, 500);
  }
});

// ── x402 paywalled routes (scaffold — ready for @x402/sui) ─────────────────

app.use("/api/paid/*", async (c, next) => {
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

// ── Wallet session endpoints ─────────────────────────────────────────────────
// Stateless cookie-based sessions — no KV/DO required.
// wallet-session-js (from sui.ski) calls these automatically on connect/disconnect.

app.post("/api/wallet/challenge", (c) => {
  return c.json({ challenge: `thunderbun-signin:${crypto.randomUUID()}` });
});

app.post("/api/wallet/connect", async (c) => {
  type ConnectBody = { address?: string; walletName?: string };
  const body: ConnectBody = await c.req.json<ConnectBody>().catch(() => ({}));
  if (!body.address?.startsWith("0x")) {
    return c.json({ error: "invalid address" }, 400);
  }
  const sessionId = crypto.randomUUID();
  const maxAge = 86400; // 24 h
  const cookieOpts = `Path=/; SameSite=Lax; Secure; Max-Age=${maxAge}`;
  c.header("Set-Cookie", `session_id=${sessionId}; ${cookieOpts}`, { append: true });
  c.header("Set-Cookie", `wallet_address=${encodeURIComponent(body.address)}; ${cookieOpts}`, { append: true });
  c.header("Set-Cookie", `wallet_name=${encodeURIComponent(body.walletName ?? "")}; ${cookieOpts}`, { append: true });
  return c.json({ sessionId, address: body.address });
});

app.post("/api/wallet/disconnect", async (c) => {
  const expired = "Path=/; SameSite=Lax; Secure; Max-Age=0";
  c.header("Set-Cookie", `session_id=; ${expired}`, { append: true });
  c.header("Set-Cookie", `wallet_address=; ${expired}`, { append: true });
  c.header("Set-Cookie", `wallet_name=; ${expired}`, { append: true });
  return c.json({ ok: true });
});

// ── Static assets fallback ──────────────────────────────────────────────────

app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

// ── Ika state machine helpers ───────────────────────────────────────────────

async function syncIkaProfile(
  env: Env,
  profile: IkaDepositProfile,
  opts: { force: boolean; maxProcess: number },
): Promise<IkaSyncReport> {
  const cfg = resolveIkaConfig(env);
  const depositMap = ikaDeposits.get(profile.suiAddress) ?? new Map<string, IkaDepositRecord>();
  ikaDeposits.set(profile.suiAddress, depositMap);

  const clients = await createBaseClients(profile.managedPrivateKey, cfg.baseRpcUrl, cfg.network);
  const latestBlock = await clients.publicClient.getBlockNumber();

  const newlyDetected = await scanDepositsFromBase({
    profile,
    cfg,
    latestBlock,
    publicClient: clients.publicClient,
    records: depositMap,
  });

  const confirmationsNeeded = cfg.minConfirmations;
  const now = Date.now();
  const records = Array.from(depositMap.values()).sort((a, b) => Number(a.blockNumber - b.blockNumber));

  let processed = 0;

  for (const record of records) {
    if (processed >= opts.maxProcess) break;

    if (record.status === "minted" || record.status === "policy_blocked") {
      continue;
    }

    if (record.status === "detected") {
      const confirmations = latestBlock >= record.blockNumber
        ? latestBlock - record.blockNumber + 1n
        : 0n;
      if (confirmations < confirmationsNeeded) {
        continue;
      }
    }

    if (record.status === "detected" || (opts.force && record.status === "failed")) {
      const burnOk = await trySubmitBurn({
        profile,
        cfg,
        clients,
        record,
      });
      processed += 1;
      if (!burnOk) continue;
    }

    if (record.status === "burn_submitted" || record.status === "attesting") {
      await refreshAttestation({
        profile,
        cfg,
        record,
      });
      processed += 1;
    }

    if (record.status === "attested" && cfg.autoSettle) {
      await tryMintOnSui({
        env,
        cfg,
        record,
      });
      processed += 1;
    }

    record.updatedAtMs = now;
  }

  profile.updatedAtMs = now;

  return {
    profile: serializeIkaProfile(profile),
    deposits: Array.from(depositMap.values())
      .sort((a, b) => Number(b.blockNumber - a.blockNumber))
      .map(serializeIkaDeposit),
    newlyDetected,
    processed,
    latestBlock: latestBlock.toString(),
    autoSettle: cfg.autoSettle,
    sponsorReady: Boolean(env.SPONSOR_PRIVATE_KEY),
  };
}

async function scanDepositsFromBase(args: {
  profile: IkaDepositProfile;
  cfg: ResolvedIkaConfig;
  latestBlock: bigint;
  publicClient: Awaited<ReturnType<typeof createBaseClients>>["publicClient"];
  records: Map<string, IkaDepositRecord>;
}): Promise<number> {
  const { profile, cfg, latestBlock, publicClient, records } = args;

  const fromBlock = profile.lastScannedBlock === null
    ? (latestBlock > cfg.scanLookbackBlocks ? latestBlock - cfg.scanLookbackBlocks : 0n)
    : profile.lastScannedBlock + 1n;

  if (fromBlock > latestBlock) {
    return 0;
  }

  const toTopic = padTopicAddress(profile.depositAddress);
  const logs = await publicClient.request({
    method: "eth_getLogs",
    params: [{
      address: profile.policy.allowedToken,
      fromBlock: toQuantityHex(fromBlock),
      toBlock: toQuantityHex(latestBlock),
      topics: [TRANSFER_TOPIC, null, toTopic],
    }],
  }) as EthLogEntry[];

  let inserted = 0;
  for (const log of logs) {
    const txHash = normalizeTxHash(log.transactionHash);
    const logIndex = log.logIndex ?? "0x0";
    const blockNumber = parseHexBigInt(log.blockNumber);
    const topics = Array.isArray(log.topics) ? log.topics : [];
    const data = typeof log.data === "string" ? log.data : "0x0";

    if (!txHash || blockNumber === null || topics.length < 3) {
      continue;
    }

    const from = topicToAddress(topics[1]);
    const to = topicToAddress(topics[2]);
    if (!from || !to || to.toLowerCase() !== profile.depositAddress.toLowerCase()) {
      continue;
    }

    const amountRaw = parseHexBigInt(data) ?? 0n;
    if (amountRaw < cfg.minDepositRaw) {
      continue;
    }

    const id = `${txHash}:${logIndex.toLowerCase()}`;
    if (records.has(id)) {
      continue;
    }

    const now = Date.now();
    records.set(id, {
      id,
      txHash,
      logIndexHex: logIndex.toLowerCase(),
      blockNumber,
      from,
      to,
      amountRaw,
      status: "detected",
      createdAtMs: now,
      updatedAtMs: now,
      burnTxHash: null,
      messageHash: null,
      messageBytesHex: null,
      attestation: null,
      attestationStatus: null,
      attestationDelayReason: null,
      mintDigest: null,
      failureReason: null,
      burnAttempts: 0,
      attestationChecks: 0,
      mintAttempts: 0,
    });
    inserted += 1;
  }

  profile.lastScannedBlock = latestBlock;
  return inserted;
}

async function trySubmitBurn(args: {
  profile: IkaDepositProfile;
  cfg: ResolvedIkaConfig;
  clients: Awaited<ReturnType<typeof createBaseClients>>;
  record: IkaDepositRecord;
}): Promise<boolean> {
  const { profile, cfg, clients, record } = args;

  if (!profile.policy.active) {
    blockRecordByPolicy(record, "Policy is inactive.");
    return false;
  }

  if (profile.policy.expiresAtMs !== null && Date.now() > profile.policy.expiresAtMs) {
    blockRecordByPolicy(record, "Policy session has expired.");
    return false;
  }

  if (record.amountRaw > profile.policy.maxBurnRaw) {
    blockRecordByPolicy(record, `Deposit exceeds policy max of ${profile.policy.maxBurnRaw.toString()} raw USDC.`);
    return false;
  }

  try {
    record.burnAttempts += 1;
    record.failureReason = null;

    const allowance = await readAllowance(
      clients.publicClient,
      profile.policy.allowedToken,
      profile.depositAddress,
      profile.policy.allowedBurnContract,
    );

    if (allowance < record.amountRaw) {
      const approveTx = await clients.walletClient.sendTransaction({
        account: clients.account,
        to: profile.policy.allowedToken,
        data: encodeApprove(profile.policy.allowedBurnContract, MAX_UINT256),
      });

      await clients.publicClient.waitForTransactionReceipt({
        hash: approveTx,
        timeout: 120_000,
        confirmations: 1,
      });
    }

    record.status = "burn_submitted";

    const burnTx = await clients.walletClient.sendTransaction({
      account: clients.account,
      to: profile.policy.allowedBurnContract,
      data: encodeDepositForBurn(
        record.amountRaw,
        profile.policy.destinationDomain,
        profile.suiAddress,
        profile.policy.allowedToken,
      ),
    });

    const burnReceipt = await clients.publicClient.waitForTransactionReceipt({
      hash: burnTx,
      timeout: 180_000,
      confirmations: 1,
    });

    const parsed = await extractMessageSentFromLogs(
      (burnReceipt.logs as Array<{ topics?: string[]; data?: string }>) ?? [],
    );

    record.burnTxHash = burnTx;
    record.messageHash = parsed.messageHash;
    record.messageBytesHex = parsed.messageBytesHex;
    record.status = "attesting";
    record.failureReason = null;
    record.updatedAtMs = Date.now();
    return true;
  } catch (err) {
    record.status = "failed";
    record.failureReason = err instanceof Error ? err.message : String(err);
    record.updatedAtMs = Date.now();
    return false;
  }
}

async function refreshAttestation(args: {
  profile: IkaDepositProfile;
  cfg: ResolvedIkaConfig;
  record: IkaDepositRecord;
}): Promise<void> {
  const { profile, cfg, record } = args;

  if (!record.burnTxHash) {
    record.status = "failed";
    record.failureReason = "Missing burn tx hash for attestation lookup.";
    record.updatedAtMs = Date.now();
    return;
  }

  record.attestationChecks += 1;

  const iris = await fetchIrisMessageByTxHash(cfg.irisApiUrl, profile.baseDomain, record.burnTxHash);
  if (!iris) {
    record.status = "attesting";
    record.attestationStatus = "pending";
    record.updatedAtMs = Date.now();
    return;
  }

  record.attestationStatus = iris.status;
  record.attestationDelayReason = iris.delayReason;

  if (iris.status === "complete" && iris.attestation) {
    record.attestation = iris.attestation;

    if (iris.message) {
      record.messageBytesHex = iris.message;
    }

    if (!record.messageBytesHex) {
      record.status = "failed";
      record.failureReason = "Circle returned complete attestation without message bytes.";
      record.updatedAtMs = Date.now();
      return;
    }

    if (!record.messageHash) {
      const { keccak256 } = await import("viem");
      record.messageHash = keccak256(hexToBytes(record.messageBytesHex));
    }

    record.status = "attested";
    record.failureReason = null;
    record.updatedAtMs = Date.now();
    return;
  }

  if (iris.status.includes("failed")) {
    record.status = "failed";
    record.failureReason = `Circle attestation status: ${iris.status}`;
    record.updatedAtMs = Date.now();
    return;
  }

  record.status = "attesting";
  record.updatedAtMs = Date.now();
}

async function tryMintOnSui(args: {
  env: Env;
  cfg: ResolvedIkaConfig;
  record: IkaDepositRecord;
}): Promise<void> {
  const { env, cfg, record } = args;

  if (!env.SPONSOR_PRIVATE_KEY) {
    record.status = "attested";
    record.failureReason = "SPONSOR_PRIVATE_KEY is missing; cannot auto-mint on Sui.";
    record.updatedAtMs = Date.now();
    return;
  }

  if (!record.attestation || !record.messageBytesHex) {
    record.status = "failed";
    record.failureReason = "Missing attestation payload for mint.";
    record.updatedAtMs = Date.now();
    return;
  }

  record.mintAttempts += 1;

  try {
    const digest = await executeSuiMintFromAttestation({
      env,
      cfg,
      messageBytesHex: record.messageBytesHex,
      attestationHex: record.attestation,
    });

    record.mintDigest = digest;
    record.status = "minted";
    record.failureReason = null;
    record.updatedAtMs = Date.now();
  } catch (err) {
    record.status = "attested";
    record.failureReason = err instanceof Error ? err.message : String(err);
    record.updatedAtMs = Date.now();
  }
}

async function executeSuiMintFromAttestation(args: {
  env: Env;
  cfg: ResolvedIkaConfig;
  messageBytesHex: `0x${string}`;
  attestationHex: `0x${string}`;
}): Promise<string> {
  const { env, cfg, messageBytesHex, attestationHex } = args;
  const privateKey = env.SPONSOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("SPONSOR_PRIVATE_KEY is required for Sui mint execution.");
  }

  const [{ decodeSuiPrivateKey }, { Ed25519Keypair }, { SuiGrpcClient }, { Transaction }] = await Promise.all([
    import("@mysten/sui/cryptography"),
    import("@mysten/sui/keypairs/ed25519"),
    import("@mysten/sui/grpc"),
    import("@mysten/sui/transactions"),
  ]);

  const { secretKey: raw } = decodeSuiPrivateKey(privateKey);
  const signer = Ed25519Keypair.fromSecretKey(raw);

  const network = env.NETWORK === "mainnet" ? "mainnet" : "testnet";
  const fullnodeUrl = env.IKA_SUI_FULLNODE_URL?.trim() || `https://fullnode.${network}.sui.io:443`;
  const client = new SuiGrpcClient({
    baseUrl: fullnodeUrl,
    network,
    mvr: {},
  });

  const tx = new Transaction();
  tx.setSender(signer.toSuiAddress());

  const msgBytes = Array.from(hexToBytes(messageBytesHex));
  const attBytes = Array.from(hexToBytes(attestationHex));

  const [receipt] = tx.moveCall({
    target: `${cfg.suiMessageTransmitterPkg}::receive_message::receive_message`,
    arguments: [
      tx.pure.vector("u8", msgBytes),
      tx.pure.vector("u8", attBytes),
      tx.object(cfg.suiMessageTransmitterState),
    ],
  });

  const [stampReceiptTicketWithBurnMessage] = tx.moveCall({
    target: `${cfg.suiTokenMessengerMinterPkg}::handle_receive_message::handle_receive_message`,
    arguments: [
      receipt,
      tx.object(cfg.suiTokenMessengerMinterState),
      tx.object(cfg.suiDenyList),
      tx.object(cfg.suiUsdcTreasury),
    ],
    typeArguments: [cfg.suiUsdcType],
  });

  const [stampReceiptTicket] = tx.moveCall({
    target: `${cfg.suiTokenMessengerMinterPkg}::handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message`,
    arguments: [stampReceiptTicketWithBurnMessage],
  });

  const [stampedReceipt] = tx.moveCall({
    target: `${cfg.suiMessageTransmitterPkg}::receive_message::stamp_receipt`,
    arguments: [
      stampReceiptTicket,
      tx.object(cfg.suiMessageTransmitterState),
    ],
    typeArguments: [`${cfg.suiTokenMessengerMinterPkg}::message_transmitter_authenticator::MessageTransmitterAuthenticator`],
  });

  tx.moveCall({
    target: `${cfg.suiMessageTransmitterPkg}::receive_message::complete_receive_message`,
    arguments: [
      stampedReceipt,
      tx.object(cfg.suiMessageTransmitterState),
    ],
  });

  tx.setGasBudget(readBigIntOr(env.IKA_MINT_GAS_BUDGET, DEFAULT_MINT_GAS_BUDGET));

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    include: {
      effects: true,
    },
  });

  const digest = result.$kind === "Transaction"
    ? result.Transaction.digest
    : result.FailedTransaction.digest;

  if (!digest) {
    throw new Error("Sui mint execution returned no digest.");
  }

  return digest;
}

async function createIkaProfile(args: {
  suiAddress: string;
  cfg: ResolvedIkaConfig;
  policyOverride: IkaRegisterBody["policy"];
}): Promise<IkaDepositProfile> {
  const { suiAddress, cfg, policyOverride } = args;
  const managedPrivateKey = await deriveManagedPrivateKey(cfg.masterSeed, suiAddress);

  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(managedPrivateKey);

  const now = Date.now();
  const policy = buildPolicy({
    cfg,
    now,
    policyOverride,
  });

  return {
    suiAddress,
    managedSignerMode: "deterministic-managed",
    managedPrivateKey,
    depositAddress: account.address,
    network: cfg.network,
    baseRpcUrl: cfg.baseRpcUrl,
    baseDomain: cfg.baseDomain,
    suiDomain: cfg.suiDomain,
    irisApiUrl: cfg.irisApiUrl,
    createdAtMs: now,
    updatedAtMs: now,
    lastScannedBlock: null,
    policy,
  };
}

function applyPolicyUpdate(
  profile: IkaDepositProfile,
  update: IkaRegisterBody["policy"],
  cfg: ResolvedIkaConfig,
): IkaDepositProfile {
  const now = Date.now();
  const nextPolicy = buildPolicy({
    cfg,
    now,
    policyOverride: {
      maxBurnRaw: update?.maxBurnRaw,
      sessionMs: update?.sessionMs,
      active: update?.active ?? true,
    },
    currentPolicy: profile.policy,
  });

  return {
    ...profile,
    updatedAtMs: now,
    policy: nextPolicy,
  };
}

function buildPolicy(args: {
  cfg: ResolvedIkaConfig;
  now: number;
  policyOverride: IkaRegisterBody["policy"];
  currentPolicy?: IkaPolicy;
}): IkaPolicy {
  const { cfg, now, policyOverride, currentPolicy } = args;
  const maxBurnRaw = readBigIntOr(policyOverride?.maxBurnRaw, currentPolicy?.maxBurnRaw ?? cfg.policyMaxBurnRaw);
  const sessionMsRaw = policyOverride?.sessionMs;
  const sessionMs = typeof sessionMsRaw === "number"
    ? (sessionMsRaw > 0 ? sessionMsRaw : null)
    : (currentPolicy?.sessionMs ?? cfg.policySessionMs);

  const active = policyOverride?.active ?? true;
  const approvedAtMs = currentPolicy?.approvedAtMs ?? now;

  return {
    active,
    approvedAtMs,
    maxBurnRaw,
    sessionMs,
    expiresAtMs: sessionMs ? now + sessionMs : null,
    allowedToken: cfg.baseUsdc,
    allowedBurnContract: cfg.baseTokenMessenger,
    destinationDomain: cfg.suiDomain,
  };
}

function blockRecordByPolicy(record: IkaDepositRecord, reason: string): void {
  record.status = "policy_blocked";
  record.failureReason = reason;
  record.updatedAtMs = Date.now();
}

// ── Base + Circle helpers ───────────────────────────────────────────────────

async function createBaseClients(
  managedPrivateKey: `0x${string}`,
  rpcUrl: string,
  network: "base" | "baseSepolia",
): Promise<{
  publicClient: any;
  walletClient: any;
  account: { address: `0x${string}` };
}> {
  const [{ createPublicClient, createWalletClient, http }, { privateKeyToAccount }, { base, baseSepolia }] = await Promise.all([
    import("viem"),
    import("viem/accounts"),
    import("viem/chains"),
  ]);

  const chain = network === "base" ? base : baseSepolia;
  const account = privateKeyToAccount(managedPrivateKey);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  return {
    publicClient,
    walletClient,
    account,
  };
}

async function readAllowance(
  publicClient: Awaited<ReturnType<typeof createBaseClients>>["publicClient"],
  usdc: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  const data = `${ALLOWANCE_SELECTOR}${owner.slice(2).toLowerCase().padStart(64, "0")}${spender.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;

  const result = await publicClient.request({
    method: "eth_call",
    params: [{
      to: usdc,
      data,
    }, "latest"],
  });

  if (typeof result !== "string") {
    throw new Error("eth_call allowance returned non-string result.");
  }

  return parseHexBigInt(result) ?? 0n;
}

function encodeApprove(spender: `0x${string}`, amount: bigint): `0x${string}` {
  const paddedSpender = spender.slice(2).toLowerCase().padStart(64, "0");
  const paddedAmount = amount.toString(16).padStart(64, "0");
  return `${APPROVE_SELECTOR}${paddedSpender}${paddedAmount}` as `0x${string}`;
}

function encodeDepositForBurn(
  amount: bigint,
  destinationDomain: number,
  mintRecipient: string,
  burnToken: string,
): `0x${string}` {
  const selector = "0x6fd3504e";
  const paddedAmount = amount.toString(16).padStart(64, "0");
  const paddedDomain = destinationDomain.toString(16).padStart(64, "0");
  const recipientHex = mintRecipient.startsWith("0x") ? mintRecipient.slice(2) : mintRecipient;
  const paddedRecipient = recipientHex.padStart(64, "0");
  const paddedBurnToken = burnToken.slice(2).toLowerCase().padStart(64, "0");
  return `${selector}${paddedAmount}${paddedDomain}${paddedRecipient}${paddedBurnToken}` as `0x${string}`;
}

async function extractMessageSentFromLogs(logs: Array<{ topics?: string[]; data?: string }>): Promise<{
  messageHash: `0x${string}`;
  messageBytesHex: `0x${string}`;
}> {
  for (const log of logs) {
    if (!Array.isArray(log.topics) || log.topics[0]?.toLowerCase() !== MESSAGE_SENT_TOPIC.toLowerCase()) {
      continue;
    }

    const data = typeof log.data === "string" ? log.data : "";
    const hex = data.startsWith("0x") ? data.slice(2) : data;
    if (hex.length < 128) continue;

    const length = parseInt(hex.slice(64, 128), 16);
    if (!Number.isFinite(length) || length <= 0) continue;

    const messageHex = hex.slice(128, 128 + length * 2);
    const messageBytesHex = (`0x${messageHex}`) as `0x${string}`;

    const { keccak256 } = await import("viem");
    const messageHash = keccak256(hexToBytes(messageBytesHex));

    return { messageHash, messageBytesHex };
  }

  throw new Error("MessageSent event not found in burn transaction logs.");
}

async function fetchIrisMessageByTxHash(
  irisApiUrl: string,
  sourceDomain: number,
  txHash: `0x${string}`,
): Promise<IrisV2Message | null> {
  const url = `${irisApiUrl}/v2/messages/${sourceDomain}?transactionHash=${txHash}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const body = await res.json() as {
      messages?: Array<{
        status?: string;
        attestation?: string;
        message?: string;
        cctpVersion?: number;
        delayReason?: string | null;
        destinationTxHash?: string | null;
      }>;
    };

    const message = body.messages?.[0];
    if (!message) return null;

    return {
      status: (message.status ?? "").toLowerCase(),
      attestation: normalizeHex(message.attestation),
      message: normalizeHex(message.message),
      delayReason: typeof message.delayReason === "string" ? message.delayReason : null,
      cctpVersion: typeof message.cctpVersion === "number" ? message.cctpVersion : 1,
      destinationTxHash: typeof message.destinationTxHash === "string" ? message.destinationTxHash : null,
    };
  } catch {
    return null;
  }
}

// ── Serialization helpers ───────────────────────────────────────────────────

function serializeIkaProfile(profile: IkaDepositProfile) {
  return {
    suiAddress: profile.suiAddress,
    signerMode: profile.managedSignerMode,
    depositAddress: profile.depositAddress,
    network: profile.network,
    baseRpcUrl: profile.baseRpcUrl,
    baseDomain: profile.baseDomain,
    suiDomain: profile.suiDomain,
    irisApiUrl: profile.irisApiUrl,
    createdAtMs: profile.createdAtMs,
    updatedAtMs: profile.updatedAtMs,
    lastScannedBlock: profile.lastScannedBlock ? profile.lastScannedBlock.toString() : null,
    policy: {
      ...profile.policy,
      maxBurnRaw: profile.policy.maxBurnRaw.toString(),
    },
  };
}

function serializeIkaDeposit(record: IkaDepositRecord) {
  return {
    id: record.id,
    txHash: record.txHash,
    logIndexHex: record.logIndexHex,
    blockNumber: record.blockNumber.toString(),
    from: record.from,
    to: record.to,
    amountRaw: record.amountRaw.toString(),
    status: record.status,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    burnTxHash: record.burnTxHash,
    messageHash: record.messageHash,
    messageBytesHex: record.messageBytesHex,
    attestationStatus: record.attestationStatus,
    attestationDelayReason: record.attestationDelayReason,
    mintDigest: record.mintDigest,
    failureReason: record.failureReason,
    attempts: {
      burn: record.burnAttempts,
      attestation: record.attestationChecks,
      mint: record.mintAttempts,
    },
  };
}

// ── Config + parsing helpers ────────────────────────────────────────────────

interface ResolvedIkaConfig {
  enabled: boolean;
  masterSeed: string;
  network: "base" | "baseSepolia";
  baseRpcUrl: string;
  baseUsdc: `0x${string}`;
  baseTokenMessenger: `0x${string}`;
  baseDomain: number;
  suiDomain: number;
  irisApiUrl: string;
  scanLookbackBlocks: bigint;
  minConfirmations: bigint;
  minDepositRaw: bigint;
  policyMaxBurnRaw: bigint;
  policySessionMs: number | null;
  autoSettle: boolean;
  suiMessageTransmitterPkg: string;
  suiTokenMessengerMinterPkg: string;
  suiMessageTransmitterState: string;
  suiTokenMessengerMinterState: string;
  suiUsdcTreasury: string;
  suiDenyList: string;
  suiUsdcType: string;
}

function resolveIkaConfig(env: Env): ResolvedIkaConfig {
  const isMainnet = env.NETWORK === "mainnet";
  const network = isMainnet ? "base" : "baseSepolia";

  const fallbackRpc = isMainnet ? "https://mainnet.base.org" : "https://sepolia.base.org";

  return {
    enabled: Boolean(env.IKA_DWALLET_MASTER_SEED?.trim()),
    masterSeed: env.IKA_DWALLET_MASTER_SEED?.trim() ?? "",
    network,
    baseRpcUrl: env.IKA_BASE_RPC_URL?.trim() || fallbackRpc,
    baseUsdc: normalizeEvmAddress(env.IKA_BASE_USDC_ADDRESS) ?? normalizeEvmAddress(isMainnet ? BASE_USDC_MAINNET : BASE_USDC_TESTNET)!,
    baseTokenMessenger: normalizeEvmAddress(env.IKA_BASE_TOKEN_MESSENGER) ?? normalizeEvmAddress(isMainnet ? TOKEN_MESSENGER_MAINNET : TOKEN_MESSENGER_TESTNET)!,
    baseDomain: readIntOr(env.IKA_BASE_DOMAIN, 6),
    suiDomain: readIntOr(env.IKA_SUI_DOMAIN, 8),
    irisApiUrl: env.IKA_CIRCLE_IRIS_URL?.trim() || (isMainnet ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com"),
    scanLookbackBlocks: readBigIntOr(env.IKA_SCAN_LOOKBACK_BLOCKS, DEFAULT_SCAN_LOOKBACK_BLOCKS),
    minConfirmations: readBigIntOr(env.IKA_MIN_BASE_CONFIRMATIONS, DEFAULT_MIN_CONFIRMATIONS),
    minDepositRaw: readBigIntOr(env.IKA_MIN_DEPOSIT_RAW, DEFAULT_MIN_DEPOSIT_RAW),
    policyMaxBurnRaw: readBigIntOr(env.IKA_POLICY_MAX_BURN_RAW, DEFAULT_POLICY_MAX_BURN_RAW),
    policySessionMs: readNullablePositiveInt(env.IKA_POLICY_SESSION_MS),
    autoSettle: readBooleanOr(env.IKA_AUTO_SETTLE, true),
    suiMessageTransmitterPkg: env.IKA_SUI_MESSAGE_TRANSMITTER_PKG?.trim() || (isMainnet ? SUI_MT_PKG_MAINNET : SUI_MT_PKG_TESTNET),
    suiTokenMessengerMinterPkg: env.IKA_SUI_TOKEN_MESSENGER_MINTER_PKG?.trim() || (isMainnet ? SUI_TMM_PKG_MAINNET : SUI_TMM_PKG_TESTNET),
    suiMessageTransmitterState: env.IKA_SUI_MESSAGE_TRANSMITTER_STATE?.trim() || (isMainnet ? SUI_MT_STATE_MAINNET : SUI_MT_STATE_TESTNET),
    suiTokenMessengerMinterState: env.IKA_SUI_TOKEN_MESSENGER_MINTER_STATE?.trim() || (isMainnet ? SUI_TMM_STATE_MAINNET : SUI_TMM_STATE_TESTNET),
    suiUsdcTreasury: env.IKA_SUI_USDC_TREASURY?.trim() || (isMainnet ? SUI_USDC_TREASURY_MAINNET : SUI_USDC_TREASURY_TESTNET),
    suiDenyList: env.IKA_SUI_DENY_LIST?.trim() || "0x403",
    suiUsdcType: env.IKA_SUI_USDC_TYPE?.trim() || SUI_USDC_TYPE,
  };
}

async function deriveManagedPrivateKey(masterSeed: string, suiAddress: string): Promise<`0x${string}`> {
  const input = new TextEncoder().encode(`${masterSeed}|${suiAddress.toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  let hex = bytesToHex(new Uint8Array(digest));
  if (/^0+$/.test(hex)) {
    hex = `${"0".repeat(63)}1`;
  }
  return (`0x${hex}`) as `0x${string}`;
}

function normalizeSuiAddress(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const noPrefix = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]+$/.test(noPrefix) || noPrefix.length === 0 || noPrefix.length > 64) {
    return null;
  }
  return `0x${noPrefix.toLowerCase().padStart(64, "0")}`;
}

function normalizeEvmAddress(value: string | undefined): `0x${string}` | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed as `0x${string}`;
}

function normalizeTxHash(value: string | undefined): `0x${string}` | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return null;
  return trimmed.toLowerCase() as `0x${string}`;
}

function topicToAddress(topic: string | undefined): `0x${string}` | null {
  if (!topic) return null;
  const hex = topic.startsWith("0x") ? topic.slice(2) : topic;
  if (hex.length !== 64) return null;
  const addr = hex.slice(24);
  if (!/^[0-9a-fA-F]{40}$/.test(addr)) return null;
  return (`0x${addr.toLowerCase()}`) as `0x${string}`;
}

function padTopicAddress(address: `0x${string}`): `0x${string}` {
  return (`0x${address.slice(2).toLowerCase().padStart(64, "0")}`) as `0x${string}`;
}

function normalizeHex(value: string | undefined): `0x${string}` | null {
  if (!value) return null;
  const raw = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]*$/.test(raw)) return null;
  const even = raw.length % 2 === 0 ? raw : `0${raw}`;
  return (`0x${even.toLowerCase()}`) as `0x${string}`;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length === 0) return new Uint8Array();
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseHexBigInt(value: string | undefined): bigint | null {
  if (!value || typeof value !== "string") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function toQuantityHex(value: bigint): `0x${string}` {
  if (value <= 0n) return "0x0";
  return (`0x${value.toString(16)}`) as `0x${string}`;
}

function readBigIntOr(value: string | bigint | undefined, fallback: bigint): bigint {
  if (typeof value === "bigint") return value;
  if (!value) return fallback;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readIntOr(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function readNullablePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function readBooleanOr(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function resolveSuiSponsorAddress(privateKey: string | undefined): Promise<string | null> {
  if (!privateKey) return null;
  try {
    const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
    const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
    const { secretKey: raw } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(raw).toSuiAddress();
  } catch {
    return null;
  }
}

// ── Generic helpers ─────────────────────────────────────────────────────────

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
