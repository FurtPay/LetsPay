pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — confidential payroll via the note model (Phase 4, Feature 1).
//
// Extends payroll.circom: in addition to proving the aggregate (sum ==
// total_budget, each active salary in (0, max_salary], headcount), it emits
// one opaque "note" commitment per recipient: note_commitment[i] =
// Poseidon(sal[i], note_blinding[i]).
//
// A note is structurally identical to an invoice escrow_commitment, so the
// on-chain side stores each note as an InvoiceEscrow with range [0, MAX] and
// recipients claim them into their confidential balance via the existing
// settle_escrow / settle_escrow_new path — no per-recipient balance update is
// performed by the employer (which is cryptographically impossible: the
// employer doesn't hold recipients' balance secrets).
//
// The employer pays total_budget into the contract publicly (the total is
// already public by design); individual salaries never appear on-chain.
//
// Public signal order (outputs first, then public inputs):
//   [ payroll_commitment, note_commitment[0..9], total_budget, max_salary, active_count ]
//   (14 signals total → VK ic.len() == 15)
//
// Compile: circom payroll_notes.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template PayrollNotes(N, BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input sal[N];
    signal input salt;
    signal input is_active[N];
    signal input note_blinding[N];

    // ── Public inputs ────────────────────────────────────────────────
    signal input total_budget;
    signal input max_salary;
    signal input active_count;

    // ── Public outputs ───────────────────────────────────────────────
    signal output payroll_commitment;
    signal output note_commitment[N];

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
        gt[i] = GreaterThan(BITS);
        gt[i].in[0] <== sal[i];
        gt[i].in[1] <== 0;
        is_active[i] * (1 - gt[i].out) === 0;

        lte[i] = LessEqThan(BITS);
        lte[i].in[0] <== sal[i];
        lte[i].in[1] <== max_salary;
        is_active[i] * (1 - lte[i].out) === 0;

        iszero[i] = IsZero();
        iszero[i].in <== sal[i];
        (1 - is_active[i]) * (1 - iszero[i].out) === 0;

        running_sum[i + 1] <== running_sum[i] + sal[i] * is_active[i];
    }

    running_sum[N] === total_budget;

    // ── commitment (nullifier) ───────────────────────────────────────
    component hasher = Poseidon(N + 1);
    for (var i = 0; i < N; i++) {
        hasher.inputs[i] <== sal[i];
    }
    hasher.inputs[N] <== salt;
    payroll_commitment <== hasher.out;

    // ── per-recipient note commitments ───────────────────────────────
    // note_commitment[i] = Poseidon(sal[i], note_blinding[i])
    // For inactive slots sal[i] == 0, producing Poseidon(0, blinding) — the
    // contract ignores notes beyond active_count.
    component note_hasher[N];
    for (var i = 0; i < N; i++) {
        note_hasher[i] = Poseidon(2);
        note_hasher[i].inputs[0] <== sal[i];
        note_hasher[i].inputs[1] <== note_blinding[i];
        note_commitment[i] <== note_hasher[i].out;
    }
}

component main {
    public [total_budget, max_salary, active_count]
} = PayrollNotes(10, 64);
