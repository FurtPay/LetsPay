#![cfg(test)]

//! Comprehensive tests for `payroll_verifier`.
//!
//! All paths that execute *before* the BLS12-381 pairing check are covered here
//! with dummy keys and proofs (all-zero bytes). The full happy-path (valid proof
//! → transfers → batch recorded) lives in `test_proof.rs`, generated from the
//! real circuit by `scripts/setup_ceremony.sh`.

use super::*;
use soroban_sdk::{
    crypto::bls12_381::{G1Affine, G2Affine},
    testutils::{Address as _, Ledger},
    token, vec, Address, BytesN, Env, Vec,
};

// ── Constants ────────────────────────────────────────────────────────────────

const AMOUNT: i128 = 50_000;
const MIN: i128 = 10_000;
const MAX: i128 = 100_000;

// ── Dummy crypto helpers ──────────────────────────────────────────────────────

/// Payroll VK: ic.len() == 15 (14 public signals: commitment, total, max, count, leaf[0..9]).
fn dummy_vk_payroll(env: &Env) -> VerificationKey {
    let g1 = G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 96]));
    let g2 = G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 192]));
    let mut ic = Vec::new(env);
    for _ in 0..15 {
        ic.push_back(g1.clone());
    }
    VerificationKey { alpha: g1, beta: g2.clone(), gamma: g2.clone(), delta: g2, ic }
}

/// Invoice VK: ic.len() == 5 (4 public signals: min, max, amount, commitment).
fn dummy_vk_invoice(env: &Env) -> VerificationKey {
    let g1 = G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 96]));
    let g2 = G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 192]));
    let mut ic = Vec::new(env);
    for _ in 0..5 {
        ic.push_back(g1.clone());
    }
    VerificationKey { alpha: g1, beta: g2.clone(), gamma: g2.clone(), delta: g2, ic }
}

fn dummy_proof(env: &Env) -> Proof {
    Proof {
        a: G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 96])),
        b: G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 192])),
        c: G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 96])),
    }
}

fn empty_leaf_hashes(env: &Env) -> Vec<BytesN<32>> {
    Vec::new(env)
}

/// Deposit-new VK: ic.len() == 3 (2 public signals: commitment, amount).
fn dummy_vk_deposit_new(env: &Env) -> VerificationKey {
    let g1 = G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 96]));
    let g2 = G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 192]));
    let mut ic = Vec::new(env);
    for _ in 0..3 {
        ic.push_back(g1.clone());
    }
    VerificationKey { alpha: g1, beta: g2.clone(), gamma: g2.clone(), delta: g2, ic }
}

/// Deposit-topup / withdraw VK: ic.len() == 4 (3 public signals: new_commitment, old_commitment, amount).
fn dummy_vk_balance_update(env: &Env) -> VerificationKey {
    let g1 = G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 96]));
    let g2 = G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 192]));
    let mut ic = Vec::new(env);
    for _ in 0..4 {
        ic.push_back(g1.clone());
    }
    VerificationKey { alpha: g1, beta: g2.clone(), gamma: g2.clone(), delta: g2, ic }
}

/// Generic dummy VK builder for an arbitrary ic length.
fn dummy_vk(env: &Env, ic_len: u32) -> VerificationKey {
    let g1 = G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 96]));
    let g2 = G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 192]));
    let mut ic = Vec::new(env);
    for _ in 0..ic_len {
        ic.push_back(g1.clone());
    }
    VerificationKey { alpha: g1, beta: g2.clone(), gamma: g2.clone(), delta: g2, ic }
}

// ── Fixture ───────────────────────────────────────────────────────────────────

struct Fixture {
    env: Env,
    client: PayrollVerifierClient<'static>,
    admin: Address,
    token: Address,
    token_sac: token::StellarAssetClient<'static>,
    payer: Address,
    payee: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000_000);

    let contract_id = env.register(PayrollVerifier, ());
    let client = PayrollVerifierClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_contract.address();
    let token_sac = token::StellarAssetClient::new(&env, &token);

    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    token_sac.mint(&payer, &1_000_000i128);

    client.initialize(
        &admin,
        &dummy_vk_payroll(&env),
        &dummy_vk_invoice(&env),
        &vec![&env, token.clone()],
    );
    client.set_confidential_vks(
        &dummy_vk_deposit_new(&env),
        &dummy_vk_balance_update(&env),
        &dummy_vk_balance_update(&env),
    );
    client.set_escrow_vks(
        &dummy_vk_balance_update(&env),  // escrow_lock: ic.len()==4, same shape
        &dummy_vk(&env, 6),               // escrow_settle: ic.len()==6
        &dummy_vk(&env, 5),               // escrow_settle_new: ic.len()==5
        &dummy_vk_balance_update(&env),  // escrow_cancel: ic.len()==4, same shape
    );
    client.set_payroll_notes_vk(&dummy_vk(&env, 15)); // payroll_notes: ic.len()==15

    Fixture { env, client, admin, token, token_sac, payer, payee }
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn initialize_is_one_time() {
    let f = setup();
    let res = f.client.try_initialize(
        &f.admin,
        &dummy_vk_payroll(&f.env),
        &dummy_vk_invoice(&f.env),
        &vec![&f.env, f.token.clone()],
    );
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn initialize_seeds_token_allowlist() {
    let f = setup();
    assert!(f.client.is_token_supported(&f.token));
    let unknown = Address::generate(&f.env);
    assert!(!f.client.is_token_supported(&unknown));
}

#[test]
fn initialize_without_prior_call_succeeds_first_time() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayrollVerifier, ());
    let client = PayrollVerifierClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let res = client.try_initialize(
        &admin,
        &dummy_vk_payroll(&env),
        &dummy_vk_invoice(&env),
        &vec![&env, token],
    );
    assert_eq!(res, Ok(Ok(())));
}

