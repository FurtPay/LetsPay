#!/usr/bin/env tsx
/**
 * Payfurt Phase 4 — confidential invoice escrow testnet end-to-end test.
 *
 * Validates the full lifecycle with the invoice amount NEVER appearing as a
 * plaintext on-chain field:
 *   payer creates escrow (escrow_lock: debits payer's confidential balance,
 *     locks an opaque escrow_commitment) →
 *   contractor settles for the FIRST time (escrow_settle_new: range-checks
 *     the amount, credits the contractor's brand-new confidential balance) →
 *   contractor withdraws (deshields back to a real, visible SAC transfer)
 *
 * Prerequisites: scripts/e2e_confidential.ts must have already run at least
 * once against the current deployment (sets up VKs and the payer's
 * confidential balance).
 *
 * Usage:
 *   SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/e2e_invoice_confidential.ts
 */

import fs from "fs";
import path from "path";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Client } from "../client/lib/bindings/payroll_verifier/src/index";
import {
  generateEscrowLockProof,
  generateEscrowSettleNewProof,
} from "../client/lib/zk/escrowProof";
import { generateWithdrawProof } from "../client/lib/zk/withdrawProof";

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;

function toBuffer(b: Uint8Array): Buffer {
  return Buffer.from(b);
}

function makeClient(contractId: string, keypair: Keypair) {
  return new Client({
    contractId,
    networkPassphrase: NETWORK,
    rpcUrl: RPC_URL,
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

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const deploy = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
  const contractId: string = deploy.payroll_verifier;
  console.log("contract :", contractId);

  // Use a fresh, ephemeral keypair as payer rather than the SECRET_KEY identity:
  // a payer's prior confidential balance/blinding is opaque on-chain by design,
  // so we can't know it without having generated it ourselves in this run.
  console.log("admin (funder) :", Keypair.fromSecret(process.env.SECRET_KEY!).publicKey());
  const xlmSac = deploy.tokens?.xlm ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  console.log("XLM SAC        :", xlmSac);

  const payer = Keypair.random();
  await friendbot(payer.publicKey());
  await sleep(3000);
  const payerClient = makeClient(contractId, payer);
  console.log("payer          :", payer.publicKey());

  console.log("\n▶ deposit_new (payer shields 10 XLM)");
  const { generateDepositNewProof } = await import("../client/lib/zk/depositProof");
  const depositAmount = 100_000_000n; // 10 XLM
  const depositRes = await generateDepositNewProof({
    amount: depositAmount,
    wasmUrl: path.join(ROOT, "circuits/build/deposit_new_js/deposit_new.wasm"),
    zkeyUrl: path.join(ROOT, "circuits/build/deposit_new.zkey"),
  });
  const depositTx = await payerClient.deposit_new({
    account: payer.publicKey(),
    token: xlmSac,
    amount: depositAmount,
    commitment: toBuffer(depositRes.commitment),
    proof: { a: toBuffer(depositRes.proof.a), b: toBuffer(depositRes.proof.b), c: toBuffer(depositRes.proof.c) },
  });
  const { result: depositResult } = await depositTx.signAndSend();
  if (depositResult.isErr()) throw new Error(`deposit_new: ${JSON.stringify(depositResult.unwrapErr())}`);
  console.log("  ✅ payer shielded 10 XLM");

  // ── Step 1: create_escrow (escrow_lock — lock 4 XLM, range [1, 8] XLM) ────
  console.log("\n▶ create_escrow (lock 4 XLM, invoice range [1, 8] XLM — amount never goes on-chain)");
  const lockAmount = 40_000_000n; // 4 XLM
  const invoiceMin = 10_000_000n; // 1 XLM
  const invoiceMax = 80_000_000n; // 8 XLM

  const contractor = Keypair.random();
  await friendbot(contractor.publicKey());
  await sleep(3000);

  const lockRes = await generateEscrowLockProof({
    oldBalance: depositRes.balance,
    oldBlinding: depositRes.blinding,
    oldCommitmentDecimal: depositRes.commitmentDecimal,
    amount: lockAmount,
    wasmUrl: path.join(ROOT, "circuits/build/escrow_lock_js/escrow_lock.wasm"),
    zkeyUrl: path.join(ROOT, "circuits/build/escrow_lock.zkey"),
  });

  const createTx = await payerClient.create_escrow({
    payer: payer.publicKey(),
    payee: contractor.publicKey(),
    token: xlmSac,
    invoice_min: invoiceMin,
    invoice_max: invoiceMax,
    new_commitment: toBuffer(lockRes.newCommitment),
    escrow_commitment: toBuffer(lockRes.escrowCommitment),
    proof: { a: toBuffer(lockRes.proof.a), b: toBuffer(lockRes.proof.b), c: toBuffer(lockRes.proof.c) },
  });
  const { result: createResult } = await createTx.signAndSend();
  if (createResult.isErr()) throw new Error(`create_escrow: ${JSON.stringify(createResult.unwrapErr())}`);
  const escrowId = createResult.unwrap();
  console.log("  ✅ escrow created, id:", escrowId.toString());
  console.log("  payer's remaining confidential balance (local only):", lockRes.newBalance.toString(), "stroops");

  // ── Step 2: settle_escrow_new (contractor's first-ever confidential credit) ─
  console.log("\n▶ settle_escrow_new (contractor settles for the first time)");
  const contractorClient = makeClient(contractId, contractor);

  const settleRes = await generateEscrowSettleNewProof({
    amount: lockAmount,
    escrowBlinding: lockRes.escrowBlinding,
    escrowCommitmentDecimal: lockRes.escrowCommitmentDecimal,
    invoiceMin,
    invoiceMax,
    wasmUrl: path.join(ROOT, "circuits/build/escrow_settle_new_js/escrow_settle_new.wasm"),
    zkeyUrl: path.join(ROOT, "circuits/build/escrow_settle_new.zkey"),
  });

  const settleTx = await contractorClient.settle_escrow_new({
    payee: contractor.publicKey(),
    escrow_id: escrowId,
    payee_commitment: toBuffer(settleRes.commitment),
    proof: { a: toBuffer(settleRes.proof.a), b: toBuffer(settleRes.proof.b), c: toBuffer(settleRes.proof.c) },
  });
  const { result: settleResult } = await settleTx.signAndSend();
  if (settleResult.isErr()) throw new Error(`settle_escrow_new: ${JSON.stringify(settleResult.unwrapErr())}`);
  console.log("  ✅ settled — contractor's confidential balance:", settleRes.balance.toString(), "stroops (known only locally)");

  // ── Step 3: contractor withdraws (deshield — the only visible amount) ────
  console.log("\n▶ withdraw (contractor deshields the full 4 XLM)");
  const withdrawRes = await generateWithdrawProof({
    oldBalance: settleRes.balance,
    oldBlinding: settleRes.blinding,
    oldCommitmentDecimal: settleRes.commitmentDecimal,
    amount: lockAmount,
    wasmUrl: path.join(ROOT, "circuits/build/withdraw_js/withdraw.wasm"),
    zkeyUrl: path.join(ROOT, "circuits/build/withdraw.zkey"),
  });
  const withdrawTx = await contractorClient.withdraw({
    account: contractor.publicKey(),
    token: xlmSac,
    amount: lockAmount,
    new_commitment: toBuffer(withdrawRes.newCommitment),
    proof: { a: toBuffer(withdrawRes.proof.a), b: toBuffer(withdrawRes.proof.b), c: toBuffer(withdrawRes.proof.c) },
  });
  const { result: withdrawResult } = await withdrawTx.signAndSend();
  if (withdrawResult.isErr()) throw new Error(`withdraw: ${JSON.stringify(withdrawResult.unwrapErr())}`);

  console.log(`
✅  Phase 4 (confidential invoice escrow) e2e PASSED
    create_escrow      : 4 XLM locked, invoice range [1,8] XLM — amount never on-chain  ✓
    settle_escrow_new   : contractor's first confidential credit                          ✓
    withdraw            : contractor deshields 4 XLM                                       ✓

    Explorer: https://stellar.expert/explorer/testnet/contract/${contractId}
    Check create_escrow's transaction — no invoice amount appears in its operations,
    only the opaque commitments. The withdraw transaction is the only place
    "4 XLM" (40000000 stroops) ever shows up as a plain number.
  `);
}

main().catch((err) => {
  console.error("\n❌  e2e_invoice_confidential FAILED:", err.message ?? err);
  process.exit(1);
});
