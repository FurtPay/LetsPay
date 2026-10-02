//! Encodes public inputs for the confidential-ledger circuits (Phase 4):
//! `deposit_new.circom`, `deposit_topup.circom`, `withdraw.circom`,
//! `escrow_lock.circom`, `escrow_settle.circom`, `escrow_cancel.circom`.
//!
//! Signal order mirrors each circuit exactly (output-first, then public
//! inputs in declaration order) — same convention as `encode.rs`.
//!
//! `deposit_new.circom`              → [commitment, amount]
//! `deposit_topup.circom` / `withdraw.circom` → [new_commitment, old_commitment, amount]
//! (both share the identical signal shape — only the witness differs)
//! `escrow_lock.circom`     → [new_commitment, escrow_commitment, old_commitment]
//! `escrow_settle.circom`   → [payee_new_commitment, escrow_commitment, invoice_min, invoice_max, payee_old_commitment]
//! `escrow_cancel.circom`   → [new_commitment, escrow_commitment, old_commitment]
//! (escrow_cancel shares escrow_lock's exact signal shape)
//! `escrow_settle_new.circom` → [payee_commitment, escrow_commitment, invoice_min, invoice_max]
//! (first-ever settlement for a payee with no prior confidential balance —
//! mirrors deposit_new.circom)

use soroban_sdk::{crypto::bls12_381::Fr, BytesN, Env, Vec};

use crate::encode::fr_from_u128;

/// Public signals for `deposit_new.circom` (2 signals → VK ic.len() == 3).
pub fn encode_deposit_new_inputs(env: &Env, amount: i128, commitment: &BytesN<32>) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    signals.push_back(Fr::from_bytes(commitment.clone()));
    signals.push_back(fr_from_u128(env, amount as u128));
    signals
}

/// Public signals shared by `deposit_topup.circom` and `withdraw.circom`
/// (3 signals → VK ic.len() == 4).
pub fn encode_balance_update_inputs(
    env: &Env,
    old_commitment: &BytesN<32>,
    amount: i128,
    new_commitment: &BytesN<32>,
) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    signals.push_back(Fr::from_bytes(new_commitment.clone()));
    signals.push_back(Fr::from_bytes(old_commitment.clone()));
    signals.push_back(fr_from_u128(env, amount as u128));
    signals
}

/// Public signals shared by `escrow_lock.circom` and `escrow_cancel.circom`
/// (3 signals → VK ic.len() == 4) — both share the exact
/// [new_commitment, escrow_commitment, old_commitment] shape.
pub fn encode_escrow_lock_inputs(
    env: &Env,
    old_commitment: &BytesN<32>,
    new_commitment: &BytesN<32>,
    escrow_commitment: &BytesN<32>,
) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    signals.push_back(Fr::from_bytes(new_commitment.clone()));
    signals.push_back(Fr::from_bytes(escrow_commitment.clone()));
    signals.push_back(Fr::from_bytes(old_commitment.clone()));
    signals
}

/// Public signals for `escrow_settle.circom` (5 signals → VK ic.len() == 6).
pub fn encode_escrow_settle_inputs(
    env: &Env,
    escrow_commitment: &BytesN<32>,
    invoice_min: i128,
    invoice_max: i128,
    payee_old_commitment: &BytesN<32>,
    payee_new_commitment: &BytesN<32>,
) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    signals.push_back(Fr::from_bytes(payee_new_commitment.clone()));
    signals.push_back(Fr::from_bytes(escrow_commitment.clone()));
    signals.push_back(fr_from_u128(env, invoice_min as u128));
    signals.push_back(fr_from_u128(env, invoice_max as u128));
    signals.push_back(Fr::from_bytes(payee_old_commitment.clone()));
    signals
}

/// Public signals for `escrow_settle_new.circom` (4 signals → VK ic.len() == 5).
pub fn encode_escrow_settle_new_inputs(
    env: &Env,
    escrow_commitment: &BytesN<32>,
    invoice_min: i128,
    invoice_max: i128,
    payee_commitment: &BytesN<32>,
) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    signals.push_back(Fr::from_bytes(payee_commitment.clone()));
    signals.push_back(Fr::from_bytes(escrow_commitment.clone()));
    signals.push_back(fr_from_u128(env, invoice_min as u128));
    signals.push_back(fr_from_u128(env, invoice_max as u128));
    signals
}

/// Public signals for `payroll_notes.circom` (14 signals → VK ic.len() == 15).
///
/// Signal order mirrors the circuit:
///   output[0]    = payroll_commitment
///   output[1..10] = note_commitment[0..9]  (all MAX_HEADCOUNT slots)
///   input[11] = total_budget
///   input[12] = max_salary
///   input[13] = active_count
pub fn encode_payroll_notes_inputs(
    env: &Env,
    total_budget: i128,
    max_salary: i128,
    active_count: u32,
    commitment: &BytesN<32>,
    note_commitments: &Vec<BytesN<32>>,
) -> Vec<Fr> {
    let mut signals = Vec::new(env);
    signals.push_back(Fr::from_bytes(commitment.clone()));
    let zero = BytesN::from_array(env, &[0u8; 32]);
    for i in 0..super::MAX_HEADCOUNT {
        let note = note_commitments.get(i).unwrap_or(zero.clone());
        signals.push_back(Fr::from_bytes(note));
    }
    signals.push_back(fr_from_u128(env, total_budget as u128));
    signals.push_back(fr_from_u128(env, max_salary as u128));
    signals.push_back(fr_from_u128(env, active_count as u128));
    signals
}
