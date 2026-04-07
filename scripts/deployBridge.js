const hre = require("hardhat");
require("dotenv").config();

function getNormalizedPrivateKey() {
  const raw = (process.env.PRIVATE_KEY || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function ensureSepoliaAndEnv() {
  if (hre.network.name !== "sepolia") {
    throw new Error(`This script targets Sepolia. Run with: npx hardhat run scripts/deployBridge.js --network sepolia`);
  }
  const pk = getNormalizedPrivateKey();
  if (!pk || pk.length !== 66) {
    throw new Error("PRIVATE_KEY missing/invalid in .env");
  }
}

async function main() {
  ensureSepoliaAndEnv();

  const DID_REGISTRY = process.env.CONTRACT_ADDRESS;
  const ZK_VERIFIER = process.env.VERIFIER_ADDRESS; // This must be the address from deployVerifier.js

  if (!DID_REGISTRY || !ZK_VERIFIER) {
    throw new Error("CONTRACT_ADDRESS or VERIFIER_ADDRESS not set in .env");
  }

  console.log("🚀 Deploying ZK-Enabled CrossBorderBridge...");
  console.log("🔗 Using DIDRegistry:", DID_REGISTRY);
  console.log("🛡️ Using ZK Verifier:", ZK_VERIFIER);

  const [deployer] = await hre.ethers.getSigners();
  
  const Bridge = await hre.ethers.getContractFactory("CrossBorderBridge");
  // Ensure your CrossBorderBridge.sol constructor accepts (Registry, Verifier)
  const bridge = await Bridge.deploy(DID_REGISTRY, ZK_VERIFIER);
  await bridge.waitForDeployment();

  const address = await bridge.getAddress();
  console.log("\n✅ Bridge deployed at:", address);
  console.log("\n👉 Update .env: BRIDGE_ADDRESS=" + address);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });