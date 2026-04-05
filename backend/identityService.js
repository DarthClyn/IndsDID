// identityService.js
// Polygon ID Sepolia DID creation using JS-SDK
const {
  core,
  IdentityWallet,
  CredentialWallet,
  IdentityStorage,
  CredentialStorage,
  InMemoryDataSource,
  InMemoryMerkleTreeStorage,
  InMemoryPrivateKeyStore,
  BjjProvider,
  CredentialStatusType,
  KMS,
  KmsKeyType,
  EthStateStorage,
  defaultEthConnectionConfig,
} = require("@0xpolygonid/js-sdk");

const AMOY_RPC_URL = process.env.AMOY_RPC_URL || process.env.SEPOLIA_RPC_URL;
const POLYGON_ID_STATE_ADDRESS = process.env.POLYGON_ID_STATE_ADDRESS;
const AMOY_CHAIN_ID = 80002; // Polygon Amoy

// Register Polygon Amoy network globally — natively supported by @0xpolygonid/js-sdk
console.log("[PolygonID] Registering polygon:amoy for did:polygonid method...");
["polygonid", "iden3"].forEach(method => {
  try {
    core.registerDidMethodNetwork({
      method,
      blockchain: "polygon",
      network: "amoy",
      chainId: AMOY_CHAIN_ID,
      networkFlag: 0b01000001 | 0b00000001, // Polygon | testnet
    });
    console.log(`[PolygonID] Registered ${method} for polygon:amoy`);
  } catch (e) {
    if (!e.message?.includes("already")) console.warn(`[PolygonID] Register warn (${method}):`, e.message);
  }
});

async function createSepoliaIdentity() {
  if (!AMOY_RPC_URL) {
    throw new Error("AMOY_RPC_URL (or SEPOLIA_RPC_URL as fallback) is not set in .env");
  }
  if (!POLYGON_ID_STATE_ADDRESS) {
    throw new Error("POLYGON_ID_STATE_ADDRESS is not set in .env");
  }

  const identityStorage = new IdentityStorage(new InMemoryDataSource(), new InMemoryDataSource());
  const credentialStorage = new CredentialStorage(new InMemoryDataSource());
  const mtStorage = new InMemoryMerkleTreeStorage(40);

  // Polygon Amoy state contract (official Polygon ID deployment)
  // Override via POLYGON_ID_STATE_ADDRESS in .env if you have a custom deployment
  const ethConfig = {
    ...defaultEthConnectionConfig,
    url: AMOY_RPC_URL,
    contractAddress: POLYGON_ID_STATE_ADDRESS,
    chainId: AMOY_CHAIN_ID,
  };
  const stateStorage = new EthStateStorage(ethConfig);

  const dataStorage = {
    credential: credentialStorage,
    identity: identityStorage,
    mt: mtStorage,
    state: stateStorage,
    states: stateStorage,
  };

  const kms = new KMS();
  const keyStore = new InMemoryPrivateKeyStore();
  const bjjProvider = new BjjProvider(KmsKeyType.BabyJubJub, keyStore);
  kms.registerKeyProvider(KmsKeyType.BabyJubJub, bjjProvider);

  const credentialWallet = new CredentialWallet(dataStorage);
  const identityWallet = new IdentityWallet(kms, dataStorage, credentialWallet);

  // Create identity on Polygon Amoy using polygonid DID method
  // This produces: did:polygonid:polygon:amoy:<base58id>
  const creationParams = {
    method: "polygonid",
    blockchain: "polygon",
    network: "amoy",
    revocationOpts: {
      type: CredentialStatusType.Iden3ReverseSparseMerkleTreeProof,
      id: "https://rhs-staging.polygonid.me"
    }
  };

  console.log("[PolygonID] Creating polygon:amoy identity...");
  try {
    const { did, credential } = await identityWallet.createIdentity(creationParams);
    console.log("[PolygonID] DID created:", did.string());
    return { did: did.string(), credential };
  } catch (err) {
    console.error("[PolygonID] createIdentity failed:", err.message);
    // Fallback: iden3 method on polygon:amoy
    const { did, credential } = await identityWallet.createIdentity({ ...creationParams, method: "iden3" });
    console.log("[PolygonID] DID created (iden3 fallback):", did.string());
    return { did: did.string(), credential };
  }
}

module.exports = { createSepoliaIdentity };