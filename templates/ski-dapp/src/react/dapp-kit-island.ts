import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider,
  useConnectWallet,
  useCurrentAccount,
  useCurrentWallet,
  useSuiClient,
  useSwitchAccount,
  useWallets,
} from "@mysten/dapp-kit";
import type { WalletAccount, WalletWithRequiredFeatures } from "@mysten/wallet-standard";
import type { Transaction } from "@mysten/sui/transactions";
import { thunderbunDappKitTheme } from "./dapp-kit-theme";

interface SignRequest {
  transaction: Transaction;
  accountAddress?: string | null;
  walletName?: string | null;
  chain?: string;
}

interface SignResponse {
  bytes: string;
  signature: string;
}

interface BridgeRuntime {
  signTransaction(request: SignRequest): Promise<SignResponse>;
}

const ISLAND_ID = "tb-dapp-kit-react-island";
const BRIDGE_READY_TIMEOUT_MS = 8_000;

const { networkConfig } = createNetworkConfig({
  mainnet: { url: "https://fullnode.mainnet.sui.io:443", network: "mainnet" as const, mvr: {} },
  testnet: { url: "https://fullnode.testnet.sui.io:443", network: "testnet" as const, mvr: {} },
  devnet: { url: "https://fullnode.devnet.sui.io:443", network: "devnet" as const, mvr: {} },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

let mounted = false;
let runtime: BridgeRuntime | null = null;
let runtimeWaiters: Array<(value: BridgeRuntime) => void> = [];
type WaaPSignMode = "signTxBytes" | "signTxBlockBytes" | "signTxBlockObject" | "signTxJson";
const WAAP_SIGN_MODE_ORDER: readonly WaaPSignMode[] = ["signTxBytes", "signTxBlockBytes", "signTxBlockObject", "signTxJson"];
let waapPreferredSignMode: WaaPSignMode = "signTxBytes";

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTransactionFormatCompatibilityError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return msg.includes("unsupported transaction format")
    || msg.includes("failed to build transaction")
    || msg.includes("keys: tojson")
    || msg.includes("r is not a function");
}

function findWalletByName(wallets: readonly WalletWithRequiredFeatures[], wantedName: string | null | undefined): WalletWithRequiredFeatures | null {
  const wanted = normalize(wantedName);
  if (!wanted) return null;

  for (const wallet of wallets) {
    const name = normalize(wallet.name);
    const id = normalize(wallet.id);
    if (name === wanted || id === wanted) return wallet;
    if (name.includes(wanted) || wanted.includes(name)) return wallet;
  }

  return null;
}

function findAccountByAddress(accounts: readonly WalletAccount[], address: string | null | undefined): WalletAccount | null {
  const wanted = normalize(address);
  if (!wanted) return null;
  return accounts.find((acc) => normalize(acc.address) === wanted) ?? null;
}

function isLikelyWaaPWallet(wallet: WalletWithRequiredFeatures | null | undefined): boolean {
  if (!wallet) return false;
  const haystack = `${wallet.name} ${wallet.id ?? ""}`.toLowerCase();
  return haystack.includes("waap")
    || haystack.includes("human")
    || haystack.includes("silk")
    || haystack.includes("peer");
}

function pickSuiChain(account: WalletAccount, override?: string): string {
  if (override && override.length > 0) return override;
  const fromAccount = account.chains.find((chain) => chain.startsWith("sui:"));
  return fromAccount ?? "sui:mainnet";
}

function setRuntime(next: BridgeRuntime): void {
  runtime = next;
  if (runtimeWaiters.length > 0) {
    for (const resolve of runtimeWaiters) resolve(next);
    runtimeWaiters = [];
  }
}

async function waitForRuntime(): Promise<BridgeRuntime> {
  if (runtime) return runtime;

  return await new Promise<BridgeRuntime>((resolve, reject) => {
    runtimeWaiters.push(resolve);
    window.setTimeout(() => {
      if (!runtime) {
        runtimeWaiters = runtimeWaiters.filter((r) => r !== resolve);
        reject(new Error("React dApp Kit bridge initialization timed out."));
      }
    }, BRIDGE_READY_TIMEOUT_MS);
  });
}

function RuntimeBridge(): React.ReactElement {
  const wallets = useWallets();
  const currentWalletState = useCurrentWallet();
  const currentAccount = useCurrentAccount();
  const connectWallet = useConnectWallet();
  const switchAccount = useSwitchAccount();
  const client = useSuiClient();

  useEffect(() => {
    const bridge: BridgeRuntime = {
      signTransaction: async (request) => {
        let selectedWallet = currentWalletState.isConnected
          ? currentWalletState.currentWallet
          : null;
        let selectedAccount = currentAccount;

        const preferredWallet = findWalletByName(wallets, request.walletName);

        if (!selectedWallet || (preferredWallet && selectedWallet.name !== preferredWallet.name)) {
          const walletToConnect = preferredWallet ?? selectedWallet ?? wallets[0] ?? null;
          if (!walletToConnect) {
            throw new Error("No Sui wallet is available in dApp Kit.");
          }

          const connected = await connectWallet.mutateAsync({
            wallet: walletToConnect,
            ...(request.accountAddress ? { accountAddress: request.accountAddress } : {}),
          });

          selectedWallet = walletToConnect;
          selectedAccount = findAccountByAddress(connected.accounts, request.accountAddress)
            ?? connected.accounts[0]
            ?? null;
        }

        if (!selectedWallet) {
          throw new Error("No wallet is connected in React dApp Kit.");
        }

        if (!selectedAccount) {
          selectedAccount = findAccountByAddress(selectedWallet.accounts, request.accountAddress)
            ?? selectedWallet.accounts[0]
            ?? null;
        }

        const requestedAccount = findAccountByAddress(selectedWallet.accounts, request.accountAddress);
        if (requestedAccount && (!selectedAccount || requestedAccount.address !== selectedAccount.address)) {
          await switchAccount.mutateAsync({ account: requestedAccount });
          selectedAccount = requestedAccount;
        }

        if (!selectedAccount) {
          throw new Error("No Sui account is selected in React dApp Kit.");
        }

        const chain = pickSuiChain(selectedAccount, request.chain) as `${string}:${string}`;
        const features = selectedWallet.features;
        const signTxBlockFeature = features["sui:signTransactionBlock"];
        const signTxFeature = features["sui:signTransaction"];
        const isWaaP = isLikelyWaaPWallet(selectedWallet);

        if (isWaaP) {
          const txBytes = await request.transaction.build({ client });
          const orderedModes: WaaPSignMode[] = [
            waapPreferredSignMode,
            ...WAAP_SIGN_MODE_ORDER.filter((mode) => mode !== waapPreferredSignMode),
          ];
          const formatFailures: string[] = [];
          let txJson: string | null = null;

          for (const mode of orderedModes) {
            try {
              if (mode === "signTxBytes") {
                if (!signTxFeature) continue;
                const signed = await (signTxFeature.signTransaction as unknown as (input: {
                  account: WalletAccount;
                  chain: `${string}:${string}`;
                  transaction: Uint8Array;
                }) => Promise<{ bytes: string; signature: string }>)({
                  account: selectedAccount,
                  chain,
                  transaction: txBytes,
                });
                waapPreferredSignMode = mode;
                return { bytes: signed.bytes, signature: signed.signature };
              }

              if (mode === "signTxBlockBytes") {
                if (!signTxBlockFeature) continue;
                const signed = await (signTxBlockFeature.signTransactionBlock as unknown as (input: {
                  account: WalletAccount;
                  chain: `${string}:${string}`;
                  transactionBlock: Uint8Array;
                }) => Promise<{ bytes?: string; transactionBlockBytes?: string; signature: string }>)({
                  account: selectedAccount,
                  chain,
                  transactionBlock: txBytes,
                });
                const bytes = signed.bytes ?? signed.transactionBlockBytes;
                if (!bytes) {
                  throw new Error("WaaP signTransactionBlock returned no transaction bytes.");
                }
                waapPreferredSignMode = mode;
                return { bytes, signature: signed.signature };
              }

              if (mode === "signTxBlockObject") {
                if (!signTxBlockFeature) continue;
                const signed = await signTxBlockFeature.signTransactionBlock({
                  account: selectedAccount,
                  chain,
                  transactionBlock: request.transaction,
                });
                waapPreferredSignMode = mode;
                return { bytes: signed.transactionBlockBytes, signature: signed.signature };
              }

              if (mode === "signTxJson") {
                if (!signTxFeature) continue;
                if (!txJson) {
                  txJson = await request.transaction.toJSON({
                    supportedIntents: [...currentWalletState.supportedIntents],
                    client,
                  });
                }
                const signed = await signTxFeature.signTransaction({
                  account: selectedAccount,
                  chain,
                  transaction: {
                    toJSON: async () => txJson!,
                  },
                });
                waapPreferredSignMode = mode;
                return { bytes: signed.bytes, signature: signed.signature };
              }
            } catch (err) {
              const msg = errorMessage(err);
              if (!isTransactionFormatCompatibilityError(err)) {
                throw new Error(`WaaP signing failed (${mode}). ${msg}`);
              }
              formatFailures.push(`${mode}: ${msg}`);
            }
          }

          if (formatFailures.length > 0) {
            const unique = Array.from(new Set(formatFailures));
            throw new Error(`WaaP signing format mismatch. ${unique.join(" | ")}`);
          }
        }

        // Prefer legacy block signing first for broad wallet compatibility.
        if (signTxBlockFeature) {
          const signed = await signTxBlockFeature.signTransactionBlock({
            account: selectedAccount,
            chain,
            transactionBlock: request.transaction,
          });
          return {
            bytes: signed.transactionBlockBytes,
            signature: signed.signature,
          };
        }

        if (signTxFeature) {
          const txJson = await request.transaction.toJSON({
            supportedIntents: [...currentWalletState.supportedIntents],
            client,
          });
          const signed = await signTxFeature.signTransaction({
            account: selectedAccount,
            chain,
            transaction: {
              toJSON: async () => txJson,
            },
          });
          return {
            bytes: signed.bytes,
            signature: signed.signature,
          };
        }

        throw new Error(`Wallet ${selectedWallet.name} does not support Sui transaction signing.`);
      },
    };

    setRuntime(bridge);
  }, [
    wallets,
    currentWalletState,
    currentAccount,
    connectWallet,
    switchAccount,
    client,
  ]);

  return React.createElement(React.Fragment);
}

function RootApp(): React.ReactElement {
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(
      SuiClientProvider,
      {
        networks: networkConfig,
        defaultNetwork: "mainnet",
        children: React.createElement(
          WalletProvider,
          {
            autoConnect: false,
            storageKey: "tb-react-dapp-kit",
            theme: thunderbunDappKitTheme,
            children: React.createElement(RuntimeBridge),
          },
        ),
      },
    ),
  );
}

function mountIsland(): void {
  if (mounted) return;
  mounted = true;

  const host = document.createElement("div");
  host.id = ISLAND_ID;
  host.style.display = "none";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);

  createRoot(host).render(React.createElement(RootApp));
}

export function initReactDappKitIsland(): void {
  if (mounted) return;
  if (document.body) {
    mountIsland();
    return;
  }
  window.addEventListener("DOMContentLoaded", () => mountIsland(), { once: true });
}

export async function signSuiTransactionViaReactDappKit(request: SignRequest): Promise<SignResponse> {
  initReactDappKitIsland();
  const bridge = await waitForRuntime();
  return await bridge.signTransaction(request);
}
