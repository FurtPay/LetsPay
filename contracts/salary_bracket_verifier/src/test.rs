#![cfg(test)]

//! Tests for `salary_bracket_verifier` (note-anchored, confidential build).
//!
//! All paths that execute *before* the BLS12-381 pairing check are covered with
//! dummy VKs (all-zero bytes) and dummy proofs. The full happy path (a real
//! `salary_bracket.circom` proof passes) is covered by an on-chain e2e.
//!
//! Escrow/note state is seeded directly via `env.as_contract` on the registered
//! `payroll_verifier` contract address — this bypasses the ZK check and lets us
//! test the cross-contract plumbing independently.

use super::*;
use soroban_sdk::{
    crypto::bls12_381::{G1Affine, G2Affine},
    testutils::Address as _,
    Address, BytesN, Env, Vec,
};
use payroll_verifier::{DataKey as PvKey, InvoiceEscrow, PayrollBatch, PayrollVerifier};

// ── Dummy crypto helpers ──────────────────────────────────────────────────────

/// Dummy VK with `ic_len` IC points (all-zero G1, intentionally invalid).
fn dummy_vk_n(env: &Env, ic_len: u32) -> VerificationKey {
    let g1 = G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 96]));
    let g2 = G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 192]));
    let mut ic = Vec::new(env);
    for _ in 0..ic_len {
        ic.push_back(g1.clone());
    }
    VerificationKey { alpha: g1, beta: g2.clone(), gamma: g2.clone(), delta: g2, ic }
}

/// Bracket VK: ic.len() == 4 (3 public signals: note_commitment, bracket_low, bracket_high).
fn dummy_vk(env: &Env) -> VerificationKey {
    dummy_vk_n(env, 4)
}

fn dummy_proof(env: &Env) -> Proof {
    Proof {
        a: G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 96])),
        b: G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 192])),
        c: G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 96])),
    }
}

// ── Fixture ───────────────────────────────────────────────────────────────────

struct Fixture {
    env: Env,
    client: SalaryBracketVerifierClient<'static>,
    pv_addr: Address,
    employee: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let pv_addr = env.register(PayrollVerifier, ());

    let sbv_id = env.register(SalaryBracketVerifier, ());
    let client = SalaryBracketVerifierClient::new(&env, &sbv_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &dummy_vk(&env), &pv_addr);
    // min_wage / pay_equity: ic.len()==4; income: ic.len()==10 (8 notes + threshold + 1)
    client.set_attestation_vks(&dummy_vk_n(&env, 4), &dummy_vk_n(&env, 4), &dummy_vk_n(&env, 10));

    let employee = Address::generate(&env);
    Fixture { env, client, pv_addr, employee }
}

/// Seed a `PayrollBatch` at `batch_id` inside `pv_addr`'s storage.
fn seed_batch(f: &Fixture, batch_id: u64, headcount: u32) {
    f.env.as_contract(&f.pv_addr, || {
        let batch = PayrollBatch {
            employer: Address::generate(&f.env),
            total_budget: 1_000_000,
            headcount,
            commitment: BytesN::from_array(&f.env, &[0x33u8; 32]),
            token: Address::generate(&f.env),
            executed_at: 1_000_000_000,
            leaf_hashes: Vec::new(&f.env),
        };
        f.env.storage().persistent().set(&PvKey::Batch(batch_id), &batch);
    });
}

/// Seed an `InvoiceEscrow` (payroll note) at `escrow_id` inside `pv_addr`'s storage.
fn seed_escrow(f: &Fixture, escrow_id: u64, payee: &Address, escrow_commitment: BytesN<32>) {
    f.env.as_contract(&f.pv_addr, || {
        let escrow = InvoiceEscrow {
            payer: Address::generate(&f.env),
            payee: payee.clone(),
            token: Address::generate(&f.env),
            invoice_min: 0,
            invoice_max: 18_446_744_073_709_551_615,
            escrow_commitment,
            settled: false,
            created_at: 1_000_000_000,
        };
        f.env.storage().persistent().set(&PvKey::Escrow(escrow_id), &escrow);
    });
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn initialize_is_one_time() {
    let f = setup();
    let pv_addr = f.env.register(PayrollVerifier, ());
    let res = f.client.try_initialize(&Address::generate(&f.env), &dummy_vk(&f.env), &pv_addr);
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn initialize_without_prior_call_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(SalaryBracketVerifier, ());
    let client = SalaryBracketVerifierClient::new(&env, &id);
    let pv_addr = env.register(PayrollVerifier, ());
    let res = client.try_initialize(&Address::generate(&env), &dummy_vk(&env), &pv_addr);
    assert_eq!(res, Ok(Ok(())));
}

// ── prove_bracket: not initialized ───────────────────────────────────────────

#[test]
fn prove_bracket_not_initialized_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let sbv_id = env.register(SalaryBracketVerifier, ());
    let client = SalaryBracketVerifierClient::new(&env, &sbv_id);
    let employee = Address::generate(&env);

    let res = client.try_prove_bracket(
        &employee, &1u64, &10_000i128, &50_000i128, &dummy_proof(&env),
    );
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
}

