/// ProofAttestation — private, ownable Sui object minted by atomic ZK proof verification.
///
/// ═══════════════════════════════════════════════════════════════════════════════
/// WHAT THIS MODULE DOES
/// ═══════════════════════════════════════════════════════════════════════════════
///
/// Composes four Sui-ecosystem primitives into a single atomic transaction:
///
///   1. DeepBook   — caller swaps SUI → WAL in the same PTB to fund storage
///   2. Ligetron   — Groth16-wrapped proof verified on-chain (this module)
///   3. Seal       — attestation payload encrypted off-chain, stored on Walrus
///   4. Walrus     — IOP proof blob + encrypted attestation referenced by ID
///
/// The result is a `ProofAttestation` object — a first-class Sui owned object
/// that represents "this address provably ran WASM program P on inputs X."
///
/// ═══════════════════════════════════════════════════════════════════════════════
/// FULL FLOW (off-chain + on-chain)
/// ═══════════════════════════════════════════════════════════════════════════════
///
///  [Off-chain, before PTB]
///
///    1. Run Ligetron WASM prover → raw IOP proof bytes
///    2. Run Groth16 wrapper circuit → 256-byte proof
///    3. Upload raw IOP proof to Walrus → iop_blob_id
///    4. Encrypt attestation metadata with Seal SDK:
///         seal.encrypt({ id: sha256(proof_nonce), data: attestationBytes })
///         → { encryptedObject: { id: seal_id, data: ciphertext } }
///    5. Upload Seal ciphertext to Walrus → seal_blob_id
///
///  [On-chain PTB — all atomic]
///
///    Step A: deepbookv3::pool::swap_exact_quantity_to_base(...)
///            → wal_coin  (WAL tokens acquired from swap)
///
///    Step B: proof_attestation::verify_and_attest(
///              registry, program_digest, public_inputs_raw, proof_bytes,
///              iop_blob_id, seal_blob_id, seal_id, ctx
///            ) → ProofAttestation
///            Internally:
///              · Groth16 proof verified via sui::groth16 precompile
///              · Nonce recorded in VerifierRegistry (replay protection)
///              · ProofAttestation object minted
///
///    Step C: transfer::public_transfer(attestation, sender)
///    Step D: transfer::public_transfer(wal_coin, sender)  [optional]
///
///  [Decryption — after PTB]
///
///    To read the private attestation:
///      sealClient.decrypt({ id: seal_id, txBytes: sealApproveTxBytes })
///      where sealApproveTxBytes calls `proof_attestation::seal_approve` with
///      the owned ProofAttestation — proving ownership to Seal decryption nodes.
///
/// ═══════════════════════════════════════════════════════════════════════════════
/// SEAL DECRYPTION GATE
/// ═══════════════════════════════════════════════════════════════════════════════
///
/// `seal_approve(id, &attestation)` is called by Seal threshold-decryption nodes
/// to check whether the requester is permitted to decrypt a blob encrypted with
/// `id`.  The function succeeds iff `id == attestation.seal_id`, meaning the
/// requester must present the owned ProofAttestation corresponding to the blob.
/// Because Sui transaction inputs require the sender to own an object they pass
/// by reference, this proves ownership without any additional signature.
///
/// Seal access control pattern:
///   Encrypt:  id = sha256(proof_nonce || program_digest)  [derivable off-chain]
///   Approve:  present the ProofAttestation whose .seal_id matches
///
module ligetron_verifier::proof_attestation {
    use std::hash;
    use ligetron_verifier::ligetron_verifier::{Self, VerifierRegistry};
    use sui::event;

    // ══════════════════════════════════════════════════════════════════════════
    // Error codes
    // ══════════════════════════════════════════════════════════════════════════

    /// iop_blob_id must be non-empty (must have uploaded proof to Walrus first).
    const E_EMPTY_IOP_BLOB_ID: u64        = 0;
    /// seal_blob_id must be non-empty (must have encrypted + uploaded attestation).
    const E_EMPTY_SEAL_BLOB_ID: u64       = 1;
    /// seal_id must be non-empty.
    const E_EMPTY_SEAL_ID: u64            = 2;
    /// The Seal decryption ID does not match this attestation's seal_id.
    const E_SEAL_ID_MISMATCH: u64         = 3;

    // ══════════════════════════════════════════════════════════════════════════
    // The attestation object
    // ══════════════════════════════════════════════════════════════════════════

    /// A Sui owned object representing a verified ZK proof with private payload.
    ///
    /// Owning this object proves:
    ///   1. A valid Ligetron proof was verified on-chain for `program_digest`
    ///      with `inputs_digest` at `verified_at_epoch`.
    ///   2. The raw IOP proof is durably stored on Walrus at `iop_blob_id`.
    ///   3. A private attestation payload (encrypted with Seal) is stored on
    ///      Walrus at `seal_blob_id` and can be decrypted by calling
    ///      `seal_approve` with this object.
    ///
    /// The object is transferable (`store` ability) — it can be sold, delegated,
    /// or used as a credential in downstream protocols.
    public struct ProofAttestation has key, store {
        id: UID,

