module cache_sui::cache {
    use std::bcs;
    use sui::coin::{Self, Coin, TreasuryCap};
    use sui::ed25519;
    use sui::event;
    use sui::hash;
    use sui::table::{Self, Table};
    use sui::url;
    use sui::vec_map::{Self, VecMap};
    use sui::vec_set;

    const E_PAUSED: u64 = 0;
    const E_ZERO_AMOUNT: u64 = 1;
    const E_THRESHOLD_INVALID: u64 = 2;
    const E_ATTESTER_ALREADY_EXISTS: u64 = 3;
    const E_ATTESTER_NOT_FOUND: u64 = 4;
    const E_SIGNATURE_LENGTH_MISMATCH: u64 = 5;
    const E_UNAUTHORIZED_ATTESTER: u64 = 6;
    const E_DUPLICATE_ATTESTER: u64 = 7;
    const E_INVALID_SIGNATURE: u64 = 8;
    const E_THRESHOLD_NOT_MET: u64 = 9;
    const E_MESSAGE_ALREADY_USED: u64 = 10;
    const E_INVALID_SOURCE_TX_HASH: u64 = 11;
    const E_INVALID_BASE_RECIPIENT: u64 = 12;

    const BASE_TX_HASH_BYTES: u64 = 32;
    const BASE_RECIPIENT_BYTES: u64 = 20;

    /// One-time witness token type for CACHE.
    public struct CACHE has drop {}

    /// Capability that controls bridge configuration.
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Shared bridge state. Holds treasury cap, replay set, and allowed attesters.
    public struct BridgeState has key {
        id: UID,
        treasury_cap: TreasuryCap<CACHE>,
        used_message_ids: Table<vector<u8>, bool>,
        attesters: VecMap<vector<u8>, bool>,
        threshold: u64,
        paused: bool,
    }

    /// Canonical payload signed by attesters.
    public struct MintPayload has copy, drop, store {
        source_chain_id: u64,
        source_nonce: u64,
        source_tx_hash: vector<u8>,
        recipient: address,
        amount: u64,
    }

    public struct CacheMinted has copy, drop {
        message_id: vector<u8>,
        source_chain_id: u64,
        source_nonce: u64,
        source_tx_hash: vector<u8>,
        recipient: address,
        amount: u64,
        minted_by: address,
    }

    public struct CacheBurnedForBase has copy, drop {
        sender: address,
        amount: u64,
        base_recipient: vector<u8>,
    }

    public struct AttesterAdded has copy, drop {
        public_key: vector<u8>,
        actor: address,
    }

    public struct AttesterRemoved has copy, drop {
        public_key: vector<u8>,
        actor: address,
    }

    public struct ThresholdUpdated has copy, drop {
        old_threshold: u64,
        new_threshold: u64,
        actor: address,
    }

    public struct PauseUpdated has copy, drop {
        paused: bool,
        actor: address,
    }

    #[allow(deprecated_usage)]
    fun init(witness: CACHE, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency(
            witness,
            6,
            b"CACHE",
            b"CACHE",
            b"CACHE stablecoin minted on Sui against confirmed Base USDC deposits",
            option::none<url::Url>(),
            ctx,
        );

        transfer::public_freeze_object(metadata);

        let state = BridgeState {
            id: object::new(ctx),
            treasury_cap,
            used_message_ids: table::new(ctx),
            attesters: vec_map::empty<vector<u8>, bool>(),
            threshold: 1,
            paused: true,
        };

        let admin = AdminCap { id: object::new(ctx) };

        transfer::share_object(state);
        transfer::transfer(admin, tx_context::sender(ctx));
    }

    public fun build_mint_payload_bytes(
        source_chain_id: u64,
        source_nonce: u64,
        source_tx_hash: vector<u8>,
        recipient: address,
        amount: u64,
    ): vector<u8> {
        let payload = MintPayload {
            source_chain_id,
            source_nonce,
            source_tx_hash,
            recipient,
            amount,
        };
        bcs::to_bytes(&payload)
    }

    public fun payload_message_id(payload_bytes: &vector<u8>): vector<u8> {
        hash::keccak256(payload_bytes)
    }

    public fun add_attester(
        state: &mut BridgeState,
        _admin: &AdminCap,
        public_key: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(!vec_map::contains(&state.attesters, &public_key), E_ATTESTER_ALREADY_EXISTS);
        vec_map::insert(&mut state.attesters, copy public_key, true);
        event::emit(AttesterAdded {
            public_key,
            actor: tx_context::sender(ctx),
        });
    }

    public fun remove_attester(
        state: &mut BridgeState,
        _admin: &AdminCap,
        public_key: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(vec_map::contains(&state.attesters, &public_key), E_ATTESTER_NOT_FOUND);
        let (_k, _v) = vec_map::remove(&mut state.attesters, &public_key);
        assert!(state.threshold <= vec_map::length(&state.attesters), E_THRESHOLD_INVALID);

        event::emit(AttesterRemoved {
            public_key,
            actor: tx_context::sender(ctx),
        });
    }

