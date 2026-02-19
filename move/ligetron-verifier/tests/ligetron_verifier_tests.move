/// Comprehensive test suite for the Ligetron verifier contracts.
///
/// Test categories:
///   1. Merkle path verification — unit tests with known SHA-256 values
///   2. Registry lifecycle — init, register, revoke
///   3. Replay protection — nonce recording and double-submit rejection
///   4. Input validation — error codes for malformed arguments
///   5. digest_for_bn254 — canonical BN254 encoding
///
/// NOTE: End-to-end Groth16 verification requires a real circuit VK + proof
/// (from an actual trusted setup).  Those integration tests live in
/// templates/sui-twa/src/zkproof.ts and run against a deployed local node.
///
#[test_only]
module ligetron_verifier::ligetron_verifier_tests {
    use sui::test_scenario::{Self as ts};
    use std::hash;

    use ligetron_verifier::ligetron_verifier::{
        Self,
        AdminCap,
        VerifierRegistry,
    };
    use ligetron_verifier::merkle;

    // ══════════════════════════════════════════════════════════════════════════
    // Constants
    // ══════════════════════════════════════════════════════════════════════════

    const ADMIN: address = @0xAD;
    const USER:  address = @0x01;

    // 32-byte fake program digest.
    const FAKE_DIGEST: vector<u8> =
        x"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";

    // Non-empty placeholder VK bytes (real VK is ~hundreds of bytes from Groth16 setup).
    const FAKE_VK: vector<u8> = x"deadbeef";

    // ══════════════════════════════════════════════════════════════════════════
    // Helpers
    // ══════════════════════════════════════════════════════════════════════════

    fun make_bytes(len: u64): vector<u8> {
        let mut v: vector<u8> = vector[];
        let mut i = 0;
        while (i < len) { v.push_back(0u8); i = i + 1; };
        v
    }

    fun setup(): ts::Scenario {
        let mut scenario = ts::begin(ADMIN);
        { ligetron_verifier::init_for_testing(scenario.ctx()); };
        scenario.next_tx(ADMIN);
        scenario
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 1. Merkle path verification
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fun test_merkle_left_child() {
        // 2-leaf tree: leaf is LEFT child.
        // root = SHA-256(leaf_hash || sibling)
        let leaf_data = b"data";
        let leaf_hash = hash::sha2_256(leaf_data);
        let sibling   = hash::sha2_256(b"sibling");
        let root      = merkle::hash_pair_testing(leaf_hash, sibling);

        merkle::verify_path(leaf_data, root, vector[sibling], vector[0u8]);
    }

    #[test]
    fun test_merkle_right_child() {
        // 2-leaf tree: leaf is RIGHT child.
        // root = SHA-256(sibling || leaf_hash)
        let leaf_data = b"leaf_right";
        let leaf_hash = hash::sha2_256(leaf_data);
        let sibling   = hash::sha2_256(b"left_sib");
        let root      = merkle::hash_pair_testing(sibling, leaf_hash);

        merkle::verify_path(leaf_data, root, vector[sibling], vector[1u8]);
    }

    #[test]
    fun test_merkle_depth_3_leaf5() {
        // 8-leaf tree.  Leaf at index 5 (binary 101):
        //   level 0: leaf5 is RIGHT child of parent(4,5)  → side=1
        //   level 1: parent(4,5) is LEFT child of parent(4..7) → side=0
        //   level 2: parent(4..7) is RIGHT child of root → side=1

        let l0 = hash::sha2_256(b"leaf0");
        let l1 = hash::sha2_256(b"leaf1");
        let l2 = hash::sha2_256(b"leaf2");
        let l3 = hash::sha2_256(b"leaf3");
        let l4 = hash::sha2_256(b"leaf4");
        let l5_data = b"leaf5";
        let l5 = hash::sha2_256(b"leaf5");
        let l6 = hash::sha2_256(b"leaf6");
        let l7 = hash::sha2_256(b"leaf7");

        let p01   = merkle::hash_pair_testing(l0, l1);
        let p23   = merkle::hash_pair_testing(l2, l3);
        let p45   = merkle::hash_pair_testing(l4, l5);
        let p67   = merkle::hash_pair_testing(l6, l7);
        let p0123 = merkle::hash_pair_testing(p01, p23);
        let p4567 = merkle::hash_pair_testing(p45, p67);
        let root  = merkle::hash_pair_testing(p0123, p4567);

        // Sibling path for leaf[5]: [l4, p67, p0123], sides [1, 0, 1]
        merkle::verify_path(
            l5_data, root,
            vector[l4, p67, p0123],
            vector[1u8, 0u8, 1u8],
        );
    }

    #[test]
    #[expected_failure(abort_code = 5)]
    fun test_merkle_wrong_root_fails() {
        let wrong_root = x"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        merkle::verify_path(
            b"data", wrong_root,
            vector[hash::sha2_256(b"sibling")],
            vector[0u8],
        );
    }

