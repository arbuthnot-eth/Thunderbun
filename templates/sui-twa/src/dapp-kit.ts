/**
 * dapp-kit.ts — Sui dApp Kit instance
 *
 * Must be initialized after WaaP is registered (wallet standard).
 * Provides connect modal, state, and client for WaaP + extension wallets.
 *
 * Docs: https://sdk.mystenlabs.com/dapp-kit
 */

import { createDAppKit } from "@mysten/dapp-kit-core";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

type Network = "mainnet" | "testnet" | "devnet";

const NETWORKS: Network[] = ["mainnet", "testnet", "devnet"];

export const dAppKit = createDAppKit({
  networks: NETWORKS,
  defaultNetwork: "mainnet",
  createClient: (network) =>
    new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(network as "mainnet" | "testnet" | "devnet"),
      network: network as "mainnet" | "testnet" | "devnet",
    }),
  slushWalletConfig: null,
  enableBurnerWallet: false,
  autoConnect: true,
});
