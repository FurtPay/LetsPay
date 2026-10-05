pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — invoice escrow range proof (Feature 2).
//
// The contractor proves:
//   invoice_commitment == Poseidon(amount, salt)
//   invoice_min <= amount <= invoice_max
//   amount == revealed_amount  (matches the on-chain escrowed value)
//
// Public signal order (output first, then public inputs):
//   [ invoice_commitment, invoice_min, invoice_max, revealed_amount ]
//   (4 signals total → VK ic.len() == 5)
//
// The payer sees invoice_min, invoice_max, and revealed_amount on-chain.
// The salt remains private, binding the contractor to a specific amount.
//
// Compile: circom invoice.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template InvoiceProof(BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input amount;   // invoice amount (must equal revealed_amount)
    signal input salt;     // random nonce — keeps the commitment binding

    // ── Public inputs ────────────────────────────────────────────────
    signal input invoice_min;        // agreed lower bound
    signal input invoice_max;        // agreed upper bound
    signal input revealed_amount;    // amount_escrowed stored on-chain

    // ── Public output ────────────────────────────────────────────────
    signal output invoice_commitment;  // Poseidon(amount, salt)

    // ── private amount matches the publicly declared escrow amount ────
    amount === revealed_amount;

    // ── range check: invoice_min <= amount <= invoice_max ─────────────
    component lte_low = LessEqThan(BITS);
    lte_low.in[0] <== invoice_min;
    lte_low.in[1] <== amount;
    lte_low.out === 1;

    component lte_high = LessEqThan(BITS);
    lte_high.in[0] <== amount;
    lte_high.in[1] <== invoice_max;
    lte_high.out === 1;

    // ── commitment ────────────────────────────────────────────────────
    component hasher = Poseidon(2);
    hasher.inputs[0] <== amount;
    hasher.inputs[1] <== salt;
    invoice_commitment <== hasher.out;
}

component main {
    public [invoice_min, invoice_max, revealed_amount]
} = InvoiceProof(64);
