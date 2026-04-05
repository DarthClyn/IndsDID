const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { enrollUser, verifyUser, getKycConfig } = require("./kycService");
const {
  whitelistWallet,
  checkVerification,
  executeCrossBorderTransfer,
  getBridgeStats,
  signIdentityCredential,
} = require("./contractService");
const {
  issueIndonesiaKycCredential,
  getIndonesiaKycQuery,
  verifyIndonesiaKycProof,
  getVerifierConfig,
  createVerifierSession,
} = require("./polygonIdService");
const { createSepoliaIdentity } = require("./identityService");


const app = express();
app.use(cors({ origin: "*" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Polygon ID: Create Sepolia DID (JS-SDK) ───────────────────────────────
app.post("/api/polygonid/create-did", async (req, res) => {
  const rid = requestId();
  logRoute(rid, "POST /api/polygonid/create-did", "request received");
  try {
    const { did, credential } = await createSepoliaIdentity();
    logRoute(rid, "POST /api/polygonid/create-did", "DID created", did);
    res.json({ did, credential });
  } catch (e) {
    logRoute(rid, "POST /api/polygonid/create-did", "error", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

function requestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function logRoute(id, route, step, data) {
  if (data === undefined) {
    console.log(`[API][${id}][${route}] ${step}`);
    return;
  }
  console.log(`[API][${id}][${route}] ${step}`, data);
}

// ─── Health / Info ────────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  const rid = requestId();
  const kyc = getKycConfig();
  const verifier = getVerifierConfig();
  logRoute(rid, "GET /api/health", "request received");
  try {
    const stats = await getBridgeStats();
    logRoute(rid, "GET /api/health", "response ok", { hasBridgeStats: Boolean(stats), kycMode: kyc.mockKyc ? "mock" : "live" });
    res.json({
      status: "ok",
      network: "Polygon Amoy",
      kycMode: kyc.mockKyc ? "mock" : "live",
      interbioBaseUrl: kyc.baseUrl,
      interbioCredentialsConfigured: kyc.hasCredentials,
      registryAddress: process.env.CONTRACT_ADDRESS || "NOT_DEPLOYED",
      bridgeAddress: process.env.BRIDGE_ADDRESS || "NOT_DEPLOYED",
      verifierAddress: process.env.VERIFIER_ADDRESS || "NOT_CONFIGURED",
      stateAddress: process.env.POLYGON_ID_STATE_ADDRESS || "NOT_CONFIGURED",
      polygonVerifierMode: verifier.mode,
      polygonVerifierApiConfigured: verifier.mode === "real" ? verifier.hasApiUrl : true,
      bridgeStats: stats,
    });
  } catch (e) {
    logRoute(rid, "GET /api/health", "response fallback", e.message);
    res.json({
      status: "ok",
      network: "Polygon Amoy",
      kycMode: kyc.mockKyc ? "mock" : "live",
      interbioBaseUrl: kyc.baseUrl,
      interbioCredentialsConfigured: kyc.hasCredentials,
      registryAddress: process.env.CONTRACT_ADDRESS || "NOT_DEPLOYED",
      bridgeAddress: process.env.BRIDGE_ADDRESS || "NOT_DEPLOYED",
      verifierAddress: process.env.VERIFIER_ADDRESS || "NOT_CONFIGURED",
      stateAddress: process.env.POLYGON_ID_STATE_ADDRESS || "NOT_CONFIGURED",
      polygonVerifierMode: verifier.mode,
      polygonVerifierApiConfigured: verifier.mode === "real" ? verifier.hasApiUrl : true,
    });
  }
});

// ─── Polygon ID: IndonesiaKYC query helper ──────────────────────────────────
app.get("/api/polygonid/query", (req, res) => {
  const rid = requestId();
  try {
    const query = getIndonesiaKycQuery();
    const verifier = getVerifierConfig();
    logRoute(rid, "GET /api/polygonid/query", "response ok");
    const base = {
      network: "Polygon Amoy",
      verifierAddress: process.env.VERIFIER_ADDRESS || "NOT_CONFIGURED",
      stateAddress: process.env.POLYGON_ID_STATE_ADDRESS || "NOT_CONFIGURED",
      verifierMode: verifier.mode,
      query,
    };

    // Optional helper for real mode: ask the remote verifier backend to
    // create a sign-in session and return QR + sessionID.
    if (verifier.mode === "real") {
      createVerifierSession()
        .then((session) => {
          res.json({ ...base, session });
        })
        .catch((err) => {
          console.error(`[API][${rid}][GET /api/polygonid/query] session error`, err.message);
          res.json({ ...base, session: null, sessionError: err.message });
        });
      return;
    }

    res.json(base);
  } catch (err) {
    console.error(`[API][${rid}][GET /api/polygonid/query] error`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Polygon ID: Off-chain proof verification (gate before transfer) ───────
// POST /api/polygonid/verify { walletAddress, proof }
app.post("/api/polygonid/verify", async (req, res) => {
  const rid = requestId();
  try {
    const { walletAddress, proof } = req.body || {};
    logRoute(rid, "POST /api/polygonid/verify", "request received", {
      walletAddress,
      hasProof: Boolean(proof),
    });

    if (!walletAddress) {
      logRoute(rid, "POST /api/polygonid/verify", "validation failed: walletAddress");
      return res.status(400).json({ error: "walletAddress is required", verified: false });
    }
    if (!proof || typeof proof !== "object") {
      logRoute(rid, "POST /api/polygonid/verify", "validation failed: proof");
      return res.status(400).json({ error: "Polygon ID proof payload is required", verified: false });
    }

    // Ensure this wallet is (or was) whitelisted on DIDRegistry
    const registryStatus = await checkVerification(walletAddress);
    if (!registryStatus.isVerified) {
      logRoute(rid, "POST /api/polygonid/verify", "registry not verified", registryStatus);
      return res.status(400).json({
        verified: false,
        error: "Wallet is not whitelisted on DIDRegistry. Complete Indonesia KYC first.",
      });
    }

    const result = await verifyIndonesiaKycProof({ walletAddress, proof });
    logRoute(rid, "POST /api/polygonid/verify", "verifier result", result);

    if (result.pending) {
      return res.status(202).json({
        verified: false,
        pending: true,
        mode: result.mode,
        sessionID: result.sessionID || null,
        message: "Polygon verification is pending. Poll again after wallet approval.",
      });
    }

    if (!result.verified) {
      return res.status(400).json({ verified: false, error: "Polygon ID proof invalid" });
    }

    res.json({
      verified: true,
      message: "Polygon ID proof accepted (off-chain gate).",
      mode: result.mode,
      walletAddress,
      registryVerified: registryStatus.isVerified,
      totalVerified: registryStatus.totalVerified,
    });
  } catch (err) {
    console.error(`[API][${rid}][POST /api/polygonid/verify] error`, err.message);
    res.status(500).json({ error: err.message, verified: false });
  }
});

// ─── KYC: Enroll ─────────────────────────────────────────────────────────────
// POST /api/kyc/enroll   { walletAddress, nik, faceImageBase64 }
app.post("/api/kyc/enroll", upload.single("faceImage"), async (req, res) => {
  const rid = requestId();
  try {
    let { walletAddress, nik, faceImageBase64 } = req.body;
    if (req.file) faceImageBase64 = req.file.buffer.toString("base64");
    logRoute(rid, "POST /api/kyc/enroll", "request received", {
      walletAddress,
      nikLength: nik ? String(nik).length : 0,
      hasFaceImage: Boolean(faceImageBase64),
    });

    if (!walletAddress || !nik || !faceImageBase64) {
      logRoute(rid, "POST /api/kyc/enroll", "validation failed");
      return res.status(400).json({ error: "walletAddress, nik, and faceImage are required" });
    }

    const result = await enrollUser({ nik, faceImageBase64, referenceId: walletAddress });
    logRoute(rid, "POST /api/kyc/enroll", "enroll completed", { success: result.success });
    res.json({
      success: result.success,
      message: result.success ? "User enrolled successfully" : "Enrollment failed",
      raw: result.raw,
    });
  } catch (err) {
    console.error(`[API][${rid}][POST /api/kyc/enroll] error`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── KYC: Verify identity + whitelist wallet ──────────────────────────────────
// POST /api/kyc/verify   { walletAddress, nik, faceImageBase64 }
// Flow: InterBio IDToBio check → if passes → whitelist wallet on DIDRegistry
app.post("/api/kyc/verify", upload.single("faceImage"), async (req, res) => {
  const rid = requestId();
  try {
    let { walletAddress, nik, faceImageBase64, did } = req.body;
    if (req.file) faceImageBase64 = req.file.buffer.toString("base64");
    logRoute(rid, "POST /api/kyc/verify", "request received", {
      walletAddress,
      nikLength: nik ? String(nik).length : 0,
      hasFaceImage: Boolean(faceImageBase64),
      hasDid: Boolean(did),
    });

    if (!walletAddress || !nik || !faceImageBase64) {
      logRoute(rid, "POST /api/kyc/verify", "validation failed");
      return res.status(400).json({ error: "walletAddress, nik, and faceImage are required" });
    }

    // Step 1: InterBio KYC — verify face against government NIK record
    const kycResult = await verifyUser({ nik, faceImageBase64, referenceId: walletAddress });
    logRoute(rid, "POST /api/kyc/verify", "kyc provider response", {
      verified: kycResult.verified,
      score: kycResult.score,
    });

    if (!kycResult.verified) {
      logRoute(rid, "POST /api/kyc/verify", "verification failed");
      return res.json({
        kycVerified: false,
        score: kycResult.score,
        message: "KYC verification failed — face does not match NIK record",
        onChain: null,
      });
    }

    // Step 2: KYC passed → whitelist wallet on-chain (DIDRegistry)
    let chainResult = null;
    try {
      chainResult = await whitelistWallet(walletAddress);
      logRoute(rid, "POST /api/kyc/verify", "wallet whitelisted", chainResult);
    } catch (whitelistErr) {
      if (whitelistErr.message?.includes("Already verified")) {
        logRoute(rid, "POST /api/kyc/verify", "wallet already verified");
      } else {
        throw whitelistErr;
      }
    }

    // Step 3: Issue Reusable Identity Credential (VC)
    const credential = await signIdentityCredential(
      walletAddress,
      did || "did:polygonid:polygon:amoy:offline",
      kycResult.score || 13
    );
    logRoute(rid, "POST /api/kyc/verify", "credential issued", {
      issuer: credential.issuer,
      timestamp: credential.timestamp,
    });

    // Step 4: Prepare Polygon ID IndonesiaKYC credential (JSON-LD)
    const polygonIdCredential = await issueIndonesiaKycCredential({
      did: did || "did:polygonid:polygon:amoy:offline",
      walletAddress,
      fusedScore: kycResult.score || 13,
      isVerified: true,
    });
    logRoute(rid, "POST /api/kyc/verify", "polygon id credential prepared", {
      issuer: polygonIdCredential.issuer,
    });

    res.json({
      kycVerified: true,
      score: kycResult.score,
      message: chainResult
        ? "KYC verified ✅ — Wallet whitelisted and Verifiable Credential issued"
        : "KYC verified ✅ — Wallet was already whitelisted; Verifiable Credential issued",
      onChain: chainResult,
      credential,
      polygonIdCredential,
    });
  } catch (err) {
    console.error(`[API][${rid}][POST /api/kyc/verify] error`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Cross-border transfer ────────────────────────────────────────────────────
// POST /api/transfer
// { fromWallet, toWallet, amountEth, fromCountry, toCountry, proof }
// Contract checks: isVerified(fromWallet) → if true → sends ETH → emits event
app.post("/api/transfer", async (req, res) => {
  const rid = requestId();
  try {
    const {
      fromWallet,
      toWallet,
      amountEth,
      fromCountry = "Indonesia",
      toCountry = "Vietnam",
      proof,
    } = req.body;
    logRoute(rid, "POST /api/transfer", "request received", {
      fromWallet,
      toWallet,
      amountEth,
      hasProof: Boolean(proof),
    });

    if (!fromWallet || !toWallet || !amountEth) {
      logRoute(rid, "POST /api/transfer", "validation failed: required fields");
      return res.status(400).json({ error: "fromWallet, toWallet, and amountEth are required" });
    }
    if (isNaN(parseFloat(amountEth)) || parseFloat(amountEth) <= 0) {
      logRoute(rid, "POST /api/transfer", "validation failed: amount");
      return res.status(400).json({ error: "amountEth must be a positive number" });
    }
    const hasProofArray = Array.isArray(proof?.proof) && proof.proof.length === 8;
    const hasInputs = Array.isArray(proof?.inputs);
    const hasRequestId = proof?.requestId !== undefined && proof?.requestId !== null;
    if (!proof || !hasRequestId || !hasInputs || !hasProofArray) {
      logRoute(rid, "POST /api/transfer", "validation failed: proof shape");
      return res.status(400).json({
        error: "proof with fields requestId (uint64), inputs (uint256[]), and proof (uint256[8]) is required",
      });
    }

    const result = await executeCrossBorderTransfer({
      fromWallet,
      toWallet,
      amountEth,
      fromCountry,
      toCountry,
      proof,
    });
    logRoute(rid, "POST /api/transfer", "transfer completed", result);

    res.json({
      success: true,
      message: `✅ Cross-border transfer complete: ${fromCountry} → ${toCountry}`,
      transfer: result,
    });
  } catch (err) {
    console.error(`[API][${rid}][POST /api/transfer] error`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Check verification status ────────────────────────────────────────────────
// GET /api/check/:walletAddress
app.get("/api/check/:walletAddress", async (req, res) => {
  const rid = requestId();
  try {
    logRoute(rid, "GET /api/check/:walletAddress", "request received", {
      walletAddress: req.params.walletAddress,
    });
    const result = await checkVerification(req.params.walletAddress);
    logRoute(rid, "GET /api/check/:walletAddress", "response ok", result);
    res.json({ ...result, contractAddress: process.env.CONTRACT_ADDRESS });
  } catch (err) {
    console.error(`[API][${rid}][GET /api/check/:walletAddress] error`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  const kyc = getKycConfig();
  console.log(`\n🚀 DID Backend running on http://localhost:${PORT}`);
  console.log(`\n📄 DIDRegistry:    ${process.env.CONTRACT_ADDRESS || "⚠️  NOT SET"}`);
  console.log(`🌉 CrossBorderBridge: ${process.env.BRIDGE_ADDRESS || "⚠️  NOT SET"}`);
  console.log(`🌐 Network: Polygon Amoy`);
  console.log(`🧪 KYC Mode: ${kyc.mockKyc ? "MOCK" : "LIVE"}`);
  console.log(`🔐 InterBio URL: ${kyc.baseUrl}`);
  console.log(`🪪 InterBio Credentials: ${kyc.hasCredentials ? "configured" : "missing"}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /api/kyc/enroll    — Enroll user biometrics`);
  console.log(`  POST /api/kyc/verify    — Verify KYC + whitelist wallet`);
  console.log(`  POST /api/transfer      — Cross-border transfer (verified wallets only)`);
  console.log(`  GET  /api/check/:addr   — Check if wallet is KYC verified\n`);
});
