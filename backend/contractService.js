const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// ─── DIDRegistry ABI ─────────────────────────────────────────────────────────
const REGISTRY_ABI = [
  "function whitelist(address user) external",
  "function isVerified(address user) external view returns (bool)",
  "function verifiedAt(address user) external view returns (uint256)",
  "function totalVerified() external view returns (uint256)",
  "event Whitelisted(address indexed user, uint256 timestamp)",
];

// ─── CrossBorderBridge ABI ───────────────────────────────────────────────────
const BRIDGE_ABI = [
  "function sendCrossBorderOnBehalf(address sender, address payable recipient, string calldata fromCountry, string calldata toCountry, tuple(uint64 requestId, uint256[] inputs, uint256[8] proof) polygonProof) external payable returns (uint256 txId)",
  "function canTransact(address user) external view returns (bool)",
  "function getTransfer(uint256 txId) external view returns (tuple(address sender, address recipient, uint256 amount, string fromCountry, string toCountry, uint256 timestamp, bool settled))",
  "function totalTransactions() external view returns (uint256)",
  "function totalVolume() external view returns (uint256)",
  "event CrossBorderTransfer(uint256 indexed txId, address indexed sender, address indexed recipient, uint256 amount, string fromCountry, string toCountry, uint256 timestamp)",
];

function getProvider() {
  // Contracts are deployed on Polygon Amoy — use AMOY_RPC_URL
  const rpc = process.env.AMOY_RPC_URL || process.env.SEPOLIA_RPC_URL || "https://rpc-amoy.polygon.technology";
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
async function whitelistWallet(walletAddress) {
  if (!process.env.CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

  console.log("[Chain] Whitelisting wallet:", walletAddress);
  const wallet = getAdminWallet();
  const registry = getRegistry(wallet);

  const tx = await registry.whitelist(walletAddress);
  console.log("[Chain] Whitelist TX sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("[Chain] Confirmed in block:", receipt.blockNumber);

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    polygonscanUrl: `https://amoy.polygonscan.com/tx/${tx.hash}`,
    contractAddress: process.env.CONTRACT_ADDRESS,
  };
}

// ─── Check KYC verification status (read-only) ───────────────────────────────
async function checkVerification(walletAddress) {
  if (!process.env.CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

  const registry = getRegistry();
  try {
    const isVerified = await registry.isVerified(walletAddress);
    let verifiedAt = null;
    if (isVerified) {
      try {
        const ts = await registry.verifiedAt(walletAddress);
        verifiedAt = new Date(Number(ts) * 1000).toISOString();
      } catch (tsErr) {
        console.warn("[Registry] Could not fetch verifiedAt:", tsErr.message);
      }
    }
    const total = await registry.totalVerified();
    return { isVerified, verifiedAt, totalVerified: Number(total) };
  } catch (err) {
    console.error(`[Registry] checkVerification failed for ${walletAddress}:`, err.message);
    throw new Error(`Contract error: ${err.message}`);
  }
}

// Admin/relayer transfer path using Polygon Universal Verifier proof struct.
async function executeCrossBorderTransfer({ fromWallet, toWallet, amountEth, fromCountry, toCountry, proof }) {
  if (!process.env.BRIDGE_ADDRESS) throw new Error("BRIDGE_ADDRESS not set in .env");

  console.log(`[Bridge] Admin sending ${amountEth} ETH on behalf of ${fromWallet} with Polygon proof`);

  const wallet = getAdminWallet();
  const bridge = getBridge(wallet);

  const amountWei = ethers.parseEther(amountEth.toString());
  
  // Normalize payload to the on-chain tuple:
  // { requestId: uint64, inputs: uint256[], proof: uint256[8] }
  const polygonProof = {
    requestId: Number(proof.requestId),
    inputs: Array.isArray(proof.inputs) ? proof.inputs : [],
    proof: proof.proof,
  };

  const tx = await bridge.sendCrossBorderOnBehalf(
    fromWallet, 
    toWallet, 
    fromCountry, 
    toCountry, 
    polygonProof,
    { value: amountWei }
  );
  console.log("[Bridge] Polygon transfer TX sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("[Bridge] Confirmed in block:", receipt.blockNumber);

  // Parse the CrossBorderTransfer event
  const iface = new ethers.Interface(BRIDGE_ABI);
  let txId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "CrossBorderTransfer") {
        txId = Number(parsed.args.txId);
      }
    } catch {}
  }

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    txId,
    fromWallet,
    toWallet,
    amountEth,
    fromCountry,
    toCountry,
    polygonscanUrl: `https://amoy.polygonscan.com/tx/${tx.hash}`,
    bridgeAddress: process.env.BRIDGE_ADDRESS,
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

// ─── Sign a Verifiable Credential (VC) for the user ──────────────────────────
async function signIdentityCredential(walletAddress, did, score) {
  const wallet = getAdminWallet();
  const timestamp = Math.floor(Date.now() / 1000);
  const numericScore = Number(score);
  // solidityPackedKeccak256 with uint256 requires an integer value.
  // InterBio fused score is a float, so we store a scaled integer for signing.
  const scoreScaled = Number.isFinite(numericScore)
    ? Math.round(Math.max(0, numericScore) * 1000)
    : 0;
  
  // Data to sign
  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "string", "uint256", "uint256"],
    [walletAddress, did, scoreScaled, timestamp]
  );
  
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));
  
  return {
    issuer: wallet.address,
    subject: {
      wallet: walletAddress,
      did: did,
      biometricScore: Number.isFinite(numericScore) ? numericScore : null,
      biometricScoreScaled: scoreScaled,
    },
    timestamp,
    signature,
    proofType: "EIP712-Simple" // Simplified for demo
  };
}

module.exports = {
  whitelistWallet,
  checkVerification,
  executeCrossBorderTransfer,
  getBridgeStats,
  signIdentityCredential,
};