// ── prove_bracket: escrow not found ──────────────────────────────────────────

#[test]
fn prove_bracket_escrow_not_found() {
    let f = setup();
    let res = f.client.try_prove_bracket(
        &f.employee, &999u64, &10_000i128, &50_000i128, &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::EscrowNotFound)));
}

// ── prove_bracket: wrong payee ────────────────────────────────────────────────

#[test]
fn prove_bracket_wrong_payee_rejected() {
    let f = setup();
    let real_payee = Address::generate(&f.env);
    seed_escrow(&f, 1, &real_payee, BytesN::from_array(&f.env, &[0xAAu8; 32]));

    // f.employee is NOT the payee.
    let res = f.client.try_prove_bracket(
        &f.employee, &1u64, &10_000i128, &50_000i128, &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
}

// ── prove_bracket: reaches proof check ───────────────────────────────────────

#[test]
fn prove_bracket_correct_payee_reaches_proof_verification() {
    // Valid payee + escrow — must reach the BLS12-381 call, not hit an early
    // error. All-zero dummy points cause the host to abort rather than return
    // InvalidProof gracefully; the abort IS the proof that we got here.
    let f = setup();
    seed_escrow(&f, 2, &f.employee, BytesN::from_array(&f.env, &[0xCCu8; 32]));

    let res = f.client.try_prove_bracket(
        &f.employee, &2u64, &10_000i128, &50_000i128, &dummy_proof(&f.env),
    );
    assert!(matches!(res, Err(Err(_))), "should abort at proof step, not earlier");
}

#[test]
fn different_escrows_are_independent() {
    let f = setup();
    seed_escrow(&f, 10, &f.employee, BytesN::from_array(&f.env, &[0xAAu8; 32]));
    seed_escrow(&f, 20, &f.employee, BytesN::from_array(&f.env, &[0xBBu8; 32]));

    let r10 = f.client.try_prove_bracket(
        &f.employee, &10u64, &10_000i128, &50_000i128, &dummy_proof(&f.env),
    );
    assert!(matches!(r10, Err(Err(_))), "escrow 10 should reach proof step");

    let r20 = f.client.try_prove_bracket(
        &f.employee, &20u64, &10_000i128, &50_000i128, &dummy_proof(&f.env),
    );
    assert!(matches!(r20, Err(Err(_))), "escrow 20 should reach proof step");

    let r30 = f.client.try_prove_bracket(
        &f.employee, &30u64, &10_000i128, &50_000i128, &dummy_proof(&f.env),
    );
    assert_eq!(r30, Err(Ok(Error::EscrowNotFound)));
}

// ── prove_bracket: malformed VK ───────────────────────────────────────────────

#[test]
fn prove_bracket_malformed_vk_detected() {
    let env = Env::default();
    env.mock_all_auths();

    let sbv_id = env.register(SalaryBracketVerifier, ());
    let client = SalaryBracketVerifierClient::new(&env, &sbv_id);
    let admin = Address::generate(&env);

    // ic.len() == 1 → needs 4 for 3 public signals.
    let g1 = G1Affine::from_bytes(BytesN::from_array(&env, &[0u8; 96]));
    let g2 = G2Affine::from_bytes(BytesN::from_array(&env, &[0u8; 192]));
    let mut bad_ic = Vec::new(&env);
    bad_ic.push_back(g1.clone());
    let bad_vk = VerificationKey {
        alpha: g1, beta: g2.clone(), gamma: g2.clone(), delta: g2, ic: bad_ic,
    };
    let pv_addr = env.register(PayrollVerifier, ());
    client.initialize(&admin, &bad_vk, &pv_addr);

    let employee = Address::generate(&env);
    env.as_contract(&pv_addr, || {
        let escrow = InvoiceEscrow {
            payer: Address::generate(&env),
            payee: employee.clone(),
            token: Address::generate(&env),
            invoice_min: 0,
            invoice_max: 18_446_744_073_709_551_615,
            escrow_commitment: BytesN::from_array(&env, &[0xEEu8; 32]),
            settled: false,
            created_at: 0,
        };
        env.storage().persistent().set(&PvKey::Escrow(1u64), &escrow);
    });

    let res = client.try_prove_bracket(
        &employee, &1u64, &10_000i128, &50_000i128, &dummy_proof(&env),
    );
    assert_eq!(res, Err(Ok(Error::MalformedVerifyingKey)));
}

// ── Feature 7: payroll attestations ───────────────────────────────────────────

#[test]
fn prove_min_wage_batch_not_found() {
    let f = setup();
    let res = f.client.try_prove_min_wage(&f.employee, &999u64, &10_000i128, &dummy_proof(&f.env));
    assert_eq!(res, Err(Ok(Error::BatchNotFound)));
}

#[test]
fn prove_min_wage_reaches_proof_verification() {
    let f = setup();
    seed_batch(&f, 1, 3);
    let res = f.client.try_prove_min_wage(&f.employee, &1u64, &10_000i128, &dummy_proof(&f.env));
    // All-zero BLS points abort at the host pairing call → we reached verification.
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn prove_min_wage_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let sbv_id = env.register(SalaryBracketVerifier, ());
    let client = SalaryBracketVerifierClient::new(&env, &sbv_id);
    // No initialize / set_attestation_vks → VkMinWage absent.
    let res = client.try_prove_min_wage(&Address::generate(&env), &1u64, &10_000i128, &dummy_proof(&env));
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
}

#[test]
fn prove_pay_equity_batch_not_found() {
    let f = setup();
    let res = f.client.try_prove_pay_equity(&f.employee, &999u64, &5_000i128, &dummy_proof(&f.env));
    assert_eq!(res, Err(Ok(Error::BatchNotFound)));
}

#[test]
fn prove_pay_equity_reaches_proof_verification() {
    let f = setup();
    seed_batch(&f, 2, 4);
    let res = f.client.try_prove_pay_equity(&f.employee, &2u64, &5_000i128, &dummy_proof(&f.env));
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn prove_income_empty_list_rejected() {
    let f = setup();
    let res = f.client.try_prove_income(
        &f.employee, &Vec::new(&f.env), &100_000i128, &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::InvalidInput)));
}

