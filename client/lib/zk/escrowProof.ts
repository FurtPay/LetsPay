/**
 * Generates Payfurt confidential invoice-escrow Groth16 proofs (Phase 4).
 *
 * Four circuits, matching the four on-chain entrypoints:
 *   - escrow_lock:       payer debits their confidential balance into an
 *                         opaque escrow commitment (create_escrow)
 *   - escrow_settle:     contractor with an existing confidential balance
 *                         credits it from the escrow (settle_escrow)
 *   - escrow_settle_new: contractor with NO prior confidential balance for
 *                         this token (settle_escrow_new)
 *   - escrow_cancel:     payer reclaims the locked amount after timeout
 *                         (cancel_escrow)
 *
 * publicSignals order (output-first circom convention):
 *   escrow_lock.circom       → [new_commitment, escrow_commitment, old_commitment]
 *   escrow_settle.circom     → [payee_new_commitment, escrow_commitment, invoice_min, invoice_max, payee_old_commitment]
 *   escrow_settle_new.circom → [payee_commitment, escrow_commitment, invoice_min, invoice_max]
 *   escrow_cancel.circom     → [payer_new_commitment, escrow_commitment, payer_old_commitment]
 */
import { groth16 } from "snarkjs";
import { encodeProof, frToBytesBE, type ProofBytes } from "./groth16Codec";

function randomFieldElement(): bigint {
  const b = new Uint8Array(31);
  globalThis.crypto.getRandomValues(b);
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}

export interface EscrowLockProofResult {
  proof: ProofBytes;
  newCommitment: Uint8Array;
  newCommitmentDecimal: string;
  escrowCommitment: Uint8Array;
  escrowCommitmentDecimal: string;
  newBalance: bigint;
  newBlinding: bigint;
  escrowBlinding: bigint;
}

