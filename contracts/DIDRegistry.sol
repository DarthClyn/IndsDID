// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DIDRegistry {
    address public owner;

    mapping(address => bool) public verified;
    mapping(address => uint256) public commitments; // NEW: Stores the ZK commitment
    mapping(address => uint256) public verifiedAt;
    uint256 public totalVerified;

    event Whitelisted(address indexed user, uint256 commitment, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "DIDRegistry: Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // UPDATED: Now accepts the commitment hash
    function whitelist(address user, uint256 commitment) external onlyOwner {
        require(!verified[user], "DIDRegistry: Already verified");
        verified[user] = true;
        commitments[user] = commitment; // Store it here
        verifiedAt[user] = block.timestamp;
        totalVerified++;
        emit Whitelisted(user, commitment, block.timestamp);
    }

    function isVerified(address user) external view returns (bool) {
        return verified[user];
    }

    // NEW: Function to return the commitment for the Bridge to check
    function getCommitment(address user) external view returns (uint256) {
        return commitments[user];
    }
}