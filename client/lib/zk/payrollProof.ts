/**
 * Generates a Payfurt payroll Groth16 proof from a list of active salaries.
 * Works in the browser and in Node (snarkjs + WebCrypto).
 *
 * publicSignals order (matches payroll.circom output-first convention):
 *   [0]    = payroll_commitment
 *   [1..10] = leaf_hash[0..9]   (per-slot Poseidon hashes for Feature 5)
 *   [11]   = total_budget
 *   [12]   = max_salary
 *   [13]   = active_count
 */
import { groth16 } from "snarkjs";
import { encodeProof, frToBytesBE, type ProofBytes } from "./groth16Codec";

const N = 10;

export interface PayrollProofResult {
  proof: ProofBytes;
  commitment: Uint8Array;       // 32-byte BE — on-chain nullifier
  commitmentDecimal: string;
  leafHashes: Uint8Array[];     // 10 × 32-byte BE leaf hashes (for disburse)
  leafHashDecimals: string[];   // raw decimal strings from circuit
  totalBudget: bigint;
  maxSalary: bigint;
  activeCount: number;
  salt: bigint;
}

export async function generatePayrollProof(params: {
  salaries: bigint[];  // active salaries, length 1..10 (token base units)
  maxSalary: bigint;
  salt?: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<PayrollProofResult> {
  const { salaries, maxSalary } = params;
  if (salaries.length === 0 || salaries.length > N) {
    throw new Error(`expected 1..${N} salaries, got ${salaries.length}`);
  }
  if (salaries.some((s) => s <= 0n || s > maxSalary)) {
    throw new Error("every salary must satisfy 0 < salary <= maxSalary");
  }

  const salt = params.salt ?? randomSalt();
  const wasmUrl = params.wasmUrl ?? "/circuits/payroll.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/payroll.zkey";

  const padded = [...salaries, ...Array(N - salaries.length).fill(0n)];
  const isActive = padded.map((_, i) => (i < salaries.length ? 1 : 0));
  const totalBudget = salaries.reduce((a, b) => a + b, 0n);

  const input = {
    sal: padded.map(String),
    salt: salt.toString(),
    is_active: isActive.map(String),
    total_budget: totalBudget.toString(),
    max_salary: maxSalary.toString(),
    active_count: salaries.length.toString(),
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);

  // publicSignals[0]    = payroll_commitment
  // publicSignals[1..10] = leaf_hash[0..9]
  // publicSignals[11]   = total_budget
  // publicSignals[12]   = max_salary
  // publicSignals[13]   = active_count
  const commitmentDecimal = publicSignals[0];
  const leafHashDecimals = publicSignals.slice(1, N + 1) as string[];
  const leafHashes = leafHashDecimals.map((d) => frToBytesBE(BigInt(d)));

  return {
    proof: encodeProof(proof),
    commitment: frToBytesBE(BigInt(commitmentDecimal)),
    commitmentDecimal,
    leafHashes,
    leafHashDecimals,
    totalBudget,
    maxSalary,
    activeCount: salaries.length,
    salt,
  };
}

/** Random salt below the BLS12-381 scalar field modulus (31 bytes is safely under). */
function randomSalt(): bigint {
  const b = new Uint8Array(31);
  globalThis.crypto.getRandomValues(b);
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}
