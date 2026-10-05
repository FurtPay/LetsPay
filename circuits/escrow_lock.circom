pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — confidential invoice escrow: payer locks funds (Phase 4).
//
// The payer debits their confidential balance and creates an opaque escrow
// commitment holding the locked amount — the amount never appears as a
// public signal anywhere in this circuit.
//
// Proves:
//   Poseidon(old_balance, old_blinding) == old_commitment
//   new_balance == old_balance - amount
//   new_balance >= 0, amount > 0
//   new_commitment == Poseidon(new_balance, new_blinding)
//   escrow_commitment == Poseidon(amount, escrow_blinding)
//
// Public signal order (output first, then public inputs):
//   [ new_commitment, escrow_commitment, old_commitment ]
//   (3 signals total → VK ic.len() == 4)
//
// Compile: circom escrow_lock.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template EscrowLock(BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input old_balance;
    signal input old_blinding;
    signal input amount;
    signal input escrow_blinding;
    signal input new_blinding;

    // ── Public input ─────────────────────────────────────────────────
    signal input old_commitment;

    // ── Public outputs ───────────────────────────────────────────────
    signal output new_commitment;
    signal output escrow_commitment;

    component old_hasher = Poseidon(2);
    old_hasher.inputs[0] <== old_balance;
    old_hasher.inputs[1] <== old_blinding;
    old_hasher.out === old_commitment;

    component gt = GreaterThan(BITS);
    gt.in[0] <== amount;
    gt.in[1] <== 0;
    gt.out === 1;

    component lte = LessEqThan(BITS);
    lte.in[0] <== amount;
    lte.in[1] <== old_balance;
    lte.out === 1;

    signal new_balance;
    new_balance <== old_balance - amount;

    component new_hasher = Poseidon(2);
    new_hasher.inputs[0] <== new_balance;
    new_hasher.inputs[1] <== new_blinding;
    new_commitment <== new_hasher.out;

    component escrow_hasher = Poseidon(2);
    escrow_hasher.inputs[0] <== amount;
    escrow_hasher.inputs[1] <== escrow_blinding;
    escrow_commitment <== escrow_hasher.out;
}

component main {
    public [old_commitment]
} = EscrowLock(64);
