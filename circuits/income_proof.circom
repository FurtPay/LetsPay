pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — proof of income over time (Feature 7).
//
// An employee proves their CUMULATIVE income across several payroll notes is at
// least `threshold` (e.g. for a loan or visa), without revealing any individual
// amount. Each note is anchored to its on-chain commitment
// `note_commitment[j] = Poseidon(amount[j], note_blinding[j])`, which the
// verifier reads from the employee's escrows — so the income provably comes
// from real, received payments.
//
// Inactive slots (note_commitment == 0) let the employee prove over fewer than
// N notes.
//
// Proves:
//   ∀ active j: note_commitment[j] == Poseidon(amount[j], note_blinding[j])
//   Σ (active amount[j]) >= threshold
//
// Public signal order: [ note_commitment[0..N-1], threshold ]  (ic.len() == N+2)
//
// Compile: circom income_proof.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template IncomeProof(N, BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input amount[N];
    signal input note_blinding[N];
    signal input is_active[N];

    // ── Public inputs ────────────────────────────────────────────────
    signal input note_commitment[N];   // on-chain note commitments (0 for unused slots)
    signal input threshold;

    component hasher[N];
    signal contrib[N];
    signal sumacc[N + 1];
    sumacc[0] <== 0;

    for (var i = 0; i < N; i++) {
        is_active[i] * (is_active[i] - 1) === 0;

        hasher[i] = Poseidon(2);
        hasher[i].inputs[0] <== amount[i];
        hasher[i].inputs[1] <== note_blinding[i];
        // active slot → the note opening must match the on-chain commitment
        is_active[i] * (hasher[i].out - note_commitment[i]) === 0;

        contrib[i] <== amount[i] * is_active[i];
        sumacc[i + 1] <== sumacc[i] + contrib[i];
    }

    // cumulative income ≥ threshold
    component ge = GreaterEqThan(BITS);
    ge.in[0] <== sumacc[N];
    ge.in[1] <== threshold;
    ge.out === 1;
}

component main {
    public [note_commitment, threshold]
} = IncomeProof(8, 64);