    public fun set_threshold(
        state: &mut BridgeState,
        _admin: &AdminCap,
        new_threshold: u64,
        ctx: &mut TxContext,
    ) {
        assert!(new_threshold > 0, E_THRESHOLD_INVALID);
        assert!(new_threshold <= vec_map::length(&state.attesters), E_THRESHOLD_INVALID);

        let old_threshold = state.threshold;
        state.threshold = new_threshold;

        event::emit(ThresholdUpdated {
            old_threshold,
            new_threshold,
            actor: tx_context::sender(ctx),
        });
    }

    public fun set_paused(
        state: &mut BridgeState,
        _admin: &AdminCap,
        paused: bool,
        ctx: &mut TxContext,
    ) {
        state.paused = paused;
        event::emit(PauseUpdated {
            paused,
            actor: tx_context::sender(ctx),
        });
    }

    /// Mint CACHE after off-chain attesters sign the canonical payload.
    ///
    /// Each public key must be allowlisted in `state.attesters` and unique in the call.
    /// Message replay is prevented by storing `keccak256(payload_bytes)` in `used_message_ids`.
    public fun mint_from_attestation(
        state: &mut BridgeState,
        source_chain_id: u64,
        source_nonce: u64,
        source_tx_hash: vector<u8>,
        recipient: address,
        amount: u64,
        public_keys: vector<vector<u8>>,
        signatures: vector<vector<u8>>,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(amount > 0, E_ZERO_AMOUNT);
        assert!(vector::length(&source_tx_hash) == BASE_TX_HASH_BYTES, E_INVALID_SOURCE_TX_HASH);

        let payload = MintPayload {
            source_chain_id,
            source_nonce,
            source_tx_hash: copy source_tx_hash,
            recipient,
            amount,
        };
        let payload_bytes = bcs::to_bytes(&payload);
        let message_id = hash::keccak256(&payload_bytes);

        assert!(
            !table::contains(&state.used_message_ids, copy message_id),
            E_MESSAGE_ALREADY_USED,
        );

        verify_attestations(state, &payload_bytes, public_keys, signatures);

        table::add(&mut state.used_message_ids, copy message_id, true);

        let minted = coin::mint(&mut state.treasury_cap, amount, ctx);
        transfer::public_transfer(minted, recipient);

        event::emit(CacheMinted {
            message_id,
            source_chain_id,
            source_nonce,
            source_tx_hash,
            recipient,
            amount,
            minted_by: tx_context::sender(ctx),
        });
    }

    /// Burn CACHE on Sui and emit an event for off-chain redemption on Base.
    public fun burn_for_base(
        state: &mut BridgeState,
        burn_coin: Coin<CACHE>,
        base_recipient: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(vector::length(&base_recipient) == BASE_RECIPIENT_BYTES, E_INVALID_BASE_RECIPIENT);

        let amount = coin::burn(&mut state.treasury_cap, burn_coin);
        assert!(amount > 0, E_ZERO_AMOUNT);

        event::emit(CacheBurnedForBase {
            sender: tx_context::sender(ctx),
            amount,
            base_recipient,
        });
    }

    public fun threshold(state: &BridgeState): u64 {
        state.threshold
    }

    public fun attester_count(state: &BridgeState): u64 {
        vec_map::length(&state.attesters)
    }

    public fun is_paused(state: &BridgeState): bool {
        state.paused
    }

    public fun is_message_used(state: &BridgeState, message_id: vector<u8>): bool {
        table::contains(&state.used_message_ids, message_id)
    }

    fun verify_attestations(
        state: &BridgeState,
        payload_bytes: &vector<u8>,
        public_keys: vector<vector<u8>>,
        signatures: vector<vector<u8>>,
    ) {
        let key_count = vector::length(&public_keys);
        let sig_count = vector::length(&signatures);
        assert!(key_count == sig_count, E_SIGNATURE_LENGTH_MISMATCH);
        assert!(key_count >= state.threshold, E_THRESHOLD_NOT_MET);

        let mut seen = vec_set::empty<vector<u8>>();
        let mut approved: u64 = 0;
        let mut i: u64 = 0;
        while (i < key_count) {
            let pk = *vector::borrow(&public_keys, i);
            let sig_ref = vector::borrow(&signatures, i);

            assert!(vec_map::contains(&state.attesters, &pk), E_UNAUTHORIZED_ATTESTER);
            assert!(!vec_set::contains(&seen, &pk), E_DUPLICATE_ATTESTER);
            assert!(ed25519::ed25519_verify(sig_ref, &pk, payload_bytes), E_INVALID_SIGNATURE);

            vec_set::insert(&mut seen, pk);
            approved = approved + 1;
            i = i + 1;
        };

        assert!(approved >= state.threshold, E_THRESHOLD_NOT_MET);
    }
}
