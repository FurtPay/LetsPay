import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDTL5N2EKQM7DA7UVU7EQ66FJJ6HPDAHFKNJR4BS2BUYOHFBAJUBG4XL",
  }
} as const

export type DataKey = {tag: "Admin", values: void} | {tag: "VkPayroll", values: void} | {tag: "VkInvoice", values: void} | {tag: "BatchCounter", values: void} | {tag: "EscrowCounter", values: void} | {tag: "SupportedToken", values: readonly [string]} | {tag: "UsedCommitment", values: readonly [string, Buffer]} | {tag: "Batch", values: readonly [u64]} | {tag: "Escrow", values: readonly [u64]} | {tag: "EmployerBatches", values: readonly [string]} | {tag: "EmployerCumulative", values: readonly [string]} | {tag: "UpgradePending", values: void} | {tag: "ConfidentialBalance", values: readonly [string, string]} | {tag: "VkDepositNew", values: void} | {tag: "VkDepositTopup", values: void} | {tag: "VkWithdraw", values: void} | {tag: "VkEscrowLock", values: void} | {tag: "VkEscrowSettle", values: void} | {tag: "VkEscrowSettleNew", values: void} | {tag: "VkEscrowCancel", values: void} | {tag: "VkPayrollNotes", values: void} | {tag: "RecipientEscrows", values: readonly [string]} | {tag: "ViewingKey", values: readonly [string]} | {tag: "NoteCipher", values: readonly [u64]};



export interface PayrollBatch {
  commitment: Buffer;
  employer: string;
  executed_at: u64;
  headcount: u32;
  /**
 * Per-slot Poseidon leaf hashes for Feature 5 (salary bracket proofs).
 */
leaf_hashes: Array<Buffer>;
  token: string;
  total_budget: i128;
}



export interface InvoiceEscrow {
  created_at: u64;
  /**
 * Phase 4: opaque Poseidon(amount, escrow_blinding) — the amount never
 * appears as a plain field anywhere on-chain.
 */
escrow_commitment: Buffer;
  invoice_max: i128;
  invoice_min: i128;
  payee: string;
  payer: string;
  settled: boolean;
  token: string;
}




export interface UpgradeProposal {
  proposed_at: u64;
  wasm_hash: Buffer;
}






export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"NotAdmin"},
  4: {message:"UnsupportedToken"},
  5: {message:"CommitmentAlreadyUsed"},
  6: {message:"LengthMismatch"},
  7: {message:"InvalidHeadcount"},
  8: {message:"SumMismatch"},
  9: {message:"InvalidProof"},
  10: {message:"MalformedVerifyingKey"},
  11: {message:"BatchNotFound"},
  12: {message:"EscrowNotFound"},
  13: {message:"EscrowAlreadySettled"},
  /**
   * invoice_max < invoice_min, or amount <= 0.
   */
  14: {message:"InvalidRange"},
  /**
   * Caller is not authorized for this operation.
   */
  15: {message:"Unauthorized"},
  /**
   * Arithmetic overflow in amount accumulation.
   */
  16: {message:"Overflow"},
  /**
   * Escrow timeout has not yet elapsed.
   */
  17: {message:"EscrowNotExpired"},
  /**
   * No pending upgrade or upgrade delay not yet elapsed.
   */
  18: {message:"UpgradeNotReady"},
  /**
   * Per-payment amount is negative.
   */
  19: {message:"InvalidAmount"},
  /**
   * No confidential balance exists yet for this (account, token) pair.
   */
  20: {message:"AccountNotFound"},
  /**
   * A confidential balance already exists for this (account, token) pair — use deposit_topup.
   */
  21: {message:"AccountAlreadyExists"},
  /**
   * No viewing key registered, or no encrypted note attached to this escrow.
   */
  22: {message:"NotFound"}
}


/**
 * Groth16 proof (BLS12-381): A in G1, B in G2, C in G1.
 */
export interface Proof {
  a: Buffer;
  b: Buffer;
  c: Buffer;
}


