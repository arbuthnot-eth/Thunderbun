import { base as baseAddresses, baseSepolia as baseSepoliaAddresses } from "@zkp2p/contracts-v2/addresses";
import { Transaction } from "@mysten/sui/transactions";
import { SuinsClient } from "@mysten/suins";

import { dAppKit } from "../dapp-kit";
import { wallet, type Network } from "../wallet";
import { getZkp2pRuntimeConfig } from "./zkp2p-config";

export interface Zkp2pSuiRoute {
  name: string;
  address: string;
  defaultName: string | null;
}

export interface SponsorStatus {
  configured: boolean;
  sponsorAddress: string | null;
  maxGasBudget: string | null;
}

export interface LaunchOnrampParams {
  recipientAddress: string;
  referrer?: string;
}

export type OnrampLaunchMode = "sdk" | "providers-url";

export interface LaunchOnrampResult {
  url: string;
  contractNetwork: Zkp2pContractNetwork;
  mode: OnrampLaunchMode;
  sdkState: Zkp2pSdkState;
}

export interface SettlementResult {
  digest: string | null;
  sponsorAddress: string;
  path: "ika-pr1646" | "contract" | "marker";
}

export interface Zkp2pContractSnapshot {
  network: Zkp2pContractNetwork;
  chainId: number;
  orchestrator: string | null;
  escrow: string | null;
  unifiedPaymentVerifier: string | null;
  usdc: string | null;
  paymentMethods: string[];
}

export type Zkp2pOnrampState = "ready" | "config_missing";
export type Zkp2pSdkState = "ready" | "needs_connection" | "needs_install" | "error";

export interface Zkp2pProofCompleteResult {
  status: string;
  intentHash?: string;
  proofId?: string;
  proof?: {
    platform?: string;
  };
  error?: {
    message?: string;
  };
}

interface SponsorResponse {
  sponsorSignature?: string;
  sponsorAddress?: string;
  error?: string;
}

interface IkaBridgeAdapterResult {
  enabled: boolean;
}

interface Zkp2pSdkBridge {
  getState: () => Promise<Zkp2pSdkState>;
  requestConnection: () => Promise<void>;
  openInstallPage: () => void;
  onramp: (args: {
    referrer: string;
    referrerLogo?: string;
    toToken: string;
    recipientAddress: string;
    callbackUrl?: string;
  }) => void;
  onProofComplete: (cb: (result: Zkp2pProofCompleteResult) => void) => () => void;
}

type IkaBridgeTxBuilder = (args: {
  tx: Transaction;
  amountUsd: number;
  baseAddress: string;
  recipientAddress: string;
  paymentMethod: string;
}) => Promise<void>;

type AddressBook = Record<string, unknown>;

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ONRAMP_MARKER_AMOUNT_MIST = 1;
const DEFAULT_ZKP2P_SUINS_NAME = "zkp2p.sui";
const DEFAULT_TO_TOKEN = `8453:${BASE_USDC}`;

const IKA_PR_CANDIDATE_EXPORTS = [
  "attachBaseToSuiUsdcBridge",
  "attachCctpBridgeFromBase",
  "attachDwalletCctpBridge",
] as const;

export async function getOnrampState(): Promise<Zkp2pOnrampState> {
  const cfg = getZkp2pRuntimeConfig();
  if (!cfg.providersBaseUrl) {
    return "config_missing";
  }

  const snapshot = getZkp2pContractSnapshot();
  if (!snapshot.orchestrator || !snapshot.escrow) {
    return "config_missing";
  }

  return "ready";
}

export async function getZkp2pSdkState(): Promise<Zkp2pSdkState> {
  try {
    const bridge = await getZkp2pSdkBridge();
    if (!bridge) return "error";
    return await bridge.getState();
  } catch {
    return "error";
  }
}

export async function connectZkp2pSdk(): Promise<Zkp2pSdkState> {
  const bridge = await getZkp2pSdkBridge();
  if (!bridge) return "error";

  const state = await bridge.getState();
  if (state === "needs_connection") {
    await bridge.requestConnection();
  }
  return await bridge.getState();
}

export async function openZkp2pSdkInstallPage(): Promise<void> {
  const bridge = await getZkp2pSdkBridge();
  bridge?.openInstallPage();
}

export async function onZkp2pProofComplete(
  cb: (result: Zkp2pProofCompleteResult) => void,
): Promise<(() => void) | null> {
  try {
    const bridge = await getZkp2pSdkBridge();
    if (!bridge) return null;
    return bridge.onProofComplete(cb);
  } catch {
    return null;
  }
}

