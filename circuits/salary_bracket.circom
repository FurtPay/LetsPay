pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — salary bracket proof (Feature 5, note-anchored for the confidential build).
//
// An employee proves their salary is within a stated bracket without revealing
// the actual value. The proof anchors to the same opaque note the employee was
// paid in: note_commitment = Poseidon(salary, note_blinding), stored on-chain
// as InvoiceEscrow.escrow_commitment by disburse_confidential. The employee
// already holds (salary, note_blinding) from claiming their pay.
//
// Proves:
//   note_commitment == Poseidon(salary, note_blinding)
//   bracket_low <= salary <= bracket_high
//
// Public signal order (output first, then public inputs):
//   [ note_commitment, bracket_low, bracket_high ]
//   (3 signals total → VK ic.len() == 4)
//
// The verifier (salary_bracket_verifier) fetches note_commitment from
// payroll_verifier's InvoiceEscrow.escrow_commitment and passes it as the
// expected public output, after checking the escrow's payee is the employee.
//
// Compile: circom salary_bracket.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template SalaryBracketProof(BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input salary;        // actual salary amount
    signal input note_blinding; // blinding of the note the employee was paid in

    // ── Public inputs ────────────────────────────────────────────────
    signal input bracket_low;   // lower bound of stated salary bracket
    signal input bracket_high;  // upper bound of stated salary bracket

    // ── Public output ────────────────────────────────────────────────
    signal output note_commitment;  // Poseidon(salary, note_blinding)

    // ── range check: bracket_low <= salary <= bracket_high ────────────
    component lte_low = LessEqThan(BITS);
    lte_low.in[0] <== bracket_low;
    lte_low.in[1] <== salary;
    lte_low.out === 1;

    component lte_high = LessEqThan(BITS);
    lte_high.in[0] <== salary;
    lte_high.in[1] <== bracket_high;
    lte_high.out === 1;

    // ── note commitment (must match on-chain InvoiceEscrow.escrow_commitment) ──
    component hasher = Poseidon(2);
    hasher.inputs[0] <== salary;
    hasher.inputs[1] <== note_blinding;
    note_commitment <== hasher.out;
}

component main {
    public [bracket_low, bracket_high]
} = SalaryBracketProof(64);
