const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Starting Full Identity Platform Deployment on", hre.network.name);
  console.log("📍 Deployer address:", deployer.address);

  // 1. Deploy DIDRegistry
  console.log("\n1/3 Deploying DIDRegistry...");
  const DIDRegistry = await hre.ethers.getContractFactory("DIDRegistry");
  const registry = await DIDRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("✅ DIDRegistry deployed at:", registryAddr);

  // 2. Deploy MockVerifier
  console.log("\n2/3 Deploying MockVerifier...");
  const MockVerifier = await hre.ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log("✅ MockVerifier deployed at:", verifierAddr);

  // 3. Deploy CrossBorderBridge
  console.log("\n3/3 Deploying CrossBorderBridge...");
  const Bridge = await hre.ethers.getContractFactory("CrossBorderBridge");
  const bridge = await Bridge.deploy(registryAddr, verifierAddr);
  await bridge.waitForDeployment();
  const bridgeAddr = await bridge.getAddress();
  console.log("✅ CrossBorderBridge deployed at:", bridgeAddr);

  console.log("\n--- DEPLOYMENT SUMMARY ---");
  console.log(`CONTRACT_ADDRESS=${registryAddr}`);
  console.log(`VERIFIER_ADDRESS=${verifierAddr}`);
  console.log(`BRIDGE_ADDRESS=${bridgeAddr}`);
  console.log("--------------------------");

  // Update .env file
  const envPath = path.join(__dirname, "../.env");
  let envContent = fs.readFileSync(envPath, "utf8");

  const updateEnv = (key, value) => {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (envContent.match(regex)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  };

  updateEnv("CONTRACT_ADDRESS", registryAddr);
  updateEnv("VERIFIER_ADDRESS", verifierAddr);
  updateEnv("BRIDGE_ADDRESS", bridgeAddr);

  fs.writeFileSync(envPath, envContent);
  console.log("\n✅ .env file updated with new addresses.");
}

main().catch((error) => {
  console.error("❌ Full deployment failed:", error);
  process.exitCode = 1;
});