        // ── Proof identity ───────────────────────────────────────────────────
        /// SHA-256(wasm_bytes) with byte[31] zeroed — identifies the proved program.
        program_digest: vector<u8>,
        /// SHA-256(public_inputs_raw) with byte[31] zeroed — identifies the inputs.
        inputs_digest: vector<u8>,
        /// SHA-256(proof_bytes) — unique per proof submission, immutable.
        proof_nonce: vector<u8>,

        // ── Storage references ───────────────────────────────────────────────
        /// Walrus blob ID for the raw Ligetron IOP proof (~MBs, unencrypted).
        /// Retrieve with: GET https://aggregator.walrus-testnet.walrus.space/v1/<iop_blob_id>
        iop_blob_id: vector<u8>,
        /// Walrus blob ID for the Seal-encrypted attestation payload.
        /// Retrieve + decrypt with: sealClient.decrypt({ id: seal_id, ... })
        seal_blob_id: vector<u8>,
        /// Seal encryption ID — used to request threshold decryption key shares.
        /// Must equal sha256(proof_nonce || program_digest) by convention.
        seal_id: vector<u8>,

        // ── Metadata ─────────────────────────────────────────────────────────
        verified_at_epoch: u64,
        /// Address that submitted and now owns this attestation.
        owner: address,
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════════════════

    public struct AttestationMinted has copy, drop {
        attestation_id: ID,
        program_digest: vector<u8>,
        inputs_digest: vector<u8>,
        proof_nonce: vector<u8>,
        iop_blob_id: vector<u8>,
        seal_blob_id: vector<u8>,
        seal_id: vector<u8>,
        owner: address,
        epoch: u64,
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Core: atomic verify + attest
    // ══════════════════════════════════════════════════════════════════════════

    /// Atomically verify a Ligetron proof and mint a ProofAttestation.
    ///
    /// This is the primary entry point.  Call it inside a PTB that also:
    ///   - Swaps SUI → WAL via DeepBook before this call
    ///   - Transfers the returned attestation to the desired recipient after
    ///
    /// # Arguments
    ///
    /// - `registry`:          The shared VerifierRegistry from ligetron_verifier.
    /// - `program_digest`:    32-byte SHA-256(wasm_bytes). Must be registered.
    /// - `public_inputs_raw`: Raw public input bytes given to the prover.
    /// - `proof_bytes`:       256-byte Arkworks BN254 Groth16 proof.
    /// - `iop_blob_id`:       Walrus blob ID for the raw IOP proof (uploaded before PTB).
    /// - `seal_blob_id`:      Walrus blob ID for the Seal-encrypted attestation.
    /// - `seal_id`:           Seal encryption ID = sha256(proof_nonce || program_digest).
    ///                        Must be pre-computed off-chain with the same derivation.
    ///
    /// # Returns
    ///
    /// A `ProofAttestation` object — transfer it to the intended owner in the PTB.
    ///
    /// # Atomicity guarantee
    ///
    /// If Groth16 verification fails, the entire PTB reverts:
    ///   - No nonce is recorded
    ///   - No attestation is minted
    ///   - The DeepBook swap is also rolled back (Sui's full transaction atomicity)
    public fun verify_and_attest(
        registry: &mut VerifierRegistry,
        program_digest: vector<u8>,
        public_inputs_raw: vector<u8>,
        proof_bytes: vector<u8>,
        iop_blob_id: vector<u8>,
        seal_blob_id: vector<u8>,
        seal_id: vector<u8>,
        ctx: &mut TxContext,
    ): ProofAttestation {
        // ── Validate storage references ───────────────────────────────────────
        assert!(!iop_blob_id.is_empty(),  E_EMPTY_IOP_BLOB_ID);
        assert!(!seal_blob_id.is_empty(), E_EMPTY_SEAL_BLOB_ID);
        assert!(!seal_id.is_empty(),      E_EMPTY_SEAL_ID);

        // ── Verify proof (Groth16) + record nonce in registry ─────────────────
        // This call aborts on any failure, rolling back the entire transaction.
        ligetron_verifier::verify_proof(
            registry,
            program_digest,
            public_inputs_raw,
            proof_bytes,
            ctx,
        );

        // ── Derive proof_nonce and inputs_digest for the attestation record ───
        // These are re-derived from the same inputs that verify_proof used.
        let proof_nonce   = hash::sha2_256(proof_bytes);
        let inputs_digest = hash::sha2_256(public_inputs_raw);

        // ── Validate Seal ID derivation ───────────────────────────────────────
        // By convention: seal_id = sha256(proof_nonce || program_digest).
        // This ties the Seal encryption key to the specific proof submission,
        // preventing one attestation's seal_id from unlocking another's blob.
        let expected_seal_id = derive_seal_id(&proof_nonce, &program_digest);
        assert!(seal_id == expected_seal_id, E_SEAL_ID_MISMATCH);

        // ── Mint the attestation object ───────────────────────────────────────
        let owner    = ctx.sender();
        let epoch    = ctx.epoch();
        let attest_uid = object::new(ctx);
        let attest_id  = object::uid_to_inner(&attest_uid);

        event::emit(AttestationMinted {
            attestation_id: attest_id,
            program_digest,
            inputs_digest,
            proof_nonce,
            iop_blob_id,
            seal_blob_id,
            seal_id,
            owner,
            epoch,
        });

        ProofAttestation {
            id: attest_uid,
            program_digest,
            inputs_digest,
            proof_nonce,
            iop_blob_id,
            seal_blob_id,
            seal_id,
            verified_at_epoch: epoch,
            owner,
        }
    }

