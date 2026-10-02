#![no_std]

//! Payfurt `salary_bracket_verifier` — Feature 5 (note-anchored, confidential build).
//!
//! Stateless: employee proves their salary ∈ [bracket_low, bracket_high]
//! anchored to the opaque note they were paid in.
//!
//! Public signals for `salary_bracket.circom`:
//!   [note_commitment, bracket_low, bracket_high]  (3 signals → ic.len() == 4)
//!
//! The `note_commitment` is Poseidon(salary, note_blinding). It is stored
//! on-chain as `InvoiceEscrow.escrow_commitment` by `disburse_confidential` (a
//! payroll note is structurally an escrow with range [0, MAX]). The employee
//! already holds (salary, note_blinding) from claiming their pay; the proof
//! binds the private salary to this public commitment without revealing it.

use soroban_sdk::{contract, contractclient, contractevent, contractimpl, contracttype, Address, BytesN, Env, Vec};

use payroll_verifier::{
    groth16,
    Error as PayrollError,
    InvoiceEscrow,
    PayrollBatch,
    Proof,
    VerificationKey,
};

mod error;
pub use error::Error;

const DAY_IN_LEDGERS: u32 = 17280;
const TTL_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_BUMP - DAY_IN_LEDGERS;

/// Income proof slot count (income_proof.circom IncomeProof(8, ..)).
const INCOME_SLOTS: u32 = 8;

// ── Cross-contract interface ──────────────────────────────────────────────────

/// Minimal interface used to cross-call `payroll_verifier`.
#[contractclient(name = "PayrollClient")]
pub trait PayrollInterface {
    fn get_escrow(env: Env, escrow_id: u64) -> Result<InvoiceEscrow, PayrollError>;
    fn get_batch(env: Env, batch_id: u64) -> Result<PayrollBatch, PayrollError>;
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    VkBracket,
    PayrollVerifier,
    VkMinWage,
    VkPayEquity,
    VkIncome,
}

// ── Events ─────────────────────────────────────────────────────────────────

#[contractevent(topics = ["attestation", "min_wage"])]
#[derive(Clone, Debug, PartialEq)]
pub struct MinWageAttested {
    #[topic]
    pub attester: Address,
    pub batch_id: u64,
    pub min_wage: i128,
}

#[contractevent(topics = ["attestation", "pay_equity"])]
#[derive(Clone, Debug, PartialEq)]
pub struct PayEquityAttested {
    #[topic]
    pub attester: Address,
    pub batch_id: u64,
    pub epsilon: i128,
}

#[contractevent(topics = ["attestation", "income"])]
#[derive(Clone, Debug, PartialEq)]
pub struct IncomeAttested {
    #[topic]
    pub employee: Address,
    pub threshold: i128,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SalaryBracketVerifier;

#[contractimpl]
impl SalaryBracketVerifier {
    /// One-time setup: stores the admin, the `salary_bracket.circom` VK, and
    /// the address of the `payroll_verifier` contract to cross-call.
    pub fn initialize(
        env: Env,
        admin: Address,
        vk_bracket: VerificationKey,
        payroll_verifier: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VkBracket, &vk_bracket);
        env.storage().instance().set(&DataKey::PayrollVerifier, &payroll_verifier);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
        Ok(())
    }

    /// Employee proves their salary satisfies [bracket_low, bracket_high] by
    /// providing a Groth16 proof against the note commitment of escrow
    /// `escrow_id` in `payroll_verifier` — the note they were paid in.
    ///
    /// The caller must be the escrow's payee. Does NOT transfer any funds —
    /// purely a verification result.
    pub fn prove_bracket(
        env: Env,
        employee: Address,
        escrow_id: u64,
        bracket_low: i128,
        bracket_high: i128,
        proof: Proof,
    ) -> Result<(), Error> {
        employee.require_auth();
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkBracket)
            .ok_or(Error::NotInitialized)?;

