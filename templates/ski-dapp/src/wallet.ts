/**
 * wallet.ts — WaaP (primary) + dApp Kit + Wallet Standard extensions
 *
 * WaaP embedded wallet works in TWA without extension.
 * Connect flow prefers native WaaP SDK auth first, then syncs dApp Kit.
 *
 * Docs: https://docs.waap.xyz/guides-sui/start
 * Docs: https://sdk.mystenlabs.com/dapp-kit
 */

import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Transaction } from "@mysten/sui/transactions";

import type { UiWallet, UiWalletAccount } from "@wallet-standard/ui";
import {
  getWalletAccountForUiWalletAccount_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as getWalletAccountForUiWalletAccount,
} from "@wallet-standard/ui-registry";

import { getWaapInitStatus, waapReady } from "./init-waap";
import { dAppKit } from "./dapp-kit";
import { signSuiTransactionViaReactDappKit } from "./react/dapp-kit-island";

// ── Types ────────────────────────────────────────────────────────────────
export type Network = "mainnet" | "testnet" | "devnet";

export interface WalletState {
  hydrating: boolean;
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

const WAAP_CONNECT_HINTS: string[] = ["waap", "silk", "human", "peer"];
const BASE_CHAIN_ID = "0x2105";
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BALANCE_OF_SELECTOR = "0x70a08231";
const WALLET_PREF_KEY = "tb_wallet_preference";

interface WalletPreference {
  type: "waap" | "traditional";
  suiAddress: string;
  walletName: string | null;
  baseAddress: string | null;
  timestamp: number;
}

function saveWalletPreference(pref: WalletPreference): void {
  try {
    localStorage.setItem(WALLET_PREF_KEY, JSON.stringify(pref));
  } catch { /* storage full or blocked */ }
}

function loadWalletPreference(): WalletPreference | null {
  try {
    const raw = localStorage.getItem(WALLET_PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WalletPreference;
    if (!parsed.type || !parsed.suiAddress || typeof parsed.timestamp !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearWalletPreference(): void {
  try {
    localStorage.removeItem(WALLET_PREF_KEY);
    localStorage.removeItem("tb-react-dapp-kit");
  } catch { /* ignore */ }
}

interface WaaPEvmProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  login?: () => Promise<unknown>;
  logout?: () => Promise<unknown>;
  getLoginMethod?: () => "waap" | "human" | "injected" | "walletconnect" | null;
}

declare global {
  interface Window {
    waap?: WaaPEvmProvider;
  }
}

function hardReloadApp(): void {
  try {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("tb_hard_reset", String(Date.now()));
    window.location.replace(nextUrl.toString());
  } catch {
    window.location.reload();
  }
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

function getTraditionalWallets(): UiWallet[] {
  return dAppKit.stores.$wallets.get().filter((wallet) => !hasWaaPName(wallet.name));
}

async function waitForPreferredWaaPWallet(timeoutMs = 5_000): Promise<ReturnType<typeof selectPreferredWaaPWallet>> {
  const startedAt = Date.now();
  let preferred = selectPreferredWaaPWallet();
  while (!preferred && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    preferred = selectPreferredWaaPWallet();
  }
  return preferred;
}

async function ensureBaseChain(provider: WaaPEvmProvider): Promise<void> {
  try {
    const currentChainId = await provider.request({ method: "eth_chainId" });
    if (typeof currentChainId === "string" && currentChainId.toLowerCase() === BASE_CHAIN_ID) {
      return;
    }
  } catch {
    // If chain id probing fails, fall back to switching.
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
}

// ── WalletManager ────────────────────────────────────────────────────────
class WalletManager {
  private static readonly WALLET_REQUEST_TIMEOUT_MS = 15_000;
  private listeners: Listener[] = [];
  private hydrating = true;
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
    dAppKit.stores.$connection.subscribe(() => {
      void this.syncFromDAppKit();
    });
    dAppKit.stores.$currentNetwork.subscribe(() => this.emit());

    window.addEventListener("tb:ski-wallet-connected", () => {
      void this.bridgeSkiWidgetConnection();
    });
    window.addEventListener("tb:ski-wallet-disconnected", () => {
      void this.disconnect();
    });

    void this.finishInitialHydration();
  }

  getState(): WalletState {
    const conn = dAppKit.stores.$connection.get();
    const network = dAppKit.stores.$currentNetwork.get() as Network;
    const address = conn.account?.address ?? null;
    const connected = conn.isConnected;
    return {
      hydrating: this.hydrating,
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
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  openConnectModal(): void {
    const kit = window.SuiWalletKit;
    if (kit?.openModal) {
      kit.openModal();
    }
  }

  async connect(): Promise<void> {
    await waapReady;
    const waapStatus = getWaapInitStatus();
    if (!waapStatus.ready) {
      throw new Error(waapStatus.reason ?? "WaaP SDK failed to initialize.");
    }

    const provider = window.waap as WaaPEvmProvider | undefined;
    if (!provider) {
      throw new Error("WaaP provider not available.");
    }

    const method = provider.getLoginMethod?.();
    if (method && method !== "waap" && method !== "human") {
      try {
        await provider.logout?.();
      } catch {
        /* ignore */
      }
    }

    if (provider.login) {
      await provider.login();
    }

    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const baseAddress = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
    if (!baseAddress) {
      throw new Error("WaaP did not return a Base account.");
    }

    this.waapBaseAddress = baseAddress;
    this.waapBaseAutoRequested = true;
    await this.refreshBaseProfile();

    const preferredWaaP = await waitForPreferredWaaPWallet();
    if (!preferredWaaP) {
      this.emit();
      throw new Error("WaaP Sui wallet was not registered in dApp Kit. Check browser privacy settings and extensions.");
    }

    await dAppKit.connectWallet({ wallet: preferredWaaP });
    const connAfter = dAppKit.stores.$connection.get();
    saveWalletPreference({
      type: "waap",
      suiAddress: connAfter.account?.address ?? baseAddress,
      walletName: connAfter.wallet?.name ?? null,
      baseAddress,
      timestamp: Date.now(),
    });
    await this.refreshBalance();
  }

  async connectTraditional(wallet?: UiWallet): Promise<void> {
    const selectedWallet = wallet ?? getTraditionalWallets()[0] ?? null;
    if (!selectedWallet) {
      throw new Error("No traditional Sui wallets detected in dApp Kit.");
    }

    const preferredAccount =
      this.findSigningAccount(selectedWallet?.accounts, ["sui:signTransaction", "sui:signAndExecuteTransaction"]) ??
      selectedWallet?.accounts?.[0] ??
      null;

    await dAppKit.connectWallet({
      wallet: selectedWallet,
      ...(preferredAccount ? { account: preferredAccount } : {}),
    });

    const conn = dAppKit.stores.$connection.get();
    const isWaaP = !!(conn.wallet?.name && hasWaaPName(conn.wallet.name));
    if (isWaaP) {
      await this.getWaaPBaseAddress({ request: true });
      this.waapBaseAutoRequested = true;
    }

    saveWalletPreference({
      type: isWaaP ? "waap" : "traditional",
      suiAddress: conn.account?.address ?? "",
      walletName: conn.wallet?.name ?? null,
      baseAddress: isWaaP ? this.waapBaseAddress : null,
      timestamp: Date.now(),
    });

    await this.refreshBalance();
  }

  async disconnect(): Promise<void> {
    clearWalletPreference();
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

  async disconnectWaaP({ hardReset = false }: { hardReset?: boolean } = {}): Promise<void> {
    clearWalletPreference();
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

    if (hardReset) {
      hardReloadApp();
    }
  }

  async disconnectAndHardReset(): Promise<void> {
    await this.disconnectWaaP({ hardReset: true });
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
      const preferredWaaP = await waitForPreferredWaaPWallet();
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
      const preferredWaaP = await waitForPreferredWaaPWallet();
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
    const sender = this.getState().address;
    const chain = `sui:${this.getState().network}`;
    const conn = dAppKit.stores.$connection.get();
    const signed = await this.withWalletRequestTimeout(
      () => signSuiTransactionViaReactDappKit({
        transaction: tx,
        accountAddress: sender,
        walletName: conn.wallet?.name ?? null,
        chain,
      }),
      "react-dapp-kit signTransaction(sponsored)",
    );
    return { bytes: signed.bytes, userSignature: signed.signature };
  }

  async executeSponsoredTx(
    bytes: string,
    signatures: string[],
  ): Promise<unknown> {
    return this.executeTransactionBytes(bytes, signatures);
  }

  async signAndExecuteSuiTransaction(transaction: Transaction): Promise<unknown> {
    await this.ensureWalletCanSignOrSignAndExecuteTransactions();
    const sender = this.getState().address;
    const conn = dAppKit.stores.$connection.get();
    const isWaaPWallet = hasWaaPName(conn.wallet?.name);
    if (sender) {
      // Always align sender with the actively connected Sui account.
      // If sender drifts from connected account, validators reject with
      // "Invalid user signature".
      transaction.setSender(sender);
    }

    const failures: unknown[] = [];

    // Primary path: React dApp Kit bridge with feature-level signing.
    // This avoids the core wrapper path that can pass unsupported formats
    // to some WaaP builds.
    try {
      const chain = `sui:${this.getState().network}`;
      const signed = await this.withWalletRequestTimeout(
        () => signSuiTransactionViaReactDappKit({
          transaction,
          accountAddress: sender,
          walletName: conn.wallet?.name ?? null,
          chain,
        }),
        "react-dapp-kit signTransaction",
      );
      return await this.executeTransactionBytes(signed.bytes, [signed.signature]);
    } catch (err) {
      console.warn("[wallet] react-dapp-kit signTransaction failed:", err);
      failures.push(err);
      if (isWaaPWallet && !this.isRetryableSignatureFailure(err)) {
        throw new Error(this.formatSignFailures(failures));
      }
    }

    // Fallback path: dApp Kit core explicit sign + execute.
    try {
      await this.ensureWalletCanSignTransactions();
      const signed = await this.withWalletRequestTimeout(
        () => dAppKit.signTransaction({ transaction }),
        "signTransaction(transaction)",
      );
      return await this.executeTransactionBytes(signed.bytes, [signed.signature]);
    } catch (err) {
      console.warn("[wallet] signTransaction(transaction) failed:", err);
      failures.push(err);
    }

    const attempts: Array<{ label: string; run: () => Promise<unknown> }> = [
      {
        label: "signAndExecute(transaction)",
        run: () => this.withWalletRequestTimeout(
          () => dAppKit.signAndExecuteTransaction({ transaction }),
          "signAndExecute(transaction)",
        ),
      },
    ];

    for (const attempt of attempts) {
      try {
        return await attempt.run();
      } catch (err) {
        console.warn(`[wallet] ${attempt.label} failed:`, err);
        failures.push(err);
      }
    }

    throw new Error(this.formatSignFailures(failures));
  }

  private formatSignFailures(failures: unknown[]): string {
    const messages = failures
      .map((err) => this.normalizeErrorMessage(err instanceof Error ? err.message : String(err)))
      .filter((msg) => msg.length > 0);
    const uniqueMessages = Array.from(new Set(messages));
    if (uniqueMessages.length === 0) {
      return "Failed to sign Sui transaction.";
    }
    return `Failed to sign Sui transaction. ${uniqueMessages.join(" | ")}`;
  }

  private normalizeErrorMessage(message: string): string {
    // Some wallet/provider errors arrive URL-encoded.
    if (!message.includes("%")) return message;
    try {
      return decodeURIComponent(message);
    } catch {
      return message;
    }
  }

  private isRetryableSignatureFailure(err: unknown): boolean {
    const raw = err instanceof Error ? err.message : String(err);
    const msg = this.normalizeErrorMessage(raw).toLowerCase();
    return msg.includes("invalid user signature")
      || msg.includes("invalid signature was given")
      || msg.includes("signature is not valid");
  }

  private async withWalletRequestTimeout<T>(
    run: () => Promise<T>,
    label: string,
  ): Promise<T> {
    const timeoutMs = WalletManager.WALLET_REQUEST_TIMEOUT_MS;
    let timer = 0;
    try {
      return await Promise.race([
        run(),
        new Promise<T>((_, reject) => {
          timer = window.setTimeout(() => {
            reject(new Error(`${label} timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) window.clearTimeout(timer);
    }
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
      const candidate = this.findSigningAccount(conn.wallet?.accounts, features);
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

    const preferredWaaP = await waitForPreferredWaaPWallet();
    if (preferredWaaP) {
      try {
        const preselected = this.findSigningAccount(preferredWaaP?.accounts, features);
        const connected = await dAppKit.connectWallet({
          wallet: preferredWaaP,
          ...(preselected ? { account: preselected } : {}),
        });
        const resolved = this.findSigningAccount(connected?.accounts, features);
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

  private async ensureWalletCanSignOrSignAndExecuteTransactions(): Promise<void> {
    await this.ensureWalletSupportsAnyFeature(["sui:signTransaction", "sui:signAndExecuteTransaction"]);
  }

  private emit() {
    this.listeners.forEach((l) => l(this.getState()));
  }

  private async bridgeSkiWidgetConnection(): Promise<void> {
    const pref = loadWalletPreference();

    let target: UiWallet | undefined;
    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const wallets = dAppKit.stores.$wallets.get();

      if (pref) {
        // Only connect to the wallet type that matches the stored preference.
        if (pref.type === "waap") {
          target = wallets.find((w) => (w.accounts?.length ?? 0) > 0 && hasWaaPName(w.name));
        } else {
          target = pref.walletName
            ? wallets.find((w) => (w.accounts?.length ?? 0) > 0 && w.name === pref.walletName)
            : wallets.find((w) => (w.accounts?.length ?? 0) > 0 && !hasWaaPName(w.name));
        }
      } else {
        // No preference — existing behavior: prefer WaaP, then any wallet.
        target =
          wallets.find((w) => (w.accounts?.length ?? 0) > 0 && hasWaaPName(w.name)) ??
          wallets.find((w) => (w.accounts?.length ?? 0) > 0);
      }

      if (target?.accounts?.[0]) break;
    }

    if (!target?.accounts?.[0]) return;

    const conn = dAppKit.stores.$connection.get();
    if (conn.isConnected && conn.account?.address === target.accounts[0].address) return;

    try {
      await dAppKit.connectWallet({ wallet: target, account: target.accounts[0] });
    } catch (err) {
      console.warn("[wallet] failed to bridge ski widget connection to dApp Kit:", err);
    }
  }

  private async reconnectFromPreference(pref: WalletPreference): Promise<boolean> {
    const deadline = Date.now() + 4_000;

    while (Date.now() < deadline) {
      const wallets = dAppKit.stores.$wallets.get();

      let candidate: UiWallet | undefined;
      if (pref.type === "waap") {
        candidate = wallets.find((w) => (w.accounts?.length ?? 0) > 0 && hasWaaPName(w.name));
      } else {
        candidate = pref.walletName
          ? wallets.find((w) => (w.accounts?.length ?? 0) > 0 && w.name === pref.walletName)
          : wallets.find((w) => (w.accounts?.length ?? 0) > 0 && !hasWaaPName(w.name));
      }

      if (candidate?.accounts?.[0]) {
        try {
          await dAppKit.connectWallet({ wallet: candidate, account: candidate.accounts[0] });
          return true;
        } catch (err) {
          console.warn("[wallet] reconnectFromPreference failed:", err);
          return false;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return false;
  }

  private async finishInitialHydration(): Promise<void> {
    try {
      const pref = loadWalletPreference();
      if (pref) {
        const reconnected = await this.reconnectFromPreference(pref);
        if (reconnected) {
          await this.syncFromDAppKit();
          return;
        }
        // Preferred wallet unavailable — clear stale preference, fall through.
        clearWalletPreference();
      }

      await this.syncFromDAppKit();
    } finally {
      if (!this.hydrating) return;
      this.hydrating = false;
      this.emit();
    }
  }

  private async syncFromDAppKit(): Promise<void> {
    const conn = dAppKit.stores.$connection.get();
    if (conn.isConnected && conn.account) {
      await this.refreshBalance();
      if (hasWaaPName(conn.wallet?.name)) {
        const shouldAutoRequest = !this.waapBaseAddress && !this.waapBaseAutoRequested;
        void this.resolveWaaPBaseInBackground(shouldAutoRequest);
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

  private async resolveWaaPBaseInBackground(shouldAutoRequest: boolean): Promise<void> {
    try {
      await this.getWaaPBaseAddress({ request: shouldAutoRequest });
      if (shouldAutoRequest) this.waapBaseAutoRequested = true;
      await this.refreshBaseProfile();
      this.emit();
    } catch {
      // WaaP not available — Base data stays null, app continues with Sui-only
    }
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
    if (this.suiPrimaryName) {
      window.SuiWalletKit?.setPrimaryName?.(this.suiPrimaryName);
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

