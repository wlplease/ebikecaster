// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

//  ╔═══════════════════════════════════════════════════════════╗
//  ║                                                           ║
//  ║    ██████╗ ██████╗  ██████╗     ██████╗  █████╗ ███████╗ ║
//  ║    ██╔══██╗██╔══██╗██╔═══██╗    ██╔══██╗██╔══██╗██╔════╝ ║
//  ║    ██████╔╝██████╔╝██║   ██║    ██████╔╝███████║███████╗ ║
//  ║    ██╔═══╝ ██╔══██╗██║   ██║    ██╔═══╝ ██╔══██║╚════██║ ║
//  ║    ██║     ██║  ██║╚██████╔╝    ██║     ██║  ██║███████║ ║
//  ║    ╚═╝     ╚═╝  ╚═╝ ╚═════╝     ╚═╝     ╚═╝  ╚═╝╚══════╝ ║
//  ║                                                           ║
//  ║    Farbits Ecosystem Pro Pass                             ║
//  ║    Soulbound ERC-721 · USDC subscription · 30-day cycle  ║
//  ║    $2.10/month — supports servers, APIs, and dev          ║
//  ║                                                           ║
//  ╚═══════════════════════════════════════════════════════════╝

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @title ProPass — Farbits Ecosystem Pro Pass
/// @author sugarz
/// @notice Soulbound ERC-721 subscription NFT. Pay USDC monthly for Pro features.
///         Non-transferable (soulbound). Burn allowed to cancel.
///
/// Security features:
///   - Ownable2Step: 2-step ownership transfer prevents accidental loss
///   - Pausable: owner can pause subscriptions in emergencies
///   - ReentrancyGuard: prevents reentrancy on subscribe/withdraw
///   - SafeERC20: safe token transfer handling
///   - Emergency withdrawal: recover any stuck tokens or ETH
///   - Revoke access: owner can revoke abusive users
///   - Soulbound: transfers blocked, only mint/burn allowed
///   - On-chain metadata: NFT image and attributes fully on-chain
contract ProPass is ERC721, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    // ═══════════════════════════════════════════════════════════
    //  Errors
    // ═══════════════════════════════════════════════════════════

    error TransferDisabled();
    error PriceTooLow();
    error NoTokenToRevoke();
    error ZeroAddress();
    error ZeroDays();

    // ═══════════════════════════════════════════════════════════
    //  Constants & State
    // ═══════════════════════════════════════════════════════════

    /// @notice Base USDC contract address (6 decimals)
    IERC20 public immutable usdc;

    /// @notice Subscription duration per payment (30 days)
    uint256 public constant DURATION = 30 days;

    /// @notice Minimum allowed price ($0.01 = 10_000 in USDC 6 decimals)
    uint256 public constant MIN_PRICE = 10_000;

    /// @notice Current subscription price in USDC (6 decimals)
    uint256 public price;

    /// @notice Token ID counter (starts at 1, 0 means "no token")
    uint256 private _nextTokenId;

    /// @notice Total unique subscribers ever (for analytics)
    uint256 public totalSubscribers;

    /// @notice Total USDC revenue collected (for analytics)
    uint256 public totalRevenue;

    /// @notice NFT image URI — owner-updatable
    string public imageURI;

    /// @notice Mapping: address -> tokenId (0 = no token)
    mapping(address => uint256) public tokenOf;

    /// @notice Mapping: tokenId -> expiry timestamp
    mapping(uint256 => uint256) public tokenExpiry;

    /// @notice Mapping: tokenId -> owner address (reverse lookup for metadata)
    mapping(uint256 => address) private _tokenOwner;

    // ═══════════════════════════════════════════════════════════
    //  Events
    // ═══════════════════════════════════════════════════════════

    event Subscribed(address indexed subscriber, uint256 indexed tokenId, uint256 expiresAt, uint256 pricePaid);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event AccessGranted(address indexed recipient, uint256 indexed tokenId, uint256 daysGranted, uint256 expiresAt);
    event AccessRevoked(address indexed account, uint256 indexed tokenId);
    event Withdrawn(address indexed to, uint256 amount);
    event EmergencyTokenWithdrawn(address indexed token, address indexed to, uint256 amount);
    event EmergencyETHWithdrawn(address indexed to, uint256 amount);
    event ImageURIUpdated(string newURI);

    // ═══════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════

    /// @param _usdc Address of the USDC token on Base
    /// @param _price Initial price in USDC smallest unit (2_100_000 = $2.10)
    /// @param _imageURI IPFS/HTTP URI for the NFT image
    constructor(
        address _usdc,
        uint256 _price,
        string memory _imageURI
    ) ERC721("Farbits Pro Pass", "PROPASS") Ownable(msg.sender) {
        if (_usdc == address(0)) revert ZeroAddress();
        if (_price < MIN_PRICE) revert PriceTooLow();
        usdc = IERC20(_usdc);
        price = _price;
        imageURI = _imageURI;
        _nextTokenId = 1;
    }

    // ═══════════════════════════════════════════════════════════
    //  Soulbound — disable all transfers
    // ═══════════════════════════════════════════════════════════

    /// @dev Override to prevent transfers. Only mint (from 0x0) and burn (to 0x0) allowed.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert TransferDisabled();
        }
        // Track reverse lookup for metadata
        if (to != address(0)) {
            _tokenOwner[tokenId] = to;
        } else {
            delete _tokenOwner[tokenId];
        }
        return super._update(to, tokenId, auth);
    }

    // ═══════════════════════════════════════════════════════════
    //  On-Chain Metadata
    // ═══════════════════════════════════════════════════════════

    /// @notice Returns fully on-chain JSON metadata for the NFT
    /// @dev Includes dynamic attributes: status, expiry, days remaining
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        uint256 expiry = tokenExpiry[tokenId];
        bool active = expiry > block.timestamp;
        uint256 daysLeft = active ? (expiry - block.timestamp) / 1 days : 0;

        // Split into parts to avoid stack-too-deep
        string memory part1 = string(
            abi.encodePacked(
                '{"name":"Farbits Pro Pass #', tokenId.toString(),
                '","description":"Farbits Ecosystem Pro Member Pass. Soulbound subscription NFT granting Pro features across all Farbits apps.',
                '","image":"', imageURI,
                '","external_url":"https://farcaster.xyz/miniapps/0AJya2542oCb/farbits"'
            )
        );

        string memory part2 = string(
            abi.encodePacked(
                ',"attributes":[',
                '{"trait_type":"Status","value":"', active ? "Active" : "Expired", '"},',
                '{"trait_type":"Days Remaining","display_type":"number","value":', daysLeft.toString(), '},'
            )
        );

        string memory part3 = string(
            abi.encodePacked(
                '{"trait_type":"Expires","display_type":"date","value":', expiry.toString(), '},',
                '{"trait_type":"Token ID","display_type":"number","value":', tokenId.toString(), '},',
                '{"trait_type":"Type","value":"Soulbound"},',
                '{"trait_type":"Tier","value":"Pro Member"}',
                ']}'
            )
        );

        string memory json = string(abi.encodePacked(part1, part2, part3));

        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64.encode(bytes(json))
            )
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  Subscribe
    // ═══════════════════════════════════════════════════════════

    /// @notice Subscribe or extend Pro Pass. Approve USDC first.
    function subscribe() external nonReentrant whenNotPaused {
        usdc.safeTransferFrom(msg.sender, address(this), price);
        totalRevenue += price;

        uint256 tokenId = tokenOf[msg.sender];

        if (tokenId == 0) {
            tokenId = _nextTokenId++;
            _mint(msg.sender, tokenId);
            tokenOf[msg.sender] = tokenId;
            tokenExpiry[tokenId] = block.timestamp + DURATION;
            totalSubscribers++;
        } else {
            uint256 current = tokenExpiry[tokenId];
            uint256 base = current > block.timestamp ? current : block.timestamp;
            tokenExpiry[tokenId] = base + DURATION;
        }

        emit Subscribed(msg.sender, tokenId, tokenExpiry[tokenId], price);
    }

    // ═══════════════════════════════════════════════════════════
    //  View Functions
    // ═══════════════════════════════════════════════════════════

    /// @notice Check if an address has an active (non-expired) Pro Pass
    function isActive(address account) external view returns (bool) {
        uint256 tokenId = tokenOf[account];
        if (tokenId == 0) return false;
        return tokenExpiry[tokenId] > block.timestamp;
    }

    /// @notice Get the expiry timestamp for an address's Pro Pass
    function expiresAt(address account) external view returns (uint256) {
        uint256 tokenId = tokenOf[account];
        if (tokenId == 0) return 0;
        return tokenExpiry[tokenId];
    }

    /// @notice Get remaining seconds of an address's Pro Pass
    function timeRemaining(address account) external view returns (uint256) {
        uint256 tokenId = tokenOf[account];
        if (tokenId == 0) return 0;
        uint256 expiry = tokenExpiry[tokenId];
        if (expiry <= block.timestamp) return 0;
        return expiry - block.timestamp;
    }

    /// @notice Get total USDC balance held by this contract
    function contractBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    // ═══════════════════════════════════════════════════════════
    //  User Functions
    // ═══════════════════════════════════════════════════════════

    /// @notice Burn your own Pro Pass (cancel subscription, no refund)
    function burn(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "Not your token");
        tokenOf[msg.sender] = 0;
        _burn(tokenId);
    }

    // ═══════════════════════════════════════════════════════════
    //  Owner Functions
    // ═══════════════════════════════════════════════════════════

    /// @notice Withdraw all collected USDC to owner
    function withdraw() external onlyOwner nonReentrant {
        uint256 bal = usdc.balanceOf(address(this));
        require(bal > 0, "Nothing to withdraw");
        usdc.safeTransfer(owner(), bal);
        emit Withdrawn(owner(), bal);
    }

    /// @notice Withdraw a specific amount of USDC to owner
    function withdrawAmount(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Zero amount");
        uint256 bal = usdc.balanceOf(address(this));
        require(amount <= bal, "Exceeds balance");
        usdc.safeTransfer(owner(), amount);
        emit Withdrawn(owner(), amount);
    }

    /// @notice Update subscription price (must be >= $0.01)
    function setPrice(uint256 newPrice) external onlyOwner {
        if (newPrice < MIN_PRICE) revert PriceTooLow();
        uint256 oldPrice = price;
        price = newPrice;
        emit PriceUpdated(oldPrice, newPrice);
    }

    /// @notice Update the NFT image URI
    function setImageURI(string calldata newURI) external onlyOwner {
        imageURI = newURI;
        emit ImageURIUpdated(newURI);
    }

    /// @notice Grant complimentary access to an address
    function grantAccess(address recipient, uint256 days_) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        if (days_ == 0) revert ZeroDays();

        uint256 tokenId = tokenOf[recipient];

        if (tokenId == 0) {
            tokenId = _nextTokenId++;
            _mint(recipient, tokenId);
            tokenOf[recipient] = tokenId;
            tokenExpiry[tokenId] = block.timestamp + (days_ * 1 days);
            totalSubscribers++;
        } else {
            uint256 current = tokenExpiry[tokenId];
            uint256 base = current > block.timestamp ? current : block.timestamp;
            tokenExpiry[tokenId] = base + (days_ * 1 days);
        }

        emit AccessGranted(recipient, tokenId, days_, tokenExpiry[tokenId]);
    }

    /// @notice Revoke a user's Pro Pass (for abuse cases)
    function revokeAccess(address account) external onlyOwner {
        uint256 tokenId = tokenOf[account];
        if (tokenId == 0) revert NoTokenToRevoke();
        tokenOf[account] = 0;
        _burn(tokenId);
        emit AccessRevoked(account, tokenId);
    }

    // ═══════════════════════════════════════════════════════════
    //  Emergency Functions (Owner Only)
    // ═══════════════════════════════════════════════════════════

    /// @notice Pause subscriptions (emergency stop)
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause subscriptions
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Emergency: recover any ERC-20 token sent to this contract
    function emergencyWithdrawToken(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        IERC20 tok = IERC20(token);
        uint256 bal = tok.balanceOf(address(this));
        uint256 toSend = amount == 0 ? bal : amount;
        require(toSend > 0 && toSend <= bal, "Invalid amount");
        tok.safeTransfer(to, toSend);
        emit EmergencyTokenWithdrawn(token, to, toSend);
    }

    /// @notice Emergency: recover any ETH sent to this contract
    function emergencyWithdrawETH(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = address(this).balance;
        require(bal > 0, "No ETH");
        (bool ok,) = to.call{value: bal}("");
        require(ok, "ETH transfer failed");
        emit EmergencyETHWithdrawn(to, bal);
    }

    /// @notice Allow contract to receive ETH (so emergency withdrawal works)
    receive() external payable {}
}
