/**
 * Generates a Payfurt confidential-payroll (note-model) Groth16 proof (Phase 4).
 *
 * Proves the aggregate (sum == total_budget, each active salary in
 * (0, max_salary], headcount) and emits one opaque note commitment per
 * recipient: note_commitment[i] = Poseidon(sal[i], note_blinding[i]).
 *
 * Each note is claimed by its recipient into their confidential balance via
 * the existing settle_escrow / settle_escrow_new path. The employer shares
 * (escrow_id, amount, note_blinding) with each recipient out-of-band.
 *
 * publicSignals order (payroll_notes.circom, output-first convention):
 *   [0]     = payroll_commitment
 *   [1..10] = note_commitment[0..9]
 *   [11]    = total_budget
 *   [12]    = max_salary
 *   [13]    = active_count
 */
import { groth16 } from "snarkjs";
import { encodeProof, frToBytesBE, type ProofBytes } from "./groth16Codec";

const N = 10;

export interface PayrollNotesProofResult {
  proof: ProofBytes;
  commitment: Uint8Array;          // 32-byte BE nullifier
  commitmentDecimal: string;
  noteCommitments: Uint8Array[];   // 10 × 32-byte BE (active slots first, padding after)
  noteCommitmentDecimals: string[];
  noteBlindings: bigint[];         // per-slot blinding — share with recipient out-of-band
  totalBudget: bigint;
  maxSalary: bigint;
  activeCount: number;
  salt: bigint;
}

export async function generatePayrollNotesProof(params: {
  salaries: bigint[]; // active salaries, length 1..10 (token base units)
  maxSalary: bigint;
  salt?: bigint;
  noteBlindings?: bigint[];
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<PayrollNotesProofResult> {
  const { salaries, maxSalary } = params;
  if (salaries.length === 0 || salaries.length > N) {
    throw new Error(`expected 1..${N} salaries, got ${salaries.length}`);
  }
  if (salaries.some((s) => s <= 0n || s > maxSalary)) {
    throw new Error("every salary must satisfy 0 < salary <= maxSalary");
  }

  const salt = params.salt ?? randomFieldElement();
  const wasmUrl = params.wasmUrl ?? "/circuits/payroll_notes.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/payroll_notes.zkey";

  const padded = [...salaries, ...Array(N - salaries.length).fill(0n)];
  const isActive = padded.map((_, i) => (i < salaries.length ? 1 : 0));
  const totalBudget = salaries.reduce((a, b) => a + b, 0n);
  const noteBlindings = params.noteBlindings ?? padded.map(() => randomFieldElement());

  const input = {
    sal: padded.map(String),
    salt: salt.toString(),
    is_active: isActive.map(String),
    note_blinding: noteBlindings.map(String),
    total_budget: totalBudget.toString(),
    max_salary: maxSalary.toString(),
    active_count: salaries.length.toString(),
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);

  const commitmentDecimal = publicSignals[0] as string;
  const noteCommitmentDecimals = publicSignals.slice(1, N + 1) as string[];
  const noteCommitments = noteCommitmentDecimals.map((d) => frToBytesBE(BigInt(d)));

  return {
    proof: encodeProof(proof),
    commitment: frToBytesBE(BigInt(commitmentDecimal)),
    commitmentDecimal,
    noteCommitments,
    noteCommitmentDecimals,
    noteBlindings,
    totalBudget,
    maxSalary,
    activeCount: salaries.length,
    salt,
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
