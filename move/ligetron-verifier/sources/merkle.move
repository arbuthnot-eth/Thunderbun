/// SHA-256 binary Merkle tree verifier — defense-in-depth for Ligetron IOP proofs
///
/// ═══════════════════════════════════════════════════════════════════════════════
/// LIGETRON MERKLE COMMITMENT SCHEME
/// ═══════════════════════════════════════════════════════════════════════════════
///
/// Ligetron commits to n=8192 matrix columns via a balanced binary Merkle tree
/// with SHA-256 (confirmed from ligeroinc/ligero-prover source code).
///
/// Leaf:          SHA-256( col[0] || col[1] || ... || col[rows-1] )
///                where each col[i] is a 32-byte BN254 LE field element.
///
/// Internal node: SHA-256( left_child || right_child )
///
/// The prover exposes t=192 column openings (Fiat-Shamir sampled), each
/// accompanied by log2(8192)=13 sibling hashes.
///
/// ═══════════════════════════════════════════════════════════════════════════════
/// USAGE
/// ═══════════════════════════════════════════════════════════════════════════════
///
/// Optional on-chain IOP-layer validation for defense-in-depth.  The primary
/// ligetron_verifier::verify_proof uses Groth16 for full proof verification.
///
module ligetron_verifier::merkle {
    use std::hash;

    // ══════════════════════════════════════════════════════════════════════════
    // Error codes
    // ══════════════════════════════════════════════════════════════════════════

    /// siblings and side_bits must be the same length, between 1 and 30.
    const E_INVALID_PATH_LEN: u64    = 0;
    /// leaf_data must be non-empty.
    const E_EMPTY_LEAF: u64          = 1;
    /// Every sibling hash must be exactly 32 bytes.
    const E_INVALID_SIBLING_LEN: u64 = 2;
    /// side_bits entries must be 0 or 1.
    const E_INVALID_SIDE_BIT: u64    = 3;
    /// expected_root must be exactly 32 bytes.
    const E_INVALID_ROOT_LEN: u64    = 4;
    /// Computed root does not match expected root.
    const E_ROOT_MISMATCH: u64       = 5;
    /// siblings.length != side_bits.length.
    const E_PATH_LEN_MISMATCH: u64   = 6;
    /// Batch input vectors must have equal length.
    const E_BATCH_LEN_MISMATCH: u64  = 7;
    /// Each field element must be exactly 32 bytes.
    const E_INVALID_FIELD_ELEM_LEN: u64 = 8;
    /// leaf_hash passed to verify_path_prehashed must be exactly 32 bytes.
    const E_INVALID_LEAF_LEN: u64 = 9;

    const HASH_LEN: u64          = 32;
    /// log2(8192) — standard Ligetron path depth.
    const LIGETRON_PATH_LEN: u64 = 13;
    const FIELD_ELEM_LEN: u64    = 32;

    // ══════════════════════════════════════════════════════════════════════════
    // Core path verification
    // ══════════════════════════════════════════════════════════════════════════

    /// Verify that `leaf_data` is included in the Merkle tree with root
    /// `expected_root`, using the given sibling path.
    ///
    /// `side_bits[i] = 0` means the current node is the LEFT child at level i
    /// (parent = SHA-256(current || sibling)).
    /// `side_bits[i] = 1` means RIGHT child (parent = SHA-256(sibling || current)).
    public fun verify_path(
        leaf_data: vector<u8>,
        expected_root: vector<u8>,
        siblings: vector<vector<u8>>,
        side_bits: vector<u8>,
    ) {
        assert!(!leaf_data.is_empty(), E_EMPTY_LEAF);
        assert!(expected_root.length() == HASH_LEN, E_INVALID_ROOT_LEN);

        let path_len = siblings.length();
        assert!(path_len >= 1 && path_len <= 30, E_INVALID_PATH_LEN);
        assert!(side_bits.length() == path_len, E_PATH_LEN_MISMATCH);

        let computed = compute_root(leaf_data, siblings, side_bits);
        assert!(computed == expected_root, E_ROOT_MISMATCH);
    }

    /// Verify using a pre-computed leaf hash (avoids double-hashing).
    public fun verify_path_prehashed(
        leaf_hash: vector<u8>,
        expected_root: vector<u8>,
        siblings: vector<vector<u8>>,
        side_bits: vector<u8>,
    ) {
        assert!(leaf_hash.length() == HASH_LEN, E_INVALID_LEAF_LEN);
        assert!(expected_root.length() == HASH_LEN, E_INVALID_ROOT_LEN);

        let path_len = siblings.length();
        assert!(path_len >= 1 && path_len <= 30, E_INVALID_PATH_LEN);
        assert!(side_bits.length() == path_len, E_PATH_LEN_MISMATCH);

        let computed = walk_to_root(leaf_hash, siblings, side_bits);
        assert!(computed == expected_root, E_ROOT_MISMATCH);
    }

