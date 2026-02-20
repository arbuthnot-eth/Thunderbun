/**
 * cctp.ts — Circle CCTP V1: Base USDC → Sui native USDC
 *
 * Three-phase bridge:
 *   1. Burn USDC on Base (approve + depositForBurn via WaaP)
 *   2. Wait for Circle attestation (poll Iris API)
 *   3. Mint USDC on Sui (PTB with 5 CCTP Move calls via dApp Kit)
 *
 * PTB flow follows circlefin/sui-cctp reference implementation:
 *   receive_message → handle_receive_message → deconstruct_stamp_receipt_ticket
 *   → stamp_receipt → complete_receive_message
 *
 * Session persistence: pending bridge stored in sessionStorage
 * so the user can resume after page reload during attestation wait.
 */

import { wallet, type Network } from "../wallet";
import {
  getCctpConfig,
  MESSAGE_SENT_TOPIC,
  ALLOWANCE_SELECTOR,
  APPROVE_SELECTOR,
} from "./cctp-config";

const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const BASE_UNISWAP_V3_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";
const DEFAULT_DUST_SWAP_USDC = 1_000_000n; // 1 USDC
const DEFAULT_MIN_BASE_GAS_WEI = 5_000_000_000_000n; // 0.000005 ETH
const DEFAULT_DUST_POOL_FEE = 500;
const DEFAULT_DUST_MIN_OUT_WEI = 0n;
const BALANCE_OF_SELECTOR = "0x70a08231";
const MAX_UINT256 = (1n << 256n) - 1n;

// ── Types ────────────────────────────────────────────────────────────────

export type CctpPhase = "idle" | "approving" | "burning" | "attesting" | "minting" | "complete" | "error";
export type CctpProgressStep = "approve" | "burn" | "attestation" | "mint";
export type CctpProgressChain = "base" | "sui";

export interface CctpProgress {
  phase: CctpPhase;
  message: string;
  attemptCount?: number;
  step?: CctpProgressStep;
  txHash?: string;
  txChain?: CctpProgressChain;
  messageHash?: string;
}

export interface CctpBurnResult {
  burnTxHash: string;
  messageBytes: Uint8Array;
  messageHash: string;
  recipientAddress: string;
}

export interface CctpAttestationResult {
  attestation: string;
  messageBytes: Uint8Array;
  messageHash: string;
}

export interface CctpMintResult {
  digest: string;
}

export interface BaseSponsorStatus {
  configured: boolean;
  amountWei: string | null;
  cooldownMs: number | null;
  network: string | null;
}

let cachedBaseSponsorStatus: BaseSponsorStatus | null = null;
let cachedBaseSponsorStatusAt = 0;

export interface CctpBridgeParams {
  /** USDC amount in raw units (6 decimals, e.g. 1_000_000 = 1 USDC) */
  amount: bigint;
  /** Sui recipient address (defaults to connected wallet) */
  recipientAddress?: string;
  /** Network override */
  network?: Network;
}

export interface PendingCctpBridge {
  messageHash: string;
  messageBytesHex: string;
  amount: string;
  burnTxHash: string;
  recipientAddress: string;
  network: Network;
  timestamp: number;
}

const SESSION_KEY = "cctp-pending-bridge";
const APPROVAL_HINT_PREFIX = "cctp-approval";
const DEFAULT_PENDING_BRIDGE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ── Session Persistence ──────────────────────────────────────────────────

export function savePendingBridge(pending: PendingCctpBridge): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(pending));
  } catch { /* quota exceeded or unavailable */ }
}

