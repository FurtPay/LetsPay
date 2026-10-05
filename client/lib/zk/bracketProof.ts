/**
 * Generates a Payfurt salary bracket Groth16 proof (note-anchored, Phase 4).
 *
 * The employee proves their salary is within [bracket_low, bracket_high] and
 * that it opens the opaque note they were paid in:
 *   note_commitment == Poseidon(salary, note_blinding)
 *
 * publicSignals order (salary_bracket.circom, output-first convention):
 *   [0] = note_commitment   (output — must match on-chain InvoiceEscrow.escrow_commitment)
 *   [1] = bracket_low       (public input)
 *   [2] = bracket_high      (public input)
 *
 * The on-chain verifier (salary_bracket_verifier.prove_bracket) reads the note
 * commitment from the employee's escrow and checks the employee is its payee.
 */
import { groth16 } from "snarkjs";
import { encodeProof, frToBytesBE, type ProofBytes } from "./groth16Codec";

export interface BracketProofResult {
  proof: ProofBytes;
  noteCommitment: Uint8Array;      // 32-byte BE — must match on-chain escrow_commitment
  noteCommitmentDecimal: string;
}

export async function generateBracketProof(params: {
  salary: bigint;          // private — employee's salary in token base units
  noteBlinding: bigint;    // private — blinding of the note they were paid in
  bracketLow: bigint;      // public — declared lower bound
  bracketHigh: bigint;     // public — declared upper bound
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<BracketProofResult> {
  const { salary, noteBlinding, bracketLow, bracketHigh } = params;

  if (salary <= 0n) throw new Error("salary must be > 0");
  if (bracketLow > bracketHigh) throw new Error("bracket_low must be <= bracket_high");
  if (salary < bracketLow || salary > bracketHigh)
    throw new Error(`salary ${salary} outside bracket [${bracketLow}, ${bracketHigh}]`);

  const wasmUrl = params.wasmUrl ?? "/circuits/salary_bracket.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/salary_bracket.zkey";

  const input = {
    salary:        salary.toString(),
    note_blinding: noteBlinding.toString(),
    bracket_low:   bracketLow.toString(),
    bracket_high:  bracketHigh.toString(),
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);

  // publicSignals[0] = note_commitment
  const noteCommitmentDecimal = publicSignals[0] as string;

  return {
    proof: encodeProof(proof),
    noteCommitment: frToBytesBE(BigInt(noteCommitmentDecimal)),
    noteCommitmentDecimal,
  };
}
