/**
 * sui-client.ts — Shared SDK client accessors (lazy, network-aware singletons)
 *
 * Provides typed accessors for ecosystem SDK clients:
 *   - SealClient  (threshold encryption)
 *   - DeepBookClient (CLOB trading)
 *   - WalrusClient (blob storage)
 *
 * All clients are recreated on network switch.
 */

import { SealClient, type KeyServerConfig } from "@mysten/seal";
import {
  DeepBookClient,
  mainnetPackageIds, testnetPackageIds,
  mainnetCoins, testnetCoins,
  mainnetPools, testnetPools,
} from "@mysten/deepbook-v3";
import { WalrusClient } from "@mysten/walrus";
import { wallet, type Network } from "./wallet";

// ── Seal ────────────────────────────────────────────────────────────────────

// Testnet key server configs (Seal v1 — from Seal docs)
const SEAL_KEY_SERVERS: Partial<Record<Network, KeyServerConfig[]>> = {
  testnet: [
    { objectId: "0x7bb65be15b06ef84d6ee7bb0787fcfa3693690a8fa543a11e1f11e8a56cff7d8", weight: 1 },
    { objectId: "0xfe66a91b381e1b3afb9f3730adae6ddc348cb1b48d7c37efed5e15d60e5b4f7a", weight: 1 },
    { objectId: "0xa34e9c508900da87339d5b4a22e578d30ad13da01f0678197db25d0db05f09e4", weight: 1 },
  ],
};

let _sealClient: SealClient | null = null;
let _sealNetwork: Network | null = null;

export function getSealClient(): SealClient | null {
  const net = wallet.getState().network;
  const servers = SEAL_KEY_SERVERS[net];
  if (!servers) return null;

  if (_sealClient && _sealNetwork === net) return _sealClient;

  _sealClient = new SealClient({
    suiClient: wallet.getClient(),
    serverConfigs: servers,
    verifyKeyServers: false,
  });
  _sealNetwork = net;
  return _sealClient;
}

// ── DeepBook ────────────────────────────────────────────────────────────────

const DB_CONFIGS: Partial<Record<Network, {
  packageIds: typeof mainnetPackageIds;
  coins: typeof mainnetCoins;
  pools: typeof mainnetPools;
}>> = {
  mainnet: { packageIds: mainnetPackageIds, coins: mainnetCoins, pools: mainnetPools },
  testnet: { packageIds: testnetPackageIds, coins: testnetCoins, pools: testnetPools },
};

let _dbClient: DeepBookClient | null = null;
let _dbNetwork: Network | null = null;

export function getDeepBookClient(): DeepBookClient | null {
  const net = wallet.getState().network;
  const cfg = DB_CONFIGS[net];
  if (!cfg) return null;

  if (_dbClient && _dbNetwork === net) return _dbClient;

  _dbClient = new DeepBookClient({
    client: wallet.getClient(),
    network: net,
    address: "0x0",
    coins: cfg.coins,
    pools: cfg.pools,
  });
  _dbNetwork = net;
  return _dbClient;
}

// ── Walrus ──────────────────────────────────────────────────────────────────

const WALRUS_NETWORKS: Network[] = ["testnet", "mainnet"];

let _walrusClient: WalrusClient | null = null;
let _walrusNetwork: Network | null = null;

export function getWalrusClient(): WalrusClient | null {
  const net = wallet.getState().network;
  if (!WALRUS_NETWORKS.includes(net)) return null;

  if (_walrusClient && _walrusNetwork === net) return _walrusClient;

  _walrusClient = new WalrusClient({
    network: net as "mainnet" | "testnet",
    suiClient: wallet.getClient(),
  });
  _walrusNetwork = net;
  return _walrusClient;
}

// ── Invalidation ────────────────────────────────────────────────────────────

/** Call when network switches to force recreation of all SDK clients */
export function invalidateClients() {
  _sealClient = null;
  _sealNetwork = null;
  _dbClient = null;
  _dbNetwork = null;
  _walrusClient = null;
  _walrusNetwork = null;
}

// Auto-invalidate on network change
wallet.subscribe(() => {
  const net = wallet.getState().network;
  if (net !== _sealNetwork || net !== _dbNetwork || net !== _walrusNetwork) {
    invalidateClients();
  }
});