        let pv_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::PayrollVerifier)
            .ok_or(Error::NotInitialized)?;

        let client = PayrollClient::new(&env, &pv_addr);
        let escrow: InvoiceEscrow = client
            .try_get_escrow(&escrow_id)
            .map_err(|_| Error::EscrowNotFound)?
            .map_err(|_| Error::EscrowNotFound)?;

        if escrow.payee != employee {
            return Err(Error::Unauthorized);
        }

        let signals = payroll_verifier::encode::encode_bracket_inputs(
            &env, bracket_low, bracket_high, &escrow.escrow_commitment,
        );

        groth16::verify(&env, &vk, &proof, &signals).map_err(|e| match e {
            PayrollError::MalformedVerifyingKey => Error::MalformedVerifyingKey,
            _ => Error::InvalidProof,
        })?;

        Ok(())
    }

    // ── Feature 7: payroll attestations ─────────────────────────────────────
    //
    // Proofs ABOUT a hidden salary set, anchored to a batch's on-chain
    // `payroll_commitment` (or, for income, to the employee's note commitments).
    // None of these reveal an individual salary.

    /// One-time setup for the attestation verification keys.
    pub fn set_attestation_vks(
        env: Env,
        vk_min_wage: VerificationKey,
        vk_pay_equity: VerificationKey,
        vk_income: VerificationKey,
    ) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::VkMinWage, &vk_min_wage);
        env.storage().instance().set(&DataKey::VkPayEquity, &vk_pay_equity);
        env.storage().instance().set(&DataKey::VkIncome, &vk_income);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
        Ok(())
    }

    /// Employer proves every active salary in batch `batch_id` is ≥ `min_wage`,
    /// anchored to the batch's payroll commitment. Reveals no salary. Emits a
    /// public `MinWageAttested` event signed by `attester`.
    pub fn prove_min_wage(
        env: Env,
        attester: Address,
        batch_id: u64,
        min_wage: i128,
        proof: Proof,
    ) -> Result<(), Error> {
        attester.require_auth();
        Self::verify_batch_attestation(&env, DataKey::VkMinWage, batch_id, min_wage, &proof)?;
        MinWageAttested { attester, batch_id, min_wage }.publish(&env);
        Ok(())
    }

    /// Employer proves the average salary of two cohorts differ by ≤ `epsilon`,
    /// anchored to the batch's payroll commitment. Reveals no salary, average, or
    /// cohort size. Emits a public `PayEquityAttested` event.
    pub fn prove_pay_equity(
        env: Env,
        attester: Address,
        batch_id: u64,
        epsilon: i128,
        proof: Proof,
    ) -> Result<(), Error> {
        attester.require_auth();
        Self::verify_batch_attestation(&env, DataKey::VkPayEquity, batch_id, epsilon, &proof)?;
        PayEquityAttested { attester, batch_id, epsilon }.publish(&env);
        Ok(())
    }

    /// Employee proves their cumulative income across the given payroll notes is
    /// ≥ `threshold`. Each `escrow_id` must name an escrow they are the payee of;
    /// the proof binds to those notes' commitments. Reveals no individual amount.
    pub fn prove_income(
        env: Env,
        employee: Address,
        escrow_ids: Vec<u64>,
        threshold: i128,
        proof: Proof,
    ) -> Result<(), Error> {
        employee.require_auth();
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        if escrow_ids.len() == 0 || escrow_ids.len() > INCOME_SLOTS {
            return Err(Error::InvalidInput);
        }

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkIncome)
            .ok_or(Error::NotInitialized)?;
        let pv_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::PayrollVerifier)
            .ok_or(Error::NotInitialized)?;
        let client = PayrollClient::new(&env, &pv_addr);

        // Collect each note commitment, checking the employee is its payee.
        let zero = BytesN::from_array(&env, &[0u8; 32]);
        let mut commitments = Vec::new(&env);
        for id in escrow_ids.iter() {
            let escrow: InvoiceEscrow = client
                .try_get_escrow(&id)
                .map_err(|_| Error::EscrowNotFound)?
                .map_err(|_| Error::EscrowNotFound)?;
            if escrow.payee != employee {
                return Err(Error::Unauthorized);
            }
            commitments.push_back(escrow.escrow_commitment);
        }
        // Pad to INCOME_SLOTS with zero commitments (inactive slots in-circuit).
        while commitments.len() < INCOME_SLOTS {
            commitments.push_back(zero.clone());
        }

        let signals = payroll_verifier::encode::encode_income_inputs(&env, &commitments, threshold);
        groth16::verify(&env, &vk, &proof, &signals).map_err(|e| match e {
            PayrollError::MalformedVerifyingKey => Error::MalformedVerifyingKey,
            _ => Error::InvalidProof,
        })?;
        IncomeAttested { employee, threshold }.publish(&env);
        Ok(())
    }

    // ── internal ─────────────────────────────────────────────────────────────

    /// Shared logic for batch-anchored attestations (min wage, pay equity):
    /// reads the batch commitment + headcount and verifies the proof against
    /// `[commitment, param, headcount]`.
    fn verify_batch_attestation(
        env: &Env,
        vk_key: DataKey,
        batch_id: u64,
        param: i128,
        proof: &Proof,
    ) -> Result<(), Error> {
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&vk_key)
            .ok_or(Error::NotInitialized)?;
        let pv_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::PayrollVerifier)
            .ok_or(Error::NotInitialized)?;

        let client = PayrollClient::new(env, &pv_addr);
        let batch: PayrollBatch = client
            .try_get_batch(&batch_id)
            .map_err(|_| Error::BatchNotFound)?
            .map_err(|_| Error::BatchNotFound)?;

        let signals = payroll_verifier::encode::encode_payroll_attestation_inputs(
            env, &batch.commitment, param, batch.headcount,
        );
        groth16::verify(env, &vk, proof, &signals).map_err(|e| match e {
            PayrollError::MalformedVerifyingKey => Error::MalformedVerifyingKey,
            _ => Error::InvalidProof,
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