    #[test]
    #[expected_failure(abort_code = 5)]
    fun test_merkle_tampered_sibling_fails() {
        let leaf_data      = b"data";
        let leaf_hash      = hash::sha2_256(leaf_data);
        let real_sibling   = hash::sha2_256(b"sibling");
        let tampered       = hash::sha2_256(b"tampered");
        let root           = merkle::hash_pair_testing(leaf_hash, real_sibling);

        merkle::verify_path(leaf_data, root, vector[tampered], vector[0u8]);
    }

    #[test]
    #[expected_failure(abort_code = 1)]
    fun test_merkle_empty_leaf_fails() {
        let dummy = x"0000000000000000000000000000000000000000000000000000000000000000";
        merkle::verify_path(vector[], dummy, vector[dummy], vector[0u8]);
    }

    #[test]
    #[expected_failure(abort_code = 6)]
    fun test_merkle_mismatched_lengths_fails() {
        let s = hash::sha2_256(b"s");
        let r = hash::sha2_256(b"r");
        merkle::verify_path(b"data", r, vector[s], vector[0u8, 1u8]);
    }

    #[test]
    fun test_compute_column_digest() {
        let fe0 = x"0101010101010101010101010101010101010101010101010101010101010101";
        let fe1 = x"0202020202020202020202020202020202020202020202020202020202020202";

        let digest = merkle::compute_column_digest(vector[fe0, fe1]);
        assert!(digest.length() == 32, 0);

        // Verify: SHA-256(fe0 || fe1)
        let mut concat = fe0;
        concat.append(fe1);
        let expected = hash::sha2_256(concat);
        assert!(digest == expected, 1);
    }

    #[test]
    fun test_expected_path_len() {
        assert!(merkle::expected_path_len(2)    == 1,  0);
        assert!(merkle::expected_path_len(4)    == 2,  1);
        assert!(merkle::expected_path_len(8)    == 3,  2);
        assert!(merkle::expected_path_len(8192) == 13, 3);
    }

