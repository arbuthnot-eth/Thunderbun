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
import { toBase64 } from "@mysten/sui/utils";

// Load web components (connect modal, etc.)
import "@mysten/dapp-kit-core/web";
import type { UiWalletAccount } from "@wallet-standard/ui";
import {
  getWalletAccountForUiWalletAccount_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as getWalletAccountForUiWalletAccount,
  getWalletForHandle_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as getWalletForHandle,
} from "@wallet-standard/ui-registry";

import { waapReady } from "./init-waap";
import { dAppKit } from "./dapp-kit";

// ── Types ────────────────────────────────────────────────────────────────
export type Network = "mainnet" | "testnet" | "devnet";

export interface WalletState {
  connected: boolean;
  address: string | null;
  suiUsdcBalance: bigint | null;
  waapBaseAddress: string | null;
  waapBaseBalance: bigint | null;
  waapBaseUsdcBalance: bigint | null;
  suiPrimaryName: string | null;
  waapBasePrimaryName: string | null;
  network: Network;
  balance: bigint | null;
}

type Listener = (state: WalletState) => void;

// ── Connect modal instance ───────────────────────────────────────────────
let connectModal: HTMLElement | null = null;
const WAAP_HINTS: string[] = ["waap", "silk", "human.tech", "walletconnect", "reown", "peer"];
const WAAP_CONNECT_HINTS: string[] = ["waap", "silk", "human", "peer"];
const BASE_CHAIN_ID = "0x2105";
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BALANCE_OF_SELECTOR = "0x70a08231";

interface WaaPEvmProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  logout?: () => Promise<unknown>;
  getLoginMethod?: () => "waap" | "human" | "injected" | "walletconnect" | null;
}

declare global {
  interface Window {
    waap?: WaaPEvmProvider;
  }
}

function setWaapOverlayMode(active: boolean): void {
  document.body.classList.toggle("waap-overlay-active", active);
  if (connectModal) {
    if (active) {
      connectModal.style.pointerEvents = "none";
      connectModal.setAttribute("aria-hidden", "true");
    } else {
      connectModal.style.pointerEvents = "";
      connectModal.removeAttribute("aria-hidden");
    }
  }
}

function closeConnectDialogForWaaP(): void {
  const dialog = connectModal?.shadowRoot?.querySelector("dialog");
  if (dialog instanceof HTMLDialogElement && dialog.open) {
    dialog.close();
  }
  setWaapOverlayMode(true);
}

