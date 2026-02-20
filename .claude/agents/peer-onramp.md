# Peer Onramp Integration Agent

## Overview

The Peer (zkp2p) onramp is **extension-only** — no REST API, redirect URL, or headless flow exists. All onramp interactions go through the PeerAuth Chrome extension via `@zkp2p/sdk`.

## Integration Rules

1. **Use scoped SDK instance** — `createPeerExtensionSdk({ window })`, NOT the default `peerExtensionSdk` singleton
2. **Button works without wallet** — `recipientAddress` is optional. Omit it if no wallet is connected.
3. **Never silently redirect to Chrome Web Store** — always show a modal/explanation first when extension is missing
4. **`referrerLogo` must be http/https URL** — never a `data:` URI
5. **Keep integration minimal** — no extra wrappers or abstractions around the SDK

## Extension State Machine

```ts
const state = await peerSdk.getState();
// 'needs_install' → show modal, call peerSdk.openInstallPage()
// 'needs_connection' → call peerSdk.requestConnection()
// 'ready' → call peerSdk.onramp(params)
```

## onramp() Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `referrer` | Yes | Application name |
| `referrerLogo` | Recommended | http/https URL to logo |
| `callbackUrl` | Recommended | Return URL after onramp |
| `toToken` | Optional | `chainId:tokenAddress` format |
| `recipientAddress` | Optional | Connected wallet address |
| `inputCurrency` | Optional | Fiat code (USD, EUR) |
| `inputAmount` | Optional | Fiat amount (2 decimals) |
| `paymentPlatform` | Optional | Preferred method (venmo, Revolut) — not enforced |
| `amountUsdc` | Optional | Exact USDC output (6 decimals). Overrides toToken + inputAmount |

## Supported Chains for `toToken`

- Base: `8453`, Solana: `792703809`, Ethereum: `1`, Polygon: `137`
- Arbitrum: `42161`, BNB: `56`, Avalanche: `43114`, HyperEVM: `999`
- Hyperliquid: `1337`, Scroll: `534352`, FlowEVM: `747`
- Use zero address for native tokens on EVM chains

## Proof Callback

```ts
const unsub = peerSdk.onProofComplete((result) => {
  // result.status: 'success' | 'failure' | 'cancelled' | 'timeout'
  // result.intentHash, result.proofId, result.proof?.platform
});
```

Subscribe BEFORE calling `onramp()` to avoid race conditions.

## Architecture in sui-twa

- `src/lib/crosschain.ts` — `launchOnramp()` (fire-and-forget), `executeSettlement()` (post-proof)
- `src/sections/crosschain.ts` — phase state machine (idle → onramping → proved → settling → settled)
- Proof listener in the section subscribes first, then launches onramp
- Settlement only fires after proof success — no race condition

## Reference

- Local docs: `docs/onramp-llm.md`
- SDK: `@zkp2p/sdk` on npm
- Demo: https://demo.peer.xyz
- Protocol docs: https://docs.peer.xyz/protocol/zkp2p-protocol
