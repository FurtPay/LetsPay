#![no_std]

use soroban_sdk::{contracttype, Address, Bytes, BytesN, Env, Vec};

#[cfg(feature = "contract")]
use soroban_sdk::{contract, contractevent, contractimpl, token};

pub mod confidential;
pub mod encode;
mod error;
pub mod groth16;

#[cfg(test)]
mod test;

pub use error::Error;
pub use groth16::{Proof, VerificationKey};

pub const MAX_HEADCOUNT: u32 = 10;

const DAY_IN_LEDGERS: u32 = 17280;
const TTL_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_BUMP - DAY_IN_LEDGERS;

const ESCROW_TIMEOUT: u64 = 30 * 24 * 60 * 60;
const UPGRADE_DELAY: u64 = 7 * 24 * 60 * 60;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct PayrollBatch {
    pub employer: Address,
    pub total_budget: i128,
    pub headcount: u32,
    pub commitment: BytesN<32>,
    pub token: Address,
    pub executed_at: u64,
    pub leaf_hashes: Vec<BytesN<32>>,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct InvoiceEscrow {
    pub payer: Address,
    pub payee: Address,
    pub token: Address,
    pub invoice_min: i128,
    pub invoice_max: i128,
    pub escrow_commitment: BytesN<32>,
    pub settled: bool,
    pub created_at: u64,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct UpgradeProposal {
    pub wasm_hash: BytesN<32>,
    pub proposed_at: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    VkPayroll,
    VkInvoice,
    BatchCounter,
    EscrowCounter,
    SupportedToken(Address),
    UsedCommitment(Address, BytesN<32>),
    Batch(u64),
    Escrow(u64),
    EmployerBatches(Address),
    EmployerCumulative(Address),
    UpgradePending,
    ConfidentialBalance(Address, Address),
    VkDepositNew,
    VkDepositTopup,
    VkWithdraw,
    VkEscrowLock,
    VkEscrowSettle,
    VkEscrowSettleNew,
    VkEscrowCancel,
    VkPayrollNotes,
    /// Index of escrow ids a recipient/payee can claim (notes + invoices).
    RecipientEscrows(Address),
    /// Auto-receive: an account's x25519 viewing public key (for ECDH note encryption).
    ViewingKey(Address),
    /// Auto-receive: ECDH-encrypted (amount, note_blinding) for a payroll note, by escrow id.
    NoteCipher(u64),
}

/// Invoice/note range sentinel: a payroll note has no min/max bound, so it is
/// stored as an escrow with range [0, NOTE_MAX]. 2^64 - 1 — the max value the
/// 64-bit circuit comparators can represent, so the range check always passes.
const NOTE_MAX: i128 = 18_446_744_073_709_551_615;

// ── Events ───────────────────────────────────────────────────────────────────

#[cfg(feature = "contract")]
#[contractevent(topics = ["payroll", "executed"])]
#[derive(Clone, Debug, PartialEq)]
pub struct PayrollExecuted {
    #[topic]
    pub employer: Address,
    pub total_budget: i128,
    pub headcount: u32,
    pub batch_id: u64,
}

#[cfg(feature = "contract")]
#[contractevent(topics = ["invoice", "created"])]
#[derive(Clone, Debug, PartialEq)]
pub struct InvoiceCreated {
    #[topic]
    pub payer: Address,
    #[topic]
    pub payee: Address,
    pub escrow_id: u64,
    pub invoice_min: i128,
    pub invoice_max: i128,
}

#[cfg(feature = "contract")]
#[contractevent(topics = ["invoice", "settled"])]
#[derive(Clone, Debug, PartialEq)]
pub struct InvoiceSettled {
    #[topic]
    pub payee: Address,
    pub escrow_id: u64,
}

#[cfg(feature = "contract")]
#[contractevent(topics = ["token", "added"])]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenAdded {
    #[topic]
    pub token: Address,
}

#[cfg(feature = "contract")]
#[contractevent(topics = ["token", "removed"])]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenRemoved {
    #[topic]
    pub token: Address,
}

#[cfg(feature = "contract")]
#[contractevent(topics = ["upgrade", "proposed"])]
#[derive(Clone, Debug, PartialEq)]
pub struct UpgradeProposed {
    pub wasm_hash: BytesN<32>,
    pub execute_after: u64,
}

