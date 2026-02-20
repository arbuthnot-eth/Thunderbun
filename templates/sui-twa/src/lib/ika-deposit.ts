export interface IkaDepositConfigResponse {
  configured: boolean;
  reason: string | null;
  signerMode: string;
  network: "base" | "baseSepolia";
  baseRpcUrl: string;
  baseDomain: number;
  suiDomain: number;
  minDepositRaw: string;
  minConfirmations: string;
  policyDefaults: {
    maxBurnRaw: string;
    sessionMs: number | null;
    autoSettle: boolean;
  };
  cctp: {
    baseUsdc: string;
    tokenMessenger: string;
    irisApiUrl: string;
    suiMessageTransmitterPkg: string;
    suiTokenMessengerMinterPkg: string;
  };
  sponsor: {
    configured: boolean;
    address: string | null;
  };
  profileCount: number;
}

export interface IkaPolicySnapshot {
  active: boolean;
  approvedAtMs: number;
  maxBurnRaw: string;
  sessionMs: number | null;
  expiresAtMs: number | null;
  allowedToken: string;
  allowedBurnContract: string;
  destinationDomain: number;
}

export interface IkaProfileSnapshot {
  suiAddress: string;
  signerMode: string;
  depositAddress: string;
  network: "base" | "baseSepolia";
  baseRpcUrl: string;
  baseDomain: number;
  suiDomain: number;
  irisApiUrl: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastScannedBlock: string | null;
  policy: IkaPolicySnapshot;
}

export interface IkaDepositSnapshot {
  id: string;
  txHash: string;
  logIndexHex: string;
  blockNumber: string;
  from: string;
  to: string;
  amountRaw: string;
  status: "detected" | "policy_blocked" | "burn_submitted" | "attesting" | "attested" | "minted" | "failed";
  createdAtMs: number;
  updatedAtMs: number;
  burnTxHash: string | null;
  messageHash: string | null;
  messageBytesHex: string | null;
  attestationStatus: string | null;
  attestationDelayReason: string | null;
  mintDigest: string | null;
  failureReason: string | null;
  attempts: {
    burn: number;
    attestation: number;
    mint: number;
  };
}

export interface IkaStatusResponse {
  exists: boolean;
  profile: IkaProfileSnapshot | null;
  deposits: IkaDepositSnapshot[];
}

export interface IkaSyncResponse {
  ok: boolean;
  profile: IkaProfileSnapshot;
  deposits: IkaDepositSnapshot[];
  newlyDetected: number;
  processed: number;
  latestBlock: string;
  autoSettle: boolean;
  sponsorReady: boolean;
}

interface ErrorBody {
  error?: string;
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = await res.json().catch(() => ({} as ErrorBody));
  if (!res.ok) {
    const err = (body as ErrorBody).error ?? `HTTP ${res.status}`;
    throw new Error(err);
  }
  return body as T;
}

export async function getIkaDepositConfig(): Promise<IkaDepositConfigResponse> {
  return requestJson<IkaDepositConfigResponse>("/api/ika-deposit/config");
}

export async function registerIkaDepositProfile(args: {
  suiAddress: string;
  maxBurnRaw?: string;
  sessionMs?: number | null;
}): Promise<{ ok: boolean; profile: IkaProfileSnapshot }> {
  return requestJson<{ ok: boolean; profile: IkaProfileSnapshot }>("/api/ika-deposit/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      suiAddress: args.suiAddress,
      policy: {
        ...(args.maxBurnRaw ? { maxBurnRaw: args.maxBurnRaw } : {}),
        ...(args.sessionMs !== undefined ? { sessionMs: args.sessionMs } : {}),
      },
    }),
  });
}

export async function getIkaDepositStatus(suiAddress: string): Promise<IkaStatusResponse> {
  const url = new URL("/api/ika-deposit/status", window.location.origin);
  url.searchParams.set("suiAddress", suiAddress);
  return requestJson<IkaStatusResponse>(url.toString());
}

export async function syncIkaDeposit(args: {
  suiAddress: string;
  force?: boolean;
  maxProcess?: number;
}): Promise<IkaSyncResponse> {
  return requestJson<IkaSyncResponse>("/api/ika-deposit/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      suiAddress: args.suiAddress,
      ...(args.force !== undefined ? { force: args.force } : {}),
      ...(args.maxProcess !== undefined ? { maxProcess: args.maxProcess } : {}),
    }),
  });
}

export function formatUsdcFromRaw(raw: string): string {
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return "0";
  }

  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

export function shortHash(value: string | null, left = 8, right = 6): string {
  if (!value) return "-";
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

export function depositStatusLabel(status: IkaDepositSnapshot["status"]): string {
  switch (status) {
    case "detected": return "Detected";
    case "policy_blocked": return "Blocked";
    case "burn_submitted": return "Burn Sent";
    case "attesting": return "Attesting";
    case "attested": return "Attested";
    case "minted": return "Minted";
    case "failed": return "Failed";
    default: return status;
  }
}
