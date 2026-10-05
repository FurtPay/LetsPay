pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Payfurt — confidential ledger: first-ever deposit for an account (Phase 4).
//
// Brand-new confidential accounts have no prior commitment to check against,
// so this circuit skips the old-balance consistency check entirely (avoiding
// the need for a magic "empty commitment" constant). Subsequent deposits use
// deposit_topup.circom instead.
//
// Proves:
//   commitment == Poseidon(balance, blinding)
//   balance == amount   (the newly shielded amount is the entire balance)
//   amount > 0
//
// Public signal order (output first, then public inputs):
//   [ commitment, amount ]
//   (2 signals total → VK ic.len() == 3)
//
// Compile: circom deposit_new.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template DepositNew(BITS) {
    // ── Private inputs ───────────────────────────────────────────────
    signal input balance;   // == amount, but kept as a separate witness for symmetry with top-up/withdraw
    signal input blinding;  // random blinding factor chosen by the depositor

    // ── Public input ─────────────────────────────────────────────────
    signal input amount;    // shielded amount — visible at the deposit boundary

    // ── Public output ────────────────────────────────────────────────
    signal output commitment;  // Poseidon(balance, blinding)

    balance === amount;

    component gt = GreaterThan(BITS);
    gt.in[0] <== amount;
    gt.in[1] <== 0;
    gt.out === 1;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== balance;
    hasher.inputs[1] <== blinding;
    commitment <== hasher.out;
}

component main {
    public [amount]
} = DepositNew(64);
