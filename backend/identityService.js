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

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;
const POLYGON_ID_STATE_ADDRESS = process.env.POLYGON_ID_STATE_ADDRESS;
const POLYGON_ID_CHAIN_ID = Number(process.env.POLYGON_ID_CHAIN_ID || "11155111");

// 1. Initial Setup: Register the Sepolia network globally in core
// We do this at the module level to ensure it's only done once and shared across calls.
console.log("[PolygonID] Globally registering Sepolia network for DID methods...");
const networkConfig = {
  blockchain: "eth",
  network: "sepolia",
  chainId: 11155111,
  networkFlag: 0b00000011, // Decimal 3: (ETH | Testnet)
};

// Register for several possible method identifiers for robustness
["iden3", "polygonid"].forEach(method => {
  try {
    core.registerDidMethodNetwork({ ...networkConfig, method });
    console.log(`[PolygonID] Registered ${method} for eth:sepolia`);
  } catch (e) {
    if (!e.message.includes("already registered")) {
       console.error(`[PolygonID] Failed to register ${method}:`, e.message);
    }
  }
});

async function createSepoliaIdentity() {
  if (!SEPOLIA_RPC_URL) {
    throw new Error("SEPOLIA_RPC_URL is not set in .env");
  }
  if (!POLYGON_ID_STATE_ADDRESS) {
    throw new Error("POLYGON_ID_STATE_ADDRESS is not set in .env");
  }

  // Setup in-memory identity / credential / Merkle tree storage
  const identityStorage = new IdentityStorage(new InMemoryDataSource(), new InMemoryDataSource());
  const credentialStorage = new CredentialStorage(new InMemoryDataSource());
  const mtStorage = new InMemoryMerkleTreeStorage(40); // standard tree depth

  // Configure the on-chain state connection
  const ethConfig = {
    ...defaultEthConnectionConfig,
    url: SEPOLIA_RPC_URL,
    contractAddress: POLYGON_ID_STATE_ADDRESS,
    chainId: POLYGON_ID_CHAIN_ID,
  };
  const stateStorage = new EthStateStorage(ethConfig);

  // We map both 'state' and 'states' keys to handle cross-version SDK variations
  const dataStorage = {
    credential: credentialStorage,
    identity: identityStorage,
    mt: mtStorage,
    state: stateStorage,
    states: stateStorage,
  };

  // Setup KMS with BabyJubJub provider
  const kms = new KMS();
  const keyStore = new InMemoryPrivateKeyStore();
  const bjjProvider = new BjjProvider(KmsKeyType.BabyJubJub, keyStore);
  kms.registerKeyProvider(KmsKeyType.BabyJubJub, bjjProvider);

  // Create credential wallet and identity wallet
  const credentialWallet = new CredentialWallet(dataStorage);
  const identityWallet = new IdentityWallet(kms, dataStorage, credentialWallet);

  // Create identity on Ethereum Sepolia using polygonid DID method
  // We strictly follow the 'polygonid' method specification provided in the documentation
  const creationParams = {
    method: "polygonid",
    blockchain: "eth",
    network: "sepolia",
    revocationOpts: {
      type: CredentialStatusType.Iden3ReverseSparseMerkleTreeProof,
      id: "https://rhs-staging.polygonid.me"
    }
  };

  console.log("[PolygonID] Creating identity with params:", JSON.stringify(creationParams));
  try {
    const { did, credential } = await identityWallet.createIdentity(creationParams);
    console.log("[PolygonID] Identity created successfully:", did.string());
    return { did: did.string(), credential };
  } catch (err) {
    console.error("[PolygonID] createIdentity call failed:", err.message);
    // If 'polygonid' method fails, fall back once to the fundamental 'iden3' method
    console.log("[PolygonID] Attempting fallback to 'iden3' method...");
    const { did, credential } = await identityWallet.createIdentity({
      ...creationParams,
      method: "iden3"
    });
    console.log("[PolygonID] Identity created successfully (fallback):", did.string());
    return { did: did.string(), credential };
  }
}

module.exports = { createSepoliaIdentity };