/**
 * Groth16 verification key (BLS12-381). Marshaled to/from JSON off-chain by
 * `scripts/snarkjs_to_soroban.ts`. `ic.len()` must equal `num_public_inputs + 1`.
 */
export interface VerificationKey {
  alpha: Buffer;
  beta: Buffer;
  delta: Buffer;
  gamma: Buffer;
  ic: Array<Buffer>;
}

export interface Client {
  /**
   * Construct and simulate a disburse transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  disburse: ({employer, proof, total_budget, max_salary, active_count, commitment, token, recipients, amounts, leaf_hashes}: {employer: string, proof: Proof, total_budget: i128, max_salary: i128, active_count: u32, commitment: Buffer, token: string, recipients: Array<string>, amounts: Array<i128>, leaf_hashes: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw: ({account, token, amount, new_commitment, proof}: {account: string, token: string, amount: i128, new_commitment: Buffer, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a add_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_token: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_batch: ({batch_id}: {batch_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<PayrollBatch>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_escrow: ({escrow_id}: {escrow_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<InvoiceEscrow>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, vk_payroll, vk_invoice, initial_tokens}: {admin: string, vk_payroll: VerificationKey, vk_invoice: VerificationKey, initial_tokens: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a deposit_new transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit_new: ({account, token, amount, commitment, proof}: {account: string, token: string, amount: i128, commitment: Buffer, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_token: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Payer reclaims the locked amount back into their own confidential
   * balance after the escrow has expired unsettled. The payer's
   * confidential balance is guaranteed to already exist — create_escrow
   * requires it to lock funds in the first place.
   */
  cancel_escrow: ({payer, escrow_id, new_commitment, proof}: {payer: string, escrow_id: u64, new_commitment: Buffer, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_escrow: ({payer, payee, token, invoice_min, invoice_max, new_commitment, escrow_commitment, proof}: {payer: string, payee: string, token: string, invoice_min: i128, invoice_max: i128, new_commitment: Buffer, escrow_commitment: Buffer, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a deposit_topup transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit_topup: ({account, token, amount, new_commitment, proof}: {account: string, token: string, amount: i128, new_commitment: Buffer, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a settle_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Settle for a payee who already holds a confidential balance for `escrow.token`.
   */
  settle_escrow: ({payee, escrow_id, new_commitment, proof}: {payee: string, escrow_id: u64, new_commitment: Buffer, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_escrow_vks transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time-per-key setup for the confidential invoice-escrow verification
   * keys (Phase 4).
   */
  set_escrow_vks: ({vk_escrow_lock, vk_escrow_settle, vk_escrow_settle_new, vk_escrow_cancel}: {vk_escrow_lock: VerificationKey, vk_escrow_settle: VerificationKey, vk_escrow_settle_new: VerificationKey, vk_escrow_cancel: VerificationKey}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_note_cipher transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_note_cipher: ({escrow_id}: {escrow_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a get_viewing_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_viewing_key: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a propose_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a settle_escrow_new transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Settle for a payee with no prior confidential balance for `escrow.token`
   * (mirrors deposit_new — see escrow_settle_new.circom).
   */
  settle_escrow_new: ({payee, escrow_id, payee_commitment, proof}: {payee: string, escrow_id: u64, payee_commitment: Buffer, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_token_supported transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_token_supported: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_employer_history transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_employer_history: ({employer}: {employer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u64>>>

  /**
   * Construct and simulate a register_viewing_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register_viewing_key: ({account, viewing_pubkey}: {account: string, viewing_pubkey: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_confidential_vks transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time-per-key setup for the confidential-ledger verification keys
   * (Phase 4). Separate from `initialize` so it can be added to an
   * already-initialized contract without changing `initialize`'s signature.
   */
  set_confidential_vks: ({vk_deposit_new, vk_deposit_topup, vk_withdraw}: {vk_deposit_new: VerificationKey, vk_deposit_topup: VerificationKey, vk_withdraw: VerificationKey}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_payroll_notes_vk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time setup for the confidential payroll (note-model) verification key.
   */
  set_payroll_notes_vk: ({vk_payroll_notes}: {vk_payroll_notes: VerificationKey}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a disburse_confidential transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  disburse_confidential: ({employer, proof, total_budget, max_salary, active_count, commitment, token, recipients, note_commitments, note_ciphers}: {employer: string, proof: Proof, total_budget: i128, max_salary: i128, active_count: u32, commitment: Buffer, token: string, recipients: Array<string>, note_commitments: Array<Buffer>, note_ciphers: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a get_recipient_escrows transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Escrow ids (payroll notes + invoices) where this address is the payee.
   */
  get_recipient_escrows: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u64>>>

  /**
   * Construct and simulate a get_employer_cumulative transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_employer_cumulative: ({employer}: {employer: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_confidential_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_confidential_balance: ({account, token}: {account: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAGAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAJVmtQYXlyb2xsAAAAAAAAAAAAAAAAAAAJVmtJbnZvaWNlAAAAAAAAAAAAAAAAAAAMQmF0Y2hDb3VudGVyAAAAAAAAAAAAAAANRXNjcm93Q291bnRlcgAAAAAAAAEAAAAAAAAADlN1cHBvcnRlZFRva2VuAAAAAAABAAAAEwAAAAEAAAA0U2NvcGVkIHRvIGVtcGxveWVyIHRvIHByZXZlbnQgY3Jvc3MtZW1wbG95ZXIgcmVwbGF5LgAAAA5Vc2VkQ29tbWl0bWVudAAAAAAAAgAAABMAAAPuAAAAIAAAAAEAAAAAAAAABUJhdGNoAAAAAAAAAQAAAAYAAAABAAAAAAAAAAZFc2Nyb3cAAAAAAAEAAAAGAAAAAQAAAAAAAAAPRW1wbG95ZXJCYXRjaGVzAAAAAAEAAAATAAAAAQAAAAAAAAASRW1wbG95ZXJDdW11bGF0aXZlAAAAAAABAAAAEwAAAAAAAAAAAAAADlVwZ3JhZGVQZW5kaW5nAAAAAAABAAAAUVBoYXNlIDQ6IGNvbmZpZGVudGlhbCBsZWRnZXIg4oCUIChhY2NvdW50LCB0b2tlbikgLT4gUG9zZWlkb24oYmFsYW5jZSwgYmxpbmRpbmcpLgAAAAAAABNDb25maWRlbnRpYWxCYWxhbmNlAAAAAAIAAAATAAAAEwAAAAAAAAAAAAAADFZrRGVwb3NpdE5ldwAAAAAAAAAAAAAADlZrRGVwb3NpdFRvcHVwAAAAAAAAAAAAAAAAAApWa1dpdGhkcmF3AAAAAAAAAAAAAAAAAAxWa0VzY3Jvd0xvY2sAAAAAAAAAAAAAAA5Wa0VzY3Jvd1NldHRsZQAAAAAAAAAAAAAAAAARVmtFc2Nyb3dTZXR0bGVOZXcAAAAAAAAAAAAAAAAAAA5Wa0VzY3Jvd0NhbmNlbAAAAAAAAAAAAAAAAAAOVmtQYXlyb2xsTm90ZXMAAAAAAAEAAABDSW5kZXggb2YgZXNjcm93IGlkcyBhIHJlY2lwaWVudC9wYXllZSBjYW4gY2xhaW0gKG5vdGVzICsgaW52b2ljZXMpLgAAAAAQUmVjaXBpZW50RXNjcm93cwAAAAEAAAATAAAAAQAAAFBBdXRvLXJlY2VpdmU6IGFuIGFjY291bnQncyB4MjU1MTkgdmlld2luZyBwdWJsaWMga2V5IChmb3IgRUNESCBub3RlIGVuY3J5cHRpb24pLgAAAApWaWV3aW5nS2V5AAAAAAABAAAAEwAAAAEAAABWQXV0by1yZWNlaXZlOiBFQ0RILWVuY3J5cHRlZCAoYW1vdW50LCBub3RlX2JsaW5kaW5nKSBmb3IgYSBwYXlyb2xsIG5vdGUsIGJ5IGVzY3JvdyBpZC4AAAAAAApOb3RlQ2lwaGVyAAAAAAABAAAABg==",
        "AAAABQAAAAAAAAAAAAAAClRva2VuQWRkZWQAAAAAAAIAAAAFdG9rZW4AAAAAAAAFYWRkZWQAAAAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAADFBheXJvbGxCYXRjaAAAAAcAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAAAAAAhlbXBsb3llcgAAABMAAAAAAAAAC2V4ZWN1dGVkX2F0AAAAAAYAAAAAAAAACWhlYWRjb3VudAAAAAAAAAQAAABEUGVyLXNsb3QgUG9zZWlkb24gbGVhZiBoYXNoZXMgZm9yIEZlYXR1cmUgNSAoc2FsYXJ5IGJyYWNrZXQgcHJvb2ZzKS4AAAALbGVhZl9oYXNoZXMAAAAD6gAAA+4AAAAgAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAADHRvdGFsX2J1ZGdldAAAAAs=",
        "AAAABQAAAAAAAAAAAAAADFRva2VuUmVtb3ZlZAAAAAIAAAAFdG9rZW4AAAAAAAAHcmVtb3ZlZAAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAADUludm9pY2VFc2Nyb3cAAAAAAAAIAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAclBoYXNlIDQ6IG9wYXF1ZSBQb3NlaWRvbihhbW91bnQsIGVzY3Jvd19ibGluZGluZykg4oCUIHRoZSBhbW91bnQgbmV2ZXIKYXBwZWFycyBhcyBhIHBsYWluIGZpZWxkIGFueXdoZXJlIG9uLWNoYWluLgAAAAAAEWVzY3Jvd19jb21taXRtZW50AAAAAAAD7gAAACAAAAAAAAAAC2ludm9pY2VfbWF4AAAAAAsAAAAAAAAAC2ludm9pY2VfbWluAAAAAAsAAAAAAAAABXBheWVlAAAAAAAAEwAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAdzZXR0bGVkAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAABQAAAAAAAAAAAAAADkludm9pY2VDcmVhdGVkAAAAAAACAAAAB2ludm9pY2UAAAAAB2NyZWF0ZWQAAAAABQAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAQAAAAAAAAAFcGF5ZWUAAAAAAAATAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAAAAAAC2ludm9pY2VfbWluAAAAAAsAAAAAAAAAAAAAAAtpbnZvaWNlX21heAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADkludm9pY2VTZXR0bGVkAAAAAAACAAAAB2ludm9pY2UAAAAAB3NldHRsZWQAAAAAAgAAAAAAAAAFcGF5ZWUAAAAAAAATAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAC",
        "AAAAAQAAAAAAAAAAAAAAD1VwZ3JhZGVQcm9wb3NhbAAAAAACAAAAAAAAAAtwcm9wb3NlZF9hdAAAAAAGAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIA==",
        "AAAABQAAAAAAAAAAAAAAD1BheXJvbGxFeGVjdXRlZAAAAAACAAAAB3BheXJvbGwAAAAACGV4ZWN1dGVkAAAABAAAAAAAAAAIZW1wbG95ZXIAAAATAAAAAQAAAAAAAAAMdG90YWxfYnVkZ2V0AAAACwAAAAAAAAAAAAAACWhlYWRjb3VudAAAAAAAAAQAAAAAAAAAAAAAAAhiYXRjaF9pZAAAAAYAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD1VwZ3JhZGVFeGVjdXRlZAAAAAACAAAAB3VwZ3JhZGUAAAAACGV4ZWN1dGVkAAAAAQAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD1VwZ3JhZGVQcm9wb3NlZAAAAAACAAAAB3VwZ3JhZGUAAAAACHByb3Bvc2VkAAAAAgAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAAAAAA1leGVjdXRlX2FmdGVyAAAAAAAABgAAAAAAAAAC",
        "AAAAAAAAAAAAAAAIZGlzYnVyc2UAAAAKAAAAAAAAAAhlbXBsb3llcgAAABMAAAAAAAAABXByb29mAAAAAAAH0AAAAAVQcm9vZgAAAAAAAAAAAAAMdG90YWxfYnVkZ2V0AAAACwAAAAAAAAAKbWF4X3NhbGFyeQAAAAAACwAAAAAAAAAMYWN0aXZlX2NvdW50AAAABAAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAKcmVjaXBpZW50cwAAAAAD6gAAABMAAAAAAAAAB2Ftb3VudHMAAAAD6gAAAAsAAAAAAAAAC2xlYWZfaGFzaGVzAAAAA+oAAAPuAAAAIAAAAAEAAAPpAAAABgAAAAM=",
        "AAAAAAAAAAAAAAAId2l0aGRyYXcAAAAFAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAA5uZXdfY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAABXByb29mAAAAAAAH0AAAAAVQcm9vZgAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAJYWRkX3Rva2VuAAAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAJZ2V0X2JhdGNoAAAAAAAAAQAAAAAAAAAIYmF0Y2hfaWQAAAAGAAAAAQAAA+kAAAfQAAAADFBheXJvbGxCYXRjaAAAAAM=",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAKZ2V0X2VzY3JvdwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAA1JbnZvaWNlRXNjcm93AAAAAAAAAw==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAp2a19wYXlyb2xsAAAAAAfQAAAAD1ZlcmlmaWNhdGlvbktleQAAAAAAAAAACnZrX2ludm9pY2UAAAAAB9AAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAAAAAAOaW5pdGlhbF90b2tlbnMAAAAAA+oAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAALZGVwb3NpdF9uZXcAAAAABQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAABXByb29mAAAAAAAH0AAAAAVQcm9vZgAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAABQAAAAAAAAAAAAAAE0NvbmZpZGVudGlhbERlcG9zaXQAAAAAAgAAAAxjb25maWRlbnRpYWwAAAAHZGVwb3NpdAAAAAADAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAAAAAAAAAAAAAMcmVtb3ZlX3Rva2VuAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAPFQYXllciByZWNsYWltcyB0aGUgbG9ja2VkIGFtb3VudCBiYWNrIGludG8gdGhlaXIgb3duIGNvbmZpZGVudGlhbApiYWxhbmNlIGFmdGVyIHRoZSBlc2Nyb3cgaGFzIGV4cGlyZWQgdW5zZXR0bGVkLiBUaGUgcGF5ZXIncwpjb25maWRlbnRpYWwgYmFsYW5jZSBpcyBndWFyYW50ZWVkIHRvIGFscmVhZHkgZXhpc3Qg4oCUIGNyZWF0ZV9lc2Nyb3cKcmVxdWlyZXMgaXQgdG8gbG9jayBmdW5kcyBpbiB0aGUgZmlyc3QgcGxhY2UuAAAAAAAADWNhbmNlbF9lc2Nyb3cAAAAAAAAEAAAAAAAAAAVwYXllcgAAAAAAABMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAADm5ld19jb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAANY3JlYXRlX2VzY3JvdwAAAAAAAAgAAAAAAAAABXBheWVyAAAAAAAAEwAAAAAAAAAFcGF5ZWUAAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAC2ludm9pY2VfbWluAAAAAAsAAAAAAAAAC2ludm9pY2VfbWF4AAAAAAsAAAAAAAAADm5ld19jb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAARZXNjcm93X2NvbW1pdG1lbnQAAAAAAAPuAAAAIAAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAANZGVwb3NpdF90b3B1cAAAAAAAAAUAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAADm5ld19jb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAE9TZXR0bGUgZm9yIGEgcGF5ZWUgd2hvIGFscmVhZHkgaG9sZHMgYSBjb25maWRlbnRpYWwgYmFsYW5jZSBmb3IgYGVzY3Jvdy50b2tlbmAuAAAAAA1zZXR0bGVfZXNjcm93AAAAAAAABAAAAAAAAAAFcGF5ZWUAAAAAAAATAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAGAAAAAAAAAA5uZXdfY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAABXByb29mAAAAAAAH0AAAAAVQcm9vZgAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAFdPbmUtdGltZS1wZXIta2V5IHNldHVwIGZvciB0aGUgY29uZmlkZW50aWFsIGludm9pY2UtZXNjcm93IHZlcmlmaWNhdGlvbgprZXlzIChQaGFzZSA0KS4AAAAADnNldF9lc2Nyb3dfdmtzAAAAAAAEAAAAAAAAAA52a19lc2Nyb3dfbG9jawAAAAAH0AAAAA9WZXJpZmljYXRpb25LZXkAAAAAAAAAABB2a19lc2Nyb3dfc2V0dGxlAAAH0AAAAA9WZXJpZmljYXRpb25LZXkAAAAAAAAAABR2a19lc2Nyb3dfc2V0dGxlX25ldwAAB9AAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAAAAAAQdmtfZXNjcm93X2NhbmNlbAAAB9AAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAABQAAAAAAAAAAAAAAFkNvbmZpZGVudGlhbFdpdGhkcmF3YWwAAAAAAAIAAAAMY29uZmlkZW50aWFsAAAACndpdGhkcmF3YWwAAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAAAAAAAAAAAAAPZXhlY3V0ZV91cGdyYWRlAAAAAAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAPZ2V0X25vdGVfY2lwaGVyAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAAA4AAAAD",
        "AAAAAAAAAAAAAAAPZ2V0X3ZpZXdpbmdfa2V5AAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAPpAAAD7gAAACAAAAAD",
        "AAAAAAAAAAAAAAAPcHJvcG9zZV91cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAIBTZXR0bGUgZm9yIGEgcGF5ZWUgd2l0aCBubyBwcmlvciBjb25maWRlbnRpYWwgYmFsYW5jZSBmb3IgYGVzY3Jvdy50b2tlbmAKKG1pcnJvcnMgZGVwb3NpdF9uZXcg4oCUIHNlZSBlc2Nyb3dfc2V0dGxlX25ldy5jaXJjb20pLgAAABFzZXR0bGVfZXNjcm93X25ldwAAAAAAAAQAAAAAAAAABXBheWVlAAAAAAAAEwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAQcGF5ZWVfY29tbWl0bWVudAAAA+4AAAAgAAAAAAAAAAVwcm9vZgAAAAAAB9AAAAAFUHJvb2YAAAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAASaXNfdG9rZW5fc3VwcG9ydGVkAAAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAQ==",
        "AAAAAAAAAAAAAAAUZ2V0X2VtcGxveWVyX2hpc3RvcnkAAAABAAAAAAAAAAhlbXBsb3llcgAAABMAAAABAAAD6gAAAAY=",
        "AAAAAAAAAAAAAAAUcmVnaXN0ZXJfdmlld2luZ19rZXkAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAADnZpZXdpbmdfcHVia2V5AAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAMtPbmUtdGltZS1wZXIta2V5IHNldHVwIGZvciB0aGUgY29uZmlkZW50aWFsLWxlZGdlciB2ZXJpZmljYXRpb24ga2V5cwooUGhhc2UgNCkuIFNlcGFyYXRlIGZyb20gYGluaXRpYWxpemVgIHNvIGl0IGNhbiBiZSBhZGRlZCB0byBhbgphbHJlYWR5LWluaXRpYWxpemVkIGNvbnRyYWN0IHdpdGhvdXQgY2hhbmdpbmcgYGluaXRpYWxpemVgJ3Mgc2lnbmF0dXJlLgAAAAAUc2V0X2NvbmZpZGVudGlhbF92a3MAAAADAAAAAAAAAA52a19kZXBvc2l0X25ldwAAAAAH0AAAAA9WZXJpZmljYXRpb25LZXkAAAAAAAAAABB2a19kZXBvc2l0X3RvcHVwAAAH0AAAAA9WZXJpZmljYXRpb25LZXkAAAAAAAAAAAt2a193aXRoZHJhdwAAAAfQAAAAD1ZlcmlmaWNhdGlvbktleQAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAEpPbmUtdGltZSBzZXR1cCBmb3IgdGhlIGNvbmZpZGVudGlhbCBwYXlyb2xsIChub3RlLW1vZGVsKSB2ZXJpZmljYXRpb24ga2V5LgAAAAAAFHNldF9wYXlyb2xsX25vdGVzX3ZrAAAAAQAAAAAAAAAQdmtfcGF5cm9sbF9ub3RlcwAAB9AAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAVZGlzYnVyc2VfY29uZmlkZW50aWFsAAAAAAAACgAAAAAAAAAIZW1wbG95ZXIAAAATAAAAAAAAAAVwcm9vZgAAAAAAB9AAAAAFUHJvb2YAAAAAAAAAAAAADHRvdGFsX2J1ZGdldAAAAAsAAAAAAAAACm1heF9zYWxhcnkAAAAAAAsAAAAAAAAADGFjdGl2ZV9jb3VudAAAAAQAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAACnJlY2lwaWVudHMAAAAAA+oAAAATAAAAAAAAABBub3RlX2NvbW1pdG1lbnRzAAAD6gAAA+4AAAAgAAAAAAAAAAxub3RlX2NpcGhlcnMAAAPqAAAADgAAAAEAAAPpAAAABgAAAAM=",
        "AAAAAAAAAEZFc2Nyb3cgaWRzIChwYXlyb2xsIG5vdGVzICsgaW52b2ljZXMpIHdoZXJlIHRoaXMgYWRkcmVzcyBpcyB0aGUgcGF5ZWUuAAAAAAAVZ2V0X3JlY2lwaWVudF9lc2Nyb3dzAAAAAAAAAQAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAEAAAPqAAAABg==",
        "AAAAAAAAAAAAAAAXZ2V0X2VtcGxveWVyX2N1bXVsYXRpdmUAAAAAAQAAAAAAAAAIZW1wbG95ZXIAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAYZ2V0X2NvbmZpZGVudGlhbF9iYWxhbmNlAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAA+4AAAAgAAAAAw==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAFgAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAITm90QWRtaW4AAAADAAAAAAAAABBVbnN1cHBvcnRlZFRva2VuAAAABAAAAAAAAAAVQ29tbWl0bWVudEFscmVhZHlVc2VkAAAAAAAABQAAAAAAAAAOTGVuZ3RoTWlzbWF0Y2gAAAAAAAYAAAAAAAAAEEludmFsaWRIZWFkY291bnQAAAAHAAAAAAAAAAtTdW1NaXNtYXRjaAAAAAAIAAAAAAAAAAxJbnZhbGlkUHJvb2YAAAAJAAAAAAAAABVNYWxmb3JtZWRWZXJpZnlpbmdLZXkAAAAAAAAKAAAAAAAAAA1CYXRjaE5vdEZvdW5kAAAAAAAACwAAAAAAAAAORXNjcm93Tm90Rm91bmQAAAAAAAwAAAAAAAAAFEVzY3Jvd0FscmVhZHlTZXR0bGVkAAAADQAAACppbnZvaWNlX21heCA8IGludm9pY2VfbWluLCBvciBhbW91bnQgPD0gMC4AAAAAAAxJbnZhbGlkUmFuZ2UAAAAOAAAALENhbGxlciBpcyBub3QgYXV0aG9yaXplZCBmb3IgdGhpcyBvcGVyYXRpb24uAAAADFVuYXV0aG9yaXplZAAAAA8AAAArQXJpdGhtZXRpYyBvdmVyZmxvdyBpbiBhbW91bnQgYWNjdW11bGF0aW9uLgAAAAAIT3ZlcmZsb3cAAAAQAAAAI0VzY3JvdyB0aW1lb3V0IGhhcyBub3QgeWV0IGVsYXBzZWQuAAAAABBFc2Nyb3dOb3RFeHBpcmVkAAAAEQAAADRObyBwZW5kaW5nIHVwZ3JhZGUgb3IgdXBncmFkZSBkZWxheSBub3QgeWV0IGVsYXBzZWQuAAAAD1VwZ3JhZGVOb3RSZWFkeQAAAAASAAAAH1Blci1wYXltZW50IGFtb3VudCBpcyBuZWdhdGl2ZS4AAAAADUludmFsaWRBbW91bnQAAAAAAAATAAAAQk5vIGNvbmZpZGVudGlhbCBiYWxhbmNlIGV4aXN0cyB5ZXQgZm9yIHRoaXMgKGFjY291bnQsIHRva2VuKSBwYWlyLgAAAAAAD0FjY291bnROb3RGb3VuZAAAAAAUAAAAW0EgY29uZmlkZW50aWFsIGJhbGFuY2UgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgKGFjY291bnQsIHRva2VuKSBwYWlyIOKAlCB1c2UgZGVwb3NpdF90b3B1cC4AAAAAFEFjY291bnRBbHJlYWR5RXhpc3RzAAAAFQAAAEhObyB2aWV3aW5nIGtleSByZWdpc3RlcmVkLCBvciBubyBlbmNyeXB0ZWQgbm90ZSBhdHRhY2hlZCB0byB0aGlzIGVzY3Jvdy4AAAAITm90Rm91bmQAAAAW",
        "AAAAAQAAADVHcm90aDE2IHByb29mIChCTFMxMi0zODEpOiBBIGluIEcxLCBCIGluIEcyLCBDIGluIEcxLgAAAAAAAAAAAAAFUHJvb2YAAAAAAAADAAAAAAAAAAFhAAAAAAAD7gAAAGAAAAAAAAAAAWIAAAAAAAPuAAAAwAAAAAAAAAABYwAAAAAAA+4AAABg",
        "AAAAAQAAAJlHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXkgKEJMUzEyLTM4MSkuIE1hcnNoYWxlZCB0by9mcm9tIEpTT04gb2ZmLWNoYWluIGJ5CmBzY3JpcHRzL3NuYXJranNfdG9fc29yb2Jhbi50c2AuIGBpYy5sZW4oKWAgbXVzdCBlcXVhbCBgbnVtX3B1YmxpY19pbnB1dHMgKyAxYC4AAAAAAAAAAAAAD1ZlcmlmaWNhdGlvbktleQAAAAAFAAAAAAAAAAVhbHBoYQAAAAAAA+4AAABgAAAAAAAAAARiZXRhAAAD7gAAAMAAAAAAAAAABWRlbHRhAAAAAAAD7gAAAMAAAAAAAAAABWdhbW1hAAAAAAAD7gAAAMAAAAAAAAAAAmljAAAAAAPqAAAD7gAAAGA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    disburse: this.txFromJSON<Result<u64>>,
        withdraw: this.txFromJSON<Result<void>>,
        add_token: this.txFromJSON<Result<void>>,
        get_batch: this.txFromJSON<Result<PayrollBatch>>,
        set_admin: this.txFromJSON<Result<void>>,
        get_escrow: this.txFromJSON<Result<InvoiceEscrow>>,
        initialize: this.txFromJSON<Result<void>>,
        deposit_new: this.txFromJSON<Result<void>>,
        remove_token: this.txFromJSON<Result<void>>,
        cancel_escrow: this.txFromJSON<Result<void>>,
        create_escrow: this.txFromJSON<Result<u64>>,
        deposit_topup: this.txFromJSON<Result<void>>,
        settle_escrow: this.txFromJSON<Result<void>>,
        set_escrow_vks: this.txFromJSON<Result<void>>,
        execute_upgrade: this.txFromJSON<Result<void>>,
        get_note_cipher: this.txFromJSON<Result<Buffer>>,
        get_viewing_key: this.txFromJSON<Result<Buffer>>,
        propose_upgrade: this.txFromJSON<Result<void>>,
        settle_escrow_new: this.txFromJSON<Result<void>>,
        is_token_supported: this.txFromJSON<boolean>,
        get_employer_history: this.txFromJSON<Array<u64>>,
        register_viewing_key: this.txFromJSON<Result<void>>,
        set_confidential_vks: this.txFromJSON<Result<void>>,
        set_payroll_notes_vk: this.txFromJSON<Result<void>>,
        disburse_confidential: this.txFromJSON<Result<u64>>,
        get_recipient_escrows: this.txFromJSON<Array<u64>>,
        get_employer_cumulative: this.txFromJSON<i128>,
        get_confidential_balance: this.txFromJSON<Result<Buffer>>
  }
}