function isLikelyWaapOverlay(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.tagName === "WAAP-WALLET") return true;

  const haystack = `${node.id} ${node.className} ${node.getAttribute("data-testid") ?? ""} ${node.getAttribute("aria-label") ?? ""}`.toLowerCase();
  if (WAAP_HINTS.some((hint) => haystack.includes(hint))) return true;

  try {
    const style = getComputedStyle(node);
    const z = Number.parseInt(style.zIndex || "0", 10);
    if (
      style.position === "fixed" &&
      z >= 900 &&
      node.clientWidth >= window.innerWidth * 0.75 &&
      node.clientHeight >= window.innerHeight * 0.55
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

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

function selectPreferredWaaPWallet() {
  const wallets = dAppKit.stores.$wallets.get();
  const preferred = wallets.find((wallet) => {
    const haystack = `${wallet.name} ${(wallet as { id?: string }).id ?? ""}`.toLowerCase();
    return WAAP_CONNECT_HINTS.some((hint) => haystack.includes(hint));
  });
  return preferred ?? null;
}

function hasWaaPName(name: string | undefined): boolean {
  if (!name) return false;
  const lowered = name.toLowerCase();
  return WAAP_CONNECT_HINTS.some((hint) => lowered.includes(hint));
}

async function ensureBaseChain(provider: WaaPEvmProvider): Promise<void> {
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
}

// ── WalletManager ────────────────────────────────────────────────────────
class WalletManager {
  private listeners: Listener[] = [];
  private balanceCache: bigint | null = null;
  private suiUsdcBalanceCache: bigint | null = null;
  private waapBaseAddress: string | null = null;
  private waapBaseBalanceCache: bigint | null = null;
  private waapBaseUsdcBalanceCache: bigint | null = null;
  private suiPrimaryName: string | null = null;
  private waapBasePrimaryName: string | null = null;
  private waapBaseAutoRequested = false;
  private waapAddressLookup: Promise<string | null> | null = null;

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
      suiUsdcBalance: connected ? this.suiUsdcBalanceCache : null,
      waapBaseAddress: connected ? this.waapBaseAddress : null,
      waapBaseBalance: connected ? this.waapBaseBalanceCache : null,
      waapBaseUsdcBalance: connected ? this.waapBaseUsdcBalanceCache : null,
      suiPrimaryName: connected ? this.suiPrimaryName : null,
      waapBasePrimaryName: connected ? this.waapBasePrimaryName : null,
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
    setWaapOverlayMode(false);

    // Prefer WaaP direct connect so users land in WaaP immediately.
    const preferredWaaP = selectPreferredWaaPWallet();
    if (preferredWaaP) {
      try {
        await dAppKit.connectWallet({ wallet: preferredWaaP });
        await this.getWaaPBaseAddress({ request: true });
        this.waapBaseAutoRequested = true;
        return;
      } catch (err) {
        console.warn("[wallet] direct WaaP connect failed, using modal fallback:", err);
      }
    }

    const modal = ensureConnectModal();

    // dApp Kit opens a top-layer <dialog>. When WaaP auth opens, force-close
    // the dApp Kit dialog so WaaP can receive pointer/keyboard focus.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (isLikelyWaapOverlay(node)) {
            closeConnectDialogForWaaP();
            observer.disconnect();
            return;
          }
        }
      }
    });

    observer.observe(document.body, { childList: true });
    const shadowRoot = connectModal?.shadowRoot;
    const onShadowClick = (ev: Event) => {
      const matched = ev.composedPath().some((p) => {
        if (!(p instanceof HTMLElement)) return false;
        const text = (p.textContent ?? "").toLowerCase();
        return WAAP_HINTS.some((hint) => text.includes(hint));
      });
      if (matched) {
        closeConnectDialogForWaaP();
      }
    };
    shadowRoot?.addEventListener("click", onShadowClick, true);

    try {
      await modal.show();
    } finally {
      observer.disconnect();
      shadowRoot?.removeEventListener("click", onShadowClick, true);
      setWaapOverlayMode(false);
    }

    const conn = dAppKit.stores.$connection.get();
    if (conn.isConnected && hasWaaPName(conn.wallet?.name)) {
      await this.getWaaPBaseAddress({ request: true });
      this.waapBaseAutoRequested = true;
    }
  }

  async disconnect(): Promise<void> {
    await dAppKit.disconnectWallet();
    this.balanceCache = null;
    this.suiUsdcBalanceCache = null;
    this.waapBaseAddress = null;
    this.waapBaseBalanceCache = null;
    this.waapBaseUsdcBalanceCache = null;
    this.suiPrimaryName = null;
    this.waapBasePrimaryName = null;
    this.waapBaseAutoRequested = false;
    this.waapAddressLookup = null;
    this.emit();
  }

  async disconnectWaaP(): Promise<void> {
    await waapReady;
    const provider = window.waap as WaaPEvmProvider | undefined;

    if (provider?.logout) {
      try {
        await provider.logout();
      } catch (err) {
        console.warn("[wallet] waap logout failed:", err);
      }
    }

    try {
      await dAppKit.disconnectWallet();
    } catch {
      /* ignore */
    }

    this.balanceCache = null;
    this.suiUsdcBalanceCache = null;
    this.waapBaseAddress = null;
    this.waapBaseBalanceCache = null;
    this.waapBaseUsdcBalanceCache = null;
    this.suiPrimaryName = null;
    this.waapBasePrimaryName = null;
    this.waapBaseAutoRequested = false;
    this.waapAddressLookup = null;
    this.emit();
  }

  async refreshBalance(): Promise<void> {
    const state = this.getState();
    if (!state.address) return;
    const address = state.address;
    const tasks: Promise<void>[] = [];

    tasks.push((async () => {
      const client = dAppKit.getClient();
      try {
        const { balance } = await client.getBalance({
          owner: address,
          coinType: "0x2::sui::SUI",
        });
        this.balanceCache = BigInt(balance.balance);
      } catch {
        /* ignore */
      }
    })());

    tasks.push(this.refreshSuiUsdcBalance(address));
    tasks.push(this.refreshSuiPrimaryName(address));
    tasks.push(this.refreshBaseProfile());

    await Promise.all(tasks);
    this.emit();
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

  formatBaseBalance(): string {
    if (this.waapBaseBalanceCache === null) return "—";
    return `${formatEthFromWei(this.waapBaseBalanceCache)} ETH`;
  }

  formatSuiUsdcBalance(): string {
    if (this.suiUsdcBalanceCache === null) return "—";
    return formatUsdc(this.suiUsdcBalanceCache);
  }

  formatBaseUsdcBalance(): string {
    if (this.waapBaseUsdcBalanceCache === null) return "—";
    return formatUsdc(this.waapBaseUsdcBalanceCache);
  }

  formatAddress(full = false): string {
    const addr = this.getState().address;
    if (!addr) return "";
    if (full) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  async getBaseEthBalance(): Promise<bigint> {
    await waapReady;
    const provider = window.waap as WaaPEvmProvider | undefined;
    if (!provider) throw new Error("WaaP provider not available.");

    const baseAddress = this.waapBaseAddress;
    if (!baseAddress) throw new Error("WaaP Base address not linked.");

    await ensureBaseChain(provider);
    const weiHex = await provider.request({
      method: "eth_getBalance",
      params: [baseAddress, "latest"],
    });

    if (typeof weiHex !== "string") {
      throw new Error("eth_getBalance returned non-string.");
    }

    const wei = BigInt(weiHex);
    this.waapBaseBalanceCache = wei;
    this.emit();
    return wei;
  }

  async getWaaPBaseAddress({ request = false }: { request?: boolean } = {}): Promise<string | null> {
    if (this.waapAddressLookup) return this.waapAddressLookup;

    const lookup = this.resolveWaaPBaseAddress(request);
    this.waapAddressLookup = lookup;
    try {
      return await lookup;
    } finally {
      if (this.waapAddressLookup === lookup) {
        this.waapAddressLookup = null;
      }
    }
  }

  async linkWaaPBaseAddress(): Promise<string> {
    await waapReady;

    const current = dAppKit.stores.$connection.get();
    if (!current.isConnected || !hasWaaPName(current.wallet?.name)) {
      const preferredWaaP = selectPreferredWaaPWallet();
      if (!preferredWaaP) {
        throw new Error("WaaP wallet is not available. Open connect and choose WaaP first.");
      }
      await dAppKit.connectWallet({ wallet: preferredWaaP });
    }

    const base = await this.getWaaPBaseAddress({ request: true });
    if (!base) {
      throw new Error("WaaP Base address could not be resolved.");
    }
    this.waapBaseAutoRequested = true;
    return base;
  }

  async getWaaPSuiAddress(): Promise<string> {
    await waapReady;

    const current = dAppKit.stores.$connection.get();
    if (!current.isConnected || !current.account || !hasWaaPName(current.wallet?.name)) {
      const preferredWaaP = selectPreferredWaaPWallet();
      if (!preferredWaaP) {
        throw new Error("WaaP Sui wallet is not available. Open connect and choose WaaP first.");
      }
      await dAppKit.connectWallet({ wallet: preferredWaaP });
    }

    const resolved = dAppKit.stores.$connection.get();
    const address = resolved.account?.address ?? null;
    if (!address || !hasWaaPName(resolved.wallet?.name)) {
      throw new Error("WaaP Sui address could not be resolved.");
    }

    return address;
  }

  // ── Base EVM Transactions ──────────────────────────────────────────────────

  async sendBaseTransaction({ to, data, value }: {
    to: string;
    data: string;
    value?: string;
  }): Promise<string> {
    await waapReady;
    const provider = window.waap as WaaPEvmProvider | undefined;
    if (!provider) throw new Error("WaaP provider not available.");

    const baseAddr = this.waapBaseAddress;
    if (!baseAddr) throw new Error("WaaP Base address not linked.");

    await ensureBaseChain(provider);

    const txParams: Record<string, string> = { from: baseAddr, to, data };
    if (value) txParams.value = value;

    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [txParams],
    });

    if (typeof txHash !== "string") {
      throw new Error("eth_sendTransaction did not return a tx hash.");
    }

    return txHash;
  }

  async waitForBaseReceipt(txHash: string, timeoutMs = 120_000): Promise<Record<string, unknown>> {
    await waapReady;
    const provider = window.waap as WaaPEvmProvider | undefined;
    if (!provider) throw new Error("WaaP provider not available.");
    await ensureBaseChain(provider);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const receipt = await provider.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      });

      if (receipt && typeof receipt === "object") {
        const r = receipt as Record<string, unknown>;
        const status = typeof r.status === "string" ? r.status : "";
        if (status === "0x0") {
          throw new Error(`Base transaction reverted: ${txHash}`);
        }
        return r;
      }

      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    throw new Error(`Timed out waiting for Base tx receipt: ${txHash}`);
  }

  async callBase({ to, data }: { to: string; data: string }): Promise<string> {
    await waapReady;
    const provider = window.waap as WaaPEvmProvider | undefined;
    if (!provider) throw new Error("WaaP provider not available.");
    await ensureBaseChain(provider);

    const result = await provider.request({
      method: "eth_call",
      params: [{ to, data }, "latest"],
    });
    if (typeof result !== "string") throw new Error("eth_call returned non-string.");
    return result;
  }

  // ── Sponsored Transactions ────────────────────────────────────────────────

  async buildSponsoredTx(
    build: (tx: Transaction) => void | Promise<void>,
    sponsorAddress: string,
  ): Promise<{ bytes: string; userSignature: string }> {
    await this.ensureWalletCanSignTransactions();

    const mod = await import("@mysten/sui/transactions");
    const tx = new mod.Transaction();
    tx.setSender(this.getState().address!);
    tx.setGasOwner(sponsorAddress);
    await build(tx);
    const signable = await this.toSignableTransactionInput(tx);
    const { signature, bytes } = await dAppKit.signTransaction({ transaction: signable });
    return { bytes, userSignature: signature };
  }

  async executeSponsoredTx(
    bytes: string,
    signatures: string[],
  ): Promise<unknown> {
    return this.executeTransactionBytes(bytes, signatures);
  }

  async signAndExecuteSuiTransaction(transaction: Transaction): Promise<unknown> {
    await this.ensureWalletCanSignAndOrExecuteTransactions();
    const signable = await this.toSignableTransactionInput(transaction, { forceSerialized: true });
    if (typeof signable !== "string") {
      throw new Error("Failed to serialize Sui transaction for signing.");
    }
    const serialized = signable;

    // Avoid dAppKit.signAndExecuteTransaction route; some WaaP builds reject its wrapper payload.
    const blockResult = await this.trySignAndExecuteViaBlockFeature(serialized);
    if (blockResult) {
      return blockResult;
    }

    await this.ensureWalletCanSignTransactions();
    const { signature, bytes } = await dAppKit.signTransaction({ transaction: serialized });
    return this.executeTransactionBytes(bytes, [signature]);
  }

  private async toSignableTransactionInput(
    transaction: Transaction,
    opts?: { forceSerialized?: boolean },
  ): Promise<Transaction | string> {
    const conn = dAppKit.stores.$connection.get();
    const shouldSerialize = Boolean(opts?.forceSerialized) || hasWaaPName(conn.wallet?.name);
    if (!shouldSerialize) {
      return transaction;
    }

    const sender = this.getState().address;
    if (sender) {
      transaction.setSenderIfNotSet(sender);
    }

    const txBytes = await transaction.build({ client: this.getClient() });
    return toBase64(txBytes);
  }

  private async executeTransactionBytes(
    bytes: string,
    signatures: string[],
  ): Promise<unknown> {
    const txBytes = Uint8Array.from(atob(bytes), (ch) => ch.charCodeAt(0));
    return this.getClient().executeTransaction({
      transaction: txBytes,
      signatures,
    });
  }

  private async trySignAndExecuteViaBlockFeature(serializedTx: string): Promise<unknown | null> {
    const conn = dAppKit.stores.$connection.get();
    const account = conn.account as UiWalletAccount | null;
    if (!account) return null;
    if (!this.isAccountOnCurrentSuiChain(account)) return null;

    type WalletWithFeatures = {
      features?: Record<string, unknown>;
    };
    type SignAndExecuteBlockFeature = {
      signAndExecuteTransactionBlock(args: {
        account: unknown;
        chain: string;
        transactionBlock: Transaction;
        options?: {
          showRawEffects?: boolean;
          showRawInput?: boolean;
        };
      }): Promise<unknown>;
    };

    const wallet = getWalletForHandle(account) as WalletWithFeatures;
    const feature = wallet.features?.["sui:signAndExecuteTransactionBlock"] as SignAndExecuteBlockFeature | undefined;
    if (!feature || typeof feature.signAndExecuteTransactionBlock !== "function") {
      return null;
    }

    const underlyingAccount = getWalletAccountForUiWalletAccount(account);
    const txMod = await import("@mysten/sui/transactions");
    const transactionBlock = txMod.Transaction.from(serializedTx);
    const sender = this.getState().address;
    if (sender) {
      transactionBlock.setSenderIfNotSet(sender);
    }

    const chain = `sui:${dAppKit.stores.$currentNetwork.get()}`;
    return await feature.signAndExecuteTransactionBlock({
      account: underlyingAccount,
      chain,
      transactionBlock,
      options: {
        showRawEffects: true,
        showRawInput: true,
      },
    });
  }

  private getFeatureAliases(feature: string): string[] {
    if (feature === "sui:signTransaction") {
      return ["sui:signTransaction", "sui:signTransactionBlock"];
    }
    if (feature === "sui:signAndExecuteTransaction") {
      return ["sui:signAndExecuteTransaction", "sui:signAndExecuteTransactionBlock"];
    }
    return [feature];
  }

  private extractFeatureNames(features: unknown): Set<string> {
    const names = new Set<string>();
    if (!features) return names;

    if (Array.isArray(features)) {
      for (const feature of features) {
        if (typeof feature === "string" && feature.length > 0) {
          names.add(feature);
        }
      }
      return names;
    }

    if (typeof features === "object") {
      for (const feature of Object.keys(features as Record<string, unknown>)) {
        if (feature.length > 0) names.add(feature);
      }
    }

    return names;
  }

  private getAccountFeatureNames(account: UiWalletAccount | null | undefined): Set<string> {
    if (!account) return new Set<string>();
    try {
      const underlying = getWalletAccountForUiWalletAccount(account) as { features?: unknown };
      return this.extractFeatureNames(underlying.features);
    } catch {
      return new Set<string>();
    }
  }

  private isAccountOnCurrentSuiChain(account: UiWalletAccount | null | undefined): boolean {
    if (!account) return false;
    const currentNetwork = dAppKit.stores.$currentNetwork.get();
    const expectedChain = `sui:${currentNetwork}` as `${string}:${string}`;
    return account.chains.includes(expectedChain);
  }

  private accountSupportsAnyFeature(account: UiWalletAccount | null | undefined, features: string[]): boolean {
    if (!account) return false;
    if (!this.isAccountOnCurrentSuiChain(account)) return false;
    const accountFeatures = this.getAccountFeatureNames(account);
    return features.some((feature) => {
      const aliases = this.getFeatureAliases(feature);
      return aliases.some((alias) => accountFeatures.has(alias));
    });
  }

  private findSigningAccount(
    accounts: readonly UiWalletAccount[] | undefined,
    features: string[],
  ): UiWalletAccount | null {
    if (!accounts || accounts.length === 0) return null;
    for (const account of accounts) {
      if (this.accountSupportsAnyFeature(account, features)) {
        return account;
      }
    }
    return null;
  }

  private connectionSupportsAnyFeature(
    conn: { account?: UiWalletAccount | null; isConnected: boolean },
    features: string[],
  ): boolean {
    if (!conn.isConnected) return false;
    return this.accountSupportsAnyFeature(conn.account, features);
  }

  private async ensureWalletSupportsAnyFeature(features: string[]): Promise<void> {
    const conn = dAppKit.stores.$connection.get();
    if (this.connectionSupportsAnyFeature(conn, features)) {
      return;
    }

    if (conn.isConnected && conn.wallet) {
      const candidate = this.findSigningAccount(conn.wallet.accounts, features);
      if (candidate && candidate.address !== conn.account?.address) {
        try {
          dAppKit.switchAccount({ account: candidate });
        } catch (err) {
          console.warn("[wallet] failed switching to signing-capable account:", err);
        }
      }
      const switched = dAppKit.stores.$connection.get();
      if (this.connectionSupportsAnyFeature(switched, features)) {
        return;
      }
    }

    const preferredWaaP = selectPreferredWaaPWallet();
    if (preferredWaaP) {
      try {
        const preselected = this.findSigningAccount(preferredWaaP.accounts, features);
        const connected = await dAppKit.connectWallet({
          wallet: preferredWaaP,
          ...(preselected ? { account: preselected } : {}),
        });
        const resolved = this.findSigningAccount(connected.accounts, features);
        if (resolved) {
          dAppKit.switchAccount({ account: resolved });
        }
      } catch (err) {
        console.warn("[wallet] failed reconnecting preferred WaaP wallet:", err);
      }
    }

    const refreshed = dAppKit.stores.$connection.get();
    if (this.connectionSupportsAnyFeature(refreshed, features)) {
      return;
    }

    const walletName = refreshed.wallet?.name ?? conn.wallet?.name ?? "current wallet";
    throw new Error(
      `Connected wallet (${walletName}) cannot sign Sui transactions. Reconnect with WaaP on the same login session.`,
    );
  }

  private async ensureWalletCanSignTransactions(): Promise<void> {
    await this.ensureWalletSupportsAnyFeature(["sui:signTransaction"]);
  }

  private async ensureWalletCanSignAndOrExecuteTransactions(): Promise<void> {
    await this.ensureWalletSupportsAnyFeature(["sui:signAndExecuteTransaction", "sui:signTransaction"]);
  }

  private emit() {
    this.listeners.forEach((l) => l(this.getState()));
  }

  private async syncFromDAppKit(): Promise<void> {
    const conn = dAppKit.stores.$connection.get();
    if (conn.isConnected && conn.account) {
      await this.refreshBalance();
      if (hasWaaPName(conn.wallet?.name)) {
        const shouldAutoRequest = !this.waapBaseAddress && !this.waapBaseAutoRequested;
        await this.getWaaPBaseAddress({ request: shouldAutoRequest });
        if (shouldAutoRequest) this.waapBaseAutoRequested = true;
        await this.refreshBaseProfile();
      } else {
        this.waapBaseAddress = null;
        this.waapBaseBalanceCache = null;
        this.waapBaseUsdcBalanceCache = null;
        this.waapBasePrimaryName = null;
        this.waapBaseAutoRequested = false;
      }
    } else {
      this.balanceCache = null;
      this.suiUsdcBalanceCache = null;
      this.waapBaseAddress = null;
      this.waapBaseBalanceCache = null;
      this.waapBaseUsdcBalanceCache = null;
      this.suiPrimaryName = null;
      this.waapBasePrimaryName = null;
      this.waapBaseAutoRequested = false;
      this.waapAddressLookup = null;
    }
    this.emit();
  }

  private async resolveWaaPBaseAddress(request: boolean): Promise<string | null> {
    await waapReady;
    const provider = window.waap as WaaPEvmProvider | undefined;
    if (!provider) {
      this.waapBaseAddress = null;
      this.emit();
      return null;
    }

    try {
      if (request) {
        const loginMethod = provider.getLoginMethod?.();
        if (loginMethod && loginMethod !== "waap" && loginMethod !== "human") {
          try {
            await provider.logout?.();
          } catch {
            /* ignore */
          }
        }
      }

      await ensureBaseChain(provider);

      const accounts = await provider.request({
        method: request ? "eth_requestAccounts" : "eth_accounts",
      });
      const nextAddress = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
      this.waapBaseAddress = nextAddress;
      if (!nextAddress) {
        this.waapBaseBalanceCache = null;
        this.waapBaseUsdcBalanceCache = null;
        this.waapBasePrimaryName = null;
      } else {
        await this.refreshBaseProfile();
      }
      this.emit();
      return nextAddress;
    } catch (err) {
      // Most common case: extension/adblock interference with WaaP iframe boot.
      console.warn("[wallet] failed resolving WaaP Base address:", err);
      this.waapBaseAddress = null;
      this.waapBaseBalanceCache = null;
      this.waapBaseUsdcBalanceCache = null;
      this.waapBasePrimaryName = null;
      this.emit();
      return null;
    }
  }

  private async refreshSuiPrimaryName(address: string): Promise<void> {
    try {
      const client = dAppKit.getClient();
      const reverse = await client.defaultNameServiceName({ address });
      this.suiPrimaryName = reverse.data.name ?? null;
    } catch {
      this.suiPrimaryName = null;
    }
  }

  private async refreshSuiUsdcBalance(address: string): Promise<void> {
    try {
      const client = dAppKit.getClient();
      const preferredCoinType = (import.meta.env.VITE_SUI_USDC_COIN_TYPE as string | undefined)?.trim() || null;

      if (preferredCoinType) {
        const { balance } = await client.getBalance({
          owner: address,
          coinType: preferredCoinType,
        });
        this.suiUsdcBalanceCache = BigInt(balance.balance);
        return;
      }

      let total = 0n;
      let cursor: string | null = null;

      do {
        const page = await client.listBalances({ owner: address, cursor, limit: 100 });
        for (const item of page.balances) {
          if (typeof item.coinType === "string" && item.coinType.endsWith("::usdc::USDC")) {
            total += BigInt(item.balance);
          }
        }
        cursor = page.cursor;
        if (!page.hasNextPage) break;
      } while (cursor);

      this.suiUsdcBalanceCache = total;
    } catch {
      this.suiUsdcBalanceCache = null;
    }
  }

  private async refreshBaseProfile(): Promise<void> {
    const baseAddress = this.waapBaseAddress;
    if (!baseAddress) {
      this.waapBaseBalanceCache = null;
      this.waapBaseUsdcBalanceCache = null;
      this.waapBasePrimaryName = null;
      return;
    }

    const provider = window.waap as WaaPEvmProvider | undefined;
    if (!provider) {
      this.waapBaseBalanceCache = null;
      this.waapBaseUsdcBalanceCache = null;
      this.waapBasePrimaryName = null;
      return;
    }

    try {
      await ensureBaseChain(provider);
    } catch {
      /* chain switch failed — balance queries will likely fail too */
    }

    try {
      const weiHex = await provider.request({
        method: "eth_getBalance",
        params: [baseAddress, "latest"],
      });
      if (typeof weiHex === "string") {
        this.waapBaseBalanceCache = BigInt(weiHex);
      }
    } catch {
      this.waapBaseBalanceCache = null;
    }

    try {
      const paddedAddr = baseAddress.slice(2).toLowerCase().padStart(64, "0");
      const data = `${BALANCE_OF_SELECTOR}${paddedAddr}`;
      const result = await provider.request({
        method: "eth_call",
        params: [{ to: BASE_USDC_ADDRESS, data }, "latest"],
      });
      if (typeof result === "string") {
        this.waapBaseUsdcBalanceCache = BigInt(result);
      }
    } catch {
      this.waapBaseUsdcBalanceCache = null;
    }

    this.waapBasePrimaryName = await resolveBasePrimaryName(baseAddress);
  }

}

export const wallet = new WalletManager();

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const fractional = raw % 1_000_000n;
  if (fractional === 0n) return `${whole} USDC`;
  const padded = fractional.toString().padStart(6, "0");
  const trimmed = padded.slice(0, 2).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed} USDC` : `${whole} USDC`;
}

function formatEthFromWei(wei: bigint): string {
  const whole = wei / 1_000_000_000_000_000_000n;
  const fractional = wei % 1_000_000_000_000_000_000n;
  if (fractional === 0n) return whole.toString();
  const padded = fractional.toString().padStart(18, "0");
  const trimmed = padded.slice(0, 4).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

async function resolveBasePrimaryName(address: string): Promise<string | null> {
  try {
    const [{ createPublicClient, http }, { base }] = await Promise.all([
      import("viem"),
      import("viem/chains"),
    ]);
    const client = createPublicClient({
      chain: base,
      transport: http("https://mainnet.base.org"),
    });
    const name = await client.getEnsName({ address: address as `0x${string}` });
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