export function getZkp2pContractSnapshot(forNetwork?: Network): Zkp2pContractSnapshot {
  const suiNetwork = forNetwork ?? wallet.getState().network;
  const contractNetwork = resolveContractNetwork(suiNetwork);

  const rawNetwork = contractNetwork === "base" ? baseAddresses : baseSepoliaAddresses;
  const addressBook = normalizeAddressBook(rawNetwork);

  const paymentMethods = resolvePaymentMethods();

  const chainId = readNumber((rawNetwork as Record<string, unknown>).chainId) ?? (contractNetwork === "base" ? 8453 : 84532);

  return {
    network: contractNetwork,
    chainId,
    orchestrator: readString(addressBook.Orchestrator),
    escrow: readString(addressBook.Escrow),
    unifiedPaymentVerifier: readString(addressBook.UnifiedPaymentVerifier),
    usdc: readString(addressBook.USDC) ?? (contractNetwork === "base" ? BASE_USDC : null),
    paymentMethods,
  };
}

export async function getSponsorStatus(): Promise<SponsorStatus> {
  try {
    const res = await fetch("/api/sponsor/status");
    if (!res.ok) {
      return {
        configured: false,
        sponsorAddress: null,
        maxGasBudget: null,
      };
    }

    const body = await res.json() as SponsorStatus;
    return {
      configured: Boolean(body.configured),
      sponsorAddress: body.sponsorAddress ?? null,
      maxGasBudget: body.maxGasBudget ?? null,
    };
  } catch {
    return {
      configured: false,
      sponsorAddress: null,
      maxGasBudget: null,
    };
  }
}

export async function resolveZkp2pSuiRoute(): Promise<Zkp2pSuiRoute> {
  const client = dAppKit.getClient();
  const network = dAppKit.stores.$currentNetwork.get() as Network;
  if (network !== "mainnet" && network !== "testnet") {
    throw new Error(`SuiNS routing requires mainnet or testnet (current: ${network}).`);
  }

  const name = (import.meta.env.VITE_ZKP2P_SUINS_NAME as string | undefined)?.trim() || DEFAULT_ZKP2P_SUINS_NAME;
  const suins = new SuinsClient({ client, network });
  const record = await suins.getNameRecord(name);
  const address = record?.targetAddress ?? null;
  if (!address) {
    throw new Error(`No target address found for "${name}" on ${network}.`);
  }

  const reverse = await client.defaultNameServiceName({ address });
  const defaultName = reverse.data.name ?? null;

  return { name, address, defaultName };
}

export async function connectWaaPBaseAddress(): Promise<string> {
  return await wallet.linkWaaPBaseAddress();
}

export async function launchOnramp({ recipientAddress, referrer }: LaunchOnrampParams): Promise<LaunchOnrampResult> {
  const cfg = getZkp2pRuntimeConfig();
  const snapshot = getZkp2pContractSnapshot();
  const toToken = (import.meta.env.VITE_ZKP2P_ONRAMP_TO_TOKEN as string | undefined)?.trim()
    || `${snapshot.chainId}:${snapshot.usdc ?? BASE_USDC}`
    || DEFAULT_TO_TOKEN;

  const chosenReferrer = referrer ?? cfg.referrer;
  const target = buildProvidersOnrampUrl({
    recipientAddress,
    toToken,
    referrer: chosenReferrer,
    snapshot,
  });

  const sdkState = await getZkp2pSdkState();
  if (sdkState === "ready") {
    const bridge = await getZkp2pSdkBridge();
    if (bridge) {
      bridge.onramp({
        referrer: chosenReferrer,
        referrerLogo: cfg.referrerLogoUrl ?? undefined,
        toToken,
        recipientAddress,
        callbackUrl: cfg.callbackUrl ?? undefined,
      });
      return {
        url: target,
        contractNetwork: snapshot.network,
        mode: "sdk",
        sdkState,
      };
    }
  }

  const popup = window.open(target, "_blank", "noopener,noreferrer");
  if (!popup) {
    window.location.href = target;
  }

  return {
    url: target,
    contractNetwork: snapshot.network,
    mode: "providers-url",
    sdkState,
  };
}

export async function executeSettlement({
  baseAddress,
  amountUsd = getDefaultSettlementUsd(),
}: {
  baseAddress: string;
  amountUsd?: number;
}): Promise<SettlementResult> {
  const route = await resolveZkp2pSuiRoute();
  return executeSponsoredSettlement({ route, baseAddress, amountUsd });
}

