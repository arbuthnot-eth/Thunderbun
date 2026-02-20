# CACHE Base Vault (Solidity)

`BaseVault.sol` is the Base-side USDC intake contract for CACHE issuance on Sui.

## Behavior

- Accepts USDC deposits and emits a deterministic `Deposit` event with:
  - `nonce`
  - `depositor`
  - `suiRecipient` (`bytes32` Sui address)
  - `amount`
  - `depositId`
- Supports optional `depositWithPermit` for permit-compatible tokens.
- Includes owner pause control for incident response.

## Integration notes

- Attesters should sign canonical payload fields mirrored by Sui `MintPayload`:
  - `source_chain_id`
  - `source_nonce`
  - `source_tx_hash`
  - `recipient`
  - `amount`
- Relayer submits those signatures to `cache_sui::cache::mint_from_attestation`.

## TODO before production

- Add full USDC-safe transfer handling (non-standard return behavior).
- Add withdrawal/rebalance policy module governed by multisig.
- Add test suite (Foundry/Hardhat).
- Add attester service that binds event log + finality + signature issuance.
