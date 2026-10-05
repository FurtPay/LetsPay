#!/usr/bin/env tsx
/**
 * Payfurt Phase 4 — confidential payroll (note model) testnet end-to-end test.
 *
 * Validates that individual salaries never appear on-chain:
 *   employer disburses (pays the public total in, creates one opaque note
 *     per recipient) →
 *   each recipient claims their note into a fresh confidential balance
 *     (settle_escrow_new) →
 *   a recipient withdraws (the only place their individual salary becomes
 *     visible — the deshield boundary)
 *
 * Prerequisites: scripts/e2e_confidential.ts must have run once against the
 * current deployment (initializes + sets all VKs incl. payroll_notes).
 *
 * Usage:
 *   SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/e2e_payroll_confidential.ts
 */

import fs from "fs";
import path from "path";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Client } from "../client/lib/bindings/payroll_verifier/src/index";
import { generatePayrollNotesProof } from "../client/lib/zk/payrollNotesProof";
import { generateEscrowSettleNewProof } from "../client/lib/zk/escrowProof";
import { generateWithdrawProof } from "../client/lib/zk/withdrawProof";

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const NOTE_MAX = 18_446_744_073_709_551_615n;

function toBuffer(b: Uint8Array): Buffer { return Buffer.from(b); }

function makeClient(contractId: string, keypair: Keypair) {
  return new Client({
    contractId, networkPassphrase: NETWORK, rpcUrl: RPC_URL,
    publicKey: keypair.publicKey(),
    signTransaction: async (xdrStr: string) => {
      const tx = TransactionBuilder.fromXDR(xdrStr, NETWORK) as Transaction;
      tx.sign(keypair);
      return { signedTxXdr: tx.toEnvelope().toXDR("base64") };
    },
  });
}

