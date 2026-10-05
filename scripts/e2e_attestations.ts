#!/usr/bin/env tsx
/**
 * Payfurt — payroll attestations testnet e2e (Feature 7).
 *
 * Verifies, against real on-chain payrolls, that:
 *   minimum_wage : every active salary ≥ a floor, anchored to the batch commitment
 *   pay_equity   : two cohorts' averages differ by ≤ epsilon
 *   income_proof : a recipient's cumulative income across notes ≥ a threshold
 * — all without revealing any individual salary.
 *
 * Prereq: e2e_confidential.ts ran once (payroll VKs set) and
 * scripts/set_attestation_vks.ts ran (attestation VKs set).
 *
 * Usage: SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/e2e_attestations.ts
 */
import fs from "fs";
import path from "path";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Client as PayrollClient } from "../client/lib/bindings/payroll_verifier/src/index";
import { Client as AttestClient } from "../client/lib/bindings/salary_bracket_verifier/src/index";
import { generatePayrollNotesProof } from "../client/lib/zk/payrollNotesProof";
import { generateMinWageProof, generatePayEquityProof, generateIncomeProof } from "../client/lib/zk/attestationProof";

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const C = (n: string) => path.join(ROOT, `circuits/build/${n}`);

function toBuffer(b: Uint8Array): Buffer { return Buffer.from(b); }
function signer(kp: Keypair) {
  return async (xdr: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, NETWORK) as Transaction;
    tx.sign(kp);
    return { signedTxXdr: tx.toEnvelope().toXDR("base64") };
  };
}

async function disburse(pv: PayrollClient, employer: Keypair, token: string, salaries: bigint[], recipients: string[]) {
  const res = await generatePayrollNotesProof({
    salaries, maxSalary: salaries.reduce((a, b) => (a > b ? a : b), 0n),
    wasmUrl: C("payroll_notes_js/payroll_notes.wasm"), zkeyUrl: C("payroll_notes.zkey"),
  });
  const tx = await pv.disburse_confidential({
    employer: employer.publicKey(),
    proof: { a: toBuffer(res.proof.a), b: toBuffer(res.proof.b), c: toBuffer(res.proof.c) },
    total_budget: res.totalBudget, max_salary: res.maxSalary, active_count: res.activeCount,
    commitment: toBuffer(res.commitment), token, recipients,
    note_commitments: res.noteCommitments.map(toBuffer),
    note_ciphers: recipients.map(() => Buffer.alloc(0)),
  });
  const { result } = await tx.signAndSend();
  if (result.isErr()) throw new Error(`disburse: ${JSON.stringify(result.unwrapErr())}`);
  await new Promise((r) => setTimeout(r, 6000)); // let the sequence number propagate
  return { batchId: result.unwrap(), res };
}