async function executeSponsoredSettlement({
  route,
  baseAddress,
  amountUsd,
}: {
  route: Zkp2pSuiRoute;
  baseAddress: string;
  amountUsd: number;
}): Promise<SettlementResult> {
  const sponsorStatus = await getSponsorStatus();
  if (!sponsorStatus.configured || !sponsorStatus.sponsorAddress) {
    throw new Error("Sponsorship endpoint is not configured. zkp2p.sui gas sponsorship is required for this flow.");
  }

  if (sponsorStatus.sponsorAddress.toLowerCase() !== route.address.toLowerCase()) {
    throw new Error(`Sponsor mismatch: /api/sponsor uses ${sponsorStatus.sponsorAddress}, but ${route.name} resolves to ${route.address}.`);
  }

  const buildOutcome = { path: "marker" as "ika-pr1646" | "contract" | "marker" };

  const rebuilt = await wallet.buildSponsoredTx(async (tx) => {
    const ika = await tryAttachIkaPrBridge(tx, {
      amountUsd,
      paymentMethod: "zkp2p-contracts",
      baseAddress,
      recipientAddress: route.address,
    });

    if (ika.enabled) {
      buildOutcome.path = "ika-pr1646";
    } else {
      const contractAttached = tryAttachConfiguredSettlementMoveCall(tx, {
        amountUsd,
        paymentMethod: "zkp2p-contracts",
        baseAddress,
        recipientAddress: route.address,
      });

      if (contractAttached) {
        buildOutcome.path = "contract";
      } else {
        const amountMist = tx.splitCoins(tx.gas, [ONRAMP_MARKER_AMOUNT_MIST]);
        tx.transferObjects([amountMist], route.address);
      }
    }

    tx.setGasBudget(10_000_000);
  }, route.address);

  const sponsorRes = await fetch("/api/sponsor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      txBytes: rebuilt.bytes,
      requiredSponsor: route.address,
    }),
  });

  const sponsorBody = await sponsorRes.json() as SponsorResponse;
  if (!sponsorRes.ok || !sponsorBody.sponsorSignature || !sponsorBody.sponsorAddress) {
    throw new Error(sponsorBody.error ?? "Failed to get sponsor signature.");
  }

  if (sponsorBody.sponsorAddress.toLowerCase() !== route.address.toLowerCase()) {
    throw new Error(`Sponsor signature address ${sponsorBody.sponsorAddress} does not match ${route.address}.`);
  }

  const executed = await wallet.executeSponsoredTx(rebuilt.bytes, [rebuilt.userSignature, sponsorBody.sponsorSignature]);
  const digest = extractDigest(executed);

  return {
    digest,
    sponsorAddress: sponsorBody.sponsorAddress,
    path: buildOutcome.path,
  };
}

function tryAttachConfiguredSettlementMoveCall(
  tx: Transaction,
  {
    amountUsd,
    paymentMethod,
    baseAddress,
    recipientAddress,
  }: {
    amountUsd: number;
    paymentMethod: string;
    baseAddress: string;
    recipientAddress: string;
  },
): boolean {
  const settlementTarget = (import.meta.env.VITE_ZKP2P_SUI_SETTLEMENT_TARGET as string | undefined)?.trim();
  if (!settlementTarget) {
    return false;
  }

  tx.moveCall({
    target: settlementTarget,
    arguments: [
      tx.pure.u64(Math.floor(amountUsd * 1_000_000)),
      tx.pure.string(paymentMethod),
      tx.pure.address(baseAddress),
      tx.pure.address(recipientAddress),
    ],
  });

  const deepbookHookTarget = (import.meta.env.VITE_ZKP2P_DEEPBOOK_HOOK_TARGET as string | undefined)?.trim();
  if (deepbookHookTarget) {
    tx.moveCall({
      target: deepbookHookTarget,
      arguments: [
        tx.pure.u64(Math.floor(amountUsd * 1_000_000)),
        tx.pure.address(recipientAddress),
      ],
    });
  }

  return true;
}