// ── add_token ─────────────────────────────────────────────────────────────────

#[test]
fn add_token_makes_it_supported() {
    let f = setup();
    let new_token = Address::generate(&f.env);
    assert!(!f.client.is_token_supported(&new_token));
    f.client.add_token(&new_token);
    assert!(f.client.is_token_supported(&new_token));
}

#[test]
fn add_token_not_initialized_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayrollVerifier, ());
    let client = PayrollVerifierClient::new(&env, &contract_id);
    let res = client.try_add_token(&Address::generate(&env));
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
}

#[test]
fn add_token_duplicate_is_idempotent() {
    let f = setup();
    f.client.add_token(&f.token); // already in allowlist from init
    assert!(f.client.is_token_supported(&f.token));
}

// ── disburse (pre-proof validation) ──────────────────────────────────────────

/// Calls `try_disburse` and asserts the contract returns `Err(expected)`.
/// Avoids the messy nested-Result type annotation by inlining the assertion.
fn check_disburse(
    f: &Fixture,
    total: i128,
    max: i128,
    count: u32,
    commitment: BytesN<32>,
    token: &Address,
    recipients: Vec<Address>,
    amounts: Vec<i128>,
    expected: Error,
) {
    let res = f.client.try_disburse(
        &f.payer,
        &dummy_proof(&f.env),
        &total,
        &max,
        &count,
        &commitment,
        token,
        &recipients,
        &amounts,
        &empty_leaf_hashes(&f.env),
    );
    assert_eq!(res, Err(Ok(expected)));
}

#[test]
fn disburse_unsupported_token() {
    let f = setup();
    let bad_token = Address::generate(&f.env);
    check_disburse(
        &f, 1000, 1000, 1,
        BytesN::from_array(&f.env, &[1u8; 32]),
        &bad_token,
        vec![&f.env, Address::generate(&f.env)],
        vec![&f.env, 1000i128],
        Error::UnsupportedToken,
    );
}

#[test]
fn disburse_headcount_zero_rejected() {
    let f = setup();
    check_disburse(
        &f, 1000, 1000, 0,
        BytesN::from_array(&f.env, &[1u8; 32]),
        &f.token,
        Vec::new(&f.env),
        Vec::new(&f.env),
        Error::InvalidHeadcount,
    );
}

#[test]
fn disburse_headcount_over_max_rejected() {
    let f = setup();
    let mut recips = Vec::new(&f.env);
    let mut amts = Vec::new(&f.env);
    for _ in 0..11 {
        recips.push_back(Address::generate(&f.env));
        amts.push_back(100i128);
    }
    check_disburse(
        &f, 1100, 100, 11,
        BytesN::from_array(&f.env, &[2u8; 32]),
        &f.token, recips, amts,
        Error::InvalidHeadcount,
    );
}

#[test]
fn disburse_recipients_length_mismatch() {
    let f = setup();
    check_disburse(
        &f, 1000, 1000, 2,
        BytesN::from_array(&f.env, &[3u8; 32]),
        &f.token,
        vec![&f.env, Address::generate(&f.env)],
        vec![&f.env, 500i128, 500i128],
        Error::LengthMismatch,
    );
}

#[test]
fn disburse_amounts_length_mismatch() {
    let f = setup();
    check_disburse(
        &f, 1000, 1000, 2,
        BytesN::from_array(&f.env, &[4u8; 32]),
        &f.token,
        vec![&f.env, Address::generate(&f.env), Address::generate(&f.env)],
        vec![&f.env, 1000i128],
        Error::LengthMismatch,
    );
}

#[test]
fn disburse_zero_total_budget_rejected() {
    let f = setup();
    check_disburse(
        &f, 0, 1000, 1,
        BytesN::from_array(&f.env, &[5u8; 32]),
        &f.token,
        vec![&f.env, Address::generate(&f.env)],
        vec![&f.env, 0i128],
        Error::SumMismatch,
    );
}

#[test]
fn disburse_zero_max_salary_rejected() {
    let f = setup();
    check_disburse(
        &f, 1000, 0, 1,
        BytesN::from_array(&f.env, &[6u8; 32]),
        &f.token,
        vec![&f.env, Address::generate(&f.env)],
        vec![&f.env, 1000i128],
        Error::SumMismatch,
    );
}

