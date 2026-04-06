// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// UPDATED: Added getCommitment to the interface
interface IDIDRegistry {
    function isVerified(address user) external view returns (bool);
    function getCommitment(address user) external view returns (uint256);
}

// Custom ZK Verifier interface
interface IVerifier {
    function verifyProof(uint[2] memory a, uint[2][2] memory b, uint[2] memory c, uint[2] memory input) external view returns (bool);
}

contract CrossBorderBridge {
    IVerifier public immutable zkVerifier;
    IDIDRegistry public immutable didRegistry;
    address public owner;

    uint256 public totalTransactions;
    uint256 public totalVolume;

    struct Transfer {
        address sender;
        address recipient;
        uint256 amount;
        string fromCountry;
        string toCountry;
        uint256 timestamp;
        bool settled;
    }

    mapping(uint256 => Transfer) public transfers;

    event CrossBorderTransfer(
        uint256 indexed txId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        string fromCountry,
        string toCountry,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    // UPDATED: Constructor now accepts your custom ZK Verifier address
    constructor(address _didRegistry, address _zkVerifier) {
        didRegistry = IDIDRegistry(_didRegistry);
        zkVerifier = IVerifier(_zkVerifier);
        owner = msg.sender;
    }

    // Direct cross-border transfer (Simplified for demo)
    function sendCrossBorder(
        address payable recipient,
        string calldata fromCountry,
        string calldata toCountry
    ) external payable returns (uint256 txId) {
        require(didRegistry.isVerified(msg.sender), "Not verified in registry");
        require(msg.value > 0, "Amount must be > 0");

        txId = ++totalTransactions;
        totalVolume += msg.value;

        transfers[txId] = Transfer({
            sender: msg.sender,
            recipient: recipient,
            amount: msg.value,
            fromCountry: fromCountry,
            toCountry: toCountry,
            timestamp: block.timestamp,
            settled: true
        });

        (bool sent, ) = recipient.call{value: msg.value}("");
        require(sent, "ETH transfer failed");

        emit CrossBorderTransfer(txId, msg.sender, recipient, msg.value, fromCountry, toCountry, block.timestamp);
    }

    // NEW: ZK-Verified Transfer
    function sendCrossBorderWithZK(
        address payable recipient,
        uint[2] memory a, uint[2][2] memory b, uint[2] memory c, uint[2] memory input
    ) external payable {
        // 1. Verify the ZKP mathematically via your custom Verifier.sol
        require(zkVerifier.verifyProof(a, b, c, input), "Invalid ZK Proof");

        // 2. Ensure the public commitment in the proof matches the registry
        // Note: input[1] matches the 'commitment' signal in your identity.circom
        require(didRegistry.getCommitment(msg.sender) == input[1], "Commitment mismatch");

        // 3. Execute Transfer
        (bool sent, ) = recipient.call{value: msg.value}("");
        require(sent, "Transfer failed");

        totalTransactions++;
        emit CrossBorderTransfer(totalTransactions, msg.sender, recipient, msg.value, "Indonesia", "Vietnam", block.timestamp);
    }

    receive() external payable {}
}