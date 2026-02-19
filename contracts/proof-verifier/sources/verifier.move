// Copyright (c) ThunderBun Team
// SPDX-License-Identifier: Apache-2.0
//
// General-purpose, security-auditable ZK proof verification contract for Sui.
// Supports Groth16 (native) and is designed for Ligetron proofs via Groth16 recursion.
//
// SECURITY: Designed for third-party audit. All verification keys are registered
// on-chain; admin controls are capability-gated; every verification emits an event.

module proof_verifier::verifier {

    use std::vector;
    use sui::event;
    use sui::groth16;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    // ============ Errors ============
    const EUnauthorized: u64 = 1;
    const EKeyAlreadyRegistered: u64 = 2;
    const EKeyNotFound: u64 = 3;
    const EInvalidProof: u64 = 4;
    const EInvalidVerifyingKey: u64 = 5;

    // ============ Proof Types ============
    /// Supported proof system identifiers.
    /// - Groth16: Native Sui verification (BN254 or BLS12-381)
    /// - Ligetron: Via Groth16 recursion (Ligero wraps Ligetron proofs in Groth16)
    public struct ProofType has drop, copy {
        pub id: u8,
    }
    const GROTH16_BN254: u8 = 0;
    const GROTH16_BLS12_381: u8 = 1;
    const LIGETRON_VIA_GROTH16: u8 = 2; // Ligetron proof verified inside a Groth16 circuit

    /// Curve selector for Groth16.
    public struct CurveType has drop, copy {
        pub id: u8,
    }

    // ============ Registry ============
    /// Registry of verification keys. Keyed by circuit_id (e.g. hex or semantic name).
    /// Holds prepared verifying keys for Groth16 and metadata for audit.
    public struct VerificationKeyRegistry has key {
        id: UID,
        /// One-time shared, mutable registry
        keys: sui::table::Table<vector<u8>, VerificationKey>,
    }

    struct VerificationKey has store, drop {
        circuit_id: vector<u8>,
        curve: u8, // 0 = BN254, 1 = BLS12-381
        pvk_component_0: vector<u8>,
        pvk_component_1: vector<u8>,
        pvk_component_2: vector<u8>,
        pvk_component_3: vector<u8>,
        proof_type_hint: u8, // ProofType id
        registered_at_ms: u64,
    }

    /// One-time admin capability. Controls who can register/update verification keys.
    public struct AdminCap has key, store {
        id: UID,
    }

    // ============ Events (audit trail) ============
    /// Emitted on every successful proof verification.
    public struct ProofVerified has drop, copy {
        circuit_id: vector<u8>,
        verifier: address,
        proof_type: u8,
        timestamp_ms: u64,
    }

    /// Emitted when a verification key is registered or updated.
    public struct KeyRegistered has drop, copy {
        circuit_id: vector<u8>,
        curve: u8,
        proof_type_hint: u8,
        registered_by: address,
        timestamp_ms: u64,
    }

    /// Emitted when verification fails (optional; can be disabled to avoid leaking info).
    public struct ProofRejected has drop, copy {
        circuit_id: vector<u8>,
        verifier: address,
        reason: u64, // error code
        timestamp_ms: u64,
    }

    // ============ Init ============
    fun init(ctx: &mut TxContext) {
        let (registry, admin_cap) = create_registry(ctx);
        transfer::share_object(registry);
        transfer::transfer(admin_cap, tx_context::sender(ctx));
    }

    fun create_registry(ctx: &mut TxContext): (VerificationKeyRegistry, AdminCap) {
        let registry = VerificationKeyRegistry {
            id: object::new(ctx),
            keys: sui::table::new(ctx),
        };
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        (registry, admin_cap)
    }

    // ============ Key Registration (Admin) ============
    /// Register or replace a Groth16 verification key.
    /// Requires AdminCap. Pass the shared registry from init.
    ///
    /// # Arguments
    /// - `registry`: Shared VerificationKeyRegistry (created at publish)
    /// - `admin`: AdminCap from init
    /// - `circuit_id`: Unique identifier for this circuit (e.g. bcs("my_circuit_v1"))
    /// - `curve_type`: 0 = BN254, 1 = BLS12-381
    /// - `vk_bytes`: Arkworks canonical compressed serialization of the verifying key
    public fun register_groth16_key(
        registry: &mut VerificationKeyRegistry,
        _admin: &AdminCap,
        circuit_id: vector<u8>,
        curve_type: u8,
        vk_bytes: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let pvk = prepare_vk(curve_type, &vk_bytes);
        let components = groth16::pvk_to_bytes(&pvk);
        let proof_type_hint = if (curve_type == 0) { GROTH16_BN254 } else { GROTH16_BLS12_381 };
        let vk = VerificationKey {
            circuit_id: circuit_id,
            curve: curve_type,
            pvk_component_0: *vector::borrow(&components, 0),
            pvk_component_1: *vector::borrow(&components, 1),
            pvk_component_2: *vector::borrow(&components, 2),
            pvk_component_3: *vector::borrow(&components, 3),
            proof_type_hint,
            registered_at_ms: tx_context::timestamp_ms(ctx),
        };

        let key_bytes = copy circuit_id;
        if (sui::table::contains(&registry.keys, key_bytes)) {
            sui::table::remove(&mut registry.keys, key_bytes);
        };
        sui::table::add(&mut registry.keys, key_bytes, vk);

        event::emit(KeyRegistered {
            circuit_id,
            curve: curve_type,
            proof_type_hint,
            registered_by: tx_context::sender(ctx),
            timestamp_ms: tx_context::timestamp_ms(ctx),
        });
    }

