const path = require("path");
const axios = require("axios");
const { processProofResponse } = require("@0xpolygonid/js-sdk");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const SCHEMA_CID = process.env.INDONESIA_KYC_SCHEMA_CID || "";
const SCHEMA_URL = process.env.INDONESIA_KYC_SCHEMA_URL || "";
const ISSUER_DID = process.env.POLYGON_ID_ISSUER_DID || "did:polygonid:polygon:amoy:issuer-demo";

const STATE_ADDRESS = process.env.POLYGON_ID_STATE_ADDRESS || "0x1a4cC30f2aA0377b0c3bc9848766D90cb4404124";
const VERIFIER_ADDRESS = process.env.VERIFIER_ADDRESS || "";
const VERIFIER_MODE = (process.env.POLYGON_ID_VERIFIER_MODE || "real").toLowerCase();
const VERIFIER_API_URL = process.env.POLYGON_ID_VERIFIER_API_URL || "https://verifier-backend.privado.id";
const VERIFIER_API_KEY = process.env.POLYGON_ID_VERIFIER_API_KEY || "";
const POLYGON_CHAIN_ID = process.env.POLYGON_ID_CHAIN_ID || "80002";
const POLYGON_CIRCUIT_ID = process.env.POLYGON_ID_CIRCUIT_ID || "credentialAtomicQuerySigV2";

const INDONESIA_KYC_QUERY = {
  allowedIssuers: [ISSUER_DID],
  context: SCHEMA_URL || "",
  type: "IndonesiaKYC",
  credentialSubject: {
    isVerified: { "$eq": true },
    fusedScore: { "$gte": 10 },
  },
};

function getSchemaConfig() {
  return { cid: SCHEMA_CID, url: SCHEMA_URL, issuerDid: ISSUER_DID };
}

function getIndonesiaKycQuery() {
  return INDONESIA_KYC_QUERY;
}

function getVerifierConfig() {
  return {
    mode: VERIFIER_MODE,
    hasApiUrl: Boolean(VERIFIER_API_URL),
    verifierAddress: VERIFIER_ADDRESS,
    stateAddress: STATE_ADDRESS,
    verifierApiUrl: VERIFIER_API_URL,
    chainId: POLYGON_CHAIN_ID,
    circuitId: POLYGON_CIRCUIT_ID,
  };
}

/**
 * Creates a verification session on the Privado ID Verifier Backend.
 * This returns the session ID and the fully-formatted iden3comm Auth Request QR.
 */
async function createVerifierSession() {
  if (VERIFIER_MODE === "mock") return { mode: "mock", qrCode: null };

  const endpoint = `${VERIFIER_API_URL}/v1/requests`;
  const backendUrl = process.env.BACKEND_URL || (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(":3000", ":3001") : "http://localhost:3001");
  const body = {
    reason: "Verify Indonesia KYC compliance for cross-border transfer",
    callbackUrl: `${backendUrl}/api/polygonid/callback`,
    zkQueries: [
      {
        id: 1,
        circuitId: POLYGON_CIRCUIT_ID,
        query: INDONESIA_KYC_QUERY
      }
    ],
    network: "amoy",
    stateAddress: STATE_ADDRESS,
    verifierAddress: VERIFIER_ADDRESS
  };

  console.log("[PolygonID] Creating verifier session at:", endpoint);
  console.log("[PolygonID] Session body:", JSON.stringify(body));

  try {
    const res = await axios.post(endpoint, body, {
       headers: { "Content-Type": "application/json" },
       timeout: 10000
    });
    console.log("[PolygonID] Privado API session response:", JSON.stringify(res.data));
    
    // The Privado API typically returns { id: "uuid", request: { "id": "uuid", ..."body": { "scope": [...] } } }
    // sessionID should be the top-level 'id' or 'request.id'
    const sId = res.data.id || res.data.request?.id;
    const req = res.data.request || res.data;
    
    return {
      sessionID: sId,
      qrCode: JSON.stringify(req)
    };
  } catch (err) {
    console.error("[PolygonID] createVerifierSession failed:", err.response?.data || err.message);
    throw new Error(`Privado Verifier Error: ${JSON.stringify(err.response?.data || err.message)}`);
  }
}

/**
 * Checks the status of a specific verification session.
 */
async function getVerifierSessionStatus(sessionID) {
  if (!sessionID) return { status: "missing" };
  const endpoint = `${VERIFIER_API_URL}/v1/requests/status/${sessionID}`;
  try {
    const res = await axios.get(endpoint);
    return res.data;
  } catch (err) {
    console.warn(`[PolygonID] getVerifierSessionStatus failed for ${sessionID}:`, err.message);
    return { status: "error", message: err.message };
  }
}

async function verifyIndonesiaKycProof({ walletAddress, proof }) {
  if (VERIFIER_MODE === "mock") return { verified: true, mode: "mock" };

  const sessionID = proof?.sessionID || proof?.sessionId || proof?.id;
  console.log("[PolygonID] Checking status for session:", sessionID, "Proof body:", JSON.stringify(proof));
  if (!sessionID) {
     throw new Error("Verification failed: SessionID is missing from the proof payload.");
  }

  const statusData = await getVerifierSessionStatus(sessionID);
  const status = String(statusData?.status || "").toLowerCase();

  return {
    verified: status === "success",
    pending: status === "pending",
    mode: "real",
    sessionID,
    raw: statusData,
  };
}

/**
 * Issues a Verifiable Credential for a given DID after successful KYC.
 * In a production environment, this would call a real Polygon ID Issuer Node.
 * For the demo, we generate a signed-compliant JSON-LD credential.
 */
async function issueIndonesiaKycCredential(did, isVerified, fusedScore) {
  const schema = getSchemaConfig();
  
  // Base credential structure for IndonesiaKYC
  const credential = {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      schema.url // This should point to our custom JSON-LD context on IPFS/Pinata
    ],
    "id": `urn:uuid:${Math.random().toString(36).substring(2, 11)}`,
    "type": ["VerifiableCredential", "IndonesiaKYC"],
    "issuer": ISSUER_DID,
    "issuanceDate": new Date().toISOString(),
    "credentialSubject": {
       "id": did,
       "isVerified": Boolean(isVerified),
       "fusedScore": typeof fusedScore === "number" ? Math.round(fusedScore) : 0,
       "type": "IndonesiaKYC"
    },
    "credentialSchema": {
      "id": schema.url.replace('.jsonld', '.json'),
      "type": "JsonSchemaValidator2018"
    }
  };

  return {
    ...credential,
    _meta: {
      schemaCid: schema.cid || null,
      issuerDid: ISSUER_DID,
      stateAddress: STATE_ADDRESS || null,
      issued: true
    }
  };
}

module.exports = {
  getSchemaConfig,
  getIndonesiaKycQuery,
  getVerifierConfig,
  createVerifierSession,
  getVerifierSessionStatus,
  verifyIndonesiaKycProof,
  issueIndonesiaKycCredential,
};
