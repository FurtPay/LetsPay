pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — confidential payroll circuit (Feature 1, variable headcount via is_active).
//
// Proves, over N private salaries with a boolean activity mask:
//   sum(sal[i] * is_active[i]) == total_budget
//   is_active[i] == 1  ->  0 < sal[i] <= max_salary
//   is_active[i] == 0  ->  sal[i] == 0
//   payroll_commitment == Poseidon(sal[0..N-1], salt)
//   leaf_hash[i] == Poseidon(sal[i], salt, i)   (per-slot, for Feature 5)
//
// Public signal order (outputs first, then public inputs in declaration order):
//   [ payroll_commitment, leaf_hash[0..9], total_budget, max_salary, active_count ]
//   (14 signals total → VK ic.len() == 15)
//
// Compile for the BLS12-381 scalar field (matches the on-chain Groth16 verifier):
//   circom payroll.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template PayrollProof(N, BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input sal[N];            // salary amounts (token base units)
    signal input salt;              // random batch nonce
    signal input is_active[N];      // 1 = real employee, 0 = padding

    // ── Public inputs ────────────────────────────────────────────────
    signal input total_budget;         // declared total
    signal input max_salary;           // per-employee cap
    signal input active_count;         // declared headcount

    // ── Public outputs ───────────────────────────────────────────────
    signal output payroll_commitment;  // Poseidon(sal[0..N-1], salt)
    signal output leaf_hash[N];        // Poseidon(sal[i], salt, i) per slot

    // ── is_active must be boolean ────────────────────────────────────
    for (var i = 0; i < N; i++) {
        is_active[i] * (is_active[i] - 1) === 0;
    }

    // ── active count matches declared headcount ──────────────────────
    signal count_acc[N + 1];
    count_acc[0] <== 0;
    for (var i = 0; i < N; i++) {
        count_acc[i + 1] <== count_acc[i] + is_active[i];
    }
    count_acc[N] === active_count;

    // ── per-slot constraints + running sum ───────────────────────────
    signal running_sum[N + 1];
    running_sum[0] <== 0;

    component gt[N];
    component lte[N];
    component iszero[N];

    for (var i = 0; i < N; i++) {
        // active -> sal[i] > 0
        gt[i] = GreaterThan(BITS);
        gt[i].in[0] <== sal[i];
        gt[i].in[1] <== 0;
        is_active[i] * (1 - gt[i].out) === 0;

        // active -> sal[i] <= max_salary
        lte[i] = LessEqThan(BITS);
        lte[i].in[0] <== sal[i];
        lte[i].in[1] <== max_salary;
        is_active[i] * (1 - lte[i].out) === 0;

        // inactive -> sal[i] == 0
        iszero[i] = IsZero();
        iszero[i].in <== sal[i];
        (1 - is_active[i]) * (1 - iszero[i].out) === 0;

        // accumulate only active salaries
        running_sum[i + 1] <== running_sum[i] + sal[i] * is_active[i];
    }

    // ── sum conservation ─────────────────────────────────────────────
    running_sum[N] === total_budget;

    // ── commitment ────────────────────────────────────────────────────
    component hasher = Poseidon(N + 1);
    for (var i = 0; i < N; i++) {
        hasher.inputs[i] <== sal[i];
    }
    hasher.inputs[N] <== salt;
    payroll_commitment <== hasher.out;

    // ── per-slot leaf hashes (Feature 5: salary bracket proofs) ──────
    // leaf_hash[i] = Poseidon(sal[i], salt, i)
    // Stored on-chain in PayrollBatch.leaf_hashes[i] so employees can later
    // prove their salary is in a bracket without revealing the value.
    component leaf_hasher[N];
    for (var i = 0; i < N; i++) {
        leaf_hasher[i] = Poseidon(3);
        leaf_hasher[i].inputs[0] <== sal[i];
        leaf_hasher[i].inputs[1] <== salt;
        leaf_hasher[i].inputs[2] <== i;
        leaf_hash[i] <== leaf_hasher[i].out;
    }
}

component main {
    public [total_budget, max_salary, active_count]
} = PayrollProof(10, 64);