    #[test]
    fun test_verify_paths_batch() {
        let a_data = b"leaf_a";
        let b_data = b"leaf_b";
        let ha = hash::sha2_256(b"leaf_a");
        let hb = hash::sha2_256(b"leaf_b");
        let root = merkle::hash_pair_testing(ha, hb); // a=left, b=right

        merkle::verify_paths_batch(
            vector[a_data, b_data],
            root,
            vector[ vector[hb], vector[ha] ],
            vector[ vector[0u8], vector[1u8] ],
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 2. Registry lifecycle
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fun test_init_creates_admin_cap_and_registry() {
        let mut s = setup();
        {
            let cap = s.take_from_sender<AdminCap>();
            let reg = s.take_shared<VerifierRegistry>();
            assert!(ligetron_verifier::total_verified(&reg) == 0, 0);
            assert!(!ligetron_verifier::is_program_registered(&reg, &FAKE_DIGEST), 1);
            ts::return_to_sender(&s, cap);
            ts::return_shared(reg);
        };
        s.end();
    }

    #[test]
    fun test_register_and_query_program() {
        let mut s = setup();
        {
            let cap = s.take_from_sender<AdminCap>();
            let mut reg = s.take_shared<VerifierRegistry>();
            ligetron_verifier::register_program(
                &cap, &mut reg, FAKE_DIGEST, FAKE_VK, b"test-v0", s.ctx(),
            );
            assert!(ligetron_verifier::is_program_registered(&reg, &FAKE_DIGEST), 0);
            assert!(ligetron_verifier::get_program_label(&reg, &FAKE_DIGEST) == b"test-v0", 1);
            ts::return_to_sender(&s, cap);
            ts::return_shared(reg);
        };
        s.end();
    }

    #[test]
    #[expected_failure(abort_code = 6)]
    fun test_register_duplicate_fails() {
        let mut s = setup();
        {
            let cap = s.take_from_sender<AdminCap>();
            let mut reg = s.take_shared<VerifierRegistry>();
            ligetron_verifier::register_program(&cap, &mut reg, FAKE_DIGEST, FAKE_VK, b"v1", s.ctx());
            ligetron_verifier::register_program(&cap, &mut reg, FAKE_DIGEST, FAKE_VK, b"v2", s.ctx());
            ts::return_to_sender(&s, cap);
            ts::return_shared(reg);
        };
        s.end();
    }

    #[test]
    fun test_revoke_program() {
        let mut s = setup();
        {
            let cap = s.take_from_sender<AdminCap>();
            let mut reg = s.take_shared<VerifierRegistry>();
            ligetron_verifier::register_program(&cap, &mut reg, FAKE_DIGEST, FAKE_VK, b"v1", s.ctx());
            assert!(ligetron_verifier::is_program_registered(&reg, &FAKE_DIGEST), 0);
            ligetron_verifier::revoke_program(&cap, &mut reg, FAKE_DIGEST, s.ctx());
            assert!(!ligetron_verifier::is_program_registered(&reg, &FAKE_DIGEST), 1);
            ts::return_to_sender(&s, cap);
            ts::return_shared(reg);
        };
        s.end();
    }

    #[test]
    #[expected_failure(abort_code = 2)]
    fun test_revoke_unregistered_fails() {
        let mut s = setup();
        {
            let cap = s.take_from_sender<AdminCap>();
            let mut reg = s.take_shared<VerifierRegistry>();
            ligetron_verifier::revoke_program(&cap, &mut reg, FAKE_DIGEST, s.ctx());
            ts::return_to_sender(&s, cap);
            ts::return_shared(reg);
        };
        s.end();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 3. verify_proof — input validation
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = 2)]
    fun test_verify_unregistered_program_fails() {
        let mut s = setup();
        s.next_tx(USER);
        {
            let mut reg = s.take_shared<VerifierRegistry>();
            ligetron_verifier::verify_proof(
                &mut reg, FAKE_DIGEST, b"inputs", make_bytes(256), s.ctx(),
            );
            ts::return_shared(reg);
        };
        s.end();
    }

    #[test]
    #[expected_failure(abort_code = 0)]
    fun test_verify_wrong_proof_length_fails() {
        let mut s = setup();
        {
            let cap = s.take_from_sender<AdminCap>();
            let mut reg = s.take_shared<VerifierRegistry>();
            ligetron_verifier::register_program(&cap, &mut reg, FAKE_DIGEST, FAKE_VK, b"p", s.ctx());
            ts::return_to_sender(&s, cap);
            ts::return_shared(reg);
        };
        s.next_tx(USER);
        {
            let mut reg = s.take_shared<VerifierRegistry>();
            ligetron_verifier::verify_proof(
                &mut reg, FAKE_DIGEST, b"inputs", make_bytes(100), s.ctx(),
            );
            ts::return_shared(reg);
        };
        s.end();
    }

    #[test]
    #[expected_failure(abort_code = 4)]
    fun test_verify_short_digest_fails() {
        let mut s = setup();
        s.next_tx(USER);
        {
            let mut reg = s.take_shared<VerifierRegistry>();
            ligetron_verifier::verify_proof(
                &mut reg, b"short", b"inputs", make_bytes(256), s.ctx(),
            );
            ts::return_shared(reg);
        };
        s.end();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 4. Replay protection
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fun test_nonce_not_recorded_before_verify() {
        let mut s = setup();
        s.next_tx(USER);
        {
            let reg = s.take_shared<VerifierRegistry>();
            let proof_bytes = make_bytes(256);
            let nonce = hash::sha2_256(proof_bytes);
            assert!(!ligetron_verifier::is_nonce_used(&reg, &nonce), 0);
            ts::return_shared(reg);
        };
        s.end();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 5. digest_for_bn254 encoding
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fun test_digest_for_bn254_zeroes_top_byte() {
        let mut input = make_bytes(32);
        *input.borrow_mut(31) = 0xFFu8;
        let result = ligetron_verifier::digest_for_bn254_testing(input);
        assert!(*result.borrow(31) == 0u8, 0);
        let mut i = 0u64;
        while (i < 31) {
            assert!(*result.borrow(i) == *input.borrow(i), i);
            i = i + 1;
        };
    }

    #[test]
    fun test_digest_for_bn254_real_sha256() {
        let raw = hash::sha2_256(b"wasm bytes here");
        let truncated = ligetron_verifier::digest_for_bn254_testing(raw);
        assert!(truncated.length() == 32, 0);
        assert!(*truncated.borrow(31) == 0u8, 1);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 6. verify_proof_stateless input validation
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = 0)]
    fun test_stateless_wrong_proof_len_fails() {
        ligetron_verifier::verify_proof_stateless(
            FAKE_VK, FAKE_DIGEST, b"inputs", make_bytes(128),
        );
    }

    #[test]
    #[expected_failure(abort_code = 7)]
    fun test_stateless_empty_vk_fails() {
        ligetron_verifier::verify_proof_stateless(
            vector[], FAKE_DIGEST, b"inputs", make_bytes(256),
        );
    }
}
