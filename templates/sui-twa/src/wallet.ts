import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

export type Network = "mainnet" | "testnet" | "devnet";

export interface WalletState {
  connected: boolean;
  address: string | null;
  network: Network;
  balance: bigint | null;
}

type WalletListener = (state: WalletState) => void;

// WaaP embedded wallet — https://docs.waap.xyz
// Falls back to window.suiWallet (Sui Wallet browser extension) if WaaP is unavailable.
declare global {
  interface Window {
    waap?: {
      connect: () => Promise<{ address: string }>;
      disconnect: () => Promise<void>;
      signAndExecuteTransaction: (tx: unknown) => Promise<unknown>;
      getAddress: () => Promise<string | null>;
    };
    suiWallet?: {
      requestPermissions: () => Promise<void>;
      getAccounts: () => Promise<string[]>;
    };
  }
}

class WalletManager {
  private state: WalletState = {
    connected: false,
    address: null,
    network: "mainnet",
    balance: null,
  };

  private listeners: WalletListener[] = [];
  private client: SuiClient;

  constructor() {
    this.client = new SuiClient({ url: getFullnodeUrl("mainnet") });
    this.restoreSession();
  }

  getState(): WalletState {
    return { ...this.state };
  }

  subscribe(listener: WalletListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l(this.getState()));
  }

  async connect(): Promise<void> {
    try {
      let address: string | null = null;

      if (window.waap) {
        // WaaP embedded wallet (preferred — works in TWA without extension)
        const result = await window.waap.connect();
        address = result.address;
      } else if (window.suiWallet) {
        // Sui Wallet browser extension fallback
        await window.suiWallet.requestPermissions();
        const accounts = await window.suiWallet.getAccounts();
        address = accounts[0] ?? null;
      } else {
        // Dev mode: generate a mock address for testing UI
        address = "0x" + "a".repeat(64);
        console.warn("[wallet] No wallet provider found. Using mock address for dev.");
      }

      if (!address) throw new Error("No address returned from wallet");

      this.state = { ...this.state, connected: true, address };
      sessionStorage.setItem("sui_wallet_address", address);

      await this.refreshBalance();
      this.emit();
    } catch (err) {
      console.error("[wallet] connect error:", err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (window.waap) {
      try {
        await window.waap.disconnect();
      } catch (_) {
        // ignore
      }
    }
    sessionStorage.removeItem("sui_wallet_address");
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
    } catch (err) {
      console.warn("[wallet] balance fetch failed:", err);
    }
  }

  setNetwork(network: Network): void {
    this.state.network = network;
    this.client = new SuiClient({ url: getFullnodeUrl(network) });
    if (this.state.address) this.refreshBalance();
    this.emit();
  }

  getClient(): SuiClient {
    return this.client;
  }

  formatBalance(): string {
    if (this.state.balance === null) return "—";
    const sui = Number(this.state.balance) / 1_000_000_000;
    return `${sui.toFixed(4)} SUI`;
  }

  formatAddress(full = false): string {
    if (!this.state.address) return "";
    if (full) return this.state.address;
    return `${this.state.address.slice(0, 6)}…${this.state.address.slice(-4)}`;
  }

  private async restoreSession(): Promise<void> {
    const saved = sessionStorage.getItem("sui_wallet_address");
    if (saved) {
      this.state = { ...this.state, connected: true, address: saved };
      await this.refreshBalance();
      this.emit();
    }
  }
}

export const wallet = new WalletManager();
