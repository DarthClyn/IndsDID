# GOE Alliance · TOTM — On-Chain KYC Cross-Border Identity Demo

**Live Demo:** Indonesia KYC → On-chain Identity → Cross-border Transfer (Indonesia → Vietnam)

---

## What This Proves

> An Indonesia KYC-verified user executes a cross-border ETH transfer to a Vietnam wallet through a smart contract that verifies identity — **without any personal data on-chain.**

| What's visible on-chain | What's hidden |
|---|---|
| Wallet address | NIK |
| `verified: true` flag | Name, age, face |
| Route (Indonesia → Vietnam) | All personal data |
| Transfer amount & tx hash | KYC raw response |

---

## Deployed Contracts (Sepolia)

| Contract | Address | Etherscan |
|---|---|---|
| DIDRegistry | `0x545623618F61490C5e981219379FCdda2eF77496` | [View](https://sepolia.etherscan.io/address/0x545623618F61490C5e981219379FCdda2eF77496) |
| CrossBorderBridge | `0x548E36bBbaEd0f4CEa9C5436811b71A8d2CED810` | [View](https://sepolia.etherscan.io/address/0x548E36bBbaEd0f4CEa9C5436811b71A8d2CED810) |

**Deployer:** `0x3A7fECFe9057E1A3CcAdB313D57b94E755a2d9D6`

---

## How to Run

### Terminal 1 — Backend API
```bash
cd backend
node server.js
# Runs on http://localhost:3001
```

### Terminal 2 — Frontend
```bash
npx serve@14 frontend -p 3000
# Open http://localhost:3000
```

---

## Demo Flow (5 Steps in Browser)

1. **Connect MetaMask** wallet to Sepolia testnet
2. **Enter NIK + face photo** → InterBio API checks face against Indonesia national ID
3. **KYC passes** → Admin backend calls `DIDRegistry.whitelist(walletAddress)` on Sepolia
4. **Cross-border transfer** → Enter Vietnam wallet + amount → `CrossBorderBridge.sendCrossBorder()` verifies KYC then sends ETH
5. **Verify any wallet** → `isVerified(address)` returns `true`/`false` publicly

---

## Architecture

```
[InterBio KYC API]          [Sepolia Testnet]
    IDToBio verify    →    DIDRegistry.whitelist(wallet)
    (face + NIK)           mapping(address => bool)
                                    ↓
                      CrossBorderBridge.sendCrossBorder()
                          require(didRegistry.isVerified(sender))
                          → ETH transfer executes
                          → event CrossBorderTransfer emitted
```

---

## API Endpoints (Backend :3001)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Contract addresses, InterBio config, bridge stats |
| POST | `/api/kyc/enroll` | Enroll user biometrics with InterBio |
| POST | `/api/kyc/verify` | KYC verify via InterBio (off-chain only, no on-chain write) |
| POST | `/api/contract/whitelist` | Re-verify biometrics and call `DIDRegistry.whitelist(wallet)` (Claim step) |
| GET | `/api/contract/verify-status/:wallet` | Check if wallet is verified in DIDRegistry |
| POST | `/api/contract/transfer` | Admin/relayer cross-border ETH transfer (gated by DIDRegistry.isVerified) |

---

## Polygon ID Integration (Replacing Legacy Groth16 ZKP)

This repo originally described a future Groth16 ZKP upgrade. It has now been
refactored to use **Polygon ID / Universal Verifier** instead of a custom
`ZKPVerifier` contract.

### On-chain

- `DIDRegistry.sol` keeps the primary `isVerified(address)` flag.
- `CrossBorderBridge.sol` continues to gate user-signer transfers with:

    ```solidity
    modifier onlyVerified() {
            require(didRegistry.isVerified(msg.sender), "Not KYC verified");
            _;
    }
    ```

- For admin / "on behalf" flows, the bridge now accepts a Polygon ID
    Universal Verifier-style proof struct instead of the old Groth16 verifier
    interface.

### Off-chain Polygon ID gate

- `backend/polygonIdService.js` defines a reusable **IndonesiaKYC** query:
    - `allowedIssuers: [POLYGON_ID_ISSUER_DID]`
    - `context: INDONESIA_KYC_SCHEMA_URL (IPFS)`
    - `type: "IndonesiaKYC"`
    - `credentialSubject.isVerified == true`
    - `credentialSubject.fusedScore >= 10`
- `issueIndonesiaKycCredential(...)` builds a JSON-LD VC for IndonesiaKYC
    (currently returned to the client and ready to be wired into an Issuer
    Node/state tree).
- `verifyIndonesiaKycProof(...)` is a **Verifier SDK scaffold** that supports:
    - `POLYGON_ID_VERIFIER_MODE=mock` → always-true for demos (with query echoed).
    - `POLYGON_ID_VERIFIER_MODE=real` → placeholder where you plug the official
        Polygon ID Verifier SDK against your Universal Verifier + STATE.

### Frontend flow additions

- After KYC success and DIDRegistry whitelisting, the UI exposes a
    **"Verify with Polygon ID"** step above the transfer form.
- The browser:
    - Calls `/api/polygonid/query` to fetch the IndonesiaKYC query + verifier
        and state addresses.
    - Posts a proof payload to `/api/polygonid/verify`.
    - Enables the cross-border transfer button only when Polygon ID verification
        reports `verified: true`.

This preserves the original privacy goals (no personal data on-chain) while
aligning the architecture with Polygon ID instead of a one-off Groth16 circuit.
