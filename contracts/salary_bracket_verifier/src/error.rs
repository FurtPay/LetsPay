use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidProof = 3,
    MalformedVerifyingKey = 4,
    /// `escrow_id` does not exist in `payroll_verifier`.
    EscrowNotFound = 5,
    /// Caller is not the payee of the escrow / note.
    Unauthorized = 6,
    /// `batch_id` does not exist in `payroll_verifier`.
    BatchNotFound = 7,
    /// Invalid input (e.g. empty or oversized escrow_ids list).
    InvalidInput = 8,
}
