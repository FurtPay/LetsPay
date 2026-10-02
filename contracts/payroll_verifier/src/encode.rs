//! Encodes contract-native public inputs into `Vec<Fr>` for the Groth16 verifier.
//!
//! Signal order MUST match each circuit's publicSignals order.
//! circom emits: all `signal output` declarations first (in order), then
//! all `public [...]` inputs (in declaration order).
//!
//! `payroll.circom`        → [commitment, leaf[0..9], total_budget, max_salary, active_count]
//! `invoice.circom`        → [commitment, invoice_min, invoice_max, amount]
//! `salary_bracket.circom` → [salary_leaf_hash, bracket_low, bracket_high]

use soroban_sdk::{crypto::bls12_381::Fr, BytesN, Env, Vec};

/// Big-endian 32-byte field element from a non-negative integer.
pub(crate) fn fr_from_u128(env: &Env, v: u128) -> Fr {
    let mut buf = [0u8; 32];
    buf[16..32].copy_from_slice(&v.to_be_bytes());
    Fr::from_bytes(BytesN::from_array(env, &buf))
}

/// Public signals for `payroll.circom` (14 signals → VK ic.len() == 15).
///
/// Signal order mirrors the circuit:
///   output[0]  = payroll_commitment
///   output[1..10] = leaf_hash[0..9]  (zero-padded to MAX_HEADCOUNT)
///   input[11] = total_budget
///   input[12] = max_salary
///   input[13] = active_count
pub fn encode_payroll_inputs(
    env: &Env,
    total_budget: i128,
    max_salary: i128,
    active_count: u32,
    commitment: &BytesN<32>,
    leaf_hashes: &Vec<BytesN<32>>,
) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    // output 0: commitment
    signals.push_back(Fr::from_bytes(commitment.clone()));
    // outputs 1-10: leaf hashes (zero-padded to MAX_HEADCOUNT)
    let zero_leaf = BytesN::from_array(env, &[0u8; 32]);
    for i in 0..super::MAX_HEADCOUNT {
        let leaf = leaf_hashes.get(i).unwrap_or(zero_leaf.clone());
        signals.push_back(Fr::from_bytes(leaf));
    }
    // public inputs 11-13
    signals.push_back(fr_from_u128(env, total_budget as u128));
    signals.push_back(fr_from_u128(env, max_salary as u128));
    signals.push_back(fr_from_u128(env, active_count as u128));
    signals
}

/// Public signals for `invoice.circom` (4 signals → VK ic.len() == 5).
///
/// Signal order:
///   output[0] = invoice_commitment
///   input[1]  = invoice_min
///   input[2]  = invoice_max
///   input[3]  = amount  (= amount_escrowed on-chain)
pub fn encode_invoice_inputs(
    env: &Env,
    invoice_min: i128,
    invoice_max: i128,
    amount: i128,
    commitment: &BytesN<32>,
) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    // output 0: commitment
    signals.push_back(Fr::from_bytes(commitment.clone()));
    // public inputs 1-3
    signals.push_back(fr_from_u128(env, invoice_min as u128));
    signals.push_back(fr_from_u128(env, invoice_max as u128));
    signals.push_back(fr_from_u128(env, amount as u128));
    signals
}

/// Public signals for `salary_bracket.circom` (3 signals → VK ic.len() == 4).
///
/// Signal order:
///   output[0] = salary_leaf_hash  = Poseidon(salary, salt, slot_index)
///   input[1]  = bracket_low
///   input[2]  = bracket_high
pub fn encode_bracket_inputs(
    env: &Env,
    bracket_low: i128,
    bracket_high: i128,
    leaf_hash: &BytesN<32>,
) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    // output 0: leaf hash
    signals.push_back(Fr::from_bytes(leaf_hash.clone()));
    // public inputs 1-2
    signals.push_back(fr_from_u128(env, bracket_low as u128));
    signals.push_back(fr_from_u128(env, bracket_high as u128));
    signals
}

/// Public signals for `minimum_wage.circom` and `pay_equity.circom` — both share
/// the shape `[payroll_commitment, param, active_count]` (3 signals → ic.len() == 4).
/// `param` is `min_wage` or `epsilon` respectively.
pub fn encode_payroll_attestation_inputs(
    env: &Env,
    commitment: &BytesN<32>,
    param: i128,
    active_count: u32,
) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    signals.push_back(Fr::from_bytes(commitment.clone()));
    signals.push_back(fr_from_u128(env, param as u128));
    signals.push_back(fr_from_u128(env, active_count as u128));
    signals
}

/// Public signals for `income_proof.circom` (N note commitments + threshold →
/// ic.len() == N + 2). `note_commitments` must already be padded to length N
/// (zero commitments for unused slots).
pub fn encode_income_inputs(
    env: &Env,
    note_commitments: &Vec<BytesN<32>>,
    threshold: i128,
) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    for c in note_commitments.iter() {
        signals.push_back(Fr::from_bytes(c));
    }
    signals.push_back(fr_from_u128(env, threshold as u128));
    signals
}
