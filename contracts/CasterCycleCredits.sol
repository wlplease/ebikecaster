// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title CasterCycleCredits
/// @notice Non-transferable gameplay credits for CasterCycle. Credits have no cash value,
/// redemption, prize pool, or owner mint. Users pay gas only when they choose to claim.
contract CasterCycleCredits is ERC20, Ownable, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant REWARD_CLAIM_TYPEHASH = keccak256(
        "RewardClaim(address to,uint256 fid,bytes32 dateKey,uint256 score,uint256 amount,bytes32 claimId,uint256 deadline)"
    );

    address public rewardSigner;
    uint256 public immutable maxSupply;
    uint256 public maxClaimAmount;

    mapping(bytes32 claimId => bool used) public usedClaim;

    error AlreadyClaimed();
    error BadAmount();
    error BadSignature();
    error ClaimExpired();
    error MaxSupplyExceeded();
    error NonTransferable();
    error NotClaimRecipient();
    error RecoverSelf();
    error TransferFailed();
    error ZeroAddress();

    event RewardSignerUpdated(address indexed signer);
    event MaxClaimAmountUpdated(uint256 amount);
    event CreditsClaimed(
        address indexed to,
        uint256 indexed fid,
        bytes32 indexed claimId,
        bytes32 dateKey,
        uint256 score,
        uint256 amount
    );

    constructor(
        address initialOwner,
        address initialRewardSigner,
        uint256 maxSupply_,
        uint256 maxClaimAmount_
    )
        ERC20("CasterCycle Credits", "CYCLE")
        Ownable(initialOwner)
        EIP712("CasterCycle Credits", "1")
    {
        if (initialOwner == address(0) || initialRewardSigner == address(0)) revert ZeroAddress();
        if (maxSupply_ == 0 || maxClaimAmount_ == 0 || maxClaimAmount_ > maxSupply_) revert BadAmount();

        rewardSigner = initialRewardSigner;
        maxSupply = maxSupply_;
        maxClaimAmount = maxClaimAmount_;

        emit RewardSignerUpdated(initialRewardSigner);
        emit MaxClaimAmountUpdated(maxClaimAmount_);
    }

    receive() external payable {}

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function claim(
        address to,
        uint256 fid,
        bytes32 dateKey,
        uint256 score,
        uint256 amount,
        bytes32 claimId,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused {
        if (msg.sender != to) revert NotClaimRecipient();
        if (block.timestamp > deadline) revert ClaimExpired();
        if (usedClaim[claimId]) revert AlreadyClaimed();
        if (amount == 0 || amount > maxClaimAmount) revert BadAmount();
        if (totalSupply() + amount > maxSupply) revert MaxSupplyExceeded();

        bytes32 structHash = keccak256(
            abi.encode(REWARD_CLAIM_TYPEHASH, to, fid, dateKey, score, amount, claimId, deadline)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != rewardSigner) revert BadSignature();

        usedClaim[claimId] = true;
        _mint(to, amount);

        emit CreditsClaimed(to, fid, claimId, dateKey, score, amount);
    }

    function burn(uint256 amount) external whenNotPaused {
        _burn(msg.sender, amount);
    }

    function setRewardSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        rewardSigner = signer;
        emit RewardSignerUpdated(signer);
    }

    function setMaxClaimAmount(uint256 amount) external onlyOwner {
        if (amount == 0 || amount > maxSupply) revert BadAmount();
        maxClaimAmount = amount;
        emit MaxClaimAmountUpdated(amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function recoverERC20(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(this)) revert RecoverSelf();
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    function recoverETH(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert NonTransferable();
        super._update(from, to, value);
    }
}
