pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

// Payfurt — confidential invoice escrow: payer reclaims after timeout (Phase 4).
//
// Mirror of escrow_settle.circom, crediting the payer instead of the payee.
// No range check is needed — the payer can always reclaim the full locked
// amount once the escrow has expired unsettled.
//
// Proves:
//   Poseidon(amount, escrow_blinding) == escrow_commitment
//   Poseidon(payer_old_balance, payer_old_blinding) == payer_old_commitment
//   payer_new_balance == payer_old_balance + amount
//   payer_new_commitment == Poseidon(payer_new_balance, payer_new_blinding)
//
// Public signal order (output first, then public inputs):
//   [ payer_new_commitment, escrow_commitment, payer_old_commitment ]
//   (3 signals total → VK ic.len() == 4)
//
// Compile: circom escrow_cancel.circom --r1cs --wasm --sym --prime bls12381 -l node_modules
template EscrowCancel() {
    // ── Private inputs ───────────────────────────────────────────────
    signal input amount;
    signal input escrow_blinding;
    signal input payer_old_balance;
    signal input payer_old_blinding;
    signal input payer_new_blinding;

    // ── Public inputs ────────────────────────────────────────────────
    signal input escrow_commitment;
    signal input payer_old_commitment;

    // ── Public output ────────────────────────────────────────────────
    signal output payer_new_commitment;

    component escrow_hasher = Poseidon(2);
    escrow_hasher.inputs[0] <== amount;
    escrow_hasher.inputs[1] <== escrow_blinding;
    escrow_hasher.out === escrow_commitment;

    component old_hasher = Poseidon(2);
    old_hasher.inputs[0] <== payer_old_balance;
    old_hasher.inputs[1] <== payer_old_blinding;
    old_hasher.out === payer_old_commitment;

    signal payer_new_balance;
    payer_new_balance <== payer_old_balance + amount;

    component new_hasher = Poseidon(2);
    new_hasher.inputs[0] <== payer_new_balance;
    new_hasher.inputs[1] <== payer_new_blinding;
    payer_new_commitment <== new_hasher.out;
}

component main {
    public [escrow_commitment, payer_old_commitment]
} = EscrowCancel();