/** Payer locks `amount` from their confidential balance — used by create_escrow. */
export async function generateEscrowLockProof(params: {
  oldBalance: bigint;
  oldBlinding: bigint;
  oldCommitmentDecimal: string;
  amount: bigint;
  newBlinding?: bigint;
  escrowBlinding?: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<EscrowLockProofResult> {
  const { oldBalance, oldBlinding, oldCommitmentDecimal, amount } = params;
  if (amount <= 0n) throw new Error("amount must be > 0");
  if (amount > oldBalance) throw new Error("amount exceeds current confidential balance");

  const newBlinding = params.newBlinding ?? randomFieldElement();
  const escrowBlinding = params.escrowBlinding ?? randomFieldElement();
  const wasmUrl = params.wasmUrl ?? "/circuits/escrow_lock.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/escrow_lock.zkey";

  const input = {
    old_balance: oldBalance.toString(),
    old_blinding: oldBlinding.toString(),
    amount: amount.toString(),
    escrow_blinding: escrowBlinding.toString(),
    new_blinding: newBlinding.toString(),
    old_commitment: oldCommitmentDecimal,
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);

  // publicSignals[0] = new_commitment, [1] = escrow_commitment
  const newCommitmentDecimal = publicSignals[0] as string;
  const escrowCommitmentDecimal = publicSignals[1] as string;

  return {
    proof: encodeProof(proof),
    newCommitment: frToBytesBE(BigInt(newCommitmentDecimal)),
    newCommitmentDecimal,
    escrowCommitment: frToBytesBE(BigInt(escrowCommitmentDecimal)),
    escrowCommitmentDecimal,
    newBalance: oldBalance - amount,
    newBlinding,
    escrowBlinding,
  };
}

export interface EscrowSettleProofResult {
  proof: ProofBytes;
  newCommitment: Uint8Array;
  newCommitmentDecimal: string;
  newBalance: bigint;
  newBlinding: bigint;
}

/** Contractor with an existing confidential balance settles — used by settle_escrow. */
export async function generateEscrowSettleProof(params: {
  amount: bigint;
  escrowBlinding: bigint;
  escrowCommitmentDecimal: string;  // from the on-chain InvoiceEscrow.escrow_commitment — never recomputed
  invoiceMin: bigint;
  invoiceMax: bigint;
  payeeOldBalance: bigint;
  payeeOldBlinding: bigint;
  payeeOldCommitmentDecimal: string;
  payeeNewBlinding?: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<EscrowSettleProofResult> {
  const { amount, escrowBlinding, escrowCommitmentDecimal, invoiceMin, invoiceMax, payeeOldBalance, payeeOldBlinding, payeeOldCommitmentDecimal } = params;
  if (amount < invoiceMin || amount > invoiceMax) throw new Error("amount outside invoice range");

  const payeeNewBlinding = params.payeeNewBlinding ?? randomFieldElement();
  const wasmUrl = params.wasmUrl ?? "/circuits/escrow_settle.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/escrow_settle.zkey";

  const input = {
    amount: amount.toString(),
    escrow_blinding: escrowBlinding.toString(),
    payee_old_balance: payeeOldBalance.toString(),
    payee_old_blinding: payeeOldBlinding.toString(),
    payee_new_blinding: payeeNewBlinding.toString(),
    escrow_commitment: escrowCommitmentDecimal,
    invoice_min: invoiceMin.toString(),
    invoice_max: invoiceMax.toString(),
    payee_old_commitment: payeeOldCommitmentDecimal,
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);

  // publicSignals[0] = payee_new_commitment
  const newCommitmentDecimal = publicSignals[0] as string;

  return {
    proof: encodeProof(proof),
    newCommitment: frToBytesBE(BigInt(newCommitmentDecimal)),
    newCommitmentDecimal,
    newBalance: payeeOldBalance + amount,
    newBlinding: payeeNewBlinding,
  };
}

export interface EscrowSettleNewProofResult {
  proof: ProofBytes;
  commitment: Uint8Array;
  commitmentDecimal: string;
  balance: bigint;
  blinding: bigint;
}

/** Contractor with NO prior confidential balance for this token — used by settle_escrow_new. */
export async function generateEscrowSettleNewProof(params: {
  amount: bigint;
  escrowBlinding: bigint;
  escrowCommitmentDecimal: string;  // from the on-chain InvoiceEscrow.escrow_commitment — never recomputed
  invoiceMin: bigint;
  invoiceMax: bigint;
  blinding?: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<EscrowSettleNewProofResult> {
  const { amount, escrowBlinding, escrowCommitmentDecimal, invoiceMin, invoiceMax } = params;
  if (amount < invoiceMin || amount > invoiceMax) throw new Error("amount outside invoice range");

  const blinding = params.blinding ?? randomFieldElement();
  const wasmUrl = params.wasmUrl ?? "/circuits/escrow_settle_new.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/escrow_settle_new.zkey";

  const input = {
    amount: amount.toString(),
    escrow_blinding: escrowBlinding.toString(),
    payee_balance: amount.toString(),
    payee_blinding: blinding.toString(),
    escrow_commitment: escrowCommitmentDecimal,
    invoice_min: invoiceMin.toString(),
    invoice_max: invoiceMax.toString(),
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);

  // publicSignals[0] = payee_commitment
  const commitmentDecimal = publicSignals[0] as string;

  return {
    proof: encodeProof(proof),
    commitment: frToBytesBE(BigInt(commitmentDecimal)),
    commitmentDecimal,
    balance: amount,
    blinding,
  };
}

export interface EscrowCancelProofResult {
  proof: ProofBytes;
  newCommitment: Uint8Array;
  newCommitmentDecimal: string;
  newBalance: bigint;
  newBlinding: bigint;
}

/** Payer reclaims the locked amount after the escrow expires unsettled — used by cancel_escrow. */
export async function generateEscrowCancelProof(params: {
  amount: bigint;
  escrowBlinding: bigint;
  escrowCommitmentDecimal: string;  // from the on-chain InvoiceEscrow.escrow_commitment — never recomputed
  payerOldBalance: bigint;
  payerOldBlinding: bigint;
  payerOldCommitmentDecimal: string;
  payerNewBlinding?: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<EscrowCancelProofResult> {
  const { amount, escrowBlinding, escrowCommitmentDecimal, payerOldBalance, payerOldBlinding, payerOldCommitmentDecimal } = params;

  const payerNewBlinding = params.payerNewBlinding ?? randomFieldElement();
  const wasmUrl = params.wasmUrl ?? "/circuits/escrow_cancel.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/escrow_cancel.zkey";

  const input = {
    amount: amount.toString(),
    escrow_blinding: escrowBlinding.toString(),
    payer_old_balance: payerOldBalance.toString(),
    payer_old_blinding: payerOldBlinding.toString(),
    payer_new_blinding: payerNewBlinding.toString(),
    escrow_commitment: escrowCommitmentDecimal,
    payer_old_commitment: payerOldCommitmentDecimal,
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);

  // publicSignals[0] = payer_new_commitment
  const newCommitmentDecimal = publicSignals[0] as string;

  return {
    proof: encodeProof(proof),
    newCommitment: frToBytesBE(BigInt(newCommitmentDecimal)),
    newCommitmentDecimal,
    newBalance: payerOldBalance + amount,
    newBlinding: payerNewBlinding,
  };
}
