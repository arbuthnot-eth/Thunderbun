# CACHE Sui Contracts

`cache_sui` is the Sui-side mint/burn contract package for the `CACHE` stablecoin.

## What this package includes

- `cache_sui::cache`
  - Defines `Coin<CACHE>` and creates metadata in `init`.
  - Stores `TreasuryCap<CACHE>` inside a shared `BridgeState` object.
  - Enforces replay protection with `used_message_ids`.
  - Verifies allowlisted Ed25519 attester signatures before minting.
  - Emits mint and burn events for off-chain accounting.

## Mint flow (Base -> Sui)

1. Base vault emits a deposit event and nonce.
2. Off-chain attesters sign the canonical BCS payload for that deposit.
3. Relayer calls `mint_from_attestation` with payload fields + signatures.
4. Contract verifies threshold signatures and non-replay, then mints `CACHE`.

## Burn flow (Sui -> Base)

1. User calls `burn_for_base` with `Coin<CACHE>` and 20-byte Base recipient.
2. Contract burns the coin and emits `CacheBurnedForBase`.
3. Off-chain operator settles USDC on Base according to policy.

## Operational notes

- Contract initializes with `paused = true` and `threshold = 1`.
- Add attesters and set threshold before unpausing.
- Hold `AdminCap` in a multisig-controlled address.

## Build

```bash
cd contracts/cache-sui
sui move build
```
