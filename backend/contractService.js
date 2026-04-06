const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// ─── DIDRegistry ABI ─────────────────────────────────────────────────────────
// const REGISTRY_ABI = [
//   "function whitelist(address user) external",
//   "function isVerified(address user) external view returns (bool)",
//   "function verifiedAt(address user) external view returns (uint256)",
//   "function totalVerified() external view returns (uint256)",
//   "event Whitelisted(address indexed user, uint256 timestamp)",
// ];
// ─── DIDRegistry ABI ─────────────────────────────────────────────────────────
const REGISTRY_ABI = [
  // UPDATED: Now accepts two arguments to match your new .sol file
  "function whitelist(address user, uint256 commitment) external", 
  "function isVerified(address user) external view returns (bool)",
  "function getCommitment(address user) external view returns (uint256)", // Ensure this is also added
  "function verifiedAt(address user) external view returns (uint256)",
  "function totalVerified() external view returns (uint256)",
  "event Whitelisted(address indexed user, uint256 commitment, uint256 timestamp)",
];

// ─── CrossBorderBridge ABI ───────────────────────────────────────────────────
const BRIDGE_ABI = [
  "function sendCrossBorder(address payable recipient, string calldata fromCountry, string calldata toCountry) external payable returns (uint256 txId)",
  "function canTransact(address user) external view returns (bool)",
  "function getTransfer(uint256 txId) external view returns (tuple(address sender, address recipient, uint256 amount, string fromCountry, string toCountry, uint256 timestamp, bool settled))",
  "function totalTransactions() external view returns (uint256)",
  "function totalVolume() external view returns (uint256)",
  "event CrossBorderTransfer(uint256 indexed txId, address indexed sender, address indexed recipient, uint256 amount, string fromCountry, string toCountry, uint256 timestamp)",
];


function getProvider() {
  // Contracts are deployed on Ethereum Sepolia — use SEPOLIA_RPC_URL
  const rpc = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  return new ethers.JsonRpcProvider(rpc);
}

function getAdminWallet() {
  return new ethers.Wallet(`0x${process.env.PRIVATE_KEY}`, getProvider());
}

function getRegistry(signer) {
  return new ethers.Contract(process.env.CONTRACT_ADDRESS, REGISTRY_ABI, signer || getProvider());
}

function getBridge(signer) {
  return new ethers.Contract(process.env.BRIDGE_ADDRESS, BRIDGE_ABI, signer || getProvider());
}

// ─── Whitelist wallet in DIDRegistry (called after KYC passes) ───────────────
// async function whitelistWallet(walletAddress) {
//   if (!process.env.CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

//   console.log("[Chain] Whitelisting wallet:", walletAddress);
//   const wallet = getAdminWallet();
//   const registry = getRegistry(wallet);

//   const tx = await registry.whitelist(walletAddress);
//   console.log("[Chain] Whitelist TX sent:", tx.hash);
//   const receipt = await tx.wait();
//   console.log("[Chain] Confirmed in block:", receipt.blockNumber);

//   return {
//     txHash: tx.hash,
//     blockNumber: receipt.blockNumber,
//     polygonscanUrl: `https://sepolia.etherscan.io/tx/${tx.hash}`,
//     contractAddress: process.env.CONTRACT_ADDRESS,
//   };
// }
async function whitelistWallet(walletAddress, commitment) {
  const wallet = getAdminWallet();
  const registry = getRegistry(wallet);
  // Pass both wallet address and the commitment string/number
  const tx = await registry.whitelist(walletAddress, commitment); 
  return await tx.wait();
}

// ─── Check KYC verification status (read-only) ───────────────────────────────
// async function checkVerification(walletAddress) {
//   if (!process.env.CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

