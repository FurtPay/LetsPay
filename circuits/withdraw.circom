pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — confidential ledger: deshield back to a real token transfer (Phase 4).
//
// Shared by Payroll recipients and Invoice's payer/contractor — anyone holding
// a confidential balance uses this to convert part (or all) of it back into a
// real, publicly-visible SAC transfer. The withdrawal amount is necessarily
// public (the network must validate the real transfer); this circuit's job is
// only to prove the withdrawal is backed by a sufficient confidential balance.
//
// Proves:
//   Poseidon(old_balance, old_blinding) == old_commitment
//   new_balance == old_balance - amount
//   new_balance >= 0   (cannot withdraw more than the balance holds)
//   amount > 0
//   new_commitment == Poseidon(new_balance, new_blinding)
//
// Public signal order (output first, then public inputs):
//   [ new_commitment, old_commitment, amount ]
//   (3 signals total → VK ic.len() == 4)
//
// Compile: circom withdraw.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template Withdraw(BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input old_balance;
    signal input old_blinding;
    signal input new_blinding;

    // ── Public inputs ────────────────────────────────────────────────
    signal input old_commitment;
    signal input amount;        // withdrawal amount — visible at the deshield boundary

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
}

component main {
    public [old_commitment, amount]
} = Withdraw(64);