export function loadPendingBridge(): PendingCctpBridge | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCctpBridge;
    const ttlMs = readNumberEnv("VITE_CCTP_PENDING_TTL_MS", DEFAULT_PENDING_BRIDGE_TTL_MS);
    if (Date.now() - parsed.timestamp > ttlMs) {
      clearPendingBridge();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingBridge(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

function approvalHintKey(owner: string, token: string, spender: string): string {
  return [
    APPROVAL_HINT_PREFIX,
    owner.toLowerCase(),
    token.toLowerCase(),
    spender.toLowerCase(),
  ].join(":");
}

function hasApprovalHint(owner: string, token: string, spender: string): boolean {
  try {
    return sessionStorage.getItem(approvalHintKey(owner, token, spender)) === "1";
  } catch {
    return false;
  }
}

function saveApprovalHint(owner: string, token: string, spender: string): void {
  try {
    sessionStorage.setItem(approvalHintKey(owner, token, spender), "1");
  } catch {
    // ignore
  }
}

// ── Phase 1: Burn on Base ────────────────────────────────────────────────

export async function burnUsdcOnBase(
  params: CctpBridgeParams,
  progress?: (p: CctpProgress) => void,
): Promise<CctpBurnResult> {
  const config = getCctpConfig(params.network ?? wallet.getState().network);
  const amount = params.amount;
  const recipientAddress = params.recipientAddress ?? await wallet.getWaaPSuiAddress();
  if (!recipientAddress) throw new Error("No Sui recipient address.");
  const baseAddress = await wallet.getWaaPBaseAddress({ request: false });
  if (!baseAddress) throw new Error("WaaP Base address not linked.");

  await maybeAutoSwapDustForGas(config, amount, progress);

  // Check allowance
  progress?.({ phase: "approving", step: "approve", message: "Checking USDC allowance…" });
  const currentAllowance = await checkAllowance(
    config.base.usdc,
    baseAddress,
    config.base.tokenMessenger,
  );
  const allowanceHint = hasApprovalHint(baseAddress, config.base.usdc, config.base.tokenMessenger);

  // Approve if needed
  const needsApproval = currentAllowance === null
    ? !allowanceHint
    : currentAllowance < amount;

  if (needsApproval) {
    const approveMax = readBooleanEnv("VITE_CCTP_APPROVE_MAX", true);
    const approveAmount = approveMax ? MAX_UINT256 : amount;
    progress?.({
      phase: "approving",
      step: "approve",
      message: approveMax ? "Requesting USDC max approval…" : "Requesting USDC approval…",
    });
    const approveData = encodeApprove(config.base.tokenMessenger, approveAmount);
    const approveTxHash = await wallet.sendBaseTransaction({
      to: config.base.usdc,
      data: approveData,
    });
    progress?.({
      phase: "approving",
      step: "approve",
      txHash: approveTxHash,
      txChain: "base",
      message: `Approval tx sent: ${approveTxHash.slice(0, 14)}…`,
    });
    await wallet.waitForBaseReceipt(approveTxHash);
    saveApprovalHint(baseAddress, config.base.usdc, config.base.tokenMessenger);
    progress?.({
      phase: "approving",
      step: "approve",
      txHash: approveTxHash,
      txChain: "base",
      message: "USDC approved.",
    });
  } else if (currentAllowance === null && allowanceHint) {
    progress?.({
      phase: "approving",
      step: "approve",
      message: "Allowance check unavailable, using prior approval hint.",
    });
  } else {
    progress?.({ phase: "approving", step: "approve", message: "Allowance sufficient, skipping approve." });
  }

  // depositForBurn
  progress?.({ phase: "burning", step: "burn", message: "Calling depositForBurn…" });
  const depositData = encodeDepositForBurn(
    amount,
    config.suiDomain,
    recipientAddress,
    config.base.usdc,
  );
  const burnTxHash = await wallet.sendBaseTransaction({
    to: config.base.tokenMessenger,
    data: depositData,
  });
  progress?.({
    phase: "burning",
    step: "burn",
    txHash: burnTxHash,
    txChain: "base",
    message: `Burn tx sent: ${burnTxHash.slice(0, 14)}…`,
  });

  const receipt = await wallet.waitForBaseReceipt(burnTxHash);
  progress?.({
    phase: "burning",
    step: "burn",
    txHash: burnTxHash,
    txChain: "base",
    message: "Burn confirmed on Base.",
  });

  // Extract MessageSent event
  const { messageBytes, messageHash } = await extractMessageSent(receipt);

  // Save for resume
  savePendingBridge({
    messageHash,
    messageBytesHex: bytesToHex(messageBytes),
    amount: amount.toString(),
    burnTxHash,
    recipientAddress,
    network: params.network ?? wallet.getState().network,
    timestamp: Date.now(),
  });

  return { burnTxHash, messageBytes, messageHash, recipientAddress };
}

// ── Phase 2: Wait for Attestation ────────────────────────────────────────

export async function waitForAttestation(
  messageHash: string,
  messageBytes: Uint8Array,
  progress?: (p: CctpProgress) => void,
  network?: Network,
  burnTxHash?: string,
): Promise<CctpAttestationResult> {
  const config = getCctpConfig(network ?? wallet.getState().network);
  const url = `${config.irisApiUrl}/v1/attestations/${messageHash}`;

  const deadline = Date.now() + config.pollingTimeoutMs;
  let attempts = 0;
  let lastStatus: string | null = null;
  let lastDelayReason: string | null = null;

  while (Date.now() < deadline) {
    attempts++;
    progress?.({
      phase: "attesting",
      step: "attestation",
      txHash: burnTxHash,
      txChain: burnTxHash ? "base" : undefined,
      messageHash,
      message: "Checking Circle attestation…",
      attemptCount: attempts,
    });

    if (burnTxHash) {
      const v2Message = await fetchIrisMessageByTxHash(config.irisApiUrl, config.baseDomain, burnTxHash);
      if (v2Message) {
        const status = v2Message.status.toLowerCase();
        lastStatus = status || null;
        lastDelayReason = v2Message.delayReason;

        if (v2Message.cctpVersion !== 1) {
          throw new Error(
            `Unsupported CCTP message version ${v2Message.cctpVersion} for Base→Sui mint path. Expected v1 for Sui domain ${config.suiDomain}.`,
          );
        }

        if (status === "complete" && v2Message.attestation) {
          progress?.({
            phase: "attesting",
            step: "attestation",
            txHash: burnTxHash,
            txChain: burnTxHash ? "base" : undefined,
            messageHash,
            message: "Attestation received.",
          });
          const canonicalMessageBytes = v2Message.message ? hexToBytes(v2Message.message) : messageBytes;
          return {
            attestation: v2Message.attestation,
            messageBytes: canonicalMessageBytes,
            messageHash,
          };
        }

        if (status === "pending_confirmations") {
          progress?.({
            phase: "attesting",
            step: "attestation",
            txHash: burnTxHash,
            txChain: burnTxHash ? "base" : undefined,
            messageHash,
            message: "Circle is waiting for Base confirmations. This usually takes a few minutes.",
            attemptCount: attempts,
          });
        } else if (status) {
          const delaySuffix = v2Message.delayReason ? ` (${v2Message.delayReason.replace(/_/g, " ")})` : "";
          progress?.({
            phase: "attesting",
            step: "attestation",
            txHash: burnTxHash,
            txChain: burnTxHash ? "base" : undefined,
            messageHash,
            message: `Circle attestation status: ${status.replace(/_/g, " ")}${delaySuffix}.`,
            attemptCount: attempts,
          });
        }
      }
    }

    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json() as { status?: string; attestation?: string };
        const status = (body.status ?? "").toLowerCase();
        if (status === "complete" && body.attestation) {
          progress?.({
            phase: "attesting",
            step: "attestation",
            txHash: burnTxHash,
            txChain: burnTxHash ? "base" : undefined,
            messageHash,
            message: "Attestation received.",
          });
          return {
            attestation: body.attestation,
            messageBytes,
            messageHash,
          };
        }
        lastStatus = status || null;
        if (status === "pending_confirmations") {
          progress?.({
            phase: "attesting",
            step: "attestation",
            txHash: burnTxHash,
            txChain: burnTxHash ? "base" : undefined,
            messageHash,
            message: "Circle is waiting for Base confirmations. This usually takes a few minutes.",
            attemptCount: attempts,
          });
        } else if (status) {
          progress?.({
            phase: "attesting",
            step: "attestation",
            txHash: burnTxHash,
            txChain: burnTxHash ? "base" : undefined,
            messageHash,
            message: `Circle attestation status: ${status.replace(/_/g, " ")}.`,
            attemptCount: attempts,
          });
        }
      }
    } catch {
      // network error — retry
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollingIntervalMs));
  }

  const statusSuffix = lastStatus ? ` Last Iris status: ${lastStatus.replace(/_/g, " ")}.` : "";
  const delaySuffix = lastDelayReason ? ` Delay reason: ${lastDelayReason.replace(/_/g, " ")}.` : "";
  throw new Error(`Attestation timed out. The bridge is still pending — you can retry later.${statusSuffix}${delaySuffix}`);
}

