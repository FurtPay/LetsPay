pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — pay-equity attestation (Feature 7).
//
// The employer proves the average salary of two cohorts (group A vs group B)
// differ by no more than `epsilon`, WITHOUT revealing any salary, either
// average, or the group sizes. Anchored to the batch's on-chain
// `payroll_commitment` so it provably refers to a real payroll.
//
// To avoid in-circuit division, the bound on |avgA − avgB| ≤ epsilon is proved
// by cross-multiplication:
//   |sumA·cntB − sumB·cntA| ≤ epsilon·cntA·cntB
// split into two non-negative comparisons.
//
// Proves:
//   payroll_commitment == Poseidon(sal[0..N-1], salt)
//   count(is_active) == active_count
//   cntA > 0 and cntB > 0
//   sumA·cntB ≤ sumB·cntA + epsilon·cntA·cntB
//   sumB·cntA ≤ sumA·cntB + epsilon·cntA·cntB
//
// Public signal order: [ payroll_commitment, epsilon, active_count ]  (ic.len() == 4)
//
// Compile: circom pay_equity.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template PayEquity(N, BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input sal[N];
    signal input salt;
    signal input is_active[N];
    signal input group[N];        // 0 = cohort A, 1 = cohort B

    // ── Public inputs ────────────────────────────────────────────────
    signal input epsilon;         // max allowed |avgA − avgB|, token base units
    signal input active_count;

    // ── Public output ────────────────────────────────────────────────
    signal output payroll_commitment;

    // booleans
    for (var i = 0; i < N; i++) {
        is_active[i] * (is_active[i] - 1) === 0;
        group[i] * (group[i] - 1) === 0;
    }

    // active count matches
    signal acc[N + 1];
    acc[0] <== 0;
    for (var i = 0; i < N; i++) {
        acc[i + 1] <== acc[i] + is_active[i];
    }
    acc[N] === active_count;

    // commitment (anchors to the batch)
    component hasher = Poseidon(N + 1);
    for (var i = 0; i < N; i++) {
        hasher.inputs[i] <== sal[i];
    }
    hasher.inputs[N] <== salt;
    payroll_commitment <== hasher.out;

    // per-cohort sums and counts
    signal sumA[N + 1];
    signal sumB[N + 1];
    signal cntA[N + 1];
    signal cntB[N + 1];
    sumA[0] <== 0; sumB[0] <== 0; cntA[0] <== 0; cntB[0] <== 0;

    signal aB[N];   // is_active AND group==1
    signal aA[N];   // is_active AND group==0
    for (var i = 0; i < N; i++) {
        aB[i] <== is_active[i] * group[i];
        aA[i] <== is_active[i] - aB[i];
        sumB[i + 1] <== sumB[i] + sal[i] * aB[i];
        sumA[i + 1] <== sumA[i] + sal[i] * aA[i];
        cntB[i + 1] <== cntB[i] + aB[i];
        cntA[i + 1] <== cntA[i] + aA[i];
    }

    // both cohorts non-empty
    component gtA = GreaterThan(BITS);
    gtA.in[0] <== cntA[N]; gtA.in[1] <== 0; gtA.out === 1;
    component gtB = GreaterThan(BITS);
    gtB.in[0] <== cntB[N]; gtB.in[1] <== 0; gtB.out === 1;

    // bound = epsilon · cntA · cntB
    signal cntAB;
    cntAB <== cntA[N] * cntB[N];
    signal bound;
    bound <== epsilon * cntAB;

    // cross products
    signal crossA;
    crossA <== sumA[N] * cntB[N];
    signal crossB;
    crossB <== sumB[N] * cntA[N];

    // |crossA − crossB| ≤ bound
    component le1 = LessEqThan(BITS);
    le1.in[0] <== crossA; le1.in[1] <== crossB + bound; le1.out === 1;
    component le2 = LessEqThan(BITS);
    le2.in[0] <== crossB; le2.in[1] <== crossA + bound; le2.out === 1;
}

component main {
    public [epsilon, active_count]
} = PayEquity(10, 64);
