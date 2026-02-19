/**
 * dapp-kit.ts — Sui dApp Kit instance
 *
 * Must be initialized after WaaP is registered (wallet standard).
 * Provides connect modal, state, and client for WaaP + extension wallets.
 *
 * MVR (Move Registry) is enabled via `mvr: {}` — auto-resolves `@pkg/module`
 * names in transactions without needing a global serialization plugin.
 *
 * Docs: https://sdk.mystenlabs.com/dapp-kit
 */

import { createDAppKit } from "@mysten/dapp-kit-core";
import { SuiGrpcClient } from "@mysten/sui/grpc";

type Network = "mainnet" | "testnet" | "devnet";

const NETWORKS: Network[] = ["mainnet", "testnet", "devnet"];

export const dAppKit = createDAppKit({
  networks: NETWORKS,
  defaultNetwork: "mainnet",
  createClient: (network) => {
    const net = network as Network;
    return new SuiGrpcClient({
      baseUrl: `https://fullnode.${net}.sui.io:443`,
      network: net,
      mvr: {},
    });
  },
  slushWalletConfig: null,
  enableBurnerWallet: false,
  autoConnect: true,
});