// ── Phase 3: Mint on Sui ─────────────────────────────────────────────────
// PTB structure from circlefin/sui-cctp receiveMessage.ts reference

export async function mintUsdcOnSui(
  attestation: CctpAttestationResult,
  progress?: (p: CctpProgress) => void,
  network?: Network,
  expectedRecipientAddress?: string,
): Promise<CctpMintResult> {
  const config = getCctpConfig(network ?? wallet.getState().network);
  const activeWaaPSuiAddress = await wallet.getWaaPSuiAddress();
  if (expectedRecipientAddress) {
    const active = normalizeSuiAddress(activeWaaPSuiAddress);
    const expected = normalizeSuiAddress(expectedRecipientAddress);
    if (active !== expected) {
      throw new Error(
        `Mint recipient mismatch. Burn targeted ${expectedRecipientAddress}, but current WaaP Sui login is ${activeWaaPSuiAddress}. Reconnect the same WaaP login used for burn and resume.`,
      );
    }
  }

  progress?.({ phase: "minting", step: "mint", message: "Building Sui transaction…" });

  const { Transaction } = await import("@mysten/sui/transactions");
  const tx = new Transaction();
  tx.setSenderIfNotSet(activeWaaPSuiAddress);

  const msgBytes = Array.from(attestation.messageBytes);
  const attBytes = Array.from(hexToBytes(attestation.attestation));

  const mtPkg = config.sui.messageTransmitterPkg;
  const tmmPkg = config.sui.tokenMessengerMinterPkg;

  // Step 1: receive_message — verifies attestation, returns Receipt
  // Move sig: receive_message(message, attestation, state, ctx)
  const [receipt] = tx.moveCall({
    target: `${mtPkg}::receive_message::receive_message`,
    arguments: [
      tx.pure.vector("u8", msgBytes),
      tx.pure.vector("u8", attBytes),
      tx.object(config.sui.messageTransmitterState),
    ],
  });

  // Step 2: handle_receive_message — mints USDC internally, returns StampReceiptTicketWithBurnMessage
  const [stampReceiptTicketWithBurnMessage] = tx.moveCall({
    target: `${tmmPkg}::handle_receive_message::handle_receive_message`,
    arguments: [
      receipt,
      tx.object(config.sui.tokenMessengerMinterState),
      tx.object(config.sui.denyList),
      tx.object(config.sui.usdcTreasury),
    ],
    typeArguments: [config.sui.usdcType],
  });

  // Step 3: deconstruct — extract StampReceiptTicket from the compound struct
  const [stampReceiptTicket] = tx.moveCall({
    target: `${tmmPkg}::handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message`,
    arguments: [stampReceiptTicketWithBurnMessage],
  });

  // Step 4: stamp_receipt — authenticate with MessageTransmitterAuthenticator type arg
  const [stampedReceipt] = tx.moveCall({
    target: `${mtPkg}::receive_message::stamp_receipt`,
    arguments: [
      stampReceiptTicket,
      tx.object(config.sui.messageTransmitterState),
    ],
    typeArguments: [`${tmmPkg}::message_transmitter_authenticator::MessageTransmitterAuthenticator`],
  });

  // Step 5: complete_receive_message — finalize
  tx.moveCall({
    target: `${mtPkg}::receive_message::complete_receive_message`,
    arguments: [
      stampedReceipt,
      tx.object(config.sui.messageTransmitterState),
    ],
  });

  // Gas budget required for multi-call PTBs passing objects between calls
  tx.setGasBudget(50_000_000);

  progress?.({ phase: "minting", step: "mint", message: "Signing and executing…" });

  const result = await wallet.signAndExecuteSuiTransaction(tx);

  const digest = extractDigest(result) ?? "unknown";

  clearPendingBridge();
  progress?.({
    phase: "complete",
    step: "mint",
    txHash: digest,
    txChain: "sui",
    messageHash: attestation.messageHash,
    message: `Mint complete. Digest: ${digest}`,
  });

  return { digest };
}

