/**
 * Generates a Payfurt invoice Groth16 proof.
 *
 * publicSignals order (invoice.circom output-first convention):
 *   [0] = invoice_commitment   (output)
 *   [1] = invoice_min          (public input)
 *   [2] = invoice_max          (public input)
 *   [3] = revealed_amount      (public input — equals amount, used by on-chain verifier)
 */
import { groth16 } from "snarkjs";
import { encodeProof, frToBytesBE, type ProofBytes } from "./groth16Codec";

export interface InvoiceProofResult {
  proof: ProofBytes;
  commitment: Uint8Array;      // 32-byte BE — stored in InvoiceEscrow on-chain
  commitmentDecimal: string;
  amount: bigint;              // the invoice amount (stroops)
  salt: bigint;
}

export async function generateInvoiceProof(params: {
  amount: bigint;       // invoice amount in token base units (e.g. stroops)
  invoiceMin: bigint;   // agreed lower bound
  invoiceMax: bigint;   // agreed upper bound
  salt?: bigint;
  wasmUrl?: string;
  zkeyUrl?: string;
}): Promise<InvoiceProofResult> {
  const { amount, invoiceMin, invoiceMax } = params;

  if (amount <= 0n) throw new Error("amount must be > 0");
  if (invoiceMin > invoiceMax) throw new Error("invoice_min must be <= invoice_max");
  if (amount < invoiceMin || amount > invoiceMax)
    throw new Error(`amount ${amount} outside range [${invoiceMin}, ${invoiceMax}]`);

  const salt = params.salt ?? randomSalt();
  const wasmUrl = params.wasmUrl ?? "/circuits/invoice.wasm";
  const zkeyUrl = params.zkeyUrl ?? "/circuits/invoice.zkey";

  const input = {
    amount: amount.toString(),
    salt: salt.toString(),
    invoice_min: invoiceMin.toString(),
    invoice_max: invoiceMax.toString(),
    revealed_amount: amount.toString(),  // public — equals amount, verified on-chain
  };

  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);

  // publicSignals[0] = invoice_commitment
  // publicSignals[1] = invoice_min
  // publicSignals[2] = invoice_max
  // publicSignals[3] = revealed_amount
  const commitmentDecimal = publicSignals[0] as string;

  return {
    proof: encodeProof(proof),
    commitment: frToBytesBE(BigInt(commitmentDecimal)),
    commitmentDecimal,
    amount,
    salt,
  };
}

function randomSalt(): bigint {
  const b = new Uint8Array(31);
  globalThis.crypto.getRandomValues(b);
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}
