pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — confidential invoice escrow: contractor settles (Phase 4).
//
// Replaces invoice.circom. The contractor proves the locked amount is within
// the agreed range AND credits their own confidential balance, all in one
// proof — the amount never appears as a public signal.
//
// Proves:
//   Poseidon(amount, escrow_blinding) == escrow_commitment
//   invoice_min <= amount <= invoice_max
//   Poseidon(payee_old_balance, payee_old_blinding) == payee_old_commitment
//   payee_new_balance == payee_old_balance + amount
//   payee_new_commitment == Poseidon(payee_new_balance, payee_new_blinding)
//
// Public signal order (output first, then public inputs):
//   [ payee_new_commitment, escrow_commitment, invoice_min, invoice_max, payee_old_commitment ]
//   (5 signals total → VK ic.len() == 6)
//
// Compile: circom escrow_settle.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template EscrowSettle(BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input amount;
    signal input escrow_blinding;
    signal input payee_old_balance;
    signal input payee_old_blinding;
    signal input payee_new_blinding;

    // ── Public inputs ────────────────────────────────────────────────
    signal input escrow_commitment;
    signal input invoice_min;
    signal input invoice_max;
    signal input payee_old_commitment;

    // ── Public output ────────────────────────────────────────────────
    signal output payee_new_commitment;

    component escrow_hasher = Poseidon(2);
    escrow_hasher.inputs[0] <== amount;
    escrow_hasher.inputs[1] <== escrow_blinding;
    escrow_hasher.out === escrow_commitment;

    component lte_low = LessEqThan(BITS);
    lte_low.in[0] <== invoice_min;
    lte_low.in[1] <== amount;
    lte_low.out === 1;

    component lte_high = LessEqThan(BITS);
    lte_high.in[0] <== amount;
    lte_high.in[1] <== invoice_max;
    lte_high.out === 1;

    component old_hasher = Poseidon(2);
    old_hasher.inputs[0] <== payee_old_balance;
    old_hasher.inputs[1] <== payee_old_blinding;
    old_hasher.out === payee_old_commitment;

    signal payee_new_balance;
    payee_new_balance <== payee_old_balance + amount;

    component new_hasher = Poseidon(2);
    new_hasher.inputs[0] <== payee_new_balance;
    new_hasher.inputs[1] <== payee_new_blinding;
    payee_new_commitment <== new_hasher.out;
}

component main {
    public [escrow_commitment, invoice_min, invoice_max, payee_old_commitment]
} = EscrowSettle(64);
