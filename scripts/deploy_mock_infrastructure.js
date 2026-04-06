const hre = require("hardhat");
const path = require("path");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Deploying Mock DID Infrastructure...");
  console.log("📍 Deployer address:", deployer.address);

  // 1. Deploy MockVerifier
  console.log("\n1/2 Deploying MockVerifier...");
  const MockVerifier = await hre.ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log("✅ MockVerifier deployed at:", verifierAddr);

  // 2. Deploy CrossBorderBridge
  // We need the existing DIDRegistry address from .env
  require("dotenv").config({ path: path.join(__dirname, "../.env") });
  const registryAddr = process.env.CONTRACT_ADDRESS;
  if (!registryAddr) {
    throw new Error("CONTRACT_ADDRESS (DIDRegistry) not found in .env. Please deploy it first or set it manually.");
  }

  console.log("\n2/2 Deploying CrossBorderBridge...");
  console.log(`🔗 Linking Registry: ${registryAddr}`);
  console.log(`🔗 Linking Verifier: ${verifierAddr}`);

  const Bridge = await hre.ethers.getContractFactory("CrossBorderBridge");
  const bridge = await Bridge.deploy(registryAddr, verifierAddr);
  await bridge.waitForDeployment();
  const bridgeAddr = await bridge.getAddress();
  console.log("✅ CrossBorderBridge deployed at:", bridgeAddr);

  console.log("\n--- DEPLOYMENT SUMMARY ---");
  console.log(`VERIFIER_ADDRESS=${verifierAddr}`);
  console.log(`BRIDGE_ADDRESS=${bridgeAddr}`);
  console.log("--------------------------");
  console.log("\n👉 Please update your .env file with these new addresses.");
}

main().catch((error) => {
  console.error("❌ Deploy infrastructure failed:", error);
  process.exitCode = 1;
});
