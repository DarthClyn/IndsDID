const hre = require("hardhat");
require("dotenv").config();

function getNormalizedPrivateKey() {
  const raw = (process.env.PRIVATE_KEY || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function ensureSepoliaAndEnv() {
  if (hre.network.name !== "sepolia") {
    throw new Error(`This script targets Sepolia. Current network: ${hre.network.name}. Run with: npx hardhat run scripts/deployBridge.js --network sepolia`);
  }
  const pk = getNormalizedPrivateKey();
  if (!pk || pk.length !== 66) {
    throw new Error("PRIVATE_KEY missing/invalid in .env (expected 32-byte hex, with or without 0x)");
  }
}

async function main() {
  ensureSepoliaAndEnv();
  const DID_REGISTRY = process.env.CONTRACT_ADDRESS;
  if (!DID_REGISTRY) {
    throw new Error("CONTRACT_ADDRESS not set in .env — deploy DIDRegistry first");
  }

  const UNIVERSAL_VERIFIER = process.env.VERIFIER_ADDRESS;
  if (!UNIVERSAL_VERIFIER) {
    throw new Error("VERIFIER_ADDRESS not set in .env");
  }

  console.log("🚀 Deploying CrossBorderBridge to Sepolia...");
  console.log("🔗 Using DIDRegistry:", DID_REGISTRY);

  const [deployer] = await hre.ethers.getSigners();
  console.log("📍 Deployer:", deployer.address);

  const Bridge = await hre.ethers.getContractFactory("CrossBorderBridge");
  const bridge = await Bridge.deploy(DID_REGISTRY, UNIVERSAL_VERIFIER);
  await bridge.waitForDeployment();

  const address = await bridge.getAddress();
  console.log("\n✅ CrossBorderBridge deployed!");
  console.log("📄 Bridge address:", address);
  console.log("🔗 Etherscan:", `https://sepolia.etherscan.io/address/${address}`);
  console.log("\n👉 Add to .env: BRIDGE_ADDRESS=" + address);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
