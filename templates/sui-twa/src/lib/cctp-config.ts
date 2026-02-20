/**
 * cctp-config.ts — Circle CCTP V1 contract address registry
 *
 * Network-aware config for Base (EVM) + Sui CCTP contracts.
 * All addresses verified against Circle's official deployments.
 *
 * Docs: https://developers.circle.com/stablecoins/cctp-getting-started
 */

import type { Network } from "../wallet";

export interface CctpBaseContracts {
  tokenMessenger: string;
  messageTransmitter: string;
  usdc: string;
}

export interface CctpSuiContracts {
  messageTransmitterPkg: string;
  tokenMessengerMinterPkg: string;
  messageTransmitterState: string;
  tokenMessengerMinterState: string;
  usdcTreasury: string;
  /** Sui system DenyList object — always 0x403 */
  denyList: string;
  /** Native USDC coin type on Sui */
  usdcType: string;
}

export interface CctpConfig {
  base: CctpBaseContracts;
  sui: CctpSuiContracts;
  /** CCTP domain ID for Base */
  baseDomain: number;
  /** CCTP domain ID for Sui */
  suiDomain: number;
  /** Circle Iris attestation API base URL */
  irisApiUrl: string;
  /** Polling interval for attestation checks (ms) */
  pollingIntervalMs: number;
  /** Timeout for attestation polling (ms) */
  pollingTimeoutMs: number;
}

// ── MessageSent event ────────────────────────────────────────────────────
// topic0 = keccak256("MessageSent(bytes)")
export const MESSAGE_SENT_TOPIC = "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";

// ── ERC-20 / CCTP function selectors ──────────────────────────────────────
export const ALLOWANCE_SELECTOR = "0xdd62ed3e"; // allowance(address,address)
export const APPROVE_SELECTOR = "0x095ea7b3"; // approve(address,uint256)

// ── Sui native USDC type ──────────────────────────────────────────────────
const SUI_USDC_TYPE = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

// ── Per-network configs ───────────────────────────────────────────────────
const MAINNET_CONFIG: CctpConfig = {
  base: {
    tokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
    messageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  sui: {
    messageTransmitterPkg: "0x08d87d37ba49e785dde270a83f8e979605b03dc552b5548f26fdf2f49bf7ed1b",
    tokenMessengerMinterPkg: "0x2aa6c5d56376c371f88a6cc42e852824994993cb9bab8d3e6450cbe3cb32b94e",
    messageTransmitterState: "0xf68268c3d9b1df3215f2439400c1c4ea08ac4ef4bb7d6f3ca6a2a239e17510af",
    tokenMessengerMinterState: "0x45993eecc0382f37419864992c12faee2238f5cfe22b98ad3bf455baf65c8a2f",
    usdcTreasury: "0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7",
    denyList: "0x403",
    usdcType: SUI_USDC_TYPE,
  },
  baseDomain: 6,
  suiDomain: 8,
  irisApiUrl: "https://iris-api.circle.com",
  pollingIntervalMs: 10_000,
  pollingTimeoutMs: 1_800_000,
};

const TESTNET_CONFIG: CctpConfig = {
  base: {
    tokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
    messageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
  sui: {
    messageTransmitterPkg: "0x4931e06dce648b3931f890035bd196920770e913e43e45990b383f6486fdd0a5",
    tokenMessengerMinterPkg: "0x31cc14d80c175ae39777c0238f20594c6d4869cfab199f40b69f3319956b8beb",
    messageTransmitterState: "0x98234bd0fa9ac12cc0a20a144a22e36d6a32f7e0a97baaeaf9c76cdc6d122d2e",
    tokenMessengerMinterState: "0x5252abd1137094ed1db3e0d75bc36abcd287aee4bc310f8e047727ef5682e7c2",
    usdcTreasury: "0x7170137d4a6431bf83351ac025baf462909bffe2877d87716374fb42b9629ebe",
    denyList: "0x403",
    usdcType: SUI_USDC_TYPE,
  },
  baseDomain: 6,
  suiDomain: 8,
  irisApiUrl: "https://iris-api-sandbox.circle.com",
  pollingIntervalMs: 10_000,
  pollingTimeoutMs: 1_800_000,
};

/**
 * Returns CCTP config for the current or specified network.
 * Only mainnet and testnet are supported — devnet throws.
 */
export function getCctpConfig(network?: Network): CctpConfig {
  const env = (import.meta.env.VITE_CCTP_IRIS_API_URL as string | undefined)?.trim();
  const pollingInterval = Number(import.meta.env.VITE_CCTP_POLLING_INTERVAL_MS) || 0;
  const pollingTimeout = Number(import.meta.env.VITE_CCTP_POLLING_TIMEOUT_MS) || 0;

  const net = network ?? "mainnet";
  if (net === "devnet") {
    throw new Error("CCTP is not available on devnet.");
  }

  const base = net === "mainnet" ? MAINNET_CONFIG : TESTNET_CONFIG;
  return {
    ...base,
    irisApiUrl: env || base.irisApiUrl,
    pollingIntervalMs: pollingInterval || base.pollingIntervalMs,
    pollingTimeoutMs: pollingTimeout || base.pollingTimeoutMs,
  };
}
