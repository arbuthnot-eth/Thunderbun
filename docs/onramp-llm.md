Add an onramp button to this site's payment flow using `@zkp2p/sdk`. When a user clicks it:

## 1. Initialize the SDK

Use a scoped instance — **not** the default singleton:

```ts
import { createPeerExtensionSdk } from '@zkp2p/sdk';

const peerSdk = createPeerExtensionSdk({ window });
```

## 2. Check extension state and handle each case

```ts
const state = await peerSdk.getState();
// Returns: 'needs_install' | 'needs_connection' | 'ready'
```

- **`needs_install`** — Show a modal prompting the user to install the Peer extension. The modal should explain: *"A funding wallet that lets you go from fiat to crypto in seconds, without additional verification."* Include a button that calls `peerSdk.openInstallPage()`. **Do not** silently redirect to the Chrome Web Store.
- **`needs_connection`** — Call `peerSdk.requestConnection()`. If the user declines, show a message explaining the extension must be connected.
- **`ready`** — Proceed to open the onramp.

## 3. Open the onramp side panel

```ts
peerSdk.onramp({
  toToken: '<chainId>:<tokenAddress>',       // Token needed for this flow (zero address for native tokens)
  recipientAddress: '<connectedWalletAddr>',  // Omit if no wallet connected — button should work either way
  referrer: '<this-site-name>',               // Your application name
  referrerLogo: '<https://your-site/logo>',   // Must be http/https URL, not a data URI
  callbackUrl: '<https://your-site/callback>',// URL to redirect back to after onramp
});
```

### Parameter reference

| Parameter | Required | Description |
|-----------|----------|-------------|
| `referrer` | Yes | Your application name |
| `referrerLogo` | Recommended | URL to your logo (must be `http`/`https`, not a data URI) |
| `callbackUrl` | Recommended | URL users return to after completing the onramp |
| `toToken` | Optional | Destination token in `chainId:tokenAddress` format |
| `recipientAddress` | Optional | User's connected wallet address. Omit if no wallet is connected |
| `inputCurrency` | Optional | Fiat currency code (e.g. `USD`, `EUR`). Defaults to user's locale |
| `inputAmount` | Optional | Fiat amount to convert (up to 2 decimal places) |
| `paymentPlatform` | Optional | Preferred payment method (e.g. `venmo`, `Revolut`) — not enforced |
| `amountUsdc` | Optional | Exact USDC output amount with 6 decimals (e.g. `1000000` = 1 USDC). Overrides `toToken` and `inputAmount`. Requires `recipientAddress` |

### Supported chains for `toToken`

| Chain | chainId | Native token example |
|-------|---------|---------------------|
| Base | `8453` | `8453:0x0000000000000000000000000000000000000000` |
| Solana | `792703809` | `792703809:11111111111111111111111111111111` |
| Ethereum | `1` | `1:0x0000000000000000000000000000000000000000` |
| Polygon | `137` | `137:0x0000000000000000000000000000000000000000` |
| Arbitrum | `42161` | `42161:0x0000000000000000000000000000000000000000` |
| BNB | `56` | `56:0x0000000000000000000000000000000000000000` |
| Avalanche | `43114` | `43114:0x0000000000000000000000000000000000000000` |
| HyperEVM | `999` | `999:0x0000000000000000000000000000000000000000` |
| Hyperliquid | `1337` | `1337:0x0000000000000000000000000000000000000000` |
| Scroll | `534352` | `534352:0x0000000000000000000000000000000000000000` |
| FlowEVM | `747` | `747:0x0000000000000000000000000000000000000000` |

For EVM chains, use the zero address (`0x0000…0000`) for native currency. For non-EVM chains (e.g. Solana), use the native token's base-58 address.

## 4. Button placement rules

- Place the onramp button **next to any action that requires a token balance** (swap, stake, mint, bridge, etc.).
- If the user's balance is too low (or no wallet is connected), **highlight the onramp button over the action button** — make the onramp the primary CTA and the action button secondary/disabled.
- Add the onramp button to any **insufficient balance error states** (e.g. "Not enough ETH" banners, failed transaction modals).

## 5. Full integration example

```tsx
import { createPeerExtensionSdk } from '@zkp2p/sdk';
import { useState } from 'react';

const peerSdk = createPeerExtensionSdk({ window });

function OnrampButton({
  toToken,
  recipientAddress,
  siteName,
  siteLogo,
  callbackUrl,
}: {
  toToken: string;
  recipientAddress?: string;
  siteName: string;
  siteLogo: string;
  callbackUrl: string;
}) {
  const [showInstallModal, setShowInstallModal] = useState(false);

  const handleOnramp = async () => {
    const state = await peerSdk.getState();

    if (state === 'needs_install') {
      setShowInstallModal(true);
      return;
    }

    if (state === 'needs_connection') {
      const approved = await peerSdk.requestConnection();
      if (!approved) return;
    }

    peerSdk.onramp({
      toToken,
      ...(recipientAddress && { recipientAddress }),
      referrer: siteName,
      referrerLogo: siteLogo,
      callbackUrl,
    });
  };

  return (
    <>
      <button onClick={handleOnramp}>Fund with Peer</button>

      {showInstallModal && (
        <div className="modal">
          <h3>Install Peer</h3>
          <p>
            A funding wallet that lets you go from fiat to crypto in seconds,
            without additional verification.
          </p>
          <button onClick={() => peerSdk.openInstallPage()}>
            Install Extension
          </button>
          <button onClick={() => setShowInstallModal(false)}>Close</button>
        </div>
      )}
    </>
  );
}
```

## Key rules

- Use `createPeerExtensionSdk({ window })` — **not** the default `peerExtensionSdk` singleton.
- Never silently redirect to the Chrome Web Store. Always show a modal first.
- The button must work with **or without** a connected wallet — just omit `recipientAddress` if none.
- `referrerLogo` must be an `http`/`https` URL, never a `data:` URI.
- Keep the integration minimal. No extra wrappers or abstractions.
