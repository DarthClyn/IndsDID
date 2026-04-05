const hre = require("hardhat");

function getNormalizedPrivateKey() {
  const raw = (process.env.PRIVATE_KEY || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function ensureSepoliaAndEnv() {
  if (hre.network.name !== "sepolia") {
    throw new Error(`This script is restricted to Sepolia. Current network: ${hre.network.name}`);
  }
  const pk = getNormalizedPrivateKey();
  if (!pk || pk.length !== 66) {
    throw new Error("PRIVATE_KEY missing/invalid in .env (expected 32-byte hex, with or without 0x)");
  }
}

async function main() {
  ensureSepoliaAndEnv();
  console.log("🚀 Deploying DIDRegistry to Sepolia...");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📍 Deployer address:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", hre.ethers.formatEther(balance), "ETH");

  const DIDRegistry = await hre.ethers.getContractFactory("DIDRegistry");
  const registry = await DIDRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("\n✅ DIDRegistry deployed!");
  console.log("📄 Contract address:", address);
  console.log("🔗 Etherscan:", `https://sepolia.etherscan.io/address/${address}`);
  console.log("\n👉 Copy this address into your .env as CONTRACT_ADDRESS=", address);
}

main().catch((error) => {
  console.error("❌ Deploy failed:", error);
  process.exitCode = 1;
});
