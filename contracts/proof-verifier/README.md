# Proof Verifier — Security-Auditable ZK Verification on Sui

A general-purpose, security-auditable Move contract for verifying zero-knowledge proofs on Sui. Designed for third-party audit: capability-gated admin, event emission for every verification, and a registry model for verification keys.

## Supported Proof Systems

| Proof System | Status | Notes |
|--------------|--------|-------|
| **Groth16** (BN254, BLS12-381) | ✅ Native | Uses Sui's built-in `sui::groth16` API |
| **Ligetron via Groth16** | ✅ Ready | Ligero wraps Ligetron proofs in Groth16; verify the outer proof on-chain |

## Ligetron Integration

[Ligetron](https://ligero-inc.com) is a memory-efficient, hash-based ZK proof system (IOP, Merkle + Fiat-Shamir, no trusted setup) from Ligero Inc. Sui does **not** have native Ligetron verification. Two paths exist:

1. **Recursion (recommended)**  
   Ligero’s toolchain can produce a Groth16 proof whose statement is “I verified a Ligetron proof.” Use `verify_proof` or `verify_ligetron_via_groth16` with a circuit ID that points to the Groth16 wrapper’s verification key.

2. **Native Move verifier (future)**  
   Porting the Ligetron verifier to pure Move would require a public proof format and verification spec from Ligero (e.g., Merkle verification, Fiat–Shamir challenges). Sui’s `std::hash::sha2_256` would cover Ligetron’s SHA-256 hasher.

## Usage

### Publish

```bash
cd contracts/proof-verifier
sui client publish --gas-budget 50000000
```

After publish, `init` runs automatically: a shared `VerificationKeyRegistry` and an `AdminCap` (to the publisher) are created.

### Register a Groth16 Verification Key

```move
proof_verifier::verifier::register_groth16_key(
    registry,    // shared VerificationKeyRegistry
    admin,       // AdminCap (owned by you)
    bcs::to_bytes(&"my_circuit_v1"),  // circuit_id
    0,           // curve: 0 = BN254, 1 = BLS12-381
    vk_bytes,    // Arkworks canonical compressed VK
    ctx,
);
```

### Verify a Proof

```move
let valid = proof_verifier::verifier::verify_proof(
    registry,
    circuit_id,
    proof_points_bytes,
    public_inputs_bytes,
    ctx,
);
```

From TypeScript (e.g., in a ThunderBun TWA):

```typescript
const tx = new TransactionBlock();
tx.moveCall({
  target: `${PACKAGE_ID}::verifier::verify_proof`,
  arguments: [
    tx.object(REGISTRY_ID),
    tx.pure(Array.from(circuitIdBytes)),
    tx.pure(Array.from(proofBytes)),
    tx.pure(Array.from(publicInputsBytes)),
  ],
});
```

### Ligetron via Groth16

Same as above: register the Groth16 wrapper circuit’s VK, then call `verify_ligetron_via_groth16` with proof bytes produced by Ligero’s recursion tooling.

## Audit Trail

Every verification emits:

- **`ProofVerified`** — circuit_id, verifier address, proof type, timestamp (success)
- **`ProofRejected`** — circuit_id, verifier, reason, timestamp (failure)
- **`KeyRegistered`** — circuit_id, curve, proof type, admin, timestamp (key registration)

Query these events for compliance, analytics, and debugging.

## Security

- **Admin-only key registration** — only `AdminCap` holders can register or unregister keys
- **Shared registry** — anyone can call `verify_proof`; keys are immutable once registered
- **No proof malleability** — Sui’s Groth16 API follows recommended checks
- **Audit-friendly** — events, explicit errors, and minimal logic for review

## Build

```bash
sui move build
```

## References

- [Sui Groth16 Guide](https://docs.sui.io/guides/developer/cryptography/groth16)
- [Ligero / Ligetron](https://ligero-inc.com)
- [Groth16 Malleability (Sui Blog)](https://blog.sui.io/malleability-groth16-zkproof/)
