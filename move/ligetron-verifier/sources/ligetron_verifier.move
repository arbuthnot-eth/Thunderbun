/// Ligetron proof verifier for Sui — Groth16 compression layer
///
/// ═══════════════════════════════════════════════════════════════════════════════
/// ARCHITECTURE
/// ═══════════════════════════════════════════════════════════════════════════════
///
/// Ligetron is a Ligero-family IOP (Interactive Oracle Proof) over BN254.
/// The native verifier re-executes the proved WASM program — infeasible on-chain.
///
/// This contract follows the SP1 Sui verifier pattern:
///
///   [1] Off-chain: Ligetron generates an IOP proof for a WASM execution.
///   [2] Off-chain: A Groth16 circuit wraps the full IOP verification, proving
///       "I know a valid Ligetron proof for WASM program P with inputs X."
///   [3] On-chain:  This contract verifies the 256-byte Groth16 proof using
///       Sui's native sui::groth16 precompile (BN254, Arkworks serialization).
///
/// ═══════════════════════════════════════════════════════════════════════════════
/// GROTH16 PUBLIC INPUTS  (64 bytes = 2 × 32-byte BN254 LE field elements)
/// ═══════════════════════════════════════════════════════════════════════════════
///
///   bytes[ 0..31] — program_digest: SHA-256(wasm_bytes), byte[31] zeroed
///   bytes[32..63] — inputs_digest:  SHA-256(public_inputs), byte[31] zeroed
///
/// Zeroing byte[31] ensures value < BN254_P (2^248 < 2^254).
/// The Groth16 circuit MUST apply the same truncation to match.
///
/// ═══════════════════════════════════════════════════════════════════════════════
/// GROTH16 PROOF FORMAT  (Arkworks BN254, 256 bytes uncompressed)
/// ═══════════════════════════════════════════════════════════════════════════════
///
///   bytes[  0.. 63] — π_A (negated G1): x(32) || y(32)
///   bytes[ 64..191] — π_B (G2):         x0(32)||x1(32)||y0(32)||y1(32)
///   bytes[192..255] — π_C (G1):         x(32) || y(32)
///
/// ═══════════════════════════════════════════════════════════════════════════════
/// SECURITY PROPERTIES
/// ═══════════════════════════════════════════════════════════════════════════════
///
///   • Soundness         — Groth16 / BN254 (~128-bit, knowledge-of-exponent)
///   • Program binding   — VK registered per program_digest; wrong program fails pairing
///   • Input binding     — inputs_digest computed on-chain from raw bytes; uncheatable
///   • Replay protection — Proof nonces (SHA-256 of proof bytes) recorded on-chain
///   • Admin isolation   — AdminCap only controls VK registry, not verified nonces
///
/// Off-chain wrapping circuit reference: move/ligetron-verifier/README.md
/// Upstream papers: Ligero CCS 2017, Ligetron IEEE S&P 2024
///
module ligetron_verifier::ligetron_verifier {
    use sui::groth16;
    use std::hash;
    use sui::table::{Self, Table};
    use sui::event;

    // ══════════════════════════════════════════════════════════════════════════
    // Error codes
    // ══════════════════════════════════════════════════════════════════════════

    const E_INVALID_PROOF_LEN: u64      = 0;
    const E_PROGRAM_NOT_REGISTERED: u64 = 2;
    const E_PROOF_ALREADY_USED: u64       = 3;
    const E_INVALID_DIGEST_LEN: u64       = 4;
    const E_PROOF_VERIFICATION_FAILED: u64 = 5;
    const E_PROGRAM_ALREADY_EXISTS: u64   = 6;
    const E_EMPTY_VK: u64                 = 7;

    // ══════════════════════════════════════════════════════════════════════════
    // Size constants
    // ══════════════════════════════════════════════════════════════════════════

    const PROOF_BYTES_LEN: u64 = 256;
    const DIGEST_LEN: u64      = 32;

    // ══════════════════════════════════════════════════════════════════════════
    // Object types
    // ══════════════════════════════════════════════════════════════════════════

    /// Sole authority to register or revoke program verifying keys.
    /// SECURITY: Store in a hardware wallet or on-chain multisig.
    public struct AdminCap has key, store { id: UID }

    /// On-chain record for a registered WASM program and its Groth16 VK.
    /// Raw VK bytes stored because PreparedVerifyingKey lacks `store` ability.
    public struct ProgramEntry has store {
        program_digest: vector<u8>,
        vk_bytes: vector<u8>,
        label: vector<u8>,
        registered_at_epoch: u64,
    }

    /// Shared registry: program VKs + used proof nonces.
    public struct VerifierRegistry has key {
        id: UID,
        /// program_digest → ProgramEntry
        programs: Table<vector<u8>, ProgramEntry>,
        /// SHA-256(proof_bytes) → submitter address  (replay protection)
        used_nonces: Table<vector<u8>, address>,
        total_verified: u64,
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════════════════

