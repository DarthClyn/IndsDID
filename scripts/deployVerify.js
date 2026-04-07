const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying Custom ZK Verifier to Sepolia...");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📍 Deployer:", deployer.address);

  // Change "Groth16Verifier" to "Verifier" if that is your contract name
  const Verifier = await hre.ethers.getContractFactory("Groth16Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();

  const address = await verifier.getAddress();
  console.log("\n✅ ZK Verifier deployed!");
  console.log("📄 Verifier address:", address);
  console.log("\n👉 Add to .env: VERIFIER_ADDRESS=" + address);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});