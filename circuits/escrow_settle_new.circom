pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — confidential invoice escrow: first-ever settlement for a payee (Phase 4).
//
// Mirrors deposit_new.circom's role: a contractor with no prior confidential
// balance for this token cannot supply a payee_old_commitment, so this
// variant skips that check entirely. Subsequent settlements use the normal
// escrow_settle.circom instead.
//
// Proves:
//   Poseidon(amount, escrow_blinding) == escrow_commitment
//   invoice_min <= amount <= invoice_max
//   payee_balance == amount   (first settlement becomes the entire balance)
//   payee_commitment == Poseidon(payee_balance, payee_blinding)
//
// Public signal order (output first, then public inputs):
//   [ payee_commitment, escrow_commitment, invoice_min, invoice_max ]
//   (4 signals total → VK ic.len() == 5)
//
// Compile: circom escrow_settle_new.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template EscrowSettleNew(BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input amount;
    signal input escrow_blinding;
    signal input payee_balance;   // == amount, kept separate for symmetry with escrow_settle.circom
    signal input payee_blinding;

    // ── Public inputs ────────────────────────────────────────────────
    signal input escrow_commitment;
    signal input invoice_min;
    signal input invoice_max;

    // ── Public output ────────────────────────────────────────────────
    signal output payee_commitment;

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

    payee_balance === amount;

    component payee_hasher = Poseidon(2);
    payee_hasher.inputs[0] <== payee_balance;
    payee_hasher.inputs[1] <== payee_blinding;
    payee_commitment <== payee_hasher.out;
}

component main {
    public [escrow_commitment, invoice_min, invoice_max]
} = EscrowSettleNew(64);