// ── Orchestrator ─────────────────────────────────────────────────────────

export async function executeCctpBridge(
  params: CctpBridgeParams,
  progress?: (p: CctpProgress) => void,
): Promise<CctpMintResult> {
  const burnResult = await burnUsdcOnBase(params, progress);

  const attestation = await waitForAttestation(
    burnResult.messageHash,
    burnResult.messageBytes,
    progress,
    params.network,
    burnResult.burnTxHash,
  );

  return mintUsdcOnSui(attestation, progress, params.network, burnResult.recipientAddress);
}

export function getCctpMinBaseGasWei(): bigint {
  return readBigIntEnv("VITE_CCTP_MIN_BASE_GAS_WEI", DEFAULT_MIN_BASE_GAS_WEI);
}

export async function getBaseSponsorStatus(): Promise<BaseSponsorStatus> {
  if (cachedBaseSponsorStatus && Date.now() - cachedBaseSponsorStatusAt < 30_000) {
    return cachedBaseSponsorStatus;
  }

  try {
    const res = await fetch("/api/base-sponsor/status");
    if (!res.ok) {
      const fallback = {
        configured: false,
        amountWei: null,
        cooldownMs: null,
        network: null,
      };
      cachedBaseSponsorStatus = fallback;
      cachedBaseSponsorStatusAt = Date.now();
      return fallback;
    }
    const data = await res.json() as Partial<BaseSponsorStatus>;
    const status = {
      configured: Boolean(data.configured),
      amountWei: typeof data.amountWei === "string" ? data.amountWei : null,
      cooldownMs: typeof data.cooldownMs === "number" ? data.cooldownMs : null,
      network: typeof data.network === "string" ? data.network : null,
    };
    cachedBaseSponsorStatus = status;
    cachedBaseSponsorStatusAt = Date.now();
    return status;
  } catch {
    const fallback = {
      configured: false,
      amountWei: null,
      cooldownMs: null,
      network: null,
    };
    cachedBaseSponsorStatus = fallback;
    cachedBaseSponsorStatusAt = Date.now();
    return fallback;
  }
}