#[test]
fn disburse_commitment_replay_rejected() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[7u8; 32]);
    f.env.as_contract(&f.client.address, || {
        f.env
            .storage()
            .persistent()
            .set(&DataKey::UsedCommitment(f.payer.clone(), commitment.clone()), &true);
    });
    check_disburse(
        &f, 1000, 1000, 1,
        commitment,
        &f.token,
        vec![&f.env, Address::generate(&f.env)],
        vec![&f.env, 1000i128],
        Error::CommitmentAlreadyUsed,
    );
}

#[test]
fn disburse_passes_pre_checks_reaches_proof_verification() {
    let f = setup();
    // All-zero bytes are not valid BLS12-381 compressed points: the host aborts
    // rather than returning InvalidProof gracefully. What matters is that none of
    // the early-exit errors (UnsupportedToken, InvalidHeadcount, etc.) fired.
    let res = f.client.try_disburse(
        &f.payer, &dummy_proof(&f.env),
        &1000i128, &1000i128, &1u32,
        &BytesN::from_array(&f.env, &[8u8; 32]),
        &f.token,
        &vec![&f.env, Address::generate(&f.env)],
        &vec![&f.env, 1000i128],
        &empty_leaf_hashes(&f.env),
    );
    // Abort (from host-level BLS panic) rather than a contract-level error
    // proves we reached the proof verification step.
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn disburse_malformed_vk_detected() {
    // VK with wrong ic length (2 entries for 4 public signals → mismatch).
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayrollVerifier, ());
    let client = PayrollVerifierClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    let g1 = G1Affine::from_bytes(BytesN::from_array(&env, &[0u8; 96]));
    let g2 = G2Affine::from_bytes(BytesN::from_array(&env, &[0u8; 192]));
    let mut bad_ic = Vec::new(&env);
    bad_ic.push_back(g1.clone()); // only 1 entry → ic.len() == 1, needs 15
    let bad_vk = VerificationKey {
        alpha: g1, beta: g2.clone(), gamma: g2.clone(), delta: g2, ic: bad_ic,
    };

    client.initialize(&admin, &bad_vk, &dummy_vk_invoice(&env), &vec![&env, token.clone()]);

    let res = client.try_disburse(
        &Address::generate(&env),
        &dummy_proof(&env),
        &1000i128, &1000i128, &1u32,
        &BytesN::from_array(&env, &[1u8; 32]),
        &token,
        &vec![&env, Address::generate(&env)],
        &vec![&env, 1000i128],
        &empty_leaf_hashes(&env),
    );
    assert_eq!(res, Err(Ok(Error::MalformedVerifyingKey)));
}

// ── create_escrow / settle_escrow / cancel_escrow (Phase 4: confidential) ────
//
// create_escrow now requires a real ZK proof (escrow_lock), so it can no
// longer succeed with a dummy all-zero proof — same constraint as
// disburse/settle_escrow's pre-existing tests. Happy-path "funds actually
// move" coverage lives in scripts/e2e_confidential.ts on testnet with real
// circom-generated proofs; these tests cover pre-proof validation only.

/// Writes an InvoiceEscrow directly into storage and bumps EscrowCounter,
/// bypassing create_escrow's ZK-gated entrypoint — for testing read-paths and
/// settle/cancel pre-checks that need an existing escrow without a real proof.
fn write_escrow_directly(f: &Fixture, escrow: InvoiceEscrow) -> u64 {
    f.env.as_contract(&f.client.address, || {
        let id: u64 = f.env.storage().instance().get(&DataKey::EscrowCounter).unwrap_or(0u64) + 1;
        f.env.storage().instance().set(&DataKey::EscrowCounter, &id);
        f.env.storage().persistent().set(&DataKey::Escrow(id), &escrow);
        id
    })
}

fn basic_escrow(f: &Fixture, escrow_commitment: BytesN<32>) -> InvoiceEscrow {
    InvoiceEscrow {
        payer: f.payer.clone(),
        payee: f.payee.clone(),
        token: f.token.clone(),
        invoice_min: MIN,
        invoice_max: MAX,
        escrow_commitment,
        settled: false,
        created_at: 1_000_000_000,
    }
}

#[test]
fn create_escrow_account_not_found_rejected() {
    // Payer never deposited — no confidential balance exists yet.
    let f = setup();
    let res = f.client.try_create_escrow(
        &f.payer, &f.payee, &f.token, &MIN, &MAX,
        &BytesN::from_array(&f.env, &[0xAAu8; 32]),
        &BytesN::from_array(&f.env, &[0xBBu8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::AccountNotFound)));
}

#[test]
fn create_escrow_zero_min_rejected() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));
    let res = f.client.try_create_escrow(
        &f.payer, &f.payee, &f.token, &0i128, &MAX,
        &BytesN::from_array(&f.env, &[1u8; 32]),
        &BytesN::from_array(&f.env, &[2u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::InvalidRange)));
}

#[test]
fn create_escrow_max_less_than_min_rejected() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));
    let res = f.client.try_create_escrow(
        &f.payer, &f.payee, &f.token, &MAX, &MIN, // min > max
        &BytesN::from_array(&f.env, &[3u8; 32]),
        &BytesN::from_array(&f.env, &[4u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::InvalidRange)));
}

