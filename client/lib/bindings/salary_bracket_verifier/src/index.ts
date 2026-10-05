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
    contractId: "CCIWKQCR3PHRBE5M6JJAUFTQOYKFQE5JNTGMX5NBERIDYNQOQRRKFEQR",
  }
} as const

export type DataKey = {tag: "Admin", values: void} | {tag: "VkBracket", values: void} | {tag: "PayrollVerifier", values: void} | {tag: "VkMinWage", values: void} | {tag: "VkPayEquity", values: void} | {tag: "VkIncome", values: void};




export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"InvalidProof"},
  4: {message:"MalformedVerifyingKey"},
  /**
   * `escrow_id` does not exist in `payroll_verifier`.
   */
  5: {message:"EscrowNotFound"},
  /**
   * Caller is not the payee of the escrow / note.
   */
  6: {message:"Unauthorized"},
  /**
   * `batch_id` does not exist in `payroll_verifier`.
   */
  7: {message:"BatchNotFound"},
  /**
   * Invalid input (e.g. empty or oversized escrow_ids list).
   */
  8: {message:"InvalidInput"}
}



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
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time setup: stores the admin, the `salary_bracket.circom` VK, and
   * the address of the `payroll_verifier` contract to cross-call.
   */
  initialize: ({admin, vk_bracket, payroll_verifier}: {admin: string, vk_bracket: VerificationKey, payroll_verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a prove_income transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Employee proves their cumulative income across the given payroll notes is
   * ≥ `threshold`. Each `escrow_id` must name an escrow they are the payee of;
   * the proof binds to those notes' commitments. Reveals no individual amount.
   */
  prove_income: ({employee, escrow_ids, threshold, proof}: {employee: string, escrow_ids: Array<u64>, threshold: i128, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a prove_bracket transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Employee proves their salary satisfies [bracket_low, bracket_high] by
   * providing a Groth16 proof against the note commitment of escrow
   * `escrow_id` in `payroll_verifier` — the note they were paid in.
   * 
   * The caller must be the escrow's payee. Does NOT transfer any funds —
   * purely a verification result.
   */
  prove_bracket: ({employee, escrow_id, bracket_low, bracket_high, proof}: {employee: string, escrow_id: u64, bracket_low: i128, bracket_high: i128, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a prove_min_wage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Employer proves every active salary in batch `batch_id` is ≥ `min_wage`,
   * anchored to the batch's payroll commitment. Reveals no salary. Emits a
   * public `MinWageAttested` event signed by `attester`.
   */
  prove_min_wage: ({attester, batch_id, min_wage, proof}: {attester: string, batch_id: u64, min_wage: i128, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a prove_pay_equity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Employer proves the average salary of two cohorts differ by ≤ `epsilon`,
   * anchored to the batch's payroll commitment. Reveals no salary, average, or
   * cohort size. Emits a public `PayEquityAttested` event.
   */
  prove_pay_equity: ({attester, batch_id, epsilon, proof}: {attester: string, batch_id: u64, epsilon: i128, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_attestation_vks transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time setup for the attestation verification keys.
   */
  set_attestation_vks: ({vk_min_wage, vk_pay_equity, vk_income}: {vk_min_wage: VerificationKey, vk_pay_equity: VerificationKey, vk_income: VerificationKey}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABgAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAJVmtCcmFja2V0AAAAAAAAAAAAAAAAAAAPUGF5cm9sbFZlcmlmaWVyAAAAAAAAAAAAAAAACVZrTWluV2FnZQAAAAAAAAAAAAAAAAAAC1ZrUGF5RXF1aXR5AAAAAAAAAAAAAAAACFZrSW5jb21l",
        "AAAABQAAAAAAAAAAAAAADkluY29tZUF0dGVzdGVkAAAAAAACAAAAC2F0dGVzdGF0aW9uAAAAAAZpbmNvbWUAAAAAAAIAAAAAAAAACGVtcGxveWVlAAAAEwAAAAEAAAAAAAAACXRocmVzaG9sZAAAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD01pbldhZ2VBdHRlc3RlZAAAAAACAAAAC2F0dGVzdGF0aW9uAAAAAAhtaW5fd2FnZQAAAAMAAAAAAAAACGF0dGVzdGVyAAAAEwAAAAEAAAAAAAAACGJhdGNoX2lkAAAABgAAAAAAAAAAAAAACG1pbl93YWdlAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEVBheUVxdWl0eUF0dGVzdGVkAAAAAAAAAgAAAAthdHRlc3RhdGlvbgAAAAAKcGF5X2VxdWl0eQAAAAAAAwAAAAAAAAAIYXR0ZXN0ZXIAAAATAAAAAQAAAAAAAAAIYmF0Y2hfaWQAAAAGAAAAAAAAAAAAAAAHZXBzaWxvbgAAAAALAAAAAAAAAAI=",
        "AAAAAAAAAINPbmUtdGltZSBzZXR1cDogc3RvcmVzIHRoZSBhZG1pbiwgdGhlIGBzYWxhcnlfYnJhY2tldC5jaXJjb21gIFZLLCBhbmQKdGhlIGFkZHJlc3Mgb2YgdGhlIGBwYXlyb2xsX3ZlcmlmaWVyYCBjb250cmFjdCB0byBjcm9zcy1jYWxsLgAAAAAKaW5pdGlhbGl6ZQAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAp2a19icmFja2V0AAAAAAfQAAAAD1ZlcmlmaWNhdGlvbktleQAAAAAAAAAAEHBheXJvbGxfdmVyaWZpZXIAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAOFFbXBsb3llZSBwcm92ZXMgdGhlaXIgY3VtdWxhdGl2ZSBpbmNvbWUgYWNyb3NzIHRoZSBnaXZlbiBwYXlyb2xsIG5vdGVzIGlzCuKJpSBgdGhyZXNob2xkYC4gRWFjaCBgZXNjcm93X2lkYCBtdXN0IG5hbWUgYW4gZXNjcm93IHRoZXkgYXJlIHRoZSBwYXllZSBvZjsKdGhlIHByb29mIGJpbmRzIHRvIHRob3NlIG5vdGVzJyBjb21taXRtZW50cy4gUmV2ZWFscyBubyBpbmRpdmlkdWFsIGFtb3VudC4AAAAAAAAMcHJvdmVfaW5jb21lAAAABAAAAAAAAAAIZW1wbG95ZWUAAAATAAAAAAAAAAplc2Nyb3dfaWRzAAAAAAPqAAAABgAAAAAAAAAJdGhyZXNob2xkAAAAAAAACwAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAS1FbXBsb3llZSBwcm92ZXMgdGhlaXIgc2FsYXJ5IHNhdGlzZmllcyBbYnJhY2tldF9sb3csIGJyYWNrZXRfaGlnaF0gYnkKcHJvdmlkaW5nIGEgR3JvdGgxNiBwcm9vZiBhZ2FpbnN0IHRoZSBub3RlIGNvbW1pdG1lbnQgb2YgZXNjcm93CmBlc2Nyb3dfaWRgIGluIGBwYXlyb2xsX3ZlcmlmaWVyYCDigJQgdGhlIG5vdGUgdGhleSB3ZXJlIHBhaWQgaW4uCgpUaGUgY2FsbGVyIG11c3QgYmUgdGhlIGVzY3JvdydzIHBheWVlLiBEb2VzIE5PVCB0cmFuc2ZlciBhbnkgZnVuZHMg4oCUCnB1cmVseSBhIHZlcmlmaWNhdGlvbiByZXN1bHQuAAAAAAAADXByb3ZlX2JyYWNrZXQAAAAAAAAFAAAAAAAAAAhlbXBsb3llZQAAABMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAAC2JyYWNrZXRfbG93AAAAAAsAAAAAAAAADGJyYWNrZXRfaGlnaAAAAAsAAAAAAAAABXByb29mAAAAAAAH0AAAAAVQcm9vZgAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAMZFbXBsb3llciBwcm92ZXMgZXZlcnkgYWN0aXZlIHNhbGFyeSBpbiBiYXRjaCBgYmF0Y2hfaWRgIGlzIOKJpSBgbWluX3dhZ2VgLAphbmNob3JlZCB0byB0aGUgYmF0Y2gncyBwYXlyb2xsIGNvbW1pdG1lbnQuIFJldmVhbHMgbm8gc2FsYXJ5LiBFbWl0cyBhCnB1YmxpYyBgTWluV2FnZUF0dGVzdGVkYCBldmVudCBzaWduZWQgYnkgYGF0dGVzdGVyYC4AAAAAAA5wcm92ZV9taW5fd2FnZQAAAAAABAAAAAAAAAAIYXR0ZXN0ZXIAAAATAAAAAAAAAAhiYXRjaF9pZAAAAAYAAAAAAAAACG1pbl93YWdlAAAACwAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAMxFbXBsb3llciBwcm92ZXMgdGhlIGF2ZXJhZ2Ugc2FsYXJ5IG9mIHR3byBjb2hvcnRzIGRpZmZlciBieSDiiaQgYGVwc2lsb25gLAphbmNob3JlZCB0byB0aGUgYmF0Y2gncyBwYXlyb2xsIGNvbW1pdG1lbnQuIFJldmVhbHMgbm8gc2FsYXJ5LCBhdmVyYWdlLCBvcgpjb2hvcnQgc2l6ZS4gRW1pdHMgYSBwdWJsaWMgYFBheUVxdWl0eUF0dGVzdGVkYCBldmVudC4AAAAQcHJvdmVfcGF5X2VxdWl0eQAAAAQAAAAAAAAACGF0dGVzdGVyAAAAEwAAAAAAAAAIYmF0Y2hfaWQAAAAGAAAAAAAAAAdlcHNpbG9uAAAAAAsAAAAAAAAABXByb29mAAAAAAAH0AAAAAVQcm9vZgAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADVPbmUtdGltZSBzZXR1cCBmb3IgdGhlIGF0dGVzdGF0aW9uIHZlcmlmaWNhdGlvbiBrZXlzLgAAAAAAABNzZXRfYXR0ZXN0YXRpb25fdmtzAAAAAAMAAAAAAAAAC3ZrX21pbl93YWdlAAAAB9AAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAAAAAANdmtfcGF5X2VxdWl0eQAAAAAAB9AAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAAAAAAJdmtfaW5jb21lAAAAAAAH0AAAAA9WZXJpZmljYXRpb25LZXkAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMSW52YWxpZFByb29mAAAAAwAAAAAAAAAVTWFsZm9ybWVkVmVyaWZ5aW5nS2V5AAAAAAAABAAAADFgZXNjcm93X2lkYCBkb2VzIG5vdCBleGlzdCBpbiBgcGF5cm9sbF92ZXJpZmllcmAuAAAAAAAADkVzY3Jvd05vdEZvdW5kAAAAAAAFAAAALUNhbGxlciBpcyBub3QgdGhlIHBheWVlIG9mIHRoZSBlc2Nyb3cgLyBub3RlLgAAAAAAAAxVbmF1dGhvcml6ZWQAAAAGAAAAMGBiYXRjaF9pZGAgZG9lcyBub3QgZXhpc3QgaW4gYHBheXJvbGxfdmVyaWZpZXJgLgAAAA1CYXRjaE5vdEZvdW5kAAAAAAAABwAAADhJbnZhbGlkIGlucHV0IChlLmcuIGVtcHR5IG9yIG92ZXJzaXplZCBlc2Nyb3dfaWRzIGxpc3QpLgAAAAxJbnZhbGlkSW5wdXQAAAAI",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAGAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAJVmtQYXlyb2xsAAAAAAAAAAAAAAAAAAAJVmtJbnZvaWNlAAAAAAAAAAAAAAAAAAAMQmF0Y2hDb3VudGVyAAAAAAAAAAAAAAANRXNjcm93Q291bnRlcgAAAAAAAAEAAAAAAAAADlN1cHBvcnRlZFRva2VuAAAAAAABAAAAEwAAAAEAAAA0U2NvcGVkIHRvIGVtcGxveWVyIHRvIHByZXZlbnQgY3Jvc3MtZW1wbG95ZXIgcmVwbGF5LgAAAA5Vc2VkQ29tbWl0bWVudAAAAAAAAgAAABMAAAPuAAAAIAAAAAEAAAAAAAAABUJhdGNoAAAAAAAAAQAAAAYAAAABAAAAAAAAAAZFc2Nyb3cAAAAAAAEAAAAGAAAAAQAAAAAAAAAPRW1wbG95ZXJCYXRjaGVzAAAAAAEAAAATAAAAAQAAAAAAAAASRW1wbG95ZXJDdW11bGF0aXZlAAAAAAABAAAAEwAAAAAAAAAAAAAADlVwZ3JhZGVQZW5kaW5nAAAAAAABAAAAUVBoYXNlIDQ6IGNvbmZpZGVudGlhbCBsZWRnZXIg4oCUIChhY2NvdW50LCB0b2tlbikgLT4gUG9zZWlkb24oYmFsYW5jZSwgYmxpbmRpbmcpLgAAAAAAABNDb25maWRlbnRpYWxCYWxhbmNlAAAAAAIAAAATAAAAEwAAAAAAAAAAAAAADFZrRGVwb3NpdE5ldwAAAAAAAAAAAAAADlZrRGVwb3NpdFRvcHVwAAAAAAAAAAAAAAAAAApWa1dpdGhkcmF3AAAAAAAAAAAAAAAAAAxWa0VzY3Jvd0xvY2sAAAAAAAAAAAAAAA5Wa0VzY3Jvd1NldHRsZQAAAAAAAAAAAAAAAAARVmtFc2Nyb3dTZXR0bGVOZXcAAAAAAAAAAAAAAAAAAA5Wa0VzY3Jvd0NhbmNlbAAAAAAAAAAAAAAAAAAOVmtQYXlyb2xsTm90ZXMAAAAAAAEAAABDSW5kZXggb2YgZXNjcm93IGlkcyBhIHJlY2lwaWVudC9wYXllZSBjYW4gY2xhaW0gKG5vdGVzICsgaW52b2ljZXMpLgAAAAAQUmVjaXBpZW50RXNjcm93cwAAAAEAAAATAAAAAQAAAFBBdXRvLXJlY2VpdmU6IGFuIGFjY291bnQncyB4MjU1MTkgdmlld2luZyBwdWJsaWMga2V5IChmb3IgRUNESCBub3RlIGVuY3J5cHRpb24pLgAAAApWaWV3aW5nS2V5AAAAAAABAAAAEwAAAAEAAABWQXV0by1yZWNlaXZlOiBFQ0RILWVuY3J5cHRlZCAoYW1vdW50LCBub3RlX2JsaW5kaW5nKSBmb3IgYSBwYXlyb2xsIG5vdGUsIGJ5IGVzY3JvdyBpZC4AAAAAAApOb3RlQ2lwaGVyAAAAAAABAAAABg==",
        "AAAAAQAAAAAAAAAAAAAADFBheXJvbGxCYXRjaAAAAAcAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAAAAAAhlbXBsb3llcgAAABMAAAAAAAAAC2V4ZWN1dGVkX2F0AAAAAAYAAAAAAAAACWhlYWRjb3VudAAAAAAAAAQAAABEUGVyLXNsb3QgUG9zZWlkb24gbGVhZiBoYXNoZXMgZm9yIEZlYXR1cmUgNSAoc2FsYXJ5IGJyYWNrZXQgcHJvb2ZzKS4AAAALbGVhZl9oYXNoZXMAAAAD6gAAA+4AAAAgAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAADHRvdGFsX2J1ZGdldAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAADUludm9pY2VFc2Nyb3cAAAAAAAAIAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAclBoYXNlIDQ6IG9wYXF1ZSBQb3NlaWRvbihhbW91bnQsIGVzY3Jvd19ibGluZGluZykg4oCUIHRoZSBhbW91bnQgbmV2ZXIKYXBwZWFycyBhcyBhIHBsYWluIGZpZWxkIGFueXdoZXJlIG9uLWNoYWluLgAAAAAAEWVzY3Jvd19jb21taXRtZW50AAAAAAAD7gAAACAAAAAAAAAAC2ludm9pY2VfbWF4AAAAAAsAAAAAAAAAC2ludm9pY2VfbWluAAAAAAsAAAAAAAAABXBheWVlAAAAAAAAEwAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAdzZXR0bGVkAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAQAAAAAAAAAAAAAAD1VwZ3JhZGVQcm9wb3NhbAAAAAACAAAAAAAAAAtwcm9wb3NlZF9hdAAAAAAGAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIA==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAFgAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAITm90QWRtaW4AAAADAAAAAAAAABBVbnN1cHBvcnRlZFRva2VuAAAABAAAAAAAAAAVQ29tbWl0bWVudEFscmVhZHlVc2VkAAAAAAAABQAAAAAAAAAOTGVuZ3RoTWlzbWF0Y2gAAAAAAAYAAAAAAAAAEEludmFsaWRIZWFkY291bnQAAAAHAAAAAAAAAAtTdW1NaXNtYXRjaAAAAAAIAAAAAAAAAAxJbnZhbGlkUHJvb2YAAAAJAAAAAAAAABVNYWxmb3JtZWRWZXJpZnlpbmdLZXkAAAAAAAAKAAAAAAAAAA1CYXRjaE5vdEZvdW5kAAAAAAAACwAAAAAAAAAORXNjcm93Tm90Rm91bmQAAAAAAAwAAAAAAAAAFEVzY3Jvd0FscmVhZHlTZXR0bGVkAAAADQAAACppbnZvaWNlX21heCA8IGludm9pY2VfbWluLCBvciBhbW91bnQgPD0gMC4AAAAAAAxJbnZhbGlkUmFuZ2UAAAAOAAAALENhbGxlciBpcyBub3QgYXV0aG9yaXplZCBmb3IgdGhpcyBvcGVyYXRpb24uAAAADFVuYXV0aG9yaXplZAAAAA8AAAArQXJpdGhtZXRpYyBvdmVyZmxvdyBpbiBhbW91bnQgYWNjdW11bGF0aW9uLgAAAAAIT3ZlcmZsb3cAAAAQAAAAI0VzY3JvdyB0aW1lb3V0IGhhcyBub3QgeWV0IGVsYXBzZWQuAAAAABBFc2Nyb3dOb3RFeHBpcmVkAAAAEQAAADRObyBwZW5kaW5nIHVwZ3JhZGUgb3IgdXBncmFkZSBkZWxheSBub3QgeWV0IGVsYXBzZWQuAAAAD1VwZ3JhZGVOb3RSZWFkeQAAAAASAAAAH1Blci1wYXltZW50IGFtb3VudCBpcyBuZWdhdGl2ZS4AAAAADUludmFsaWRBbW91bnQAAAAAAAATAAAAQk5vIGNvbmZpZGVudGlhbCBiYWxhbmNlIGV4aXN0cyB5ZXQgZm9yIHRoaXMgKGFjY291bnQsIHRva2VuKSBwYWlyLgAAAAAAD0FjY291bnROb3RGb3VuZAAAAAAUAAAAW0EgY29uZmlkZW50aWFsIGJhbGFuY2UgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgKGFjY291bnQsIHRva2VuKSBwYWlyIOKAlCB1c2UgZGVwb3NpdF90b3B1cC4AAAAAFEFjY291bnRBbHJlYWR5RXhpc3RzAAAAFQAAAEhObyB2aWV3aW5nIGtleSByZWdpc3RlcmVkLCBvciBubyBlbmNyeXB0ZWQgbm90ZSBhdHRhY2hlZCB0byB0aGlzIGVzY3Jvdy4AAAAITm90Rm91bmQAAAAW",
        "AAAAAQAAADVHcm90aDE2IHByb29mIChCTFMxMi0zODEpOiBBIGluIEcxLCBCIGluIEcyLCBDIGluIEcxLgAAAAAAAAAAAAAFUHJvb2YAAAAAAAADAAAAAAAAAAFhAAAAAAAD7gAAAGAAAAAAAAAAAWIAAAAAAAPuAAAAwAAAAAAAAAABYwAAAAAAA+4AAABg",
        "AAAAAQAAAJlHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXkgKEJMUzEyLTM4MSkuIE1hcnNoYWxlZCB0by9mcm9tIEpTT04gb2ZmLWNoYWluIGJ5CmBzY3JpcHRzL3NuYXJranNfdG9fc29yb2Jhbi50c2AuIGBpYy5sZW4oKWAgbXVzdCBlcXVhbCBgbnVtX3B1YmxpY19pbnB1dHMgKyAxYC4AAAAAAAAAAAAAD1ZlcmlmaWNhdGlvbktleQAAAAAFAAAAAAAAAAVhbHBoYQAAAAAAA+4AAABgAAAAAAAAAARiZXRhAAAD7gAAAMAAAAAAAAAABWRlbHRhAAAAAAAD7gAAAMAAAAAAAAAABWdhbW1hAAAAAAAD7gAAAMAAAAAAAAAAAmljAAAAAAPqAAAD7gAAAGA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<Result<void>>,
        prove_income: this.txFromJSON<Result<void>>,
        prove_bracket: this.txFromJSON<Result<void>>,
        prove_min_wage: this.txFromJSON<Result<void>>,
        prove_pay_equity: this.txFromJSON<Result<void>>,
        set_attestation_vks: this.txFromJSON<Result<void>>
  }
}