async function main() {
  const deploy = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
  const pvId: string = deploy.payroll_verifier;
  const sbvId: string = deploy.salary_bracket_verifier;
  const xlm = deploy.tokens?.xlm;
  const employer = Keypair.fromSecret(process.env.SECRET_KEY!);
  const pv = new PayrollClient({ contractId: pvId, networkPassphrase: NETWORK, rpcUrl: RPC_URL, publicKey: employer.publicKey(), signTransaction: signer(employer) });
  const attest = new AttestClient({ contractId: sbvId, networkPassphrase: NETWORK, rpcUrl: RPC_URL, publicKey: employer.publicKey(), signTransaction: signer(employer) });
  console.log("payroll:", pvId, "\nattest :", sbvId);

  // ── batch 1: 4 recipients, salaries 4/4/3/5 XLM, cohorts A=[0,1] B=[2,3] ──
  console.log("\n▶ disburse batch (4 salaries: 4, 4, 3, 5 XLM)");
  const salaries = [40_000_000n, 40_000_000n, 30_000_000n, 50_000_000n];
  const groups = [0, 0, 1, 1];
  const recipientKps = [Keypair.random(), Keypair.random(), Keypair.random(), Keypair.random()];
  const recipients = recipientKps.map((k) => k.publicKey());
  const { batchId, res } = await disburse(pv, employer, xlm, salaries, recipients);
  console.log("  ✅ batch", batchId.toString());

  // ── minimum wage: all ≥ 3 XLM ──
  console.log("\n▶ prove_min_wage (all ≥ 3 XLM)");
  const mw = await generateMinWageProof({
    salaries, salt: res.salt, minWage: 30_000_000n,
    wasmUrl: C("minimum_wage_js/minimum_wage.wasm"), zkeyUrl: C("minimum_wage.zkey"),
  });
  const mwTx = await attest.prove_min_wage({ attester: employer.publicKey(), batch_id: batchId, min_wage: 30_000_000n, proof: { a: toBuffer(mw.proof.a), b: toBuffer(mw.proof.b), c: toBuffer(mw.proof.c) } });
  const mwRes = await mwTx.signAndSend();
  if (mwRes.result.isErr()) throw new Error(`min_wage: ${JSON.stringify(mwRes.result.unwrapErr())}`);
  console.log("  ✅ attested: every salary ≥ 3 XLM (no salary revealed)");
  await new Promise((r) => setTimeout(r, 6000));

  // ── pay equity: |avgA − avgB| ≤ 1 XLM (actual gap is 0) ──
  console.log("\n▶ prove_pay_equity (cohort averages within 1 XLM)");
  const pe = await generatePayEquityProof({
    salaries, groups, salt: res.salt, epsilon: 10_000_000n,
    wasmUrl: C("pay_equity_js/pay_equity.wasm"), zkeyUrl: C("pay_equity.zkey"),
  });
  const peTx = await attest.prove_pay_equity({ attester: employer.publicKey(), batch_id: batchId, epsilon: 10_000_000n, proof: { a: toBuffer(pe.proof.a), b: toBuffer(pe.proof.b), c: toBuffer(pe.proof.c) } });
  const peRes = await peTx.signAndSend();
  if (peRes.result.isErr()) throw new Error(`pay_equity: ${JSON.stringify(peRes.result.unwrapErr())}`);
  console.log("  ✅ attested: cohort pay gap ≤ 1 XLM (no salary/average revealed)");

  // ── income proof: recipient 0 paid again, prove cumulative ≥ 5 XLM ──
  console.log("\n▶ second payroll to recipient 0 (+2 XLM), then prove income ≥ 5 XLM");
  const r0kp = recipientKps[0];
  const r0 = r0kp.publicKey();
  await fetch(`https://friendbot.stellar.org?addr=${r0}`); // fund r0 to pay its own tx fee
  await new Promise((r) => setTimeout(r, 3000));
  const second = await disburse(pv, employer, xlm, [20_000_000n], [r0]);

  // recipient 0's two notes: 4 XLM (batch1, slot0) + 2 XLM (batch2, slot0)
  const idsTx = await pv.get_recipient_escrows({ recipient: r0 });
  const ids = idsTx.result as unknown as bigint[];

  const inc = await generateIncomeProof({
    amounts: [40_000_000n, 20_000_000n],
    noteBlindings: [res.noteBlindings[0], second.res.noteBlindings[0]],
    noteCommitmentDecimals: [res.noteCommitmentDecimals[0], second.res.noteCommitmentDecimals[0]],
    threshold: 50_000_000n,
    wasmUrl: C("income_proof_js/income_proof.wasm"), zkeyUrl: C("income_proof.zkey"),
  });

  const r0Attest = new AttestClient({ contractId: sbvId, networkPassphrase: NETWORK, rpcUrl: RPC_URL, publicKey: r0, signTransaction: signer(r0kp) });
  const incTx = await r0Attest.prove_income({
    employee: r0,
    escrow_ids: [ids[ids.length - 2], ids[ids.length - 1]],
    threshold: 50_000_000n,
    proof: { a: toBuffer(inc.proof.a), b: toBuffer(inc.proof.b), c: toBuffer(inc.proof.c) },
  });
  const incRes = await incTx.signAndSend();
  if (incRes.result.isErr()) throw new Error(`income: ${JSON.stringify(incRes.result.unwrapErr())}`);
  console.log("  ✅ attested: cumulative income ≥ 5 XLM (no individual amount revealed)");

  console.log(`
✅  Payroll attestations e2e PASSED
    minimum_wage : every salary ≥ 3 XLM, anchored to batch ${batchId}        ✓
    pay_equity   : cohort averages within 1 XLM                               ✓
    income_proof : recipient cumulative income ≥ 5 XLM across 2 notes         ✓
    No individual salary, average, or amount was revealed in any of them.
  `);
}

main().catch((e) => { console.error("\n❌", e.message ?? e); process.exit(1); });