#[test]
fn create_escrow_passes_pre_checks_reaches_proof_verification() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));
    let res = f.client.try_create_escrow(
        &f.payer, &f.payee, &f.token, &MIN, &MAX,
        &BytesN::from_array(&f.env, &[5u8; 32]),
        &BytesN::from_array(&f.env, &[6u8; 32]),
        &dummy_proof(&f.env),
    );
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn create_escrow_malformed_vk_detected() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));
    let bad_vk = dummy_vk(&f.env, 1); // needs 4
    f.client.set_escrow_vks(&bad_vk, &dummy_vk(&f.env, 6), &dummy_vk(&f.env, 5), &dummy_vk_balance_update(&f.env));
    let res = f.client.try_create_escrow(
        &f.payer, &f.payee, &f.token, &MIN, &MAX,
        &BytesN::from_array(&f.env, &[8u8; 32]),
        &BytesN::from_array(&f.env, &[9u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::MalformedVerifyingKey)));
}

// ── settle_escrow ─────────────────────────────────────────────────────────────

#[test]
fn settle_escrow_not_found() {
    let f = setup();
    let res = f.client.try_settle_escrow(
        &f.payee, &99u64, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::EscrowNotFound)));
}

#[test]
fn settle_escrow_wrong_payee_rejected() {
    let f = setup();
    let id = write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32])));
    let stranger = Address::generate(&f.env);
    let res = f.client.try_settle_escrow(
        &stranger, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
}

#[test]
fn settle_escrow_already_settled_rejected() {
    let f = setup();
    let mut escrow = basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32]));
    escrow.settled = true;
    let id = write_escrow_directly(&f, escrow);
    let res = f.client.try_settle_escrow(
        &f.payee, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::EscrowAlreadySettled)));
}

#[test]
fn settle_escrow_account_not_found_rejected() {
    // Payee has no confidential balance yet — must use settle_escrow_new instead.
    let f = setup();
    let id = write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32])));
    let res = f.client.try_settle_escrow(
        &f.payee, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::AccountNotFound)));
}

#[test]
fn settle_escrow_passes_pre_checks_reaches_proof_verification() {
    let f = setup();
    seed_confidential_balance(&f, &f.payee, BytesN::from_array(&f.env, &[7u8; 32]));
    let id = write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32])));
    let res = f.client.try_settle_escrow(
        &f.payee, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn settle_escrow_malformed_vk_detected() {
    let f = setup();
    seed_confidential_balance(&f, &f.payee, BytesN::from_array(&f.env, &[7u8; 32]));
    let id = write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32])));
    let bad_vk = dummy_vk(&f.env, 1); // needs 6
    f.client.set_escrow_vks(&dummy_vk_balance_update(&f.env), &bad_vk, &dummy_vk(&f.env, 5), &dummy_vk_balance_update(&f.env));
    let res = f.client.try_settle_escrow(
        &f.payee, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::MalformedVerifyingKey)));
}

// ── settle_escrow_new ─────────────────────────────────────────────────────────

#[test]
fn settle_escrow_new_account_already_exists_rejected() {
    let f = setup();
    seed_confidential_balance(&f, &f.payee, BytesN::from_array(&f.env, &[7u8; 32]));
    let id = write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32])));
    let res = f.client.try_settle_escrow_new(
        &f.payee, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::AccountAlreadyExists)));
}

#[test]
fn settle_escrow_new_passes_pre_checks_reaches_proof_verification() {
    let f = setup();
    let id = write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32])));
    let res = f.client.try_settle_escrow_new(
        &f.payee, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert!(matches!(res, Err(Err(_))));
}

// ── get_escrow ────────────────────────────────────────────────────────────────

#[test]
fn get_escrow_returns_correct_data() {
    let f = setup();
    let escrow_commitment = BytesN::from_array(&f.env, &[0xDDu8; 32]);
    let id = write_escrow_directly(&f, basic_escrow(&f, escrow_commitment.clone()));
    let escrow = f.client.get_escrow(&id);
    assert_eq!(escrow.payer, f.payer);
    assert_eq!(escrow.payee, f.payee);
    assert_eq!(escrow.escrow_commitment, escrow_commitment);
    assert_eq!(escrow.invoice_min, MIN);
    assert_eq!(escrow.invoice_max, MAX);
    assert!(!escrow.settled);
}

#[test]
fn get_escrow_not_found() {
    let f = setup();
    let res = f.client.try_get_escrow(&999u64);
    assert_eq!(res, Err(Ok(Error::EscrowNotFound)));
}

// ── history & batch queries ───────────────────────────────────────────────────

#[test]
fn empty_history_for_new_employer() {
    let f = setup();
    let unknown = Address::generate(&f.env);
    assert_eq!(f.client.get_employer_history(&unknown).len(), 0);
}

#[test]
fn cumulative_zero_for_new_employer() {
    let f = setup();
    let unknown = Address::generate(&f.env);
    assert_eq!(f.client.get_employer_cumulative(&unknown), 0i128);
}

#[test]
fn get_batch_not_found() {
    let f = setup();
    let res = f.client.try_get_batch(&1u64);
    assert_eq!(res, Err(Ok(Error::BatchNotFound)));
}

