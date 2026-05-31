// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title CasterCycleTokenTrophyVault
/// @notice Owner-funded, skill-result token trophies for closed CasterCycle leaderboards.
/// The contract cannot mint. It only transfers tokens already deposited into this vault.
contract CasterCycleTokenTrophyVault is Ownable, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant TOKEN_TROPHY_CLAIM_TYPEHASH = keccak256(
        "TokenTrophyClaim(address to,uint256 fid,bytes32 periodKey,uint256 score,uint256 amount,bytes32 claimId,uint256 deadline)"
    );

    IERC20 public immutable rewardToken;
    address public rewardSigner;
    uint256 public maxClaimAmount;

    mapping(bytes32 claimId => bool used) public usedClaim;

    error AlreadyClaimed();
    error BadAmount();
    error BadSignature();
    error ClaimExpired();
    error NotClaimRecipient();
    error TransferFailed();
    error ZeroAddress();

    event RewardSignerUpdated(address indexed signer);
    event MaxClaimAmountUpdated(uint256 amount);
    event TokenTrophyClaimed(
        address indexed to,
        uint256 indexed fid,
        bytes32 indexed claimId,
        bytes32 periodKey,
        uint256 score,
        uint256 amount
    );

    constructor(
        address initialOwner,
        address token,
        address initialRewardSigner,
        uint256 maxClaimAmount_
    )
        Ownable(initialOwner)
        EIP712("CasterCycle Token Trophies", "1")
    {
        if (initialOwner == address(0) || token == address(0) || initialRewardSigner == address(0)) {
            revert ZeroAddress();
        }
        if (maxClaimAmount_ == 0) revert BadAmount();

        rewardToken = IERC20(token);
        rewardSigner = initialRewardSigner;
        maxClaimAmount = maxClaimAmount_;

        emit RewardSignerUpdated(initialRewardSigner);
        emit MaxClaimAmountUpdated(maxClaimAmount_);
    }

    receive() external payable {}

    function claim(
        address to,
        uint256 fid,
        bytes32 periodKey,
        uint256 score,
        uint256 amount,
        bytes32 claimId,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if (msg.sender != to) revert NotClaimRecipient();
        if (block.timestamp > deadline) revert ClaimExpired();
        if (usedClaim[claimId]) revert AlreadyClaimed();
        if (amount == 0 || amount > maxClaimAmount) revert BadAmount();

        bytes32 structHash = keccak256(
            abi.encode(TOKEN_TROPHY_CLAIM_TYPEHASH, to, fid, periodKey, score, amount, claimId, deadline)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != rewardSigner) revert BadSignature();

        usedClaim[claimId] = true;
        rewardToken.safeTransfer(to, amount);

        emit TokenTrophyClaimed(to, fid, claimId, periodKey, score, amount);
    }

    function setRewardSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        rewardSigner = signer;
        emit RewardSignerUpdated(signer);
    }

    function setMaxClaimAmount(uint256 amount) external onlyOwner {
        if (amount == 0) revert BadAmount();
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
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    function recoverETH(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
