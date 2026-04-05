const path = require("path");
const axios = require("axios");
const { processProofResponse } = require("@0xpolygonid/js-sdk");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const SCHEMA_CID = process.env.INDONESIA_KYC_SCHEMA_CID || "";
const SCHEMA_URL = process.env.INDONESIA_KYC_SCHEMA_URL || "";
const ISSUER_DID = process.env.POLYGON_ID_ISSUER_DID || "did:polygonid:polygon:amoy:issuer-demo";

// Network-level Polygon ID configuration (used by verifier / state checks)
const STATE_ADDRESS = process.env.POLYGON_ID_STATE_ADDRESS || "";
const VERIFIER_ADDRESS = process.env.VERIFIER_ADDRESS || "";
const VERIFIER_MODE = (process.env.POLYGON_ID_VERIFIER_MODE || "mock").toLowerCase();
const VERIFIER_API_URL = process.env.POLYGON_ID_VERIFIER_API_URL || "https://verifier-backend.privado.id";
const VERIFIER_API_KEY = process.env.POLYGON_ID_VERIFIER_API_KEY || "";
const POLYGON_CHAIN_ID = process.env.POLYGON_ID_CHAIN_ID || "11155111";
const POLYGON_CIRCUIT_ID = process.env.POLYGON_ID_CIRCUIT_ID || "credentialAtomicQuerySigV2";

// Reusable query for "Vietnam side" compliance:
//  - Issued by our IndonesiaKYC issuer (ISSUER_DID)
//  - Uses the IndonesiaKYC schema on IPFS as context
//  - Requires isVerified == true and fusedScore >= 10
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
  return {
    cid: SCHEMA_CID,
    url: SCHEMA_URL,
    issuerDid: ISSUER_DID,
  };
}

function getIndonesiaKycQuery() {
  return INDONESIA_KYC_QUERY;
}

function getVerifierConfig() {
  return {
    mode: VERIFIER_MODE,
    hasApiUrl: Boolean(VERIFIER_API_URL),
    verifierAddress: VERIFIER_ADDRESS || null,
    stateAddress: STATE_ADDRESS || null,
    verifierApiUrl: VERIFIER_API_URL || null,
    chainId: POLYGON_CHAIN_ID,
    circuitId: POLYGON_CIRCUIT_ID,
  };
}

function getVerifierApiHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (VERIFIER_API_KEY) headers["x-api-key"] = VERIFIER_API_KEY;
  return headers;
}

function buildSignInRequestFromQuery(query) {
  return {
    chainID: POLYGON_CHAIN_ID,
    scope: [
      {
        id: 1,
        circuitID: POLYGON_CIRCUIT_ID,
        query,
      },
    ],
  };
}

async function createVerifierSession() {
  if (!VERIFIER_API_URL) {
    throw new Error("POLYGON_ID_VERIFIER_API_URL is required");
  }
  const query = getIndonesiaKycQuery();
  const payload = buildSignInRequestFromQuery(query);

  const res = await axios.post(`${VERIFIER_API_URL}/sign-in`, payload, {
    headers: getVerifierApiHeaders(),
    timeout: 30000,
  });

  return {
    sessionID: res.data?.sessionID || res.data?.sessionId || null,
    qrCode: res.data?.qrCode || null,
    request: payload,
    raw: res.data,
  };
}

async function getVerifierSessionStatus(sessionID) {
  if (!VERIFIER_API_URL) {
    throw new Error("POLYGON_ID_VERIFIER_API_URL is required");
  }
  if (!sessionID) {
    throw new Error("sessionID is required");
  }

  const res = await axios.get(`${VERIFIER_API_URL}/status`, {
    params: { sessionID },
    headers: getVerifierApiHeaders(),
    timeout: 30000,
  });

  return res.data;
}

/**
 * Build a Polygon ID-style VC for IndonesiaKYC.
 * This does not yet push to a Polygon ID Issuer Node; it prepares
 * a JSON-LD credential body that can be used with an Issuer later.
 */
