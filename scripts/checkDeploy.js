const hre = require("hardhat");
require("dotenv").config();

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

async function checkAddress(label, address) {
  if (!address) {
    console.log(`- ${label}: not set in .env`);
    return;
  }
  if (!hre.ethers.isAddress(address)) {
    console.log(`- ${label}: invalid address format (${address})`);
    return;
  }
  const code = await hre.ethers.provider.getCode(address);
  const deployed = code && code !== "0x";
  console.log(`- ${label}: ${address} (${deployed ? "deployed" : "no contract code"})`);
}

async function main() {
  ensureSepoliaAndEnv();

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH");
  console.log("\nDeployment status from .env:");

  await checkAddress("CONTRACT_ADDRESS (DIDRegistry)", process.env.CONTRACT_ADDRESS);
  await checkAddress("BRIDGE_ADDRESS (CrossBorderBridge)", process.env.BRIDGE_ADDRESS);
  await checkAddress("VERIFIER_ADDRESS (UniversalVerifier)", process.env.VERIFIER_ADDRESS);
}

main().catch((error) => {
  console.error("❌ checkDeploy failed:", error.message);
  process.exitCode = 1;
});
