const express = require("express");
const cors = require("cors");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { buildPoseidon } = require("circomlibjs");
const { enrollUser, verifyUser, getKycConfig } = require("./kycService");
const {
  whitelistWallet,
  checkVerification,
  executeCrossBorderTransfer,
  getBridgeStats,
} = require("./contractService");

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

function requestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function logRoute(id, route, step, data) {
  console.log(`[API][${id}][${route}] ${step}`, data || "");
}

// ─── Health / Info ────────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  const rid = requestId();
  try {
    const stats = await getBridgeStats();
    const kyc = getKycConfig();
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      registryAddress: process.env.CONTRACT_ADDRESS || "NOT_SET",
      bridgeAddress: process.env.BRIDGE_ADDRESS || "NOT_SET",
      bridgeStats: stats,
      kycMode: kyc.mockKyc ? "mock" : "live",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── KYC: Enroll ─────────────────────────────────────────────────────────────
app.post("/api/kyc/enroll", async (req, res) => {
  const rid = requestId();
  try {
    const { nik, image } = req.body;
    logRoute(rid, "POST /api/kyc/enroll", "received", { nik });

    if (!nik || !image) {
      return res.status(400).json({ error: "nik and image are required" });
    }

    const result = await enrollUser({ nik, faceImageBase64: image });
    res.json({ success: result.success, raw: result.raw });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── KYC: Verify ──────────────────────────────────
app.post("/api/kyc/verify", async (req, res) => {
  const rid = requestId();
  try {
    const { nik, image, wallet } = req.body;
    logRoute(rid, "POST /api/kyc/verify", "received", { nik, wallet });

    if (!nik || !image) {
      return res.status(400).json({ error: "nik and image are required" });
    }

    const kycResult = await verifyUser({ nik, faceImageBase64: image });
    logRoute(rid, "POST /api/kyc/verify", "kyc result", { verified: kycResult.verified });

    res.json({
      success: kycResult.verified,
      score: kycResult.score,
      message: kycResult.verified ? "KYC Success" : "KYC Failed",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Contract: Whitelist ──────────────────────────────────────────────────
// app.post("/api/contract/whitelist", async (req, res) => {
//   const rid = requestId();
//   try {
//     const { wallet, nik, image } = req.body;
//     logRoute(rid, "POST /api/contract/whitelist", "received", { wallet, nik });

//     if (!wallet || !nik || !image) {
//       return res.status(400).json({ error: "wallet, nik, and image are required for on-chain claim" });
//     }

//     // Secondary Verify: Ensure the credentials are valid before touching the chain
//     logRoute(rid, "POST /api/contract/whitelist", "re-verifying kyc...");
//     const kycResult = await verifyUser({ nik, faceImageBase64: image });
    
//     if (!kycResult.verified) {
//       logRoute(rid, "POST /api/contract/whitelist", "kyc failed", kycResult);
//       return res.status(403).json({ 
//         error: "Biometric verification failed. Cannot whitelist on-chain.",
//         score: kycResult.score 
//       });
//     }

//     logRoute(rid, "POST /api/contract/whitelist", "kyc passed, initiating trx");
//     const result = await whitelistWallet(wallet);
//     res.json({ success: true, hash: result.txHash });
//   } catch (err) {
//     if (err.message.includes("Already verified")) {
//        return res.json({ success: true, message: "Already whitelisted" });
//     }
//     res.status(500).json({ error: err.message });
//   }
// });
app.post("/api/contract/whitelist", async (req, res) => {
  const { wallet, nik, image } = req.body;
  
  // 1. InterBio Biometric Check
  const kycResult = await verifyUser({ nik, faceImageBase64: image });
  if (!kycResult.verified) return res.status(403).json({ error: "KYC failed" });

  // 2. Generate Identity Commitment
  const poseidon = await buildPoseidon();
  const secret = ethers.hexlify(ethers.randomBytes(32)); // Random secret
  const commitment = poseidon.F.toString(poseidon([nik, secret, wallet]));

  // 3. Whitelist the COMMITMENT on-chain instead of just the wallet
  const result = await whitelistWallet(wallet, commitment);

  // 4. Return Secret to User for LocalStorage
  res.json({ success: true, secret, commitment, hash: result.txHash });
});
// ─── Contract: Transfer ──────────────────────────────────────────────────
app.post("/api/contract/transfer", async (req, res) => {
  const rid = requestId();
  try {
    const { from, to, amount } = req.body;
    logRoute(rid, "POST /api/contract/transfer", "received", { from, to, amount });

    if (!from || !to || !amount) return res.status(400).json({ error: "Missing fields" });

    const result = await executeCrossBorderTransfer(from, to, amount);
    res.json({ success: true, hash: result.hash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Contract: Status ────────────────────────────────────────────────
app.get("/api/contract/verify-status/:wallet", async (req, res) => {
  const rid = requestId();
  try {
    const { wallet } = req.params;
    const result = await checkVerification(wallet);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Registry-Based DID Backend running on port ${PORT}`);
  console.log(`🧪 Mode: ${getKycConfig().mockKyc ? "MOCK" : "LIVE"}\n`);
});
