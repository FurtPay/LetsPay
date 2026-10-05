/**
 * Generates a Payfurt confidential-ledger withdrawal Groth16 proof (Phase 4).
 *
 * Converts part (or all) of a confidential balance back into a real,
 * publicly-visible SAC transfer. The withdrawal amount is necessarily public
 * (the network must validate the real transfer) — this proof only attests
 * that the withdrawal is backed by a sufficient confidential balance.
 *
 * publicSignals order (withdraw.circom, output-first convention):
 *   [0] = new_commitment  (output)
 *   [1] = old_commitment  (public input)
 *   [2] = amount           (public input)
 */
import { groth16 } from "snarkjs";
import { encodeProof, frToBytesBE, type ProofBytes } from "./groth16Codec";

export interface WithdrawProofResult {
  proof: ProofBytes;
  newCommitment: Uint8Array;    // 32-byte BE — replaces the stored commitment
  newCommitmentDecimal: string;
  newBalance: bigint;
  newBlinding: bigint;
}

export async function generateWithdrawProof(params: {
  oldBalance: bigint;
  oldBlinding: bigint;
  oldCommitmentDecimal: string;  // the commitment currently stored on-chain — from the wallet's last known state
  amount: bigint;
  newBlinding?: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<WithdrawProofResult> {
  const { oldBalance, oldBlinding, oldCommitmentDecimal, amount } = params;
  if (amount <= 0n) throw new Error("amount must be > 0");
  if (amount > oldBalance) throw new Error("amount exceeds current confidential balance");

  const newBlinding = params.newBlinding ?? randomFieldElement();
  const wasmUrl = params.wasmUrl ?? "/circuits/withdraw.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/withdraw.zkey";

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
    newBalance: oldBalance - amount,
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