    /// Verify multiple column openings against the same Merkle root.
    public fun verify_paths_batch(
        leaf_datas: vector<vector<u8>>,
        expected_root: vector<u8>,
        siblings_list: vector<vector<vector<u8>>>,
        side_bits_list: vector<vector<u8>>,
    ) {
        assert!(expected_root.length() == HASH_LEN, E_INVALID_ROOT_LEN);
        let n = leaf_datas.length();
        assert!(siblings_list.length() == n, E_BATCH_LEN_MISMATCH);
        assert!(side_bits_list.length() == n, E_BATCH_LEN_MISMATCH);

        let mut i = 0;
        while (i < n) {
            verify_path(
                *leaf_datas.borrow(i),
                expected_root,
                *siblings_list.borrow(i),
                *side_bits_list.borrow(i),
            );
            i = i + 1;
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Ligetron-specific helpers
    // ══════════════════════════════════════════════════════════════════════════

    /// Compute the SHA-256 leaf digest for a Ligetron matrix column.
    ///
    /// leaf[j] = SHA-256( row_0[j] || row_1[j] || ... || row_{m-1}[j] )
    /// Each row value is a 32-byte BN254 LE field element.
    public fun compute_column_digest(field_elements: vector<vector<u8>>): vector<u8> {
        let n = field_elements.length();
        assert!(n > 0, E_EMPTY_LEAF);
        let mut data: vector<u8> = vector[];
        let mut i = 0;
        while (i < n) {
            let elem = field_elements.borrow(i);
            assert!(elem.length() == FIELD_ELEM_LEN, E_INVALID_FIELD_ELEM_LEN);
            data.append(*elem);
            i = i + 1;
        };
        hash::sha2_256(data)
    }

    /// Verify a Ligetron column opening, asserting the standard depth of 13
    /// (n=8192 leaves). Pass a pre-hashed column digest.
    public fun verify_ligetron_column_opening(
        column_digest: vector<u8>,
        merkle_root: vector<u8>,
        siblings: vector<vector<u8>>,
        side_bits: vector<u8>,
    ) {
        assert!(siblings.length() == LIGETRON_PATH_LEN, E_INVALID_PATH_LEN);
        verify_path_prehashed(column_digest, merkle_root, siblings, side_bits);
    }

    /// Return the expected path length for a balanced tree with `num_leaves` leaves
    /// (num_leaves must be a power of 2).
    public fun expected_path_len(num_leaves: u64): u64 {
        assert!(num_leaves > 0, E_INVALID_PATH_LEN);
        let mut n = num_leaves;
        let mut depth = 0u64;
        while (n > 1) { n = n >> 1; depth = depth + 1; };
        depth
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Internal helpers
    // ══════════════════════════════════════════════════════════════════════════

    fun compute_root(
        leaf_data: vector<u8>,
        siblings: vector<vector<u8>>,
        side_bits: vector<u8>,
    ): vector<u8> {
        let leaf_hash = hash::sha2_256(leaf_data);
        walk_to_root(leaf_hash, siblings, side_bits)
    }

    fun walk_to_root(
        mut current: vector<u8>,
        siblings: vector<vector<u8>>,
        side_bits: vector<u8>,
    ): vector<u8> {
        let path_len = siblings.length();
        let mut i = 0;
        while (i < path_len) {
            let sibling = siblings.borrow(i);
            assert!(sibling.length() == HASH_LEN, E_INVALID_SIBLING_LEN);
            let side = *side_bits.borrow(i);
            assert!(side == 0u8 || side == 1u8, E_INVALID_SIDE_BIT);
            current = if (side == 0u8) {
                hash_pair(current, *sibling)
            } else {
                hash_pair(*sibling, current)
            };
            i = i + 1;
        };
        current
    }

    /// SHA-256(left || right)
    fun hash_pair(left: vector<u8>, right: vector<u8>): vector<u8> {
        let mut data = left;
        data.append(right);
        hash::sha2_256(data)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Test exports
    // ══════════════════════════════════════════════════════════════════════════

    #[test_only]
    public fun hash_pair_testing(left: vector<u8>, right: vector<u8>): vector<u8> {
        hash_pair(left, right)
    }

    #[test_only]
    public fun walk_to_root_testing(
        current: vector<u8>,
        siblings: vector<vector<u8>>,
        side_bits: vector<u8>,
    ): vector<u8> {
        walk_to_root(current, siblings, side_bits)
    }
}
