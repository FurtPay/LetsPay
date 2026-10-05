/**
 * Generates Payfurt confidential-ledger deposit Groth16 proofs (Phase 4).
 *
 * Two variants, matching the two on-chain entrypoints:
 *   - deposit_new:    first-ever deposit for an (account, token) pair
 *   - deposit_topup:  subsequent deposits into an existing confidential balance
 *
 * publicSignals order (output-first circom convention):
 *   deposit_new.circom    → [commitment, amount]
 *   deposit_topup.circom  → [new_commitment, old_commitment, amount]
 */
import { groth16 } from "snarkjs";
import { encodeProof, frToBytesBE, type ProofBytes } from "./groth16Codec";

export interface DepositNewProofResult {
  proof: ProofBytes;
  commitment: Uint8Array;       // 32-byte BE — stored on-chain as the initial balance commitment
  commitmentDecimal: string;
  balance: bigint;              // == amount, the new confidential balance
  blinding: bigint;
}

export async function generateDepositNewProof(params: {
  amount: bigint;
  blinding?: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<DepositNewProofResult> {
  const { amount } = params;
  if (amount <= 0n) throw new Error("amount must be > 0");

  const blinding = params.blinding ?? randomFieldElement();
  const wasmUrl = params.wasmUrl ?? "/circuits/deposit_new.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/deposit_new.zkey";

  const input = {
    balance: amount.toString(),
    blinding: blinding.toString(),
    amount: amount.toString(),
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);

  // publicSignals[0] = commitment
  const commitmentDecimal = publicSignals[0] as string;

  return {
    proof: encodeProof(proof),
    commitment: frToBytesBE(BigInt(commitmentDecimal)),
    commitmentDecimal,
    balance: amount,
    blinding,
  };
}

export interface DepositTopupProofResult {
  proof: ProofBytes;
  newCommitment: Uint8Array;    // 32-byte BE — replaces the stored commitment
  newCommitmentDecimal: string;
  newBalance: bigint;
  newBlinding: bigint;
}

export async function generateDepositTopupProof(params: {
  oldBalance: bigint;
  oldBlinding: bigint;
  oldCommitmentDecimal: string;  // the commitment currently stored on-chain — from the wallet's last known state, never recomputed independently
  amount: bigint;
  newBlinding?: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<DepositTopupProofResult> {
  const { oldBalance, oldBlinding, oldCommitmentDecimal, amount } = params;
  if (amount <= 0n) throw new Error("amount must be > 0");

  const newBlinding = params.newBlinding ?? randomFieldElement();
  const wasmUrl = params.wasmUrl ?? "/circuits/deposit_topup.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/deposit_topup.zkey";

  const input = {
    old_balance: oldBalance.toString(),
    old_blinding: oldBlinding.toString(),
    new_blinding: newBlinding.toString(),
    old_commitment: oldCommitmentDecimal,
    amount: amount.toString(),
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);

  // publicSignals[0] = new_commitment
  const newCommitmentDecimal = publicSignals[0] as string;

  return {
    proof: encodeProof(proof),
    newCommitment: frToBytesBE(BigInt(newCommitmentDecimal)),
    newCommitmentDecimal,
    newBalance: oldBalance + amount,
    newBlinding,
  };
}

/** Random scalar below the BLS12-381 scalar field modulus (31 bytes is safely under). */
function randomFieldElement(): bigint {
  const b = new Uint8Array(31);
  globalThis.crypto.getRandomValues(b);
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}
