const axios = require("axios");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const MOCK_KYC = process.env.MOCK_KYC === "true";
const BASE_URL = process.env.INTERBIO_BASE_URL || "https://be-webevent.app.interbio.id";
const EMAIL = process.env.INTERBIO_EMAIL;
const PASSWORD = process.env.INTERBIO_PASSWORD;

let cachedToken = null;
let tokenExpiry = 0;

// ─── Step 1: Login and get bearer token ───────────────────────────────────────
async function getToken() {
  if (!MOCK_KYC) {
    if (!BASE_URL) throw new Error("INTERBIO_BASE_URL is not set");
    if (!EMAIL || !PASSWORD) throw new Error("INTERBIO_EMAIL and INTERBIO_PASSWORD are required for live KYC");
  }

  // Reuse token if still valid (5 min buffer)
  if (cachedToken && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  console.log("[KYC] Authenticating with InterBio...");
  const res = await axios.post(`${BASE_URL}/v1/auth/login`, {
    email: EMAIL,
    password: PASSWORD,
  });

  if (!res.data?.data?.token) {
    throw new Error("InterBio login failed: no token returned");
  }

  cachedToken = res.data.data.token;
  // Parse JWT expiry
  try {
    const payload = JSON.parse(Buffer.from(cachedToken.split(".")[1], "base64").toString());
    tokenExpiry = payload.exp * 1000;
  } catch {
    tokenExpiry = Date.now() + 3600000; // fallback: 1hr
  }

  console.log("[KYC] Auth success. Token obtained.");
  return cachedToken;
}

function authHeader(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ─── Step 2: Initiate KYC transaction ─────────────────────────────────────────
// transactionType 0 = Enroll, 3 = ID-to-Biometric verify
async function initiateKyc(token, transactionType) {
  console.log(`[KYC] Initiating transaction type ${transactionType}...`);
  const res = await axios.post(
    `${BASE_URL}/v1/kyc/initiate`,
    { transactionType, client: "web" },
    { headers: authHeader(token) }
  );
  const txId = res.data?.data?.transactionId || res.data?.transactionId;
  if (!txId) {
    throw new Error(`Could not get transactionId from initiate. Response: ${JSON.stringify(res.data)}`);
  }
  console.log("[KYC] TransactionId:", txId);
  return txId;
}

// ─── Enroll: Register new user biometrics against NIK ─────────────────────────
async function enrollUser({ nik, faceImageBase64, referenceId }) {
  if (MOCK_KYC) {
    console.log("[KYC MOCK] Enroll skipped — MOCK_KYC=true");
    return { success: true, raw: { mock: true, nik } };
  }
  console.log(`[KYC-PROVIDER] Starting enrollment for NIK: ${nik}`);
  const token = await getToken();
  const transactionId = await initiateKyc(token, 0);
  console.log(`[KYC-PROVIDER] Transaction initiated. ID: ${transactionId}`);

  const res = await axios.post(
    `${BASE_URL}/v1/kyc/enroll`,
    {
      transactionId,
      referenceId: referenceId || `ref_${Date.now()}`,
      faceImage: faceImageBase64,
      demographics: { nik },
      client: "web",
    },
    { headers: authHeader(token) }
  );

  console.log("[KYC-PROVIDER] Real API Enrollment Response Received:");
  console.dir(res.data, { depth: null });

  const success =
    res.data?.status?.isSuccess ??
    res.data?.isSuccess ??
    res.data?.success ??
    false;
    
  return { success, raw: res.data };
}

// ─── Verify: ID-to-Biometric — checks face against govt national ID record ────
// Returns { verified: bool, score: number (0-13, 13=best), raw }
async function verifyUser({ nik, faceImageBase64, referenceId }) {
  if (MOCK_KYC) {
    console.log("[KYC MOCK] Verify skipped — MOCK_KYC=true. Returning verified=true");
    return { verified: true, score: 13, raw: { mock: true, nik, message: "Mock KYC — always passes" } };
  }
  const token = await getToken();
  const transactionId = await initiateKyc(token, 3);

  console.log("[KYC] Verifying user against NIK:", nik);
  const res = await axios.post(
    `${BASE_URL}/v1/kyc/IDToBio`,
    {
      transactionId,
      referenceId: referenceId || "",
      faceImage: faceImageBase64,
      nik,
    },
    { headers: authHeader(token) }
  );

  console.log("[KYC] IDToBio response:", JSON.stringify(res.data));

  // Score 0-13; threshold ≥ 6 = match (adjust as needed)
  let score =
    res.data?.data?.scores?.fused_scores ??
    res.data?.scores?.fused_scores ??
    res.data?.fused_scores ??
    null;

  // InterBio demo often nests scores inside a JSON string field `data.response`.
  if (score === null && typeof res.data?.data?.response === "string") {
    try {
      const parsed = JSON.parse(res.data.data.response);
      const fused = parsed?.scores?.fused_scores;
      if (fused && typeof fused === "object") {
        const values = Object.values(fused).filter(v => typeof v === "number");
        if (values.length > 0) {
          score = values[0];
        }
      }
    } catch {
      // leave score as null if parsing fails
    }
  }

  const verified =
    score !== null ? score >= 6 : res.data?.data?.verified ?? res.data?.verified ?? false;

  return { verified, score, raw: res.data };
}

module.exports = {
  enrollUser,
  verifyUser,
  getKycConfig: () => ({
    mockKyc: MOCK_KYC,
    baseUrl: BASE_URL,
    hasCredentials: Boolean(EMAIL && PASSWORD),
  }),
};
