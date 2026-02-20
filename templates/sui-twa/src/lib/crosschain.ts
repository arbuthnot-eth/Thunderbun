import { Transaction } from "@mysten/sui/transactions";
import { peerExtensionSdk } from "@zkp2p/sdk";

import { dAppKit } from "../dapp-kit";
import { waapReady } from "../init-waap";

export interface TradFiToSuiNativeParams {
  amountUsd: number;
  paymentMethod?: string;
  referrer?: string;
}

export interface TradFiToSuiNativeResult {
  baseAddress: string;
  peerState: "ready";
  markerTxDigest: string | null;
}

interface WaaPEvmProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

const BASE_CHAIN_ID = "0x2105";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ONRAMP_MARKER_AMOUNT_MIST = 1;

declare global {
  interface Window {
    waap?: WaaPEvmProvider;
  }
}

export async function getPeerOnrampState(): Promise<"needs_install" | "needs_connection" | "ready" | "error"> {
  try {
    return await peerExtensionSdk.getState();
  } catch {
    return "error";
  }
}

export async function tradFiToSuiNative({
  amountUsd,
  paymentMethod = "venmo",
  referrer = "ThunderBun",
}: TradFiToSuiNativeParams): Promise<TradFiToSuiNativeResult> {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("Amount must be a positive number.");
  }

  const peerState = await peerExtensionSdk.getState();
  if (peerState !== "ready") {
    throw new Error(`Peer extension state is "${peerState}".`);
  }

  const baseAddress = await connectWaaPBaseAddress();

  peerExtensionSdk.onramp({
    referrer,
    inputCurrency: "USD",
    inputAmount: amountUsd,
    paymentPlatform: paymentMethod,
    toToken: `8453:${BASE_USDC}`,
    recipientAddress: baseAddress,
  });

  const markerTxDigest = await submitSuiMarkerTx();

  return {
    baseAddress,
    peerState,
    markerTxDigest,
  };
}

async function connectWaaPBaseAddress(): Promise<string> {
  await waapReady;
  const provider = window.waap;
  if (!provider) {
    throw new Error("WaaP provider is not available in this environment.");
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID }],
    });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: BASE_CHAIN_ID,
        chainName: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://mainnet.base.org"],
        blockExplorerUrls: ["https://basescan.org"],
      }],
    });
  }

  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("No Base address returned by WaaP.");
  }
  return accounts[0];
}

async function submitSuiMarkerTx(): Promise<string | null> {
  const account = dAppKit.stores.$connection.get().account;
  if (!account) {
    throw new Error("Connect your Sui wallet before starting the onramp flow.");
  }

  const tx = new Transaction();
  const markerCoin = tx.splitCoins(tx.gas, [ONRAMP_MARKER_AMOUNT_MIST]);
  tx.transferObjects([markerCoin], account.address);
  tx.setGasBudget(2_000_000);

  const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
  if (result.$kind === "Transaction") {
    return result.Transaction.digest;
  }
  return result.FailedTransaction.digest ?? null;
}