    /// Unregister a verification key. Requires AdminCap.
    public fun unregister_key(
        registry: &mut VerificationKeyRegistry,
        _admin: &AdminCap,
        circuit_id: vector<u8>,
    ) {
        let key_bytes = circuit_id;
        assert!(sui::table::contains(&registry.keys, key_bytes), EKeyNotFound);
        sui::table::remove(&mut registry.keys, key_bytes);
    }

    // ============ Proof Verification ============
    /// Verify a Groth16 proof. Returns true iff the proof is valid.
    /// Emits ProofVerified on success, ProofRejected on failure.
    ///
    /// # Arguments
    /// - `registry`: Shared VerificationKeyRegistry
    /// - `circuit_id`: Must match a registered key
    /// - `proof_points_bytes`: Serialized proof points (Arkworks compressed)
    /// - `public_inputs_bytes`: Concatenated 32-byte little-endian scalars (max 8)
    public fun verify_proof(
        registry: &mut VerificationKeyRegistry,
        circuit_id: vector<u8>,
        proof_points_bytes: vector<u8>,
        public_inputs_bytes: vector<u8>,
        ctx: &mut TxContext,
    ): bool {
        let key_bytes = circuit_id;
        assert!(sui::table::contains(&registry.keys, key_bytes), EKeyNotFound);

        let vk = sui::table::borrow(&registry.keys, key_bytes);
        let pvk = groth16::pvk_from_bytes(
            vk.pvk_component_0,
            vk.pvk_component_1,
            vk.pvk_component_2,
            vk.pvk_component_3,
        );
        let proof_points = groth16::proof_points_from_bytes(proof_points_bytes);
        let public_inputs = groth16::public_proof_inputs_from_bytes(public_inputs_bytes);

        let curve = if (vk.curve == 0) {
            groth16::bn254()
        } else {
            groth16::bls12381()
        };

        let valid = groth16::verify_groth16_proof(&curve, &pvk, &public_inputs, &proof_points);

        let sender = tx_context::sender(ctx);
        let ts = tx_context::timestamp_ms(ctx);
        if (valid) {
            event::emit(ProofVerified {
                circuit_id,
                verifier: sender,
                proof_type: vk.proof_type_hint,
                timestamp_ms: ts,
            });
        } else {
            event::emit(ProofRejected {
                circuit_id,
                verifier: sender,
                reason: EInvalidProof,
                timestamp_ms: ts,
            });
        };

        valid
    }

    /// Verify a proof that wraps a Ligetron verification inside a Groth16 circuit.
    /// Use this when Ligero provides a Groth16 proof whose inner statement is
    /// "I verified a Ligetron proof". The outer proof is standard Groth16.
    ///
    /// Same interface as verify_proof — the circuit_id identifies a key for the
    /// Groth16 wrapper circuit.
    public fun verify_ligetron_via_groth16(
        registry: &mut VerificationKeyRegistry,
        circuit_id: vector<u8>,
        proof_points_bytes: vector<u8>,
        public_inputs_bytes: vector<u8>,
        ctx: &mut TxContext,
    ): bool {
        // Ligetron-via-Groth16 uses the same Groth16 verification; the circuit
        // encodes the Ligetron verifier as the statement.
        verify_proof(registry, circuit_id, proof_points_bytes, public_inputs_bytes, ctx)
    }

    // ============ Helpers ============
    fun prepare_vk(curve_type: u8, vk_bytes: &vector<u8>): groth16::PreparedVerifyingKey {
        let curve = if (curve_type == 0) {
            groth16::bn254()
        } else {
            groth16::bls12381()
        };
        groth16::prepare_verifying_key(&curve, vk_bytes)
    }

    // ============ Public View / Queries ============
    /// Check if a circuit has a registered key.
    public fun has_key(circuit_id: vector<u8>, registry: &VerificationKeyRegistry): bool {
        sui::table::contains(&registry.keys, circuit_id)
    }
}
