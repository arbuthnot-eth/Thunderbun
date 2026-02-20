// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @notice Base-side USDC vault for CACHE issuance on Sui.
/// @dev Emits deterministic deposit payload fields for attesters/relayers.
contract BaseVault {
    error NotOwner();
    error Paused();
    error InvalidAmount();
    error InvalidRecipient();
    error TransferFailed();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PauseUpdated(bool paused);
    event Deposit(
        uint64 indexed nonce,
        address indexed depositor,
        bytes32 indexed suiRecipient,
        uint256 amount,
        bytes32 depositId
    );

    address public owner;
    address public immutable usdc;
    bool public paused;
    uint64 public nextNonce;

    constructor(address usdc_) {
        owner = msg.sender;
        usdc = usdc_;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "newOwner=0");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PauseUpdated(paused_);
    }

    function deposit(uint256 amount, bytes32 suiRecipient)
        external
        whenNotPaused
        returns (uint64 nonce, bytes32 depositId)
    {
        return _deposit(msg.sender, amount, suiRecipient);
    }

    /// @notice Optional one-tx UX path for permit-compatible tokens.
    /// @dev Native Base USDC may not support EIP-2612 permit in all deployments.
    function depositWithPermit(
        uint256 amount,
        bytes32 suiRecipient,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused returns (uint64 nonce, bytes32 depositId) {
        IERC20Permit(usdc).permit(msg.sender, address(this), amount, deadline, v, r, s);
        return _deposit(msg.sender, amount, suiRecipient);
    }

    function _deposit(address depositor, uint256 amount, bytes32 suiRecipient)
        internal
        returns (uint64 nonce, bytes32 depositId)
    {
        if (amount == 0) revert InvalidAmount();
        if (suiRecipient == bytes32(0)) revert InvalidRecipient();

        bool ok = IERC20(usdc).transferFrom(depositor, address(this), amount);
        if (!ok) revert TransferFailed();

        nonce = ++nextNonce;
        depositId = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                nonce,
                depositor,
                suiRecipient,
                amount
            )
        );

        emit Deposit(nonce, depositor, suiRecipient, amount, depositId);
    }
}
