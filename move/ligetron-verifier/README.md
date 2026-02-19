# ligetron-verifier

**On-chain Groth16-wrapped Ligetron proof verifier for Sui Move.**

Verifies zero-knowledge proofs produced by [Ligetron](https://github.com/ligeroinc/ligero-prover) (Ligero-family IOP over BN254) on the Sui blockchain, using Sui's native Groth16 precompile.

---

## Why Groth16 compression?

Ligetron's native IOP verifier **re-executes the WASM program** to reconstruct the constraint matrix at verification time. That is infeasible on-chain.

This contract uses the same pattern as the [SP1 Sui verifier](https://soundness.xyz/blog/sp1sui):

```
Ligetron IOP proof  (large, WASM-dependent)
        │
        ▼  [Off-chain Groth16 wrapper circuit]
        │  "I know a valid Ligetron proof for
        │   program P with public inputs X"
        │
        ▼
Groth16 proof  (256 bytes, constant size)
        │
        ▼  [This contract — sui::groth16 precompile]
        │
   ✓ / ✗  on-chain
```

The contract never sees the IOP proof bytes — only the compact Groth16 proof.

---

## Package structure

```
move/ligetron-verifier/
├── Move.toml
├── sources/
│   ├── ligetron_verifier.move   # Groth16 verifier + program registry + replay protection
│   └── merkle.move              # SHA-256 Merkle path verifier (defense-in-depth)
└── tests/
    └── ligetron_verifier_tests.move
```

---

## Security model

| Property | Mechanism |
|---|---|
| **Soundness** | Groth16 over BN254 (~128-bit, knowledge-of-exponent assumption) |
| **Program binding** | Each VK registered per `program_digest`; a proof for wrong program fails the pairing check |
| **Input binding** | `inputs_digest = SHA-256(raw_inputs)[0..30]\|\|0x00` computed on-chain; caller cannot substitute different inputs |
| **Replay protection** | `used_nonces` table records `SHA-256(proof_bytes)` → submitter; re-submission aborts |
| **Admin isolation** | `AdminCap` only controls VK registry, not verified proofs; compromise does not retroactively invalidate past proofs |
| **Non-upgradeability** | Contract has no upgrade authority; new programs added via `register_program`, not contract upgrades |

### Trust assumptions

1. **The Groth16 wrapping circuit is correct.** The `AdminCap` holder must verify that registered VKs correspond to a circuit that genuinely constrains the full Ligetron IOP verification.

2. **BN254 discrete log hardness.** Groth16 security reduces to knowledge-of-exponent over BN254 (~AES-128 equivalent).

3. **SHA-256 collision resistance.** Used for Merkle trees, Fiat-Shamir, and nonce derivation.

---

## Public inputs encoding

The Groth16 circuit expects exactly **2 BN254 scalar field elements** (64 bytes) as public inputs:

| Index | Signal | Value |
|---|---|---|
| 0 | `program_digest` | `SHA-256(wasm_bytes)` with byte[31] zeroed, as 32-byte LE field element |
| 1 | `inputs_digest` | `SHA-256(concat(public_input_args))` with byte[31] zeroed, as 32-byte LE field element |

The top-byte zero truncation guarantees the value fits in the BN254 scalar field (`2^248 < BN254_P`).

**The off-chain Groth16 circuit MUST apply the same truncation** when binding public signals, or verification will fail.

---

## Groth16 proof format (Arkworks BN254, 256 bytes)

```
bytes[  0.. 63]  π_A (negated G1 affine):  x (32) || y (32)
bytes[ 64..191]  π_B (G2 affine):          x0 (32) || x1 (32) || y0 (32) || y1 (32)
bytes[192..255]  π_C (G1 affine):          x (32) || y (32)
```

This matches the format expected by `sui::groth16::proof_points_from_bytes`.

---

## Deployment

### Prerequisites

```bash
# Install Sui CLI
cargo install --locked --git https://github.com/MystenLabs/sui.git sui

# Or via brew
brew install sui
```

### Build and test

```bash
cd move/ligetron-verifier
sui move build
sui move test
```

### Publish to testnet

```bash
sui client publish --gas-budget 100000000
```

Save the **Package ID** and **VerifierRegistry Object ID** from the output.

### Register a program

```bash
# program_digest: SHA-256 of your WASM binary (hex, 32 bytes)
# vk_bytes:       Arkworks-serialized BN254 Groth16 VK from your circuit setup
# label:          UTF-8 name for audit trail

sui client call \
  --package <PACKAGE_ID> \
  --module ligetron_verifier \
  --function register_program \
  --args \
    <ADMIN_CAP_ID> \
    <REGISTRY_ID> \
    "0x<program_digest_hex>" \
    "0x<vk_bytes_hex>" \
    "my-app-v1.0" \
  --gas-budget 10000000
```

---

## Integration — TypeScript PTB

```typescript
import { Transaction }   from "@mysten/sui/transactions";
import { SuiClient }     from "@mysten/sui/client";
import { bcs }           from "@mysten/sui/bcs";
import { createHash }    from "crypto";

const PACKAGE_ID  = "0x...";  // from publish output
const REGISTRY_ID = "0x...";  // shared VerifierRegistry object

/**
 * Submit a Groth16-wrapped Ligetron proof to Sui.
 *
 * @param programWasmBytes  - The WASM program binary (used to derive program_digest)
 * @param publicInputsRaw   - Canonical byte encoding of public inputs
 * @param groth16ProofBytes - 256-byte Arkworks BN254 Groth16 proof
 */
async function submitLigetronProof(
  signer: any,
  programWasmBytes: Uint8Array,
  publicInputsRaw:  Uint8Array,
  groth16ProofBytes: Uint8Array,
) {
  const client = new SuiClient({ url: "https://fullnode.testnet.sui.io" });

  // Compute the same program_digest the contract will derive internally.
  const programDigest = new Uint8Array(
    createHash("sha256").update(programWasmBytes).digest()
  );

  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::ligetron_verifier::verify_proof`,
    arguments: [
      tx.object(REGISTRY_ID),
      tx.pure(bcs.vector(bcs.u8()).serialize(programDigest)),    // 32 bytes
      tx.pure(bcs.vector(bcs.u8()).serialize(publicInputsRaw)),  // variable
      tx.pure(bcs.vector(bcs.u8()).serialize(groth16ProofBytes)),// 256 bytes
    ],
  });

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEvents: true },
  });

  // Check for the ProofVerified event.
  const event = result.events?.find(e =>
    e.type.includes("ligetron_verifier::ProofVerified")
  );

  if (!event) throw new Error("Proof verification failed or event missing");
  return event.parsedJson;
}
```

---

## The Merkle module (optional / defense-in-depth)

`merkle.move` provides on-chain SHA-256 Merkle path verification for Ligetron column openings. This lets you validate specific IOP-layer commitments without needing the full WASM re-execution.

```typescript
// Verify column 42's opening from a Ligetron proof on-chain.
tx.moveCall({
  target: `${PACKAGE_ID}::merkle::verify_ligetron_column_opening`,
  arguments: [
    tx.pure(bcs.vector(bcs.u8()).serialize(columnDigest)),    // SHA-256 of column bytes
    tx.pure(bcs.vector(bcs.u8()).serialize(merkleRoot)),       // committed root
    tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(siblings)),  // 13 siblings
    tx.pure(bcs.vector(bcs.u8()).serialize(sideBits)),         // 13 direction bits
  ],
});
```

**Gas cost**: ~13 SHA-256 hashes per column opening ≈ a few thousand computation units.

---

## Off-chain tooling still needed

This contract is the on-chain half. The off-chain half (not yet built) is:

| Component | Status | Notes |
|---|---|---|
| Groth16 wrapper circuit | **TODO** | Proves Ligetron IOP verification in-circuit. Needs Ligero Inc. or a community contributor. |
| Trusted setup ceremony | **TODO** | Powers of Tau (BN254) + circuit-specific phase 2. Can reuse existing BN254 setups. |
| Off-chain prover CLI | **TODO** | Takes a Ligetron proof → outputs Arkworks-format Groth16 proof + VK |
| Ligetron WASM prover | ✅ | [ligeroinc/ligero-prover](https://github.com/ligeroinc/ligero-prover) |

---

## References

- [Ligero: Lightweight Sublinear Arguments Without a Trusted Setup](https://eprint.iacr.org/2022/1608) — Ames et al., CCS 2017
- [Ligetron: Lightweight Scalable End-to-End ZKPs](https://ieeexplore.ieee.org/document/10646776) — IEEE S&P 2024
- [SP1 Sui Verifier](https://soundness.xyz/blog/sp1sui) — Reference architecture for Groth16-wrapped zkVM proofs on Sui
- [sui::groth16 module docs](https://docs.sui.io/references/framework/sui-framework/groth16)
- [Ligetron prover source](https://github.com/ligeroinc/ligero-prover)