export async function requestBaseGasSponsor(
  progress?: (message: string) => void,
): Promise<{ txHash: string; amountWei: string }> {
  const baseAddress = wallet.getState().waapBaseAddress;
  if (!baseAddress) throw new Error("WaaP Base address not linked.");

  progress?.("Requesting sponsored Base gas transfer…");
  const res = await fetch("/api/base-sponsor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: baseAddress }),
  });

  const body = await res.json() as { txHash?: string; amountWei?: string; error?: string };
  if (!res.ok || !body.txHash || !body.amountWei) {
    throw new Error(body.error ?? "Base sponsor request failed.");
  }

  progress?.("Sponsor transfer submitted on Base.");
  return { txHash: body.txHash, amountWei: body.amountWei };
}

export async function topUpBaseGasFromUsdc(
  progress?: (message: string) => void,
): Promise<void> {
  const config = getCctpConfig(wallet.getState().network);
  await maybeAutoSwapDustForGas(config, 0n, (p) => {
    progress?.(p.message);
  });
}

/**
 * Resume a pending bridge from sessionStorage (after page reload during attestation).
 */
export async function resumePendingBridge(
  progress?: (p: CctpProgress) => void,
): Promise<CctpMintResult> {
  const pending = loadPendingBridge();
  if (!pending) throw new Error("No pending bridge found.");

  const messageBytes = hexToBytes(pending.messageBytesHex);

  progress?.({
    phase: "attesting",
    step: "attestation",
    txHash: pending.burnTxHash,
    txChain: "base",
    messageHash: pending.messageHash,
    message: "Resuming attestation polling…",
  });

  const attestation = await waitForAttestation(
    pending.messageHash,
    messageBytes,
    progress,
    pending.network,
    pending.burnTxHash,
  );

  return mintUsdcOnSui(attestation, progress, pending.network, pending.recipientAddress);
}