#[test]
fn prove_income_too_many_rejected() {
    let f = setup();
    let mut ids = Vec::new(&f.env);
    for i in 0..9u64 { ids.push_back(i + 1); } // 9 > INCOME_SLOTS (8)
    let res = f.client.try_prove_income(&f.employee, &ids, &100_000i128, &dummy_proof(&f.env));
    assert_eq!(res, Err(Ok(Error::InvalidInput)));
}

#[test]
fn prove_income_escrow_not_found() {
    let f = setup();
    let mut ids = Vec::new(&f.env);
    ids.push_back(999u64);
    let res = f.client.try_prove_income(&f.employee, &ids, &100_000i128, &dummy_proof(&f.env));
    assert_eq!(res, Err(Ok(Error::EscrowNotFound)));
}

#[test]
fn prove_income_wrong_payee_rejected() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    seed_escrow(&f, 1, &stranger, BytesN::from_array(&f.env, &[0xAAu8; 32]));
    let mut ids = Vec::new(&f.env);
    ids.push_back(1u64);
    let res = f.client.try_prove_income(&f.employee, &ids, &100_000i128, &dummy_proof(&f.env));
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
}

#[test]
fn prove_income_reaches_proof_verification() {
    let f = setup();
    seed_escrow(&f, 1, &f.employee, BytesN::from_array(&f.env, &[0xAAu8; 32]));
    seed_escrow(&f, 2, &f.employee, BytesN::from_array(&f.env, &[0xBBu8; 32]));
    let mut ids = Vec::new(&f.env);
    ids.push_back(1u64);
    ids.push_back(2u64);
    let res = f.client.try_prove_income(&f.employee, &ids, &100_000i128, &dummy_proof(&f.env));
    assert!(matches!(res, Err(Err(_))));
}
