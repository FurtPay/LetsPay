use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    UnsupportedToken = 4,
    CommitmentAlreadyUsed = 5,
    LengthMismatch = 6,
    InvalidHeadcount = 7,
    SumMismatch = 8,
    InvalidProof = 9,
    MalformedVerifyingKey = 10,
    BatchNotFound = 11,
    EscrowNotFound = 12,
    EscrowAlreadySettled = 13,
    /// invoice_max < invoice_min, or amount <= 0.
    InvalidRange = 14,
    /// Caller is not authorized for this operation.
    Unauthorized = 15,
    /// Arithmetic overflow in amount accumulation.
    Overflow = 16,
    /// Escrow timeout has not yet elapsed.
    EscrowNotExpired = 17,
    /// No pending upgrade or upgrade delay not yet elapsed.
    UpgradeNotReady = 18,
    /// Per-payment amount is negative.
    InvalidAmount = 19,
    /// No confidential balance exists yet for this (account, token) pair.
    AccountNotFound = 20,
    /// A confidential balance already exists for this (account, token) pair — use deposit_topup.
    AccountAlreadyExists = 21,
    /// No viewing key registered, or no encrypted note attached to this escrow.
    NotFound = 22,
}