// ── ABI Encoding Helpers ─────────────────────────────────────────────────

function encodeApprove(spender: string, amount: bigint): string {
  const paddedSpender = spender.slice(2).toLowerCase().padStart(64, "0");
  const paddedAmount = amount.toString(16).padStart(64, "0");
  return `${APPROVE_SELECTOR}${paddedSpender}${paddedAmount}`;
}

function encodeDepositForBurn(
  amount: bigint,
  destinationDomain: number,
  mintRecipient: string,
  burnToken: string,
): string {
  // depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken)
  const selector = "0x6fd3504e";
  const paddedAmount = amount.toString(16).padStart(64, "0");
  const paddedDomain = destinationDomain.toString(16).padStart(64, "0");

  // Sui address → bytes32: remove 0x prefix, left-pad to 64 hex chars
  const recipientHex = mintRecipient.startsWith("0x")
    ? mintRecipient.slice(2)
    : mintRecipient;
  const paddedRecipient = recipientHex.padStart(64, "0");

  const paddedBurnToken = burnToken.slice(2).toLowerCase().padStart(64, "0");

  return `${selector}${paddedAmount}${paddedDomain}${paddedRecipient}${paddedBurnToken}`;
}

async function checkAllowance(
  usdcAddress: string,
  owner: string,
  spender: string,
): Promise<bigint | null> {
  const paddedOwner = owner.slice(2).toLowerCase().padStart(64, "0");
  const paddedSpender = spender.slice(2).toLowerCase().padStart(64, "0");
  const data = `${ALLOWANCE_SELECTOR}${paddedOwner}${paddedSpender}`;

  try {
    const result = await wallet.callBase({ to: usdcAddress, data });
    return BigInt(result);
  } catch {
    return null;
  }
}

