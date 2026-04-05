// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DIDRegistry — GOE Alliance / TOTM KYC Whitelist
/// @notice Stores ONLY wallet verification status. Zero personal data on-chain.
contract DIDRegistry {
    address public owner;

    mapping(address => bool) public verified;
    mapping(address => uint256) public verifiedAt;
    uint256 public totalVerified;

    event Whitelisted(address indexed user, uint256 timestamp);
    event Revoked(address indexed user);

    modifier onlyOwner() {
        require(msg.sender == owner, "DIDRegistry: Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Whitelist a KYC-verified wallet. Only callable by admin backend.
    function whitelist(address user) external onlyOwner {
        require(!verified[user], "DIDRegistry: Already verified");
        verified[user] = true;
        verifiedAt[user] = block.timestamp;
        totalVerified++;
        emit Whitelisted(user, block.timestamp);
    }

    /// @notice Revoke verification for a wallet.
    function revokeVerification(address user) external onlyOwner {
        require(verified[user], "DIDRegistry: Not verified");
        verified[user] = false;
        totalVerified--;
        emit Revoked(user);
    }

    /// @notice Public check — anyone can verify a wallet without seeing any personal data.
    function isVerified(address user) external view returns (bool) {
        return verified[user];
    }

    /// @notice Transfer ownership to a new admin.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "DIDRegistry: Zero address");
        owner = newOwner;
    }
}