#[cfg(feature = "contract")]
#[contractevent(topics = ["upgrade", "executed"])]
#[derive(Clone, Debug, PartialEq)]
pub struct UpgradeExecuted {
    pub wasm_hash: BytesN<32>,
}

#[cfg(feature = "contract")]
#[contractevent(topics = ["confidential", "deposit"])]
#[derive(Clone, Debug, PartialEq)]
pub struct ConfidentialDeposit {
    #[topic]
    pub account: Address,
    #[topic]
    pub token: Address,
    pub amount: i128,
}

#[cfg(feature = "contract")]
#[contractevent(topics = ["confidential", "withdrawal"])]
#[derive(Clone, Debug, PartialEq)]
pub struct ConfidentialWithdrawal {
    #[topic]
    pub account: Address,
    #[topic]
    pub token: Address,
    pub amount: i128,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[cfg(feature = "contract")]
#[contract]
pub struct PayrollVerifier;

#[cfg(feature = "contract")]
#[contractimpl]
impl PayrollVerifier {
    // ── Initialization ───────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        vk_payroll: VerificationKey,
        vk_invoice: VerificationKey,
        initial_tokens: Vec<Address>,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VkPayroll, &vk_payroll);
        env.storage()
            .instance()
            .set(&DataKey::VkInvoice, &vk_invoice);
        for t in initial_tokens.iter() {
            let key = DataKey::SupportedToken(t.clone());
            env.storage().persistent().set(&key, &true);
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
        }
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
        Ok(())
    }

    // ── Feature 6: token management ──────────────────────────────────────────

    pub fn add_token(env: Env, token: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        let key = DataKey::SupportedToken(token.clone());
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
        TokenAdded { token }.publish(&env);
        Ok(())
    }

    pub fn remove_token(env: Env, token: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage()
            .persistent()
            .remove(&DataKey::SupportedToken(token.clone()));
        TokenRemoved { token }.publish(&env);
        Ok(())
    }

    pub fn is_token_supported(env: Env, token: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::SupportedToken(token))
    }

    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
        Ok(())
    }

    pub fn set_confidential_vks(
        env: Env,
        vk_deposit_new: VerificationKey,
        vk_deposit_topup: VerificationKey,
        vk_withdraw: VerificationKey,
    ) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::VkDepositNew, &vk_deposit_new);
        env.storage()
            .instance()
            .set(&DataKey::VkDepositTopup, &vk_deposit_topup);
        env.storage()
            .instance()
            .set(&DataKey::VkWithdraw, &vk_withdraw);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
        Ok(())
    }

    pub fn set_escrow_vks(
        env: Env,
        vk_escrow_lock: VerificationKey,
        vk_escrow_settle: VerificationKey,
        vk_escrow_settle_new: VerificationKey,
        vk_escrow_cancel: VerificationKey,
    ) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::VkEscrowLock, &vk_escrow_lock);
        env.storage()
            .instance()
            .set(&DataKey::VkEscrowSettle, &vk_escrow_settle);
        env.storage()
            .instance()
            .set(&DataKey::VkEscrowSettleNew, &vk_escrow_settle_new);
        env.storage()
            .instance()
            .set(&DataKey::VkEscrowCancel, &vk_escrow_cancel);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
        Ok(())
    }

    pub fn set_payroll_notes_vk(env: Env, vk_payroll_notes: VerificationKey) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::VkPayrollNotes, &vk_payroll_notes);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
        Ok(())
    }

    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        Self::require_admin(&env)?;
        let now = env.ledger().timestamp();
        let proposal = UpgradeProposal {
            wasm_hash: new_wasm_hash.clone(),
            proposed_at: now,
        };
        env.storage()
            .instance()
            .set(&DataKey::UpgradePending, &proposal);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
        UpgradeProposed {
            wasm_hash: new_wasm_hash,
            execute_after: now + UPGRADE_DELAY,
        }
        .publish(&env);
        Ok(())
    }

    pub fn execute_upgrade(env: Env) -> Result<(), Error> {
        Self::require_admin(&env)?;
        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&DataKey::UpgradePending)
            .ok_or(Error::UpgradeNotReady)?;
        if env.ledger().timestamp() < proposal.proposed_at + UPGRADE_DELAY {
            return Err(Error::UpgradeNotReady);
        }
        env.storage().instance().remove(&DataKey::UpgradePending);
        UpgradeExecuted {
            wasm_hash: proposal.wasm_hash.clone(),
        }
        .publish(&env);
        env.deployer()
            .update_current_contract_wasm(proposal.wasm_hash);
        Ok(())
    }

    pub fn disburse(
        env: Env,
        employer: Address,
        proof: Proof,
        total_budget: i128,
        max_salary: i128,
        active_count: u32,
        commitment: BytesN<32>,
        token: Address,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
        leaf_hashes: Vec<BytesN<32>>,
    ) -> Result<u64, Error> {
        employer.require_auth();
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        let token_key = DataKey::SupportedToken(token.clone());
        if !env.storage().persistent().has(&token_key) {
            return Err(Error::UnsupportedToken);
        }
        env.storage()
            .persistent()
            .extend_ttl(&token_key, TTL_THRESHOLD, TTL_BUMP);

        let used_key = DataKey::UsedCommitment(employer.clone(), commitment.clone());
        if env.storage().persistent().has(&used_key) {
            return Err(Error::CommitmentAlreadyUsed);
        }

        if active_count == 0 || active_count > MAX_HEADCOUNT {
            return Err(Error::InvalidHeadcount);
        }
        if recipients.len() != active_count || amounts.len() != active_count {
            return Err(Error::LengthMismatch);
        }
        if total_budget <= 0 || max_salary <= 0 {
            return Err(Error::SumMismatch);
        }

        let mut declared_sum: i128 = 0;
        for a in amounts.iter() {
            if a < 0 {
                return Err(Error::InvalidAmount);
            }
            declared_sum = declared_sum.checked_add(a).ok_or(Error::Overflow)?;
        }
        if declared_sum != total_budget {
            return Err(Error::SumMismatch);
        }

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkPayroll)
            .ok_or(Error::NotInitialized)?;
        let signals = encode::encode_payroll_inputs(
            &env,
            total_budget,
            max_salary,
            active_count,
            &commitment,
            &leaf_hashes,
        );
        groth16::verify(&env, &vk, &proof, &signals)?;

        let token_client = token::Client::new(&env, &token);
        for i in 0..active_count {
            token_client.transfer(
                &employer,
                &recipients.get(i).unwrap(),
                &amounts.get(i).unwrap(),
            );
        }

        env.storage().persistent().set(&used_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&used_key, TTL_THRESHOLD, TTL_BUMP);

        let batch_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BatchCounter)
            .unwrap_or(0u64)
            + 1;
        env.storage()
            .instance()
            .set(&DataKey::BatchCounter, &batch_id);

        let batch = PayrollBatch {
            employer: employer.clone(),
            total_budget,
            headcount: active_count,
            commitment,
            token,
            executed_at: env.ledger().timestamp(),
            leaf_hashes,
        };
        let batch_key = DataKey::Batch(batch_id);
        env.storage().persistent().set(&batch_key, &batch);
        env.storage()
            .persistent()
            .extend_ttl(&batch_key, TTL_THRESHOLD, TTL_BUMP);

        let hist_key = DataKey::EmployerBatches(employer.clone());
        let mut hist: Vec<u64> = env
            .storage()
            .persistent()
            .get(&hist_key)
            .unwrap_or(Vec::new(&env));
        if hist.len() >= 1000 {
            hist.remove(0);
        }
        hist.push_back(batch_id);
        env.storage().persistent().set(&hist_key, &hist);
        env.storage()
            .persistent()
            .extend_ttl(&hist_key, TTL_THRESHOLD, TTL_BUMP);

        let cum_key = DataKey::EmployerCumulative(employer.clone());
        let prev: i128 = env.storage().persistent().get(&cum_key).unwrap_or(0i128);
        let new_cum = prev.checked_add(total_budget).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&cum_key, &new_cum);
        env.storage()
            .persistent()
            .extend_ttl(&cum_key, TTL_THRESHOLD, TTL_BUMP);

        PayrollExecuted {
            employer,
            total_budget,
            headcount: active_count,
            batch_id,
        }
        .publish(&env);

        Ok(batch_id)
    }

    pub fn disburse_confidential(
        env: Env,
        employer: Address,
        proof: Proof,
        total_budget: i128,
        max_salary: i128,
        active_count: u32,
        commitment: BytesN<32>,
        token: Address,
        recipients: Vec<Address>,
        note_commitments: Vec<BytesN<32>>,
        note_ciphers: Vec<Bytes>,
    ) -> Result<u64, Error> {
        employer.require_auth();
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        let token_key = DataKey::SupportedToken(token.clone());
        if !env.storage().persistent().has(&token_key) {
            return Err(Error::UnsupportedToken);
        }
        env.storage()
            .persistent()
            .extend_ttl(&token_key, TTL_THRESHOLD, TTL_BUMP);

        let used_key = DataKey::UsedCommitment(employer.clone(), commitment.clone());
        if env.storage().persistent().has(&used_key) {
            return Err(Error::CommitmentAlreadyUsed);
        }

        if active_count == 0 || active_count > MAX_HEADCOUNT {
            return Err(Error::InvalidHeadcount);
        }
        if recipients.len() != active_count || note_ciphers.len() != active_count {
            return Err(Error::LengthMismatch);
        }
        if note_commitments.len() != MAX_HEADCOUNT {
            return Err(Error::LengthMismatch);
        }
        if total_budget <= 0 || max_salary <= 0 {
            return Err(Error::SumMismatch);
        }

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkPayrollNotes)
            .ok_or(Error::NotInitialized)?;
        let signals = confidential::encode_payroll_notes_inputs(
            &env,
            total_budget,
            max_salary,
            active_count,
            &commitment,
            &note_commitments,
        );
        groth16::verify(&env, &vk, &proof, &signals)?;

        // Employer funds the total publicly (the total is public by design).
        token::Client::new(&env, &token).transfer(
            &employer,
            &env.current_contract_address(),
            &total_budget,
        );

        env.storage().persistent().set(&used_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&used_key, TTL_THRESHOLD, TTL_BUMP);

        // Create one note-escrow per active recipient.
        let now = env.ledger().timestamp();
        for i in 0..active_count {
            let escrow_id: u64 = env
                .storage()
                .instance()
                .get(&DataKey::EscrowCounter)
                .unwrap_or(0u64)
                + 1;
            env.storage()
                .instance()
                .set(&DataKey::EscrowCounter, &escrow_id);

            let payee = recipients.get(i).unwrap();
            let escrow = InvoiceEscrow {
                payer: employer.clone(),
                payee: payee.clone(),
                token: token.clone(),
                invoice_min: 0,
                invoice_max: NOTE_MAX,
                escrow_commitment: note_commitments.get(i).unwrap(),
                settled: false,
                created_at: now,
            };
            let key = DataKey::Escrow(escrow_id);
            env.storage().persistent().set(&key, &escrow);
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);

            // Attach the encrypted note for auto-receive (skip empty = out-of-band).
            let cipher = note_ciphers.get(i).unwrap();
            if cipher.len() > 0 {
                let cipher_key = DataKey::NoteCipher(escrow_id);
                env.storage().persistent().set(&cipher_key, &cipher);
                env.storage()
                    .persistent()
                    .extend_ttl(&cipher_key, TTL_THRESHOLD, TTL_BUMP);
            }

            Self::append_recipient_escrow(&env, &payee, escrow_id);
        }

        let batch_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BatchCounter)
            .unwrap_or(0u64)
            + 1;
        env.storage()
            .instance()
            .set(&DataKey::BatchCounter, &batch_id);

        let batch = PayrollBatch {
            employer: employer.clone(),
            total_budget,
            headcount: active_count,
            commitment,
            token,
            executed_at: now,
            leaf_hashes: Vec::new(&env),
        };
        let batch_key = DataKey::Batch(batch_id);
        env.storage().persistent().set(&batch_key, &batch);
        env.storage()
            .persistent()
            .extend_ttl(&batch_key, TTL_THRESHOLD, TTL_BUMP);

        let hist_key = DataKey::EmployerBatches(employer.clone());
        let mut hist: Vec<u64> = env
            .storage()
            .persistent()
            .get(&hist_key)
            .unwrap_or(Vec::new(&env));
        if hist.len() >= 1000 {
            hist.remove(0);
        }
        hist.push_back(batch_id);
        env.storage().persistent().set(&hist_key, &hist);
        env.storage()
            .persistent()
            .extend_ttl(&hist_key, TTL_THRESHOLD, TTL_BUMP);

        let cum_key = DataKey::EmployerCumulative(employer.clone());
        let prev: i128 = env.storage().persistent().get(&cum_key).unwrap_or(0i128);
        let new_cum = prev.checked_add(total_budget).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&cum_key, &new_cum);
        env.storage()
            .persistent()
            .extend_ttl(&cum_key, TTL_THRESHOLD, TTL_BUMP);

        PayrollExecuted {
            employer,
            total_budget,
            headcount: active_count,
            batch_id,
        }
        .publish(&env);

        Ok(batch_id)
    }

    /// Escrow ids (payroll notes + invoices) where this address is the payee.
    pub fn get_recipient_escrows(env: Env, recipient: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::RecipientEscrows(recipient))
            .unwrap_or(Vec::new(&env))
    }

    pub fn register_viewing_key(
        env: Env,
        account: Address,
        viewing_pubkey: BytesN<32>,
    ) -> Result<(), Error> {
        account.require_auth();
        let key = DataKey::ViewingKey(account);
        env.storage().persistent().set(&key, &viewing_pubkey);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
        Ok(())
    }

    pub fn get_viewing_key(env: Env, account: Address) -> Result<BytesN<32>, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::ViewingKey(account))
            .ok_or(Error::NotFound)
    }

    pub fn get_note_cipher(env: Env, escrow_id: u64) -> Result<Bytes, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::NoteCipher(escrow_id))
            .ok_or(Error::NotFound)
    }

    pub fn create_escrow(
        env: Env,
        payer: Address,
        payee: Address,
        token: Address,
        invoice_min: i128,
        invoice_max: i128,
        new_commitment: BytesN<32>,
        escrow_commitment: BytesN<32>,
        proof: Proof,
    ) -> Result<u64, Error> {
        payer.require_auth();
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        if invoice_min <= 0 || invoice_max < invoice_min {
            return Err(Error::InvalidRange);
        }

        let balance_key = DataKey::ConfidentialBalance(payer.clone(), token.clone());
        let old_commitment: BytesN<32> = env
            .storage()
            .persistent()
            .get(&balance_key)
            .ok_or(Error::AccountNotFound)?;

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkEscrowLock)
            .ok_or(Error::NotInitialized)?;
        let signals = confidential::encode_escrow_lock_inputs(
            &env,
            &old_commitment,
            &new_commitment,
            &escrow_commitment,
        );
        groth16::verify(&env, &vk, &proof, &signals)?;

        env.storage()
            .persistent()
            .set(&balance_key, &new_commitment);
        env.storage()
            .persistent()
            .extend_ttl(&balance_key, TTL_THRESHOLD, TTL_BUMP);

        let escrow_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCounter)
            .unwrap_or(0u64)
            + 1;
        env.storage()
            .instance()
            .set(&DataKey::EscrowCounter, &escrow_id);

        let escrow = InvoiceEscrow {
            payer: payer.clone(),
            payee: payee.clone(),
            token,
            invoice_min,
            invoice_max,
            escrow_commitment,
            settled: false,
            created_at: env.ledger().timestamp(),
        };
        let key = DataKey::Escrow(escrow_id);
        env.storage().persistent().set(&key, &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);

        Self::append_recipient_escrow(&env, &payee, escrow_id);

        InvoiceCreated {
            payer,
            payee,
            escrow_id,
            invoice_min,
            invoice_max,
        }
        .publish(&env);

        Ok(escrow_id)
    }

    /// Settle for a payee who already holds a confidential balance for `escrow.token`.
    pub fn settle_escrow(
        env: Env,
        payee: Address,
        escrow_id: u64,
        new_commitment: BytesN<32>,
        proof: Proof,
    ) -> Result<(), Error> {
        payee.require_auth();
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        let mut escrow: InvoiceEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(Error::EscrowNotFound)?;

        if escrow.payee != payee {
            return Err(Error::Unauthorized);
        }
        if escrow.settled {
            return Err(Error::EscrowAlreadySettled);
        }

        let balance_key = DataKey::ConfidentialBalance(payee.clone(), escrow.token.clone());
        let payee_old_commitment: BytesN<32> = env
            .storage()
            .persistent()
            .get(&balance_key)
            .ok_or(Error::AccountNotFound)?;

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkEscrowSettle)
            .ok_or(Error::NotInitialized)?;
        let signals = confidential::encode_escrow_settle_inputs(
            &env,
            &escrow.escrow_commitment,
            escrow.invoice_min,
            escrow.invoice_max,
            &payee_old_commitment,
            &new_commitment,
        );
        groth16::verify(&env, &vk, &proof, &signals)?;

        escrow.settled = true;
        let key = DataKey::Escrow(escrow_id);
        env.storage().persistent().set(&key, &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);

        env.storage()
            .persistent()
            .set(&balance_key, &new_commitment);
        env.storage()
            .persistent()
            .extend_ttl(&balance_key, TTL_THRESHOLD, TTL_BUMP);

        InvoiceSettled { payee, escrow_id }.publish(&env);
        Ok(())
    }

    /// Settle for a payee with no prior confidential balance for `escrow.token`
    /// (mirrors deposit_new — see escrow_settle_new.circom).
    pub fn settle_escrow_new(
        env: Env,
        payee: Address,
        escrow_id: u64,
        payee_commitment: BytesN<32>,
        proof: Proof,
    ) -> Result<(), Error> {
        payee.require_auth();
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        let mut escrow: InvoiceEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(Error::EscrowNotFound)?;

        if escrow.payee != payee {
            return Err(Error::Unauthorized);
        }
        if escrow.settled {
            return Err(Error::EscrowAlreadySettled);
        }

        let balance_key = DataKey::ConfidentialBalance(payee.clone(), escrow.token.clone());
        if env.storage().persistent().has(&balance_key) {
            return Err(Error::AccountAlreadyExists);
        }

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkEscrowSettleNew)
            .ok_or(Error::NotInitialized)?;
        let signals = confidential::encode_escrow_settle_new_inputs(
            &env,
            &escrow.escrow_commitment,
            escrow.invoice_min,
            escrow.invoice_max,
            &payee_commitment,
        );
        groth16::verify(&env, &vk, &proof, &signals)?;

        escrow.settled = true;
        let key = DataKey::Escrow(escrow_id);
        env.storage().persistent().set(&key, &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);

        env.storage()
            .persistent()
            .set(&balance_key, &payee_commitment);
        env.storage()
            .persistent()
            .extend_ttl(&balance_key, TTL_THRESHOLD, TTL_BUMP);

        InvoiceSettled { payee, escrow_id }.publish(&env);
        Ok(())
    }

    pub fn cancel_escrow(
        env: Env,
        payer: Address,
        escrow_id: u64,
        new_commitment: BytesN<32>,
        proof: Proof,
    ) -> Result<(), Error> {
        payer.require_auth();

        let mut escrow: InvoiceEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(Error::EscrowNotFound)?;

        if escrow.payer != payer {
            return Err(Error::Unauthorized);
        }
        if escrow.settled {
            return Err(Error::EscrowAlreadySettled);
        }
        if env.ledger().timestamp() < escrow.created_at + ESCROW_TIMEOUT {
            return Err(Error::EscrowNotExpired);
        }

        let balance_key = DataKey::ConfidentialBalance(payer.clone(), escrow.token.clone());
        let payer_old_commitment: BytesN<32> = env
            .storage()
            .persistent()
            .get(&balance_key)
            .ok_or(Error::AccountNotFound)?;

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkEscrowCancel)
            .ok_or(Error::NotInitialized)?;

        let signals = confidential::encode_escrow_lock_inputs(
            &env,
            &payer_old_commitment,
            &new_commitment,
            &escrow.escrow_commitment,
        );
        groth16::verify(&env, &vk, &proof, &signals)?;

        escrow.settled = true;
        let key = DataKey::Escrow(escrow_id);
        env.storage().persistent().set(&key, &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);

        env.storage()
            .persistent()
            .set(&balance_key, &new_commitment);
        env.storage()
            .persistent()
            .extend_ttl(&balance_key, TTL_THRESHOLD, TTL_BUMP);

        Ok(())
    }

    pub fn deposit_new(
        env: Env,
        account: Address,
        token: Address,
        amount: i128,
        commitment: BytesN<32>,
        proof: Proof,
    ) -> Result<(), Error> {
        account.require_auth();
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        let token_key = DataKey::SupportedToken(token.clone());
        if !env.storage().persistent().has(&token_key) {
            return Err(Error::UnsupportedToken);
        }
        env.storage()
            .persistent()
            .extend_ttl(&token_key, TTL_THRESHOLD, TTL_BUMP);

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let balance_key = DataKey::ConfidentialBalance(account.clone(), token.clone());
        if env.storage().persistent().has(&balance_key) {
            return Err(Error::AccountAlreadyExists);
        }

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkDepositNew)
            .ok_or(Error::NotInitialized)?;
        let signals = confidential::encode_deposit_new_inputs(&env, amount, &commitment);
        groth16::verify(&env, &vk, &proof, &signals)?;

        token::Client::new(&env, &token).transfer(
            &account,
            &env.current_contract_address(),
            &amount,
        );

        env.storage().persistent().set(&balance_key, &commitment);
        env.storage()
            .persistent()
            .extend_ttl(&balance_key, TTL_THRESHOLD, TTL_BUMP);

        ConfidentialDeposit {
            account,
            token,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn deposit_topup(
        env: Env,
        account: Address,
        token: Address,
        amount: i128,
        new_commitment: BytesN<32>,
        proof: Proof,
    ) -> Result<(), Error> {
        account.require_auth();
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        let token_key = DataKey::SupportedToken(token.clone());
        if !env.storage().persistent().has(&token_key) {
            return Err(Error::UnsupportedToken);
        }
        env.storage()
            .persistent()
            .extend_ttl(&token_key, TTL_THRESHOLD, TTL_BUMP);

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let balance_key = DataKey::ConfidentialBalance(account.clone(), token.clone());
        let old_commitment: BytesN<32> = env
            .storage()
            .persistent()
            .get(&balance_key)
            .ok_or(Error::AccountNotFound)?;

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkDepositTopup)
            .ok_or(Error::NotInitialized)?;
        let signals = confidential::encode_balance_update_inputs(
            &env,
            &old_commitment,
            amount,
            &new_commitment,
        );
        groth16::verify(&env, &vk, &proof, &signals)?;

        token::Client::new(&env, &token).transfer(
            &account,
            &env.current_contract_address(),
            &amount,
        );

        env.storage()
            .persistent()
            .set(&balance_key, &new_commitment);
        env.storage()
            .persistent()
            .extend_ttl(&balance_key, TTL_THRESHOLD, TTL_BUMP);

        ConfidentialDeposit {
            account,
            token,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn withdraw(
        env: Env,
        account: Address,
        token: Address,
        amount: i128,
        new_commitment: BytesN<32>,
        proof: Proof,
    ) -> Result<(), Error> {
        account.require_auth();
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let balance_key = DataKey::ConfidentialBalance(account.clone(), token.clone());
        let old_commitment: BytesN<32> = env
            .storage()
            .persistent()
            .get(&balance_key)
            .ok_or(Error::AccountNotFound)?;

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkWithdraw)
            .ok_or(Error::NotInitialized)?;
        let signals = confidential::encode_balance_update_inputs(
            &env,
            &old_commitment,
            amount,
            &new_commitment,
        );
        groth16::verify(&env, &vk, &proof, &signals)?;

        env.storage()
            .persistent()
            .set(&balance_key, &new_commitment);
        env.storage()
            .persistent()
            .extend_ttl(&balance_key, TTL_THRESHOLD, TTL_BUMP);

        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &account,
            &amount,
        );

        ConfidentialWithdrawal {
            account,
            token,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_confidential_balance(
        env: Env,
        account: Address,
        token: Address,
    ) -> Result<BytesN<32>, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::ConfidentialBalance(account, token))
            .ok_or(Error::AccountNotFound)
    }

    pub fn get_employer_history(env: Env, employer: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::EmployerBatches(employer))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_employer_cumulative(env: Env, employer: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::EmployerCumulative(employer))
            .unwrap_or(0i128)
    }

    pub fn get_batch(env: Env, batch_id: u64) -> Result<PayrollBatch, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Batch(batch_id))
            .ok_or(Error::BatchNotFound)
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> Result<InvoiceEscrow, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(Error::EscrowNotFound)
    }

    // ── internal ─────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) -> Result<Address, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
    }

    fn append_recipient_escrow(env: &Env, recipient: &Address, escrow_id: u64) {
        let key = DataKey::RecipientEscrows(recipient.clone());
        let mut list: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(env));
        if list.len() >= 1000 {
            list.remove(0);
        }
        list.push_back(escrow_id);
        env.storage().persistent().set(&key, &list);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
    }
}
