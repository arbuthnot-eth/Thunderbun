/**
 * wallet.ts — WaaP + Sui Wallet Standard integration (no React, no dapp-kit)
 *
 * WaaP implements the Sui Wallet Standard, so we can use it directly:
 *   1. Call initWaaPSui() → get wallet instance
 *   2. registerWallet() → registers it in the global wallet registry
 *   3. Connect directly via wallet.features['standard:connect']
 *
 * Docs: https://docs.waap.xyz/guides-sui/start
 */

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { namedPackagesPlugin, Transaction } from "@mysten/sui/transactions";

// ── Types ────────────────────────────────────────────────────────────────
export type Network = "mainnet" | "testnet" | "devnet";

export interface WalletState {
  connected: boolean;
  address: string | null;
  network: Network;
  balance: bigint | null;
}

type Listener = (state: WalletState) => void;

// WaaP SDK + Wallet Standard types (declared here to avoid TS errors when
// package is not yet installed in template consumers' environments)
declare module "@human.tech/waap-sdk" {
  export function initWaaPSui(opts: {
    config: {
      authenticationMethods?: string[];
      allowedSocials?: string[];
      styles?: { darkMode?: boolean };
    };
    useStaging?: boolean;
  }): WaaPSuiWallet;

  export interface WaaPSuiWallet {
    name: string;
    features: {
      "standard:connect": {
        connect: (opts?: { silent?: boolean }) => Promise<{ accounts: Array<{ address: string }> }>;
      };
      "standard:disconnect"?: { disconnect: () => Promise<void> };
      "standard:events": {
        on: (event: string, cb: (data: unknown) => void) => () => void;
      };
      "sui:signAndExecuteTransaction": {
        signAndExecuteTransaction: (opts: {
          transaction: unknown;
          account: { address: string };
          chain: string;
        }) => Promise<{ digest: string }>;
      };
    };
    accounts: Array<{ address: string }>;
  }
}

declare module "@mysten/wallet-standard" {
  export function registerWallet(wallet: unknown): void;
}

// ── MVR: register named packages plugin so transactions can use @pkg/module names
Transaction.registerGlobalSerializationPlugin(
  "namedPackagesPlugin",
  namedPackagesPlugin({ url: "https://mainnet.mvr.mystenlabs.com" })
);

// ── WalletManager ────────────────────────────────────────────────────────
class WalletManager {
  private state: WalletState = {
    connected: false,
    address: null,
    network: "mainnet",
    balance: null,
  };

  private listeners: Listener[] = [];
  private client: SuiClient;
  private waapWallet: import("@human.tech/waap-sdk").WaaPSuiWallet | null = null;

  constructor() {
    this.client = new SuiClient({ url: getFullnodeUrl("mainnet") });
    this.initWaaP();
    this.restoreSession();
  }

  // ── Public API ────────────────────────────────────────────────────────

  getState(): WalletState { return { ...this.state }; }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    // Emit current state immediately
    listener(this.getState());
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  async connect(): Promise<void> {
    let address: string | null = null;

    if (this.waapWallet) {
      try {
        const result = await this.waapWallet.features["standard:connect"].connect();
        address = result.accounts[0]?.address ?? null;
      } catch (err) {
        console.warn("[wallet] WaaP connect failed, trying extension fallback:", err);
      }
    }

    // Browser extension fallback (any Wallet Standard wallet)
    if (!address) {
      address = await this.tryExtensionWallet();
    }

    // Dev mock (no wallet available)
    if (!address) {
      console.warn("[wallet] No wallet provider found. Using dev mock address.");
      address = "0x" + "a1b2c3d4e5f6".repeat(5).slice(0, 64);
    }

    if (!address) throw new Error("No address returned");

    this.state = { ...this.state, connected: true, address };
    sessionStorage.setItem("sui_wallet_addr", address);
    await this.refreshBalance();
    this.emit();
  }

  async disconnect(): Promise<void> {
    if (this.waapWallet?.features["standard:disconnect"]) {
      try {
        await this.waapWallet.features["standard:disconnect"]!.disconnect();
      } catch (_) { /* ignore */ }
    }
    sessionStorage.removeItem("sui_wallet_addr");
    this.state = { connected: false, address: null, network: this.state.network, balance: null };
    this.emit();
  }

  async refreshBalance(): Promise<void> {
    if (!this.state.address) return;
    try {
      const { totalBalance } = await this.client.getBalance({
        owner: this.state.address,
        coinType: "0x2::sui::SUI",
      });
      this.state.balance = BigInt(totalBalance);
      this.emit();
    } catch { /* ignore */ }
  }

  setNetwork(network: Network): void {
    this.state.network = network;
    this.client = new SuiClient({ url: getFullnodeUrl(network) });
    if (this.state.address) this.refreshBalance();
    this.emit();
  }

  getClient(): SuiClient { return this.client; }

  formatBalance(): string {
    if (this.state.balance === null) return "—";
    return (Number(this.state.balance) / 1_000_000_000).toFixed(4) + " SUI";
  }

  formatAddress(full = false): string {
    if (!this.state.address) return "";
    if (full) return this.state.address;
    const a = this.state.address;
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  // ── Private ───────────────────────────────────────────────────────────

  private emit() { this.listeners.forEach((l) => l(this.getState())); }

  private async initWaaP(): Promise<void> {
    try {
      const { initWaaPSui } = await import("@human.tech/waap-sdk");
      const { registerWallet } = await import("@mysten/wallet-standard");

      const w = initWaaPSui({
        config: {
          authenticationMethods: ["email", "phone", "social"],
          allowedSocials: ["google", "twitter", "discord"],
          styles: { darkMode: true },
        },
        useStaging: false,
      });

      registerWallet(w as unknown as Parameters<typeof registerWallet>[0]);
      this.waapWallet = w;
    } catch (err) {
      console.warn("[wallet] WaaP SDK not available:", err);
    }
  }

  private async tryExtensionWallet(): Promise<string | null> {
    // Walk the registered wallets via Wallet Standard
    try {
      const { getWallets } = await import("@mysten/wallet-standard");
      const wallets = getWallets().get();
      if (wallets.length === 0) return null;

      const w = wallets[0]!;
      const connectFeature = w.features["standard:connect"] as
        | { connect: () => Promise<{ accounts: Array<{ address: string }> }> }
        | undefined;

      if (!connectFeature) return null;
      const result = await connectFeature.connect();
      return result.accounts[0]?.address ?? null;
    } catch { return null; }
  }

  private async restoreSession(): Promise<void> {
    const saved = sessionStorage.getItem("sui_wallet_addr");
    if (saved) {
      this.state = { ...this.state, connected: true, address: saved };
      await this.refreshBalance();
      this.emit();
    }
  }
}

export const wallet = new WalletManager();