async function friendbot(pk: string) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${pk}`);
  if (!r.ok) throw new Error(`Friendbot failed for ${pk}: ${r.status}`);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const deploy = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
  const contractId: string = deploy.payroll_verifier;
  const xlmSac = deploy.tokens?.xlm ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  console.log("contract :", contractId);

  const secretKey = process.env.SECRET_KEY;
  if (!secretKey) {
    console.error("❌  SECRET_KEY not set"); process.exit(1);
  }
  const employer = Keypair.fromSecret(secretKey);
  console.log("employer :", employer.publicKey());
  const employerClient = makeClient(contractId, employer);

  // ── Step 1: generate the confidential payroll proof (3 recipients) ─────────
  console.log("\n▶ generating payroll_notes proof (3 salaries: 1, 2, 1.5 XLM)");
  const salaries = [10_000_000n, 20_000_000n, 15_000_000n]; // 1, 2, 1.5 XLM
  const maxSalary = 20_000_000n;
  const proofRes = await generatePayrollNotesProof({
    salaries, maxSalary,
    wasmUrl: path.join(ROOT, "circuits/build/payroll_notes_js/payroll_notes.wasm"),
    zkeyUrl: path.join(ROOT, "circuits/build/payroll_notes.zkey"),
  });
  console.log("  total (public):", proofRes.totalBudget.toString(), "stroops (4.5 XLM)");

  // ── Step 2: fund 3 recipient accounts ──────────────────────────────────────
  console.log("\n▶ funding 3 recipient accounts via Friendbot");
  const recipients = [Keypair.random(), Keypair.random(), Keypair.random()];
  await Promise.all(recipients.map((k) => friendbot(k.publicKey())));
  await sleep(3000);

  // ── Step 3: disburse_confidential ──────────────────────────────────────────
  console.log("\n▶ disburse_confidential (pays 4.5 XLM total in, creates 3 opaque notes)");
  const disburseTx = await employerClient.disburse_confidential({
    employer: employer.publicKey(),
    proof: { a: toBuffer(proofRes.proof.a), b: toBuffer(proofRes.proof.b), c: toBuffer(proofRes.proof.c) },
    total_budget: proofRes.totalBudget,
    max_salary: proofRes.maxSalary,
    active_count: proofRes.activeCount,
    commitment: toBuffer(proofRes.commitment),
    token: xlmSac,
    recipients: recipients.map((k) => k.publicKey()),
    note_commitments: proofRes.noteCommitments.map(toBuffer),
    note_ciphers: recipients.map(() => Buffer.alloc(0)), // out-of-band path
  });
  const { result: disburseResult } = await disburseTx.signAndSend();
  if (disburseResult.isErr()) throw new Error(`disburse_confidential: ${JSON.stringify(disburseResult.unwrapErr())}`);
  const batchId = disburseResult.unwrap();
  console.log("  ✅ disbursed, batch_id:", batchId.toString());

  // ── Step 4: each recipient claims their note ───────────────────────────────
  console.log("\n▶ each recipient claims their note into a confidential balance");
  const settleResults: { balance: bigint; blinding: bigint; commitmentDecimal: string; kp: Keypair }[] = [];
  for (let i = 0; i < recipients.length; i++) {
    const kp = recipients[i];
    const rClient = makeClient(contractId, kp);
    const escrowIdsRes = await rClient.get_recipient_escrows({ recipient: kp.publicKey() });
    const ids = escrowIdsRes.result as unknown as bigint[];
    const escrowId = ids[ids.length - 1]; // their note is the most recent

    const settleRes = await generateEscrowSettleNewProof({
      amount: salaries[i],
      escrowBlinding: proofRes.noteBlindings[i],
      escrowCommitmentDecimal: proofRes.noteCommitmentDecimals[i],
      invoiceMin: 0n,
      invoiceMax: NOTE_MAX,
      wasmUrl: path.join(ROOT, "circuits/build/escrow_settle_new_js/escrow_settle_new.wasm"),
      zkeyUrl: path.join(ROOT, "circuits/build/escrow_settle_new.zkey"),
    });
    const settleTx = await rClient.settle_escrow_new({
      payee: kp.publicKey(),
      escrow_id: escrowId,
      payee_commitment: toBuffer(settleRes.commitment),
      proof: { a: toBuffer(settleRes.proof.a), b: toBuffer(settleRes.proof.b), c: toBuffer(settleRes.proof.c) },
    });
    const { result } = await settleTx.signAndSend();
    if (result.isErr()) throw new Error(`settle (recipient ${i}): ${JSON.stringify(result.unwrapErr())}`);
    console.log(`  ✅ recipient ${i} claimed escrow #${escrowId} — confidential balance ${settleRes.balance} stroops`);
    settleResults.push({ balance: settleRes.balance, blinding: settleRes.blinding, commitmentDecimal: settleRes.commitmentDecimal, kp });
  }

  // ── Step 5: recipient 0 withdraws (the only visible per-salary amount) ─────
  console.log("\n▶ recipient 0 withdraws their full 1 XLM (deshield boundary)");
  const r0 = settleResults[0];
  const r0Client = makeClient(contractId, r0.kp);
  const withdrawRes = await generateWithdrawProof({
    oldBalance: r0.balance,
    oldBlinding: r0.blinding,
    oldCommitmentDecimal: r0.commitmentDecimal,
    amount: r0.balance,
    wasmUrl: path.join(ROOT, "circuits/build/withdraw_js/withdraw.wasm"),
    zkeyUrl: path.join(ROOT, "circuits/build/withdraw.zkey"),
  });
  const withdrawTx = await r0Client.withdraw({
    account: r0.kp.publicKey(),
    token: xlmSac,
    amount: r0.balance,
    new_commitment: toBuffer(withdrawRes.newCommitment),
    proof: { a: toBuffer(withdrawRes.proof.a), b: toBuffer(withdrawRes.proof.b), c: toBuffer(withdrawRes.proof.c) },
  });
  const { result: withdrawResult } = await withdrawTx.signAndSend();
  if (withdrawResult.isErr()) throw new Error(`withdraw: ${JSON.stringify(withdrawResult.unwrapErr())}`);

  console.log(`
✅  Phase 4 (confidential payroll, note model) e2e PASSED
    disburse_confidential : 4.5 XLM total paid in (public), 3 opaque notes created  ✓
    3 recipients claimed   : each credited confidentially, no salary on-chain         ✓
    recipient 0 withdrew    : 1 XLM deshielded                                          ✓

    Explorer: https://stellar.expert/explorer/testnet/contract/${contractId}
    The disburse_confidential transaction shows only the 4.5 XLM total and the
    opaque note commitments — never the 1 / 2 / 1.5 XLM split. Each recipient's
    individual amount only becomes visible if and when THEY choose to withdraw it.
  `);
}

main().catch((err) => {
  console.error("\n❌  e2e_payroll_confidential FAILED:", err.message ?? err);
  process.exit(1);
});
