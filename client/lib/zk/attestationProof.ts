/**
 * Payfurt payroll attestation proofs (Feature 7) — proofs ABOUT a hidden salary
 * set, anchored to the batch's on-chain payroll_commitment or to the employee's
 * note commitments. None reveal an individual salary.
 *
 *   minimum_wage.circom → [payroll_commitment, min_wage, active_count]   (ic 4)
 *   pay_equity.circom    → [payroll_commitment, epsilon, active_count]    (ic 4)
 *   income_proof.circom  → [note_commitment[0..7], threshold]             (ic 10)
 *
 * The employer supplies the same `(salaries, salt)` they used at disburse, so the
 * recomputed payroll_commitment matches the one stored in the batch.
 */
import { groth16 } from "snarkjs";
import { encodeProof, type ProofBytes } from "./groth16Codec";

const N = 10;
const INCOME_SLOTS = 8;

function pad(salaries: bigint[]): { padded: bigint[]; isActive: number[] } {
  const padded = [...salaries, ...Array(N - salaries.length).fill(0n)];
  const isActive = padded.map((_, i) => (i < salaries.length ? 1 : 0));
  return { padded, isActive };
}

/** Prove every active salary ≥ minWage, anchored to the batch commitment. */
export async function generateMinWageProof(params: {
  salaries: bigint[];
  salt: bigint;
  minWage: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<{ proof: ProofBytes; activeCount: number }> {
  const { salaries, salt, minWage } = params;
  if (salaries.some((s) => s < minWage)) throw new Error("a salary is below the declared minimum wage");
  const { padded, isActive } = pad(salaries);
  const input = {
    sal: padded.map(String),
    salt: salt.toString(),
    is_active: isActive.map(String),
    min_wage: minWage.toString(),
    active_count: salaries.length.toString(),
  };
  const { proof } = await groth16.fullProve(
    input,
    params.wasmUrl ?? "/circuits/minimum_wage.wasm",
    params.zkeyUrl ?? "/circuits/minimum_wage.zkey"
  );
  return { proof: encodeProof(proof), activeCount: salaries.length };
}

/** Prove |avg(group A) − avg(group B)| ≤ epsilon, anchored to the batch commitment. */
export async function generatePayEquityProof(params: {
  salaries: bigint[];
  groups: number[];     // 0 = A, 1 = B, aligned with salaries
  salt: bigint;
  epsilon: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<{ proof: ProofBytes; activeCount: number }> {
  const { salaries, groups, salt, epsilon } = params;
  if (groups.length !== salaries.length) throw new Error("groups must align with salaries");
  const a = salaries.filter((_, i) => groups[i] === 0);
  const b = salaries.filter((_, i) => groups[i] === 1);
  if (a.length === 0 || b.length === 0) throw new Error("both cohorts must be non-empty");
  const avgA = a.reduce((x, y) => x + y, 0n) / BigInt(a.length);
  const avgB = b.reduce((x, y) => x + y, 0n) / BigInt(b.length);
  const diff = avgA > avgB ? avgA - avgB : avgB - avgA;
  if (diff > epsilon) throw new Error(`pay gap ${diff} exceeds epsilon ${epsilon}`);

  const { padded, isActive } = pad(salaries);
  const paddedGroups = [...groups, ...Array(N - groups.length).fill(0)];
  const input = {
    sal: padded.map(String),
    salt: salt.toString(),
    is_active: isActive.map(String),
    group: paddedGroups.map(String),
    epsilon: epsilon.toString(),
    active_count: salaries.length.toString(),
  };
  const { proof } = await groth16.fullProve(
    input,
    params.wasmUrl ?? "/circuits/pay_equity.wasm",
    params.zkeyUrl ?? "/circuits/pay_equity.zkey"
  );
  return { proof: encodeProof(proof), activeCount: salaries.length };
}

/** Prove cumulative income across notes ≥ threshold, anchored to the note commitments. */
export async function generateIncomeProof(params: {
  amounts: bigint[];               // active note amounts (≤ 8)
  noteBlindings: bigint[];         // aligned blindings
  noteCommitmentDecimals: string[]; // aligned on-chain commitments (decimal)
  threshold: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<{ proof: ProofBytes }> {
  const { amounts, noteBlindings, noteCommitmentDecimals, threshold } = params;
  const k = amounts.length;
  if (k === 0 || k > INCOME_SLOTS) throw new Error(`expected 1..${INCOME_SLOTS} notes`);
  if (noteBlindings.length !== k || noteCommitmentDecimals.length !== k)
    throw new Error("amounts, blindings, commitments must align");
  const total = amounts.reduce((x, y) => x + y, 0n);
  if (total < threshold) throw new Error(`income ${total} below threshold ${threshold}`);

  const padAmount = [...amounts, ...Array(INCOME_SLOTS - k).fill(0n)];
  const padBlinding = [...noteBlindings, ...Array(INCOME_SLOTS - k).fill(0n)];
  const padCommit = [...noteCommitmentDecimals, ...Array(INCOME_SLOTS - k).fill("0")];
  const isActive = padAmount.map((_, i) => (i < k ? 1 : 0));

  const input = {
    amount: padAmount.map(String),
    note_blinding: padBlinding.map(String),
    is_active: isActive.map(String),
    note_commitment: padCommit,
    threshold: threshold.toString(),
  };
  const { proof } = await groth16.fullProve(
    input,
    params.wasmUrl ?? "/circuits/income_proof.wasm",
    params.zkeyUrl ?? "/circuits/income_proof.zkey"
  );
  return { proof: encodeProof(proof) };
}
