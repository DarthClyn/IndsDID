// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockVerifier
 * @notice A dummy implementation of the IUniversalVerifier interface for browser-only DID demos.
 *         It satisfies the proof structure but always returns true for the verification.
 */
contract MockVerifier {
    struct Proof {
        uint64 requestId;
        uint256[] inputs;
        uint256[8] proof;
    }

    /// @notice Always returns true to facilitate the browser-side mock ZKP flow.
    /// @param proof The Groth16 proof payload (ignored in this mock implementation).
    /// @return bool Always true.
    function verify(Proof calldata proof) external pure returns (bool) {
        // In a real ZKP system, this would perform a cryptographic pairing check.
        // For the browser-only demo, we accept any proof of the correct shape.
        return true; 
    }
}