//   const registry = getRegistry();
//   try {
//     const isVerified = await registry.isVerified(walletAddress);
//     let verifiedAt = null;
//     if (isVerified) {
//       try {
//         const ts = await registry.verifiedAt(walletAddress);
//         verifiedAt = new Date(Number(ts) * 1000).toISOString();
//       } catch (tsErr) {
//         console.warn("[Registry] Could not fetch verifiedAt:", tsErr.message);
//       }
//     }
//     const total = await registry.totalVerified();
//     return { isVerified, verifiedAt, totalVerified: Number(total) };
//   } catch (err) {
//     console.error(`[Registry] checkVerification failed for ${walletAddress}:`, err.message);
//     throw new Error(`Contract error: ${err.message}`);
//   }
// }
async function checkVerification(walletAddress) {
  if (!process.env.CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

  const registry = getRegistry();
  try {
    const isVerified = await registry.isVerified(walletAddress);
    
    // NEW: Fetch the commitment from the mapping we added to DIDRegistry.sol
    let commitment = "0";
    let verifiedAt = null;

    if (isVerified) {
      try {
        // Call the new getter we added to the contract
        const c = await registry.getCommitment(walletAddress);
        commitment = c.toString(); 

        const ts = await registry.verifiedAt(walletAddress);
        verifiedAt = new Date(Number(ts) * 1000).toISOString();
      } catch (err) {
        console.warn("[Registry] Could not fetch extra data:", err.message);
      }
    }

    const total = await registry.totalVerified();
    
    // Ensure 'commitment' is included in the returned object
    return { 
      isVerified, 
      verifiedAt, 
      commitment, 
      totalVerified: Number(total) 
    };
  } catch (err) {
    console.error(`[Registry] checkVerification failed:`, err.message);
    throw new Error(`Contract error: ${err.message}`);
  }
}


// ─── Execute cross-border transfer (admin/relayer flow - DISCOURAGED for UI) ─
// NOTE: The preferred flow for the dApp is that the user's own wallet
// directly calls `sendCrossBorder` from the browser (see frontend/index.html).
// This helper remains only for backend/relayer experiments and still enforces
// that the mapped `sender` is verified in the DID registry before sending.
async function executeCrossBorderTransfer(sender, recipient, amountEth) {
  if (!process.env.BRIDGE_ADDRESS) throw new Error("BRIDGE_ADDRESS not set");

  console.log(`[Bridge] (Relayer) Executing transfer for ${sender} -> ${recipient} (${amountEth} MATIC)`);

  // 1) Ensure the claimed sender is KYC-verified in the registry.
  const registry = getRegistry();
  const isVerified = await registry.isVerified(sender);
  if (!isVerified) {
    throw new Error(`Identity mismatch: Wallet ${sender} is NOT whitelisted on-chain.`);
  }

  // 2) Relayer/admin wallet performs the actual bridge call.
  const wallet = getAdminWallet();
  const bridge = getBridge(wallet);

  const amountWei = ethers.parseEther(amountEth.toString());
  const tx = await bridge.sendCrossBorder(recipient, "Indonesia", "Vietnam", {
    value: amountWei,
    gasLimit: 500000,
  });

  console.log("[Bridge] Transfer TX sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("[Bridge] Confirmed in block:", receipt.blockNumber);

  return {
    hash: tx.hash,
    blockNumber: receipt.blockNumber,
    from: sender,
    to: recipient,
    amount: amountEth,
  };
}

// ─── Get bridge stats ────────────────────────────────────────────────────────
async function getBridgeStats() {
  if (!process.env.BRIDGE_ADDRESS) return null;
  const bridge = getBridge();
  try {
    const [total, volume] = await Promise.all([
      bridge.totalTransactions(),
      bridge.totalVolume(),
    ]);
    return {
      totalTransactions: Number(total),
      totalVolumeEth: ethers.formatEther(volume),
      bridgeAddress: process.env.BRIDGE_ADDRESS,
      registryAddress: process.env.CONTRACT_ADDRESS,
    };
  } catch (err) {
    console.error("[Bridge] getBridgeStats failed:", err.message);
    return null;
  }
}

module.exports = {
  whitelistWallet,
  checkVerification,
  executeCrossBorderTransfer,
  getBridgeStats,
};

