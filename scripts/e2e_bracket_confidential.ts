#!/usr/bin/env tsx
/**
 * Payfurt — note-anchored salary bracket proof testnet end-to-end test.
 *
 * Chains a real confidential payroll note into a bracket attestation:
 *   employer disburses 1 confidential note to a recipient →
 *   recipient proves their salary ∈ [low, high] anchored to that note,
 *   via salary_bracket_verifier.prove_bracket — without revealing the salary
 *
 * Prerequisites: e2e_confidential.ts has run once (VKs set), and
 * deployments/testnet.json has both payroll_verifier + salary_bracket_verifier.
 *
 * Usage:
 *   SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/e2e_bracket_confidential.ts
 */

import fs from "fs";
import path from "path";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Client as PayrollClient } from "../client/lib/bindings/payroll_verifier/src/index";
import { Client as BracketClient } from "../client/lib/bindings/salary_bracket_verifier/src/index";
import { generatePayrollNotesProof } from "../client/lib/zk/payrollNotesProof";
import { generateBracketProof } from "../client/lib/zk/bracketProof";

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;

function toBuffer(b: Uint8Array): Buffer { return Buffer.from(b); }

function signer(kp: Keypair) {
  return async (xdrStr: string) => {
    const tx = TransactionBuilder.fromXDR(xdrStr, NETWORK) as Transaction;
    tx.sign(kp);
    return { signedTxXdr: tx.toEnvelope().toXDR("base64") };
  };
}

async function friendbot(pk: string) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${pk}`);
  if (!r.ok) throw new Error(`Friendbot failed for ${pk}: ${r.status}`);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const deploy = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
  const pvId: string = deploy.payroll_verifier;
  const sbvId: string = deploy.salary_bracket_verifier;
  const xlmSac = deploy.tokens?.xlm ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  console.log("payroll_verifier        :", pvId);
  console.log("salary_bracket_verifier :", sbvId);

  const secretKey = process.env.SECRET_KEY;
  if (!secretKey) { console.error("❌  SECRET_KEY not set"); process.exit(1); }
  const employer = Keypair.fromSecret(secretKey);
  const employerPv = new PayrollClient({ contractId: pvId, networkPassphrase: NETWORK, rpcUrl: RPC_URL, publicKey: employer.publicKey(), signTransaction: signer(employer) });

  // ── Step 1: disburse one confidential note (salary 7 XLM) ──────────────────
  console.log("\n▶ disburse_confidential (1 recipient, salary 7 XLM)");
  const salary = 70_000_000n; // 7 XLM
  const notesRes = await generatePayrollNotesProof({
    salaries: [salary], maxSalary: salary,
    wasmUrl: path.join(ROOT, "circuits/build/payroll_notes_js/payroll_notes.wasm"),
    zkeyUrl: path.join(ROOT, "circuits/build/payroll_notes.zkey"),
  });

  const recipient = Keypair.random();
  await friendbot(recipient.publicKey());
  await sleep(3000);

  const disburseTx = await employerPv.disburse_confidential({
    employer: employer.publicKey(),
    proof: { a: toBuffer(notesRes.proof.a), b: toBuffer(notesRes.proof.b), c: toBuffer(notesRes.proof.c) },
    total_budget: notesRes.totalBudget,
    max_salary: notesRes.maxSalary,
    active_count: notesRes.activeCount,
    commitment: toBuffer(notesRes.commitment),
    token: xlmSac,
    recipients: [recipient.publicKey()],
    note_commitments: notesRes.noteCommitments.map(toBuffer),
    note_ciphers: [Buffer.alloc(0)], // out-of-band path (single recipient)
  });
  const { result: dRes } = await disburseTx.signAndSend();
  if (dRes.isErr()) throw new Error(`disburse_confidential: ${JSON.stringify(dRes.unwrapErr())}`);
  console.log("  ✅ disbursed, batch_id:", dRes.unwrap().toString());

  // Recipient's note escrow id.
  const recipientPv = new PayrollClient({ contractId: pvId, networkPassphrase: NETWORK, rpcUrl: RPC_URL, publicKey: recipient.publicKey(), signTransaction: signer(recipient) });
  const idsRes = await recipientPv.get_recipient_escrows({ recipient: recipient.publicKey() });
  const ids = idsRes.result as unknown as bigint[];
  const escrowId = ids[ids.length - 1];
  console.log("  recipient note escrow id:", escrowId.toString());

  // ── Step 2: recipient proves salary ∈ [5, 10] XLM, anchored to the note ────
  console.log("\n▶ prove_bracket (salary ∈ [5, 10] XLM, amount never revealed)");
  const bracketLow = 50_000_000n;  // 5 XLM
  const bracketHigh = 100_000_000n; // 10 XLM
  const bracketRes = await generateBracketProof({
    salary,
    noteBlinding: notesRes.noteBlindings[0],
    bracketLow,
    bracketHigh,
    wasmUrl: path.join(ROOT, "circuits/build/salary_bracket_js/salary_bracket.wasm"),
    zkeyUrl: path.join(ROOT, "circuits/build/salary_bracket.zkey"),
  });

  // Sanity: the proof's note commitment must equal the on-chain note.
  const escrowRes = await recipientPv.get_escrow({ escrow_id: escrowId });
  const onChainNote = BigInt("0x" + Buffer.from(escrowRes.result.unwrap().escrow_commitment).toString("hex")).toString(10);
  if (bracketRes.noteCommitmentDecimal !== onChainNote) {
    throw new Error("note commitment mismatch — proof would be rejected");
  }
  console.log("  note commitment matches on-chain note ✓");

  const bracketClient = new BracketClient({ contractId: sbvId, networkPassphrase: NETWORK, rpcUrl: RPC_URL, publicKey: recipient.publicKey(), signTransaction: signer(recipient) });
  const proveTx = await bracketClient.prove_bracket({
    employee: recipient.publicKey(),
    escrow_id: escrowId,
    bracket_low: bracketLow,
    bracket_high: bracketHigh,
    proof: { a: toBuffer(bracketRes.proof.a), b: toBuffer(bracketRes.proof.b), c: toBuffer(bracketRes.proof.c) },
  });
  const { result: pRes } = await proveTx.signAndSend();
  if (pRes.isErr()) throw new Error(`prove_bracket: ${JSON.stringify(pRes.unwrapErr())}`);

  console.log(`
✅  Note-anchored salary bracket e2e PASSED
    disburse_confidential : 1 note created (salary 7 XLM, hidden)        ✓
    prove_bracket          : salary proven ∈ [5, 10] XLM on-chain         ✓
                             anchored to the note, exact amount never revealed

    salary_bracket_verifier: ${sbvId}
  `);
}

main().catch((err) => {
  console.error("\n❌  e2e_bracket_confidential FAILED:", err.message ?? err);
  process.exit(1);
});