async function tryAttachIkaPrBridge(
  tx: Transaction,
  {
    amountUsd,
    paymentMethod,
    baseAddress,
    recipientAddress,
  }: {
    amountUsd: number;
    paymentMethod: string;
    baseAddress: string;
    recipientAddress: string;
  },
): Promise<IkaBridgeAdapterResult> {
  const enabled = (import.meta.env.VITE_IKA_PR1646_ENABLED as string | undefined)?.trim() === "true";
  if (!enabled) {
    return { enabled: false };
  }

  const ikaModule = await import("@dika.sui/sdk") as Record<string, unknown>;
  for (const exportName of IKA_PR_CANDIDATE_EXPORTS) {
    const fn = ikaModule[exportName];
    if (typeof fn === "function") {
      await (fn as IkaBridgeTxBuilder)({
        tx,
        amountUsd,
        paymentMethod,
        baseAddress,
        recipientAddress,
      });
      return { enabled: true };
    }
  }

  return { enabled: false };
}

function extractDigest(executed: unknown): string | null {
  if (!executed || typeof executed !== "object") {
    return null;
  }

  const maybeDigest = (executed as { digest?: unknown }).digest;
  if (typeof maybeDigest === "string") {
    return maybeDigest;
  }

  const maybeData = (executed as { data?: { digest?: unknown } }).data?.digest;
  if (typeof maybeData === "string") {
    return maybeData;
  }

  return null;
}

function resolveContractNetwork(network: Network): Zkp2pContractNetwork {
  const override = (import.meta.env.VITE_ZKP2P_CONTRACT_NETWORK as string | undefined)?.trim();
  if (override === "base" || override === "baseSepolia") {
    return override;
  }
  return network === "mainnet" ? "base" : "baseSepolia";
}

function normalizeAddressBook(input: unknown): AddressBook {
  if (!input || typeof input !== "object") {
    return {};
  }
  const record = input as Record<string, unknown>;
  if (record.contracts && typeof record.contracts === "object") {
    return record.contracts as AddressBook;
  }
  return record as AddressBook;
}

function resolvePaymentMethods(): string[] {
  const env = (import.meta.env.VITE_ZKP2P_PAYMENT_METHODS as string | undefined)?.trim();
  if (env) {
    return env
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return ["venmo", "zelle", "paypal", "wise", "revolut"];
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function getDefaultSettlementUsd(): number {
  const raw = (import.meta.env.VITE_ZKP2P_DEFAULT_SETTLEMENT_USD as string | undefined)?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 1;
}

async function getZkp2pSdkBridge(): Promise<Zkp2pSdkBridge | null> {
  try {
    const mod = await import("@zkp2p/sdk") as { peerExtensionSdk?: unknown };
    if (!mod.peerExtensionSdk || typeof mod.peerExtensionSdk !== "object") {
      return null;
    }
    const sdk = mod.peerExtensionSdk as Partial<Zkp2pSdkBridge>;
    if (
      typeof sdk.getState !== "function"
      || typeof sdk.requestConnection !== "function"
      || typeof sdk.openInstallPage !== "function"
      || typeof sdk.onramp !== "function"
      || typeof sdk.onProofComplete !== "function"
    ) {
      return null;
    }
    return sdk as Zkp2pSdkBridge;
  } catch {
    return null;
  }
}

function buildProvidersOnrampUrl({
  recipientAddress,
  toToken,
  referrer,
  snapshot,
}: {
  recipientAddress: string;
  toToken: string;
  referrer: string;
  snapshot: Zkp2pContractSnapshot;
}): string {
  const cfg = getZkp2pRuntimeConfig();
  const url = new URL(cfg.providersBaseUrl);
  url.searchParams.set("recipientAddress", recipientAddress);
  url.searchParams.set("toToken", toToken);
  url.searchParams.set("contractNetwork", snapshot.network);
  url.searchParams.set("referrer", referrer);
  if (snapshot.orchestrator) url.searchParams.set("orchestrator", snapshot.orchestrator);
  if (snapshot.escrow) url.searchParams.set("escrow", snapshot.escrow);
  if (cfg.referrerLogoUrl) url.searchParams.set("referrerLogo", cfg.referrerLogoUrl);
  if (cfg.callbackUrl) url.searchParams.set("callbackUrl", cfg.callbackUrl);
  return url.toString();
}

export type Zkp2pContractNetwork = "base" | "baseSepolia";

// ── CCTP re-exports ──────────────────────────────────────────────────────
export {
  executeCctpBridge,
  resumePendingBridge,
  loadPendingBridge,
  clearPendingBridge,
  burnUsdcOnBase,
  waitForAttestation,
  mintUsdcOnSui,
  type CctpPhase,
  type CctpProgress,
  type CctpBridgeParams,
  type CctpBurnResult,
  type CctpAttestationResult,
  type CctpMintResult,
  type PendingCctpBridge,
} from "./cctp";

export { getCctpConfig, type CctpConfig } from "./cctp-config";
