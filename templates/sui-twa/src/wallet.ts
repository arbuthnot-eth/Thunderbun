/**
 * wallet.ts — WaaP (primary) + dApp Kit + Wallet Standard extensions
 *
 * WaaP embedded wallet works in TWA without extension.
 * dApp Kit provides the connect modal (WaaP + Sui Wallet, etc.).
 *
 * Docs: https://docs.waap.xyz/guides-sui/start
 * Docs: https://sdk.mystenlabs.com/dapp-kit
 */

import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Transaction } from "@mysten/sui/transactions";

// Load web components (connect modal, etc.)
import "@mysten/dapp-kit-core/web";

import { waapReady } from "./init-waap";
import { dAppKit } from "./dapp-kit";

// ── Types ────────────────────────────────────────────────────────────────
export type Network = "mainnet" | "testnet" | "devnet";

export interface WalletState {
  connected: boolean;
  address: string | null;
  network: Network;
  balance: bigint | null;
}

type Listener = (state: WalletState) => void;

// ── Connect modal instance ───────────────────────────────────────────────
let connectModal: HTMLElement | null = null;

function ensureConnectModal(): HTMLElement & { show: () => Promise<void> } {
  if (!connectModal) {
    const el = document.createElement("mysten-dapp-kit-connect-modal");
    (el as unknown as { instance: typeof dAppKit }).instance = dAppKit;
    (el as unknown as { sortFn?: (a: { name: string }, b: { name: string }) => number }).sortFn = (a, b) => {
      // Sort normally, keeping user's installed wallets first
      return a.name.localeCompare(b.name);
    };
    document.body.appendChild(el);
    connectModal = el;
  }
  return connectModal as HTMLElement & { show: () => Promise<void> };
}

// ── WalletManager ────────────────────────────────────────────────────────
class WalletManager {
  private listeners: Listener[] = [];
  private balanceCache: bigint | null = null;

  constructor() {
    this.syncFromDAppKit();
    dAppKit.stores.$connection.subscribe(() => this.syncFromDAppKit());
    dAppKit.stores.$currentNetwork.subscribe(() => this.emit());
  }

  getState(): WalletState {
    const conn = dAppKit.stores.$connection.get();
    const network = dAppKit.stores.$currentNetwork.get() as Network;
    const address = conn.account?.address ?? null;
    const connected = conn.isConnected;
    return {
      connected,
      address,
      network,
      balance: connected && address ? this.balanceCache : null,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    listener(this.getState());
    const unsub = dAppKit.stores.$connection.subscribe(() => listener(this.getState()));
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
      unsub();
    };
  }

  async connect(): Promise<void> {
    await waapReady;
    const modal = ensureConnectModal();

    // dApp Kit opens <dialog> via .showModal() → top layer, above everything.
    // When user picks WaaP, WaaP appends its own auth overlay to <body>.
    // Close the dialog at that point so it doesn't stack above WaaP.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (
            node instanceof HTMLElement &&
            node.tagName === "DIV" &&
            node !== connectModal &&
            node.id !== "app" &&
            node.id !== "splash"
          ) {
            const dialog = connectModal?.shadowRoot?.querySelector("dialog");
            if (dialog instanceof HTMLDialogElement && dialog.open) {
              dialog.close();
            }
            observer.disconnect();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });

    try {
      await modal.show();
    } finally {
      observer.disconnect();
    }
  }

  async disconnect(): Promise<void> {
    await dAppKit.disconnectWallet();
    this.balanceCache = null;
    this.emit();
  }

  async refreshBalance(): Promise<void> {
    const state = this.getState();
    if (!state.address) return;
    try {
      const client = dAppKit.getClient();
      const { balance } = await client.getBalance({
        owner: state.address,
        coinType: "0x2::sui::SUI",
      });
      this.balanceCache = BigInt(balance.balance);
      this.emit();
    } catch {
      /* ignore */
    }
  }

  setNetwork(network: Network): void {
    dAppKit.switchNetwork(network);
    if (this.getState().address) this.refreshBalance();
  }

  getClient(): SuiGrpcClient {
    return dAppKit.getClient() as SuiGrpcClient;
  }

  formatBalance(): string {
    const s = this.getState();
    if (s.balance === null) return "—";
    return (Number(s.balance) / 1_000_000_000).toFixed(4) + " SUI";
  }

  formatAddress(full = false): string {
    const addr = this.getState().address;
    if (!addr) return "";
    if (full) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  // ── Sponsored Transactions ────────────────────────────────────────────────

  async buildSponsoredTx(
    build: (tx: Transaction) => void,
    sponsorAddress: string,
  ): Promise<{ bytes: string; userSignature: string }> {
    const mod = await import("@mysten/sui/transactions");
    const tx = new mod.Transaction();
    tx.setSender(this.getState().address!);
    tx.setGasOwner(sponsorAddress);
    build(tx);
    const { signature, bytes } = await dAppKit.signTransaction({ transaction: tx });
    return { bytes, userSignature: signature };
  }

  async executeSponsoredTx(
    bytes: string,
    signatures: string[],
  ): Promise<unknown> {
    const txBytes = Uint8Array.from(atob(bytes), (ch) => ch.charCodeAt(0));
    return this.getClient().executeTransaction({
      transaction: txBytes,
      signatures,
    });
  }

  private emit() {
    this.listeners.forEach((l) => l(this.getState()));
  }

  private async syncFromDAppKit(): Promise<void> {
    const conn = dAppKit.stores.$connection.get();
    if (conn.isConnected && conn.account) {
      await this.refreshBalance();
    } else {
      this.balanceCache = null;
    }
    this.emit();
  }

}

export const wallet = new WalletManager();