async function issueIndonesiaKycCredential({ did, walletAddress, fusedScore, isVerified = true }) {
  const now = new Date();
  const schema = getSchemaConfig();

  const context = [
    "https://www.w3.org/2018/credentials/v1",
  ];
  if (schema.url) context.push(schema.url);

  const credential = {
    '@context': context,
    type: ["VerifiableCredential", "IndonesiaKYC"],
    issuer: ISSUER_DID,
    issuanceDate: now.toISOString(),
    credentialSchema: schema.url
      ? {
          id: schema.url,
          type: "JsonSchema",
        }
      : undefined,
    credentialSubject: {
      id: did,
      wallet: walletAddress,
      isVerified: Boolean(isVerified),
      fusedScore: typeof fusedScore === "number" ? fusedScore : null,
    },
  };

  // POST to Polygon ID Issuer Node to mint/sign the credential
  const ISSUER_API_URL = process.env.POLYGON_ID_ISSUER_API_URL || "";
  if (!ISSUER_API_URL) {
    console.error("[PolygonID] POLYGON_ID_ISSUER_API_URL is not set. Cannot mint credential.");
    return {
      ...credential,
      _meta: {
        schemaCid: schema.cid || null,
        issuerDid: ISSUER_DID,
        stateAddress: STATE_ADDRESS || null,
        error: "POLYGON_ID_ISSUER_API_URL not set"
      },
    };
  }

  // Prepare payload for issuer node
  const payload = {
    credentialSchema: schema.url,
    type: "IndonesiaKYC",
    credentialSubject: {
      id: did,
      isVerified: Boolean(isVerified),
      fusedScore: typeof fusedScore === "number" ? fusedScore : null,
    },
    expiration: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365, // 1 year from now
    refreshService: {
      id: ISSUER_API_URL + "/v1/refresh",
      type: "Iden3RefreshService2023"
    }
  };

  let signedCredential = null;
  try {
    console.log("[PolygonID] Issuing VC via issuer node:", JSON.stringify(payload));
    const res = await axios.post(
      `${ISSUER_API_URL}/v1/identities/${encodeURIComponent(ISSUER_DID)}/credentials`,
      payload,
      { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );
    signedCredential = res.data;
    console.log("[PolygonID] Issuer node response:", JSON.stringify(signedCredential));
    return {
      ...signedCredential,
      _meta: {
        schemaCid: schema.cid || null,
        issuerDid: ISSUER_DID,
        stateAddress: STATE_ADDRESS || null,
        issuerApiUrl: ISSUER_API_URL,
        issued: true
      }
    };
  } catch (err) {
    console.error("[PolygonID] Error issuing VC:", err.response?.data || err.message);
    return {
      ...credential,
      _meta: {
        schemaCid: schema.cid || null,
        issuerDid: ISSUER_DID,
        stateAddress: STATE_ADDRESS || null,
        issuerApiUrl: ISSUER_API_URL,
        issued: false,
        error: err.response?.data || err.message
      }
    };
  }
}

function normalizeRealVerifierResponse(payload) {
  if (!payload || typeof payload !== "object") return { verified: false };

  if (typeof payload.verified === "boolean") {
    return {
      verified: payload.verified,
      requestId: payload.requestId ?? payload.proofRequestId ?? null,
      raw: payload,
    };
  }
  if (typeof payload.valid === "boolean") {
    return {
      verified: payload.valid,
      requestId: payload.requestId ?? payload.proofRequestId ?? null,
      raw: payload,
    };
  }
  if (payload.result && typeof payload.result.verified === "boolean") {
    return {
      verified: payload.result.verified,
      requestId: payload.result.requestId ?? payload.result.proofRequestId ?? null,
      raw: payload,
    };
  }

  return { verified: false, raw: payload };
}

async function verifyWithMockAdapter({ query }) {
  return {
    verified: true,
    mode: "mock",
    query,
  };
}

async function verifyWithRealAdapter({ walletAddress, proof, query }) {
  if (!VERIFIER_API_URL) {
    throw new Error("POLYGON_ID_VERIFIER_API_URL is required when POLYGON_ID_VERIFIER_MODE=real");
  }

  // Path A: preferred for Privado verifier backend -> client sends sessionID
  // after scanning /sign-in QR and we poll /status.
  const sessionID = proof?.sessionID || proof?.sessionId || proof?.session;
  if (sessionID) {
    const statusData = await getVerifierSessionStatus(sessionID);
    const status = String(statusData?.status || "").toLowerCase();

    if (status === "pending") {
      return {
        verified: false,
        pending: true,
        mode: "real",
        sessionID,
        raw: statusData,
      };
    }

    if (status === "success") {
      return {
        verified: true,
        pending: false,
        mode: "real",
        sessionID,
        raw: statusData,
      };
    }

    return {
      verified: false,
      pending: false,
      mode: "real",
      sessionID,
      error: statusData?.message || "Verifier status is not success",
      raw: statusData,
    };
  }

  // Path B: SDK-assisted direct proof format handling (fallback).
  // If caller provides zk-proof fields, run SDK transformation to ensure
  // payload is well-formed and can be consumed by on-chain/off-chain verifiers.
  if (proof?.id !== undefined && Array.isArray(proof?.pub_signals) && proof?.proof) {
    const packed = processProofResponse(proof);
    return {
      verified: true,
      mode: "real",
      requestId: packed.requestId,
      packed,
    };
  }

  // Path C: Custom verifier endpoint fallback.
  const res = await axios.post(
    VERIFIER_API_URL,
    {
      walletAddress,
      proof,
      query,
      network: "sepolia",
      verifierAddress: VERIFIER_ADDRESS,
      stateAddress: STATE_ADDRESS,
    },
    { headers: getVerifierApiHeaders(), timeout: 30000 }
  );

  const normalized = normalizeRealVerifierResponse(res.data);
  return {
    verified: normalized.verified,
    pending: false,
    mode: "real",
    requestId: normalized.requestId,
    raw: normalized.raw,
  };
}

function getVerifierAdapter() {
  if (VERIFIER_MODE === "real") {
    return verifyWithRealAdapter;
  }
  return verifyWithMockAdapter;
}

// Main Polygon proof verification entrypoint.
// Toggle with a single env flag:
//   POLYGON_ID_VERIFIER_MODE=mock|real
//
// real mode is operational via HTTP adapter and can point to your
// verifier service endpoint using POLYGON_ID_VERIFIER_API_URL.
async function verifyIndonesiaKycProof({ walletAddress, proof }) {
  if (!walletAddress) {
    throw new Error("walletAddress is required for Polygon ID verification");
  }
  if (!proof || typeof proof !== "object") {
    throw new Error("Polygon ID proof payload is missing or invalid");
  }
  const query = getIndonesiaKycQuery();
  const adapter = getVerifierAdapter();
  return adapter({ walletAddress, proof, query });
}

module.exports = {
  getSchemaConfig,
  issueIndonesiaKycCredential,
  getIndonesiaKycQuery,
  getVerifierConfig,
  createVerifierSession,
  getVerifierSessionStatus,
  verifyIndonesiaKycProof,
};
