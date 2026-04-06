pragma circom 2.1.0;
include "node_modules/circomlib/circuits/poseidon.circom";

template IdentityProof() {
    // Private Inputs (Stay in user's browser)
    signal input nik;
    signal input secret;

    // Public Inputs (Seen by the blockchain/verifier)
    signal input wallet;
    signal input commitment;

    // 1. Calculate Poseidon Hash of NIK + Secret + Wallet
    component hasher = Poseidon(3);
    hasher.inputs[0] <== nik;
    hasher.inputs[1] <== secret;
    hasher.inputs[2] <== wallet;

    // 2. Constrain the hash to match the public commitment
    commitment === hasher.out;
}

component main {public [wallet, commitment]} = IdentityProof();