async function maybeAutoSwapDustForGas(
  config: ReturnType<typeof getCctpConfig>,
  bridgeAmount: bigint,
  progress?: (p: CctpProgress) => void,
): Promise<void> {
  const enabled = readBooleanEnv("VITE_CCTP_AUTO_SWAP_DUST", false);
  if (!enabled) return;

  const baseAddress = wallet.getState().waapBaseAddress;
  if (!baseAddress) return;

  const minBaseGasWei = getCctpMinBaseGasWei();
  const currentGas = await wallet.getBaseEthBalance().catch(() => null);
  if (currentGas === null) {
    progress?.({
      phase: "approving",
      message: "Skipping automatic gas top-up because Base balance check failed.",
    });
    return;
  }
  if (currentGas >= minBaseGasWei) {
    return;
  }

  const trySponsorFirst = readBooleanEnv("VITE_CCTP_TRY_BASE_SPONSOR", true);
  if (trySponsorFirst) {
    const sponsorStatus = await getBaseSponsorStatus();
    if (sponsorStatus.configured) {
      try {
        await requestBaseGasSponsor((message) => {
          progress?.({ phase: "approving", message });
        });
        await new Promise((resolve) => setTimeout(resolve, 2200));
        const sponsoredBalance = await wallet.getBaseEthBalance().catch(() => null);
        if (sponsoredBalance !== null && sponsoredBalance >= minBaseGasWei) {
          progress?.({ phase: "approving", message: "Base gas sponsored." });
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        progress?.({ phase: "approving", message: `Sponsor unavailable (${message}). Using USDC dust swap…` });
      }
    }
  }

  const dustSwapAmount = readBigIntEnv("VITE_CCTP_DUST_SWAP_USDC", DEFAULT_DUST_SWAP_USDC);
  if (dustSwapAmount <= 0n) return;

  const usdcBalance = await getErc20Balance(config.base.usdc, baseAddress);
  const requiredUsdc = bridgeAmount + dustSwapAmount;
  if (usdcBalance < requiredUsdc) {
    throw new Error(
      `Base ETH is low. Auto gas top-up requires ${formatUsdc(dustSwapAmount)} extra USDC (need ${formatUsdc(requiredUsdc)} total).`,
    );
  }

  const router = readAddressEnv("VITE_CCTP_DUST_SWAP_ROUTER", BASE_UNISWAP_V3_ROUTER);
  const weth = readAddressEnv("VITE_CCTP_BASE_WETH", BASE_WETH_ADDRESS);
  const poolFee = readNumberEnv("VITE_CCTP_DUST_POOL_FEE", DEFAULT_DUST_POOL_FEE);
  const minOutWei = readBigIntEnv("VITE_CCTP_DUST_MIN_OUT_WEI", DEFAULT_DUST_MIN_OUT_WEI);

  progress?.({
    phase: "approving",
    message: `Base gas low. Swapping ${formatUsdc(dustSwapAmount)} to ETH for fees…`,
  });

  const allowance = await checkAllowance(config.base.usdc, baseAddress, router);
  if (allowance === null || allowance < dustSwapAmount) {
    progress?.({ phase: "approving", message: "Approving USDC for gas top-up swap…" });
    const approveTxHash = await wallet.sendBaseTransaction({
      to: config.base.usdc,
      data: encodeApprove(router, MAX_UINT256),
    });
    await wallet.waitForBaseReceipt(approveTxHash);
  }

  const swapData = await encodeDustSwapToEth({
    router,
    usdc: config.base.usdc,
    weth,
    amountIn: dustSwapAmount,
    baseAddress,
    poolFee,
    minOutWei,
  });

  progress?.({ phase: "burning", message: "Executing dust swap USDC → ETH on Base…" });
  const swapTxHash = await wallet.sendBaseTransaction({
    to: router,
    data: swapData,
  });
  await wallet.waitForBaseReceipt(swapTxHash);

  const nextGas = await wallet.getBaseEthBalance().catch(() => null);
  if (nextGas !== null && nextGas < minBaseGasWei) {
    progress?.({
      phase: "burning",
      message: "Dust swap completed, but Base gas is still low.",
    });
    return;
  }

  progress?.({
    phase: "burning",
    message: "Base gas topped up from USDC.",
  });
}

async function encodeDustSwapToEth({
  router,
  usdc,
  weth,
  amountIn,
  baseAddress,
  poolFee,
  minOutWei,
}: {
  router: string;
  usdc: string;
  weth: string;
  amountIn: bigint;
  baseAddress: string;
  poolFee: number;
  minOutWei: bigint;
}): Promise<string> {
  const { encodeFunctionData, parseAbi } = await import("viem");
  const routerAddress = asHexAddress(router);
  const usdcAddress = asHexAddress(usdc);
  const wethAddress = asHexAddress(weth);
  const recipientAddress = asHexAddress(baseAddress);

  const swapAbi = parseAbi([
    "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
    "function unwrapWETH9(uint256 amountMinimum,address recipient) payable",
    "function multicall(bytes[] data) payable returns (bytes[] results)",
  ]);

  const exactInput = encodeFunctionData({
    abi: swapAbi,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: usdcAddress,
      tokenOut: wethAddress,
      fee: poolFee,
      recipient: routerAddress,
      amountIn,
      amountOutMinimum: minOutWei,
      sqrtPriceLimitX96: 0n,
    }],
  });

  const unwrap = encodeFunctionData({
    abi: swapAbi,
    functionName: "unwrapWETH9",
    args: [minOutWei, recipientAddress],
  });

  return encodeFunctionData({
    abi: swapAbi,
    functionName: "multicall",
    args: [[exactInput, unwrap]],
  });
}

