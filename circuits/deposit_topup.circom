pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — confidential ledger: top-up an existing confidential balance (Phase 4).
//
// Proves:
//   Poseidon(old_balance, old_blinding) == old_commitment
//   new_balance == old_balance + amount
//   amount > 0
//   new_commitment == Poseidon(new_balance, new_blinding)
//
// Public signal order (output first, then public inputs):
//   [ new_commitment, old_commitment, amount ]
//   (3 signals total → VK ic.len() == 4)
//
// Compile: circom deposit_topup.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template DepositTopup(BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input old_balance;
    signal input old_blinding;
    signal input new_blinding;

    // ── Public inputs ────────────────────────────────────────────────
    signal input old_commitment;
    signal input amount;        // shielded amount — visible at the deposit boundary

    // ── Public output ────────────────────────────────────────────────
    signal output new_commitment;

    component old_hasher = Poseidon(2);
    old_hasher.inputs[0] <== old_balance;
    old_hasher.inputs[1] <== old_blinding;
    old_hasher.out === old_commitment;

    component gt = GreaterThan(BITS);
    gt.in[0] <== amount;
    gt.in[1] <== 0;
    gt.out === 1;

    signal new_balance;
    new_balance <== old_balance + amount;

    component new_hasher = Poseidon(2);
    new_hasher.inputs[0] <== new_balance;
    new_hasher.inputs[1] <== new_blinding;
    new_commitment <== new_hasher.out;
}

component main {
    public [old_commitment, amount]
} = DepositTopup(64);
