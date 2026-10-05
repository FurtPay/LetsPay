#!/usr/bin/env tsx
/**
 * Isolated income-proof e2e using the persistent funded account as both the
 * employer and recipient (avoids friendbot-funded-account flakiness).
 *
 * Usage: SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/e2e_income_only.ts
 */
import fs from "fs";
import path from "path";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Client as PayrollClient } from "../client/lib/bindings/payroll_verifier/src/index";
import { Client as AttestClient } from "../client/lib/bindings/salary_bracket_verifier/src/index";
import { generatePayrollNotesProof } from "../client/lib/zk/payrollNotesProof";
import { generateIncomeProof } from "../client/lib/zk/attestationProof";

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const C = (n: string) => path.join(ROOT, `circuits/build/${n}`);
const buf = (b: Uint8Array) => Buffer.from(b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function signer(kp: Keypair) {
  return async (xdr: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, NETWORK) as Transaction;
    tx.sign(kp);
    return { signedTxXdr: tx.toEnvelope().toXDR("base64") };
  };
}

async function disburse(pv: PayrollClient, kp: Keypair, token: string, salary: bigint, payee: string) {
  const res = await generatePayrollNotesProof({
    salaries: [salary], maxSalary: salary,
    wasmUrl: C("payroll_notes_js/payroll_notes.wasm"), zkeyUrl: C("payroll_notes.zkey"),
  });
  const tx = await pv.disburse_confidential({
    employer: kp.publicKey(),
    proof: { a: buf(res.proof.a), b: buf(res.proof.b), c: buf(res.proof.c) },
    total_budget: res.totalBudget, max_salary: res.maxSalary, active_count: res.activeCount,
    commitment: buf(res.commitment), token, recipients: [payee],
    note_commitments: res.noteCommitments.map(buf), note_ciphers: [Buffer.alloc(0)],
  });
  const { result } = await tx.signAndSend();
  if (result.isErr()) throw new Error(`disburse: ${JSON.stringify(result.unwrapErr())}`);
  await sleep(6000);
  return res;
}

async function main() {
  const deploy = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
  const pvId: string = deploy.payroll_verifier;
  const sbvId: string = deploy.salary_bracket_verifier;
  const xlm = deploy.tokens?.xlm;
  const me = Keypair.fromSecret(process.env.SECRET_KEY!);
  const pv = new PayrollClient({ contractId: pvId, networkPassphrase: NETWORK, rpcUrl: RPC_URL, publicKey: me.publicKey(), signTransaction: signer(me) });
  console.log("employer = recipient:", me.publicKey());

  const getIds = async (): Promise<bigint[]> => {
    const t = await pv.get_recipient_escrows({ recipient: me.publicKey() });
    return (t.result as unknown as bigint[]) ?? [];
  };
  // Poll the index until it reflects `want` more notes than `before` (RPC lags).
  const waitForCount = async (before: number, want: number): Promise<bigint[]> => {
    for (let i = 0; i < 30; i++) {
      const ids = await getIds();
      if (ids.length >= before + want) return ids;
      await sleep(4000);
    }
    throw new Error("timed out waiting for the note index to update");
  };

  const startCount = (await getIds()).length;
  console.log("\n▶ two payrolls to self: 4 XLM, then 2 XLM");
  const r1 = await disburse(pv, me, xlm, 40_000_000n, me.publicKey());
  const r2 = await disburse(pv, me, xlm, 20_000_000n, me.publicKey());
  const ids = (await waitForCount(startCount, 2)).slice(-2);
  console.log("  my two newest notes:", ids.map(String).join(", "));

  console.log("\n▶ prove cumulative income ≥ 5 XLM over my last 2 notes");
  const inc = await generateIncomeProof({
    amounts: [40_000_000n, 20_000_000n],
    noteBlindings: [r1.noteBlindings[0], r2.noteBlindings[0]],
    noteCommitmentDecimals: [r1.noteCommitmentDecimals[0], r2.noteCommitmentDecimals[0]],
    threshold: 50_000_000n,
    wasmUrl: C("income_proof_js/income_proof.wasm"), zkeyUrl: C("income_proof.zkey"),
  });
  const attest = new AttestClient({ contractId: sbvId, networkPassphrase: NETWORK, rpcUrl: RPC_URL, publicKey: me.publicKey(), signTransaction: signer(me) });
  const tx = await attest.prove_income({
    employee: me.publicKey(),
    escrow_ids: ids,
    threshold: 50_000_000n,
    proof: { a: buf(inc.proof.a), b: buf(inc.proof.b), c: buf(inc.proof.c) },
  });
  const { result } = await tx.signAndSend();
  if (result.isErr()) throw new Error(`income: ${JSON.stringify(result.unwrapErr())}`);
  console.log("\n✅ income proof PASSED — cumulative ≥ 5 XLM, no individual amount revealed");
}

main().catch((e) => { console.error("\n❌", e.message ?? e); process.exit(1); });
