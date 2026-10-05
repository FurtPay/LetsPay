pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — minimum / living wage attestation (Feature 7).
//
// The employer proves that EVERY active salary in a payroll batch is at least
// `min_wage`, without revealing any individual salary. The proof is anchored to
// the batch's on-chain `payroll_commitment = Poseidon(sal[0..N-1], salt)`, so
// the attestation provably refers to a real, paid payroll — the employer can't
// substitute fake salaries.
//
// Proves:
//   payroll_commitment == Poseidon(sal[0..N-1], salt)
//   count(is_active) == active_count
//   ∀ active i: sal[i] >= min_wage
//
// Public signal order (output first, then public inputs):
//   [ payroll_commitment, min_wage, active_count ]
//   (3 signals → VK ic.len() == 4)
//
// Compile: circom minimum_wage.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template MinimumWage(N, BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input sal[N];
    signal input salt;
    signal input is_active[N];

    // ── Public inputs ────────────────────────────────────────────────
    signal input min_wage;
    signal input active_count;

    // ── Public output ────────────────────────────────────────────────
    signal output payroll_commitment;

    // is_active boolean
    for (var i = 0; i < N; i++) {
        is_active[i] * (is_active[i] - 1) === 0;
    }

    // active count matches
    signal acc[N + 1];
    acc[0] <== 0;
    for (var i = 0; i < N; i++) {
        acc[i + 1] <== acc[i] + is_active[i];
    }
    acc[N] === active_count;

    // commitment (same formula as payroll_notes.circom → anchors to the batch)
    component hasher = Poseidon(N + 1);
    for (var i = 0; i < N; i++) {
        hasher.inputs[i] <== sal[i];
    }
    hasher.inputs[N] <== salt;
    payroll_commitment <== hasher.out;

    // every active salary ≥ min_wage
    component ge[N];
    for (var i = 0; i < N; i++) {
        ge[i] = GreaterEqThan(BITS);
        ge[i].in[0] <== sal[i];
        ge[i].in[1] <== min_wage;
        is_active[i] * (1 - ge[i].out) === 0;
    }
}

component main {
    public [min_wage, active_count]
} = MinimumWage(10, 64);
