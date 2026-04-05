// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDIDRegistry {
    function isVerified(address user) external view returns (bool);
}

/// @title Universal Verifier interface for Polygon ID proofs
/// @notice This abstracts the Polygon ID Universal Verifier contract.
///         The proof payload shape is a tuple of:
///         - requestId: uint64          (query / request identifier)
///         - inputs: uint256[]          (public inputs bound to the query)
///         - proof: uint256[8]          (Groth16 proof elements)
interface IUniversalVerifier {
    struct Proof {
        uint64 requestId;
        uint256[] inputs;
        uint256[8] proof;
    }

    function verify(Proof calldata proof) external view returns (bool);
}

contract CrossBorderBridge {

    IDIDRegistry public immutable didRegistry;
    IUniversalVerifier public immutable universalVerifier;
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

    event TransferSettled(uint256 indexed txId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    /// @dev This is the identity proof gate.
    ///      Checks the DIDRegistry (KYC whitelist) — no personal data read.
    ///      In a ZKP upgrade: replace this check with a Groth16 verifier.verifyProof() call.
    modifier onlyVerified() {
        require(
            didRegistry.isVerified(msg.sender),
            "CrossBorderBridge: Sender not KYC verified. Complete Indonesia KYC first."
        );
        _;
    }

    constructor(address _didRegistry, address _universalVerifier) {
        didRegistry = IDIDRegistry(_didRegistry);
        universalVerifier = IUniversalVerifier(_universalVerifier);
        owner = msg.sender;
    }

    /// @notice Send ETH cross-border. Only KYC-verified senders allowed.
    /// @param recipient   Destination wallet address (e.g. Vietnam wallet)
    /// @param fromCountry Label e.g. "Indonesia"
    /// @param toCountry   Label e.g. "Vietnam"
    /// @return txId       Sequential transaction ID for this bridge
    /**
     * @dev Execute cross-border transfer on behalf of a verified user (Admin/Relayer flow)
     * @param sender The KYC-verified user who is "sending" the funds
     * @param recipient The recipient in the destination country
     * @param fromCountry Origin country string
     * @param toCountry Destination country string
     */
    function sendCrossBorderOnBehalf(
        address sender,
        address payable recipient,
        string calldata fromCountry,
        string calldata toCountry,
        IUniversalVerifier.Proof calldata proof
    ) external payable onlyOwner returns (uint256 txId) {
        // 1. Check DID registry for initial KYC status
        require(didRegistry.isVerified(sender), "CrossBorderBridge: Sender not KYC verified");
        
        // 2. Verify Polygon ID proof via Universal Verifier
        //    The underlying query (requestId) encodes the score threshold / KYC policy.
        require(universalVerifier.verify(proof), "CrossBorderBridge: Polygon ID proof invalid");
        
        require(msg.value > 0, "CrossBorderBridge: Amount must be > 0");

        totalTransactions++;
        txId = totalTransactions;
        totalVolume += msg.value;

        Transfer memory newTransfer = Transfer({
            sender: sender,
            recipient: recipient,
            amount: msg.value,
            fromCountry: fromCountry,
            toCountry: toCountry,
            timestamp: block.timestamp,
            settled: true
        });

        transfers[txId] = newTransfer;

        (bool sent, ) = recipient.call{value: msg.value}("");
        require(sent, "CrossBorderBridge: ETH transfer failed");

        emit CrossBorderTransfer(txId, sender, recipient, msg.value, fromCountry, toCountry, block.timestamp);
    }

    function sendCrossBorder(
        address payable recipient,
        string calldata fromCountry,
        string calldata toCountry
    ) external payable onlyVerified returns (uint256 txId) {
        require(msg.value > 0, "CrossBorderBridge: Amount must be > 0");
        require(recipient != address(0), "CrossBorderBridge: Invalid recipient");
        require(recipient != msg.sender, "CrossBorderBridge: Cannot send to self");

        txId = ++totalTransactions;
        totalVolume += msg.value;

        transfers[txId] = Transfer({
            sender: msg.sender,
            recipient: recipient,
            amount: msg.value,
            fromCountry: fromCountry,
            toCountry: toCountry,
            timestamp: block.timestamp,
            settled: false
        });

        // Execute the actual ETH transfer to recipient
        (bool sent, ) = recipient.call{value: msg.value}("");
        require(sent, "CrossBorderBridge: ETH transfer failed");

        transfers[txId].settled = true;

        emit CrossBorderTransfer(
            txId, msg.sender, recipient,
            msg.value, fromCountry, toCountry, block.timestamp
        );
        emit TransferSettled(txId);
    }

    /// @notice Get full details of a past transfer
    function getTransfer(uint256 txId) external view returns (Transfer memory) {
        return transfers[txId];
    }

    /// @notice Check if a wallet can initiate cross-border transfers (is KYC verified)
    function canTransact(address user) external view returns (bool) {
        return didRegistry.isVerified(user);
    }

    receive() external payable {}
}