    public struct ProgramRegistered has copy, drop {
        program_digest: vector<u8>,
        label: vector<u8>,
        epoch: u64,
    }

    public struct ProofVerified has copy, drop {
        program_digest: vector<u8>,
        inputs_digest: vector<u8>,
        proof_nonce: vector<u8>,
        submitter: address,
        epoch: u64,
    }

    public struct ProgramRevoked has copy, drop {
        program_digest: vector<u8>,
        epoch: u64,
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Initializer
    // ══════════════════════════════════════════════════════════════════════════

    fun init(ctx: &mut TxContext) {
        transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
        transfer::share_object(VerifierRegistry {
            id: object::new(ctx),
            programs: table::new(ctx),
            used_nonces: table::new(ctx),
            total_verified: 0,
        });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Admin — program registration
    // ══════════════════════════════════════════════════════════════════════════

    /// Register a WASM program and its Groth16 verifying key.
    ///
    /// `program_digest` MUST match the value the Groth16 circuit constrains as
    /// its first public signal (SHA-256(wasm_bytes) with byte[31] zeroed).
    ///
    /// SECURITY: The AdminCap holder must verify vk_bytes corresponds to a
    /// correctly constructed wrapping circuit before calling this function.
    public fun register_program(
        _admin: &AdminCap,
        registry: &mut VerifierRegistry,
        program_digest: vector<u8>,
        vk_bytes: vector<u8>,
        label: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(program_digest.length() == DIGEST_LEN, E_INVALID_DIGEST_LEN);
        assert!(!vk_bytes.is_empty(), E_EMPTY_VK);
        assert!(!table::contains(&registry.programs, program_digest), E_PROGRAM_ALREADY_EXISTS);

        let epoch = ctx.epoch();
        event::emit(ProgramRegistered { program_digest, label, epoch });

        table::add(&mut registry.programs, program_digest, ProgramEntry {
            program_digest,
            vk_bytes,
            label,
            registered_at_epoch: epoch,
        });
    }

    /// Revoke a program's verifying key.
    ///
    /// Future proofs for this program_digest will fail with E_PROGRAM_NOT_REGISTERED.
    /// Previously accepted nonces remain recorded (no retroactive invalidation).
    public fun revoke_program(
        _admin: &AdminCap,
        registry: &mut VerifierRegistry,
        program_digest: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(table::contains(&registry.programs, program_digest), E_PROGRAM_NOT_REGISTERED);
        let ProgramEntry { program_digest: _, vk_bytes: _, label: _, registered_at_epoch: _ } =
            table::remove(&mut registry.programs, program_digest);
        event::emit(ProgramRevoked { program_digest, epoch: ctx.epoch() });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Core verification
    // ══════════════════════════════════════════════════════════════════════════

    /// Verify a Groth16-wrapped Ligetron proof on-chain.
    ///
    /// Aborts on any failure; the transaction reverts with no side-effects.
    ///
    /// # Arguments
    ///
    /// - `program_digest`:    32-byte SHA-256(wasm_bytes). Must match a registered program.
    /// - `public_inputs_raw`: Canonical byte encoding of public inputs passed to the prover.
    ///   The contract derives `inputs_digest = SHA-256(public_inputs_raw)[..byte31=0]` on-chain.
    /// - `proof_bytes`:       256-byte Arkworks BN254 Groth16 proof.
    ///
    /// # TypeScript PTB example
    ///
    /// ```typescript
    /// const tx = new Transaction();
    /// tx.moveCall({
    ///   target: `${PACKAGE_ID}::ligetron_verifier::verify_proof`,
    ///   arguments: [
    ///     tx.object(REGISTRY_ID),
    ///     tx.pure(bcs.vector(bcs.u8()).serialize(programDigest)),    // 32 bytes
    ///     tx.pure(bcs.vector(bcs.u8()).serialize(publicInputsRaw)),  // variable
    ///     tx.pure(bcs.vector(bcs.u8()).serialize(groth16Proof)),     // 256 bytes
    ///   ],
    /// });
    /// ```
    public fun verify_proof(
        registry: &mut VerifierRegistry,
        program_digest: vector<u8>,
        public_inputs_raw: vector<u8>,
        proof_bytes: vector<u8>,
        ctx: &mut TxContext,
    ) {
        // ── 1. Structural validation ─────────────────────────────────────────
        assert!(program_digest.length() == DIGEST_LEN, E_INVALID_DIGEST_LEN);
        assert!(proof_bytes.length() == PROOF_BYTES_LEN, E_INVALID_PROOF_LEN);

        // ── 2. Program registration check ────────────────────────────────────
        assert!(table::contains(&registry.programs, program_digest), E_PROGRAM_NOT_REGISTERED);

        // ── 3. Replay protection ─────────────────────────────────────────────
        let proof_nonce = hash::sha2_256(proof_bytes);
        assert!(!table::contains(&registry.used_nonces, proof_nonce), E_PROOF_ALREADY_USED);

        // ── 4. Derive inputs_digest on-chain ─────────────────────────────────
        let inputs_digest = digest_for_bn254(hash::sha2_256(public_inputs_raw));

        // ── 5. Encode public inputs (64 bytes = 2 × 32-byte LE scalars) ──────
        let program_digest_field = digest_for_bn254(program_digest);
        let mut pi_bytes = program_digest_field;
        pi_bytes.append(inputs_digest);

        // ── 6. Groth16 verification ───────────────────────────────────────────
        let entry = table::borrow(&registry.programs, program_digest);
        let pvk   = groth16::prepare_verifying_key(&groth16::bn254(), &entry.vk_bytes);
        let pi    = groth16::public_proof_inputs_from_bytes(pi_bytes);
        let proof = groth16::proof_points_from_bytes(proof_bytes);

        assert!(
            groth16::verify_groth16_proof(&groth16::bn254(), &pvk, &pi, &proof),
            E_PROOF_VERIFICATION_FAILED,
        );

        // ── 7. Record nonce + emit event ──────────────────────────────────────
        let submitter = ctx.sender();
        table::add(&mut registry.used_nonces, proof_nonce, submitter);
        registry.total_verified = registry.total_verified + 1;

        event::emit(ProofVerified {
            program_digest,
            inputs_digest,
            proof_nonce,
            submitter,
            epoch: ctx.epoch(),
        });
    }

    /// Stateless verifier — no registry, no replay protection.
    ///
    /// For callers that manage nonces externally.  Returns true on success.
    /// WARNING: no replay protection.  Caller must ensure uniqueness.
    public fun verify_proof_stateless(
        vk_bytes: vector<u8>,
        program_digest: vector<u8>,
        public_inputs_raw: vector<u8>,
        proof_bytes: vector<u8>,
    ): bool {
        assert!(program_digest.length() == DIGEST_LEN, E_INVALID_DIGEST_LEN);
        assert!(proof_bytes.length() == PROOF_BYTES_LEN, E_INVALID_PROOF_LEN);
        assert!(!vk_bytes.is_empty(), E_EMPTY_VK);

        let inputs_digest        = digest_for_bn254(hash::sha2_256(public_inputs_raw));
        let program_digest_field = digest_for_bn254(program_digest);

        let mut pi_bytes = program_digest_field;
        pi_bytes.append(inputs_digest);

        let pvk   = groth16::prepare_verifying_key(&groth16::bn254(), &vk_bytes);
        let pi    = groth16::public_proof_inputs_from_bytes(pi_bytes);
        let proof = groth16::proof_points_from_bytes(proof_bytes);

        groth16::verify_groth16_proof(&groth16::bn254(), &pvk, &pi, &proof)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Read-only accessors
    // ══════════════════════════════════════════════════════════════════════════

    public fun is_program_registered(registry: &VerifierRegistry, digest: &vector<u8>): bool {
        table::contains(&registry.programs, *digest)
    }

    public fun is_nonce_used(registry: &VerifierRegistry, nonce: &vector<u8>): bool {
        table::contains(&registry.used_nonces, *nonce)
    }

    public fun get_program_label(registry: &VerifierRegistry, digest: &vector<u8>): vector<u8> {
        assert!(table::contains(&registry.programs, *digest), E_PROGRAM_NOT_REGISTERED);
        table::borrow(&registry.programs, *digest).label
    }

    public fun get_program_registered_epoch(registry: &VerifierRegistry, digest: &vector<u8>): u64 {
        assert!(table::contains(&registry.programs, *digest), E_PROGRAM_NOT_REGISTERED);
        table::borrow(&registry.programs, *digest).registered_at_epoch
    }

    public fun total_verified(registry: &VerifierRegistry): u64 { registry.total_verified }

    // ══════════════════════════════════════════════════════════════════════════
    // Internal helpers
    // ══════════════════════════════════════════════════════════════════════════

    /// Zero byte[31] of a 32-byte digest so it fits in the BN254 scalar field
    /// when interpreted as a LE integer.
    ///
    ///   value[31] = 0  =>  value ≤ 2^248 - 1  <  BN254_P ≈ 2^254   ✓
    ///
    /// The Groth16 circuit MUST apply the same truncation to its public signals.
    fun digest_for_bn254(mut digest: vector<u8>): vector<u8> {
        assert!(digest.length() == DIGEST_LEN, E_INVALID_DIGEST_LEN);
        *digest.borrow_mut(31) = 0u8;
        digest
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Test-only helpers
    // ══════════════════════════════════════════════════════════════════════════

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }

    #[test_only]
    public fun digest_for_bn254_testing(digest: vector<u8>): vector<u8> {
        digest_for_bn254(digest)
    }
}