    /// Convenience wrapper: verify_and_attest + transfer to sender in one call.
    #[allow(lint(self_transfer))]
    public fun verify_attest_and_keep(
        registry: &mut VerifierRegistry,
        program_digest: vector<u8>,
        public_inputs_raw: vector<u8>,
        proof_bytes: vector<u8>,
        iop_blob_id: vector<u8>,
        seal_blob_id: vector<u8>,
        seal_id: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let attestation = verify_and_attest(
            registry, program_digest, public_inputs_raw, proof_bytes,
            iop_blob_id, seal_blob_id, seal_id, ctx,
        );
        transfer::transfer(attestation, ctx.sender());
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Seal decryption gate
    // ══════════════════════════════════════════════════════════════════════════

    /// Seal threshold-decryption approval gate.
    ///
    /// Called by Seal decryption nodes to verify that the requester is permitted
    /// to decrypt the blob encrypted with `id`.
    ///
    /// # How it works
    ///
    /// 1. The attestation owner constructs a transaction that calls this function,
    ///    passing their `ProofAttestation` by reference (proving ownership).
    /// 2. They sign the transaction bytes and present them to Seal decryption nodes.
    /// 3. Each node simulates the transaction; if `seal_approve` succeeds (no abort),
    ///    the node provides its decryption key share.
    /// 4. With threshold-many shares, the client reconstructs the decryption key.
    ///
    /// # Arguments
    ///
    /// - `id`: The Seal encryption ID to approve.  Must equal `attestation.seal_id`.
    ///         Seal nodes set this to the blob's encryption ID.
    /// - `attestation`: Reference to the owned ProofAttestation.
    ///
    /// # Security
    ///
    /// Only the transaction sender can provide a `&ProofAttestation` as an input —
    /// Sui requires the sender to own (or have been delegated) the object.
    /// Therefore approval is granted iff the requester owns the correct attestation.
    public fun seal_approve(id: vector<u8>, attestation: &ProofAttestation) {
        assert!(attestation.seal_id == id, E_SEAL_ID_MISMATCH);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Read-only accessors
    // ══════════════════════════════════════════════════════════════════════════

    public fun program_digest(a: &ProofAttestation):  vector<u8> { a.program_digest }
    public fun inputs_digest(a: &ProofAttestation):   vector<u8> { a.inputs_digest }
    public fun proof_nonce(a: &ProofAttestation):     vector<u8> { a.proof_nonce }
    public fun iop_blob_id(a: &ProofAttestation):     vector<u8> { a.iop_blob_id }
    public fun seal_blob_id(a: &ProofAttestation):    vector<u8> { a.seal_blob_id }
    public fun seal_id(a: &ProofAttestation):         vector<u8> { a.seal_id }
    public fun verified_at_epoch(a: &ProofAttestation): u64      { a.verified_at_epoch }
    public fun owner(a: &ProofAttestation):           address    { a.owner }

    // ══════════════════════════════════════════════════════════════════════════
    // Seal ID derivation — canonical formula, must match off-chain SDK usage
    // ══════════════════════════════════════════════════════════════════════════

    /// Derive the Seal encryption ID from a proof nonce and program digest.
    ///
    /// Convention: seal_id = SHA-256( proof_nonce || program_digest )
    ///
    /// This ties the encrypted blob to one specific proof submission.
    /// The off-chain client MUST use the same derivation when calling
    /// `sealClient.encrypt({ id: deriveSealId(proofNonce, programDigest), ... })`.
    ///
    /// Public so the TypeScript SDK can call this to verify the expected seal_id
    /// before constructing the PTB.
    public fun derive_seal_id(
        proof_nonce: &vector<u8>,
        program_digest: &vector<u8>,
    ): vector<u8> {
        let mut data = *proof_nonce;
        data.append(*program_digest);
        hash::sha2_256(data)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Test-only helpers
    // ══════════════════════════════════════════════════════════════════════════

    #[test_only]
    public fun derive_seal_id_testing(nonce: vector<u8>, digest: vector<u8>): vector<u8> {
        derive_seal_id(&nonce, &digest)
    }

    #[test_only]
    public fun seal_id_of(a: &ProofAttestation): vector<u8> { a.seal_id }
}