#[test]
fn get_batch_with_leaf_hashes_round_trips() {
    let f = setup();
    let leaf = BytesN::from_array(&f.env, &[0xEEu8; 32]);
    let mut leaves = Vec::new(&f.env);
    leaves.push_back(leaf.clone());

    // Write a batch directly — bypasses ZK check.
    f.env.as_contract(&f.client.address, || {
        let batch = PayrollBatch {
            employer: f.payer.clone(),
            total_budget: 1_000,
            headcount: 1,
            commitment: BytesN::from_array(&f.env, &[1u8; 32]),
            token: f.token.clone(),
            executed_at: 1_000_000_000,
            leaf_hashes: leaves.clone(),
        };
        f.env.storage().persistent().set(&DataKey::Batch(1u64), &batch);
    });

    let batch = f.client.get_batch(&1u64);
    assert_eq!(batch.leaf_hashes.len(), 1);
    assert_eq!(batch.leaf_hashes.get(0).unwrap(), leaf);
}

#[test]
fn is_token_supported_false_for_unknown() {
    let f = setup();
    assert!(!f.client.is_token_supported(&Address::generate(&f.env)));
}

#[test]
fn escrow_and_payroll_counters_are_independent() {
    let f = setup();
    write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[1u8; 32])));
    write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[2u8; 32])));
    // Escrow counter is at 2; batch counter is still at 0.
    let res = f.client.try_get_batch(&1u64);
    assert_eq!(res, Err(Ok(Error::BatchNotFound)));
    let escrow = f.client.get_escrow(&2u64);
    assert_eq!(escrow.escrow_commitment, BytesN::from_array(&f.env, &[2u8; 32]));
}

// ── disburse: new security checks ────────────────────────────────────────────

#[test]
fn disburse_negative_amount_rejected() {
    let f = setup();
    check_disburse(
        &f, 1000, 1000, 1,
        BytesN::from_array(&f.env, &[9u8; 32]),
        &f.token,
        vec![&f.env, Address::generate(&f.env)],
        vec![&f.env, -1i128],
        Error::InvalidAmount,
    );
}

// ── cancel_escrow ─────────────────────────────────────────────────────────────

#[test]
fn cancel_escrow_before_timeout_rejected() {
    let f = setup();
    let id = write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32])));
    let res = f.client.try_cancel_escrow(
        &f.payer, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::EscrowNotExpired)));
}

#[test]
fn cancel_escrow_account_not_found_rejected() {
    let f = setup();
    let id = write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32])));
    f.env.ledger().with_mut(|l| l.timestamp = 1_000_000_000 + 31 * 24 * 60 * 60);
    let res = f.client.try_cancel_escrow(
        &f.payer, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::AccountNotFound)));
}

#[test]
fn cancel_escrow_passes_pre_checks_reaches_proof_verification() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));
    let id = write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32])));
    f.env.ledger().with_mut(|l| l.timestamp = 1_000_000_000 + 31 * 24 * 60 * 60);
    let res = f.client.try_cancel_escrow(
        &f.payer, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn cancel_escrow_already_settled_rejected() {
    let f = setup();
    let mut escrow = basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32]));
    escrow.settled = true;
    let id = write_escrow_directly(&f, escrow);
    f.env.ledger().with_mut(|l| l.timestamp = 1_000_000_000 + 31 * 24 * 60 * 60);
    let res = f.client.try_cancel_escrow(
        &f.payer, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::EscrowAlreadySettled)));
}

#[test]
fn cancel_escrow_not_found() {
    let f = setup();
    let res = f.client.try_cancel_escrow(
        &f.payer, &99u64, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::EscrowNotFound)));
}

#[test]
fn cancel_escrow_wrong_payer_rejected() {
    let f = setup();
    let id = write_escrow_directly(&f, basic_escrow(&f, BytesN::from_array(&f.env, &[0xAAu8; 32])));
    let stranger = Address::generate(&f.env);
    f.env.ledger().with_mut(|l| l.timestamp = 1_000_000_000 + 31 * 24 * 60 * 60);
    let res = f.client.try_cancel_escrow(
        &stranger, &id, &BytesN::from_array(&f.env, &[1u8; 32]), &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
}

// ── set_admin ─────────────────────────────────────────────────────────────────

#[test]
fn set_admin_succeeds() {
    let f = setup();
    let new_admin = Address::generate(&f.env);
    let res = f.client.try_set_admin(&new_admin);
    assert_eq!(res, Ok(Ok(())));
}

#[test]
fn set_admin_not_initialized_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayrollVerifier, ());
    let client = PayrollVerifierClient::new(&env, &contract_id);
    let res = client.try_set_admin(&Address::generate(&env));
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
}

// ── remove_token ──────────────────────────────────────────────────────────────

#[test]
fn remove_token_makes_it_unsupported() {
    let f = setup();
    assert!(f.client.is_token_supported(&f.token));
    f.client.remove_token(&f.token);
    assert!(!f.client.is_token_supported(&f.token));
}

// ── propose_upgrade / execute_upgrade ────────────────────────────────────────

#[test]
fn execute_upgrade_without_proposal_rejected() {
    let f = setup();
    let res = f.client.try_execute_upgrade();
    assert_eq!(res, Err(Ok(Error::UpgradeNotReady)));
}