// ── Event Parsing ────────────────────────────────────────────────────────

async function extractMessageSent(receipt: Record<string, unknown>): Promise<{
  messageBytes: Uint8Array;
  messageHash: string;
}> {
  const logs = receipt.logs as Array<{ topics?: string[]; data?: string }> | undefined;
  if (!logs || !Array.isArray(logs)) {
    throw new Error("No logs in transaction receipt.");
  }

  for (const log of logs) {
    if (!log.topics || log.topics[0]?.toLowerCase() !== MESSAGE_SENT_TOPIC.toLowerCase()) {
      continue;
    }

    // MessageSent(bytes message) — ABI-encoded bytes
    // data layout: offset (32 bytes) + length (32 bytes) + message bytes (padded)
    const data = log.data;
    if (!data || data.length < 130) continue;

    const hex = data.startsWith("0x") ? data.slice(2) : data;
    // Skip the offset word (first 32 bytes, always 0x20)
    const lengthOffset = 64;
    const length = parseInt(hex.slice(lengthOffset, lengthOffset + 64), 16);
    const messageHex = hex.slice(lengthOffset + 64, lengthOffset + 64 + length * 2);
    const messageBytes = hexToBytes("0x" + messageHex);

    const { keccak256 } = await import("viem");
    const messageHash = keccak256(messageBytes);

    return { messageBytes, messageHash };
  }

  throw new Error("MessageSent event not found in transaction logs.");
}

// ── Byte Utilities ───────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractDigest(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const topLevel = (result as { digest?: unknown }).digest;
  if (typeof topLevel === "string") return topLevel;

  const nested = (result as { data?: { digest?: unknown } }).data?.digest;
  if (typeof nested === "string") return nested;

  return null;
}

async function getErc20Balance(token: string, owner: string): Promise<bigint> {
  const data = `${BALANCE_OF_SELECTOR}${owner.slice(2).toLowerCase().padStart(64, "0")}`;
  const result = await wallet.callBase({ to: token, data });
  return BigInt(result);
}

function readBigIntEnv(name: string, fallback: bigint): bigint {
  const env = import.meta.env as Record<string, string | undefined>;
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  try {
    const value = BigInt(raw);
    return value >= 0n ? value : fallback;
  } catch {
    return fallback;
  }
}

function readNumberEnv(name: string, fallback: number): number {
  const env = import.meta.env as Record<string, string | undefined>;
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const env = import.meta.env as Record<string, string | undefined>;
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return fallback;
}

function readAddressEnv(name: string, fallback: string): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  return raw;
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const fractional = raw % 1_000_000n;
  if (fractional === 0n) return `${whole} USDC`;
  const padded = fractional.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${padded} USDC`;
}

function asHexAddress(value: string): `0x${string}` {
  if (!value.startsWith("0x")) {
    throw new Error(`Invalid address: ${value}`);
  }
  return value as `0x${string}`;
}

function normalizeSuiAddress(value: string): string {
  const raw = value.trim();
  const noPrefix = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]+$/.test(noPrefix) || noPrefix.length === 0 || noPrefix.length > 64) {
    throw new Error(`Invalid Sui address: ${value}`);
  }
  return `0x${noPrefix.toLowerCase().padStart(64, "0")}`;
}

interface IrisV2Message {
  status: string;
  attestation: string | null;
  message: string | null;
  cctpVersion: number;
  delayReason: string | null;
}

async function fetchIrisMessageByTxHash(
  irisApiUrl: string,
  sourceDomain: number,
  txHash: string,
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
      }>;
    };
    const message = body.messages?.[0];
    if (!message) return null;
    return {
      status: (message.status ?? "").toLowerCase(),
      attestation: typeof message.attestation === "string" ? message.attestation : null,
      message: typeof message.message === "string" ? message.message : null,
      cctpVersion: typeof message.cctpVersion === "number" ? message.cctpVersion : 1,
      delayReason: typeof message.delayReason === "string" ? message.delayReason : null,
    };
  } catch {
    return null;
  }
}
