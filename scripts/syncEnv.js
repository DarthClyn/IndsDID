const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '../deploy_record.txt');
const envPath = path.join(__dirname, '../.env');

try {
  // Read UTF-16LE or UTF-8 (PowerShell > redirects as UTF-16LE by default in some versions)
  const content = fs.readFileSync(logPath, 'utf16le');
  
  console.log("Raw Log Content (first 200 chars):", content.substring(0, 200));

  const registryMatch = content.match(/DIDRegistry deployed to: (0x[a-fA-F0-9]{40})/);
  // Legacy ZKPVerifier is no longer used; VERIFIER_ADDRESS now points
  // to the Polygon ID Universal Verifier and should be managed manually
  // or via your dedicated deployment script, so we no longer parse it
  // from deploy_record.txt here.
  const bridgeMatch   = content.match(/CrossBorderBridge deployed to: (0x[a-fA-F0-9]{40})/);

  if (!registryMatch || !bridgeMatch) {
    console.error("Failed to parse all addresses. Trying UTF-8 fallback...");
    // Fallback?
    process.exit(1);
  }

  const registryAddress = registryMatch[1];
  const bridgeAddress   = bridgeMatch[1];

  console.log("Parsed Addresses:");
  console.log("REGISTRY:", registryAddress);
  console.log("BRIDGE:", bridgeAddress);

  // Update .env
  let envData = fs.readFileSync(envPath, 'utf8');
  envData = envData.replace(/CONTRACT_ADDRESS=.*/, `CONTRACT_ADDRESS=${registryAddress}`);
  envData = envData.replace(/BRIDGE_ADDRESS=.*/, `BRIDGE_ADDRESS=${bridgeAddress}`);

  fs.writeFileSync(envPath, envData);
  console.log(".env updated successfully.");
} catch (err) {
  console.error("Critical error in update script:", err.message);
}