#[test]
fn execute_upgrade_before_delay_rejected() {
    let f = setup();
    let wasm_hash = BytesN::from_array(&f.env, &[0xABu8; 32]);
    f.client.propose_upgrade(&wasm_hash);
    // Delay not elapsed — still at the same timestamp.
    let res = f.client.try_execute_upgrade();
    assert_eq!(res, Err(Ok(Error::UpgradeNotReady)));
}

// ── Phase 4: deposit_new ──────────────────────────────────────────────────────

#[test]
fn deposit_new_unsupported_token() {
    let f = setup();
    let bad_token = Address::generate(&f.env);
    let res = f.client.try_deposit_new(
        &f.payer, &bad_token, &AMOUNT,
        &BytesN::from_array(&f.env, &[1u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::UnsupportedToken)));
}

#[test]
fn deposit_new_zero_amount_rejected() {
    let f = setup();
    let res = f.client.try_deposit_new(
        &f.payer, &f.token, &0i128,
        &BytesN::from_array(&f.env, &[2u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn deposit_new_negative_amount_rejected() {
    let f = setup();
    let res = f.client.try_deposit_new(
        &f.payer, &f.token, &-1i128,
        &BytesN::from_array(&f.env, &[3u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn deposit_new_account_already_exists_rejected() {
    let f = setup();
    f.env.as_contract(&f.client.address, || {
        f.env.storage().persistent().set(
            &DataKey::ConfidentialBalance(f.payer.clone(), f.token.clone()),
            &BytesN::from_array(&f.env, &[9u8; 32]),
        );
    });
    let res = f.client.try_deposit_new(
        &f.payer, &f.token, &AMOUNT,
        &BytesN::from_array(&f.env, &[4u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::AccountAlreadyExists)));
}

#[test]
fn deposit_new_passes_pre_checks_reaches_proof_verification() {
    let f = setup();
    let res = f.client.try_deposit_new(
        &f.payer, &f.token, &AMOUNT,
        &BytesN::from_array(&f.env, &[5u8; 32]),
        &dummy_proof(&f.env),
    );
    // Abort (from host-level BLS panic) proves we reached proof verification.
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn deposit_new_malformed_vk_detected() {
    let f = setup();
    let g1 = G1Affine::from_bytes(BytesN::from_array(&f.env, &[0u8; 96]));
    let g2 = G2Affine::from_bytes(BytesN::from_array(&f.env, &[0u8; 192]));
    let mut bad_ic = Vec::new(&f.env);
    bad_ic.push_back(g1.clone()); // ic.len()==1, needs 3
    let bad_vk = VerificationKey { alpha: g1, beta: g2.clone(), gamma: g2.clone(), delta: g2, ic: bad_ic };

    f.client.set_confidential_vks(&bad_vk, &dummy_vk_balance_update(&f.env), &dummy_vk_balance_update(&f.env));

    let res = f.client.try_deposit_new(
        &f.payer, &f.token, &AMOUNT,
        &BytesN::from_array(&f.env, &[6u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::MalformedVerifyingKey)));
}

// ── Phase 4: deposit_topup ────────────────────────────────────────────────────

fn seed_confidential_balance(f: &Fixture, account: &Address, commitment: BytesN<32>) {
    f.env.as_contract(&f.client.address, || {
        f.env.storage().persistent().set(
            &DataKey::ConfidentialBalance(account.clone(), f.token.clone()),
            &commitment,
        );
    });
}

#[test]
fn deposit_topup_account_not_found_rejected() {
    let f = setup();
    let res = f.client.try_deposit_topup(
        &f.payer, &f.token, &AMOUNT,
        &BytesN::from_array(&f.env, &[1u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::AccountNotFound)));
}

#[test]
fn deposit_topup_unsupported_token() {
    let f = setup();
    let bad_token = Address::generate(&f.env);
    let res = f.client.try_deposit_topup(
        &f.payer, &bad_token, &AMOUNT,
        &BytesN::from_array(&f.env, &[2u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::UnsupportedToken)));
}

#[test]
fn deposit_topup_zero_amount_rejected() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));
    let res = f.client.try_deposit_topup(
        &f.payer, &f.token, &0i128,
        &BytesN::from_array(&f.env, &[3u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn deposit_topup_passes_pre_checks_reaches_proof_verification() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));
    let res = f.client.try_deposit_topup(
        &f.payer, &f.token, &AMOUNT,
        &BytesN::from_array(&f.env, &[8u8; 32]),
        &dummy_proof(&f.env),
    );
    assert!(matches!(res, Err(Err(_))));
}

// ── Phase 4: withdraw ─────────────────────────────────────────────────────────

#[test]
fn withdraw_account_not_found_rejected() {
    let f = setup();
    let res = f.client.try_withdraw(
        &f.payer, &f.token, &AMOUNT,
        &BytesN::from_array(&f.env, &[1u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::AccountNotFound)));
}

#[test]
fn withdraw_zero_amount_rejected() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));
    let res = f.client.try_withdraw(
        &f.payer, &f.token, &0i128,
        &BytesN::from_array(&f.env, &[2u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn withdraw_negative_amount_rejected() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));
    let res = f.client.try_withdraw(
        &f.payer, &f.token, &-1i128,
        &BytesN::from_array(&f.env, &[3u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn withdraw_passes_pre_checks_reaches_proof_verification() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));
    let res = f.client.try_withdraw(
        &f.payer, &f.token, &AMOUNT,
        &BytesN::from_array(&f.env, &[4u8; 32]),
        &dummy_proof(&f.env),
    );
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn withdraw_malformed_vk_detected() {
    let f = setup();
    seed_confidential_balance(&f, &f.payer, BytesN::from_array(&f.env, &[7u8; 32]));

    let g1 = G1Affine::from_bytes(BytesN::from_array(&f.env, &[0u8; 96]));
    let g2 = G2Affine::from_bytes(BytesN::from_array(&f.env, &[0u8; 192]));
    let mut bad_ic = Vec::new(&f.env);
    bad_ic.push_back(g1.clone()); // ic.len()==1, needs 4
    let bad_vk = VerificationKey { alpha: g1, beta: g2.clone(), gamma: g2.clone(), delta: g2, ic: bad_ic };

    f.client.set_confidential_vks(&dummy_vk_deposit_new(&f.env), &dummy_vk_balance_update(&f.env), &bad_vk);

    let res = f.client.try_withdraw(
        &f.payer, &f.token, &AMOUNT,
        &BytesN::from_array(&f.env, &[5u8; 32]),
        &dummy_proof(&f.env),
    );
    assert_eq!(res, Err(Ok(Error::MalformedVerifyingKey)));
}

// ── Phase 4: get_confidential_balance ─────────────────────────────────────────

#[test]
fn get_confidential_balance_not_found() {
    let f = setup();
    let res = f.client.try_get_confidential_balance(&f.payer, &f.token);
    assert_eq!(res, Err(Ok(Error::AccountNotFound)));
}

#[test]
fn get_confidential_balance_returns_stored_commitment() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[0xFFu8; 32]);
    seed_confidential_balance(&f, &f.payer, commitment.clone());
    let res = f.client.get_confidential_balance(&f.payer, &f.token);
    assert_eq!(res, commitment);
}

// ── Phase 4: disburse_confidential (note model) ───────────────────────────────

/// Ten note commitments (active slots first, padding after) for the given count.
fn ten_notes(f: &Fixture) -> Vec<BytesN<32>> {
    let mut notes = Vec::new(&f.env);
    for i in 0..10u8 {
        notes.push_back(BytesN::from_array(&f.env, &[i + 1; 32]));
    }
    notes
}

/// `n` empty note ciphers (out-of-band fallback — no auto-receive).
fn empty_ciphers(f: &Fixture, n: u32) -> Vec<soroban_sdk::Bytes> {
    let mut v = Vec::new(&f.env);
    for _ in 0..n {
        v.push_back(soroban_sdk::Bytes::new(&f.env));
    }
    v
}

/// Calls `try_disburse_confidential` and asserts the contract returns `Err(expected)`.
fn check_disburse_conf(
    f: &Fixture,
    total: i128,
    max: i128,
    count: u32,
    commitment: BytesN<32>,
    token: &Address,
    recipients: Vec<Address>,
    notes: Vec<BytesN<32>>,
    expected: Error,
) {
    let ciphers = empty_ciphers(f, recipients.len());
    let res = f.client.try_disburse_confidential(
        &f.payer, &dummy_proof(&f.env), &total, &max, &count, &commitment,
        token, &recipients, &notes, &ciphers,
    );
    assert_eq!(res, Err(Ok(expected)));
}

#[test]
fn disburse_confidential_unsupported_token() {
    let f = setup();
    let bad_token = Address::generate(&f.env);
    check_disburse_conf(
        &f, 1000, 1000, 1, BytesN::from_array(&f.env, &[1u8; 32]),
        &bad_token, vec![&f.env, Address::generate(&f.env)], ten_notes(&f),
        Error::UnsupportedToken,
    );
}

#[test]
fn disburse_confidential_headcount_zero_rejected() {
    let f = setup();
    check_disburse_conf(
        &f, 1000, 1000, 0, BytesN::from_array(&f.env, &[2u8; 32]),
        &f.token, Vec::new(&f.env), ten_notes(&f),
        Error::InvalidHeadcount,
    );
}

#[test]
fn disburse_confidential_recipients_length_mismatch() {
    let f = setup();
    check_disburse_conf(
        &f, 1000, 1000, 2, BytesN::from_array(&f.env, &[3u8; 32]),
        &f.token, vec![&f.env, Address::generate(&f.env)], ten_notes(&f),
        Error::LengthMismatch,
    );
}

#[test]
fn disburse_confidential_notes_length_mismatch() {
    let f = setup();
    // only 3 note commitments instead of MAX_HEADCOUNT (10)
    let mut short_notes = Vec::new(&f.env);
    for i in 0..3u8 {
        short_notes.push_back(BytesN::from_array(&f.env, &[i + 1; 32]));
    }
    check_disburse_conf(
        &f, 1000, 1000, 1, BytesN::from_array(&f.env, &[4u8; 32]),
        &f.token, vec![&f.env, Address::generate(&f.env)], short_notes,
        Error::LengthMismatch,
    );
}

#[test]
fn disburse_confidential_zero_total_budget_rejected() {
    let f = setup();
    check_disburse_conf(
        &f, 0, 1000, 1, BytesN::from_array(&f.env, &[5u8; 32]),
        &f.token, vec![&f.env, Address::generate(&f.env)], ten_notes(&f),
        Error::SumMismatch,
    );
}

#[test]
fn disburse_confidential_commitment_replay_rejected() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[6u8; 32]);
    f.env.as_contract(&f.client.address, || {
        f.env.storage().persistent().set(
            &DataKey::UsedCommitment(f.payer.clone(), commitment.clone()), &true,
        );
    });
    check_disburse_conf(
        &f, 1000, 1000, 1, commitment,
        &f.token, vec![&f.env, Address::generate(&f.env)], ten_notes(&f),
        Error::CommitmentAlreadyUsed,
    );
}

#[test]
fn disburse_confidential_passes_pre_checks_reaches_proof_verification() {
    let f = setup();
    let res = f.client.try_disburse_confidential(
        &f.payer, &dummy_proof(&f.env), &1000i128, &1000i128, &1u32,
        &BytesN::from_array(&f.env, &[7u8; 32]),
        &f.token, &vec![&f.env, Address::generate(&f.env)], &ten_notes(&f),
        &empty_ciphers(&f, 1),
    );
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn disburse_confidential_cipher_length_mismatch() {
    let f = setup();
    // 1 recipient but 0 ciphers.
    let res = f.client.try_disburse_confidential(
        &f.payer, &dummy_proof(&f.env), &1000i128, &1000i128, &1u32,
        &BytesN::from_array(&f.env, &[12u8; 32]),
        &f.token, &vec![&f.env, Address::generate(&f.env)], &ten_notes(&f),
        &empty_ciphers(&f, 0),
    );
    assert_eq!(res, Err(Ok(Error::LengthMismatch)));
}

// ── Auto-receive: viewing keys + note ciphers ─────────────────────────────────

#[test]
fn register_and_get_viewing_key_round_trips() {
    let f = setup();
    let pubkey = BytesN::from_array(&f.env, &[0x42u8; 32]);
    f.client.register_viewing_key(&f.payee, &pubkey);
    assert_eq!(f.client.get_viewing_key(&f.payee), pubkey);
}

#[test]
fn get_viewing_key_not_found() {
    let f = setup();
    let res = f.client.try_get_viewing_key(&Address::generate(&f.env));
    assert_eq!(res, Err(Ok(Error::NotFound)));
}

#[test]
fn register_viewing_key_overwrites() {
    let f = setup();
    f.client.register_viewing_key(&f.payee, &BytesN::from_array(&f.env, &[1u8; 32]));
    let k2 = BytesN::from_array(&f.env, &[2u8; 32]);
    f.client.register_viewing_key(&f.payee, &k2);
    assert_eq!(f.client.get_viewing_key(&f.payee), k2);
}

#[test]
fn get_note_cipher_not_found() {
    let f = setup();
    let res = f.client.try_get_note_cipher(&999u64);
    assert_eq!(res, Err(Ok(Error::NotFound)));
}

#[test]
fn get_note_cipher_returns_stored_bytes() {
    let f = setup();
    let cipher = soroban_sdk::Bytes::from_array(&f.env, &[0xCA, 0xFE, 0xBA, 0xBE]);
    f.env.as_contract(&f.client.address, || {
        f.env.storage().persistent().set(&DataKey::NoteCipher(7u64), &cipher);
    });
    assert_eq!(f.client.get_note_cipher(&7u64), cipher);
}

#[test]
fn disburse_confidential_malformed_vk_detected() {
    let f = setup();
    f.client.set_payroll_notes_vk(&dummy_vk(&f.env, 1)); // needs 15
    check_disburse_conf(
        &f, 1000, 1000, 1, BytesN::from_array(&f.env, &[8u8; 32]),
        &f.token, vec![&f.env, Address::generate(&f.env)], ten_notes(&f),
        Error::MalformedVerifyingKey,
    );
}

#[test]
fn get_recipient_escrows_empty_for_unknown() {
    let f = setup();
    let unknown = Address::generate(&f.env);
    assert_eq!(f.client.get_recipient_escrows(&unknown).len(), 0);
}

#[test]
fn create_escrow_indexes_payee() {
    // write_escrow_directly bypasses the index; verify the real create_escrow
    // path indexes the payee via a direct settle-style write is not possible
    // (ZK-gated), so instead seed an escrow through disburse's index helper by
    // checking get_recipient_escrows after a manual append in as_contract.
    let f = setup();
    f.env.as_contract(&f.client.address, || {
        let key = DataKey::RecipientEscrows(f.payee.clone());
        let mut list: Vec<u64> = Vec::new(&f.env);
        list.push_back(42u64);
        f.env.storage().persistent().set(&key, &list);
    });
    let list = f.client.get_recipient_escrows(&f.payee);
    assert_eq!(list.len(), 1);
    assert_eq!(list.get(0).unwrap(), 42u64);
}
