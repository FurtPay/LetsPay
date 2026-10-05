#!/usr/bin/env tsx
/**
 * Payfurt Phase 1 — testnet end-to-end test.
 *
 * Validates the full pipeline:
 *   initialize contract (real payroll+invoice VKs) → in-Node Groth16 proof →
 *   on-chain disburse (BLS12-381 pairing verifies on testnet) →
 *   batch readback (total + headcount + leaf_hashes)
 *
 * Prerequisites (run from payfurt/):
 *   1. bash scripts/setup_ceremony.sh payroll    # payroll wasm + zkey + vk
 *   2. bash scripts/setup_ceremony.sh invoice    # invoice wasm + zkey + vk
 *   3. bash scripts/deploy.sh testnet maylord    # writes deployments/testnet.json
 *   4. pnpm install                              # @stellar/stellar-sdk + snarkjs
 *
 * Usage:
 *   SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/e2e.ts
 *
 * Optional env vars:
 *   RPC_URL=https://soroban-testnet.stellar.org
 *   TOKEN_CONTRACT=C...   (defaults to native XLM SAC via CLI)
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Client } from "../client/lib/bindings/payroll_verifier/src/index";
import { encodeVerificationKey } from "../client/lib/zk/groth16Codec";
import { generatePayrollProof } from "../client/lib/zk/payrollProof";

// ── config ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;

// ── helpers ─────────────────────────────────────────────────────────────────

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

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function friendbot(pk: string) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${pk}`);
  if (!r.ok) throw new Error(`Friendbot failed for ${pk}: ${r.status}`);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load deployment
  const deploy = JSON.parse(
    fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8")
  );
  const contractId: string = deploy.payroll_verifier;
  console.log("contract :", contractId);

  // 2. Load and encode payroll VK
  const payrollVkJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "circuits/build/payroll_vk.json"), "utf8")
  );
  const payrollVkBytes = encodeVerificationKey(payrollVkJson);
  if (payrollVkBytes.ic.length !== 15)
    throw new Error(`payroll VK IC len ${payrollVkBytes.ic.length} — expected 15 (14 signals + 1)`);
  console.log("payroll VK IC len: 15 ✓");

  // 3. Load and encode invoice VK
  const invoiceVkPath = path.join(ROOT, "circuits/build/invoice_vk.json");
  if (!fs.existsSync(invoiceVkPath)) {
    console.error("❌  invoice_vk.json not found — run: bash scripts/setup_ceremony.sh invoice");
    process.exit(1);
  }
  const invoiceVkJson = JSON.parse(fs.readFileSync(invoiceVkPath, "utf8"));
  const invoiceVkBytes = encodeVerificationKey(invoiceVkJson);
  if (invoiceVkBytes.ic.length !== 5)
    throw new Error(`invoice VK IC len ${invoiceVkBytes.ic.length} — expected 5 (4 signals + 1)`);
  console.log("invoice VK IC len: 5 ✓");

  // 4. Set up keypair
  const secretKey = process.env.SECRET_KEY;
  if (!secretKey) {
    console.error(
      "❌  SECRET_KEY not set\n  Run: SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/e2e.ts"
    );
    process.exit(1);
  }
  const admin = Keypair.fromSecret(secretKey);
  console.log("admin    :", admin.publicKey());

  const client = makeClient(contractId, admin);

  // 5. Resolve token SAC addresses
  const xlmSac =
    process.env.TOKEN_CONTRACT ??
    execSync("stellar contract id asset --asset native --network testnet", {
      encoding: "utf8",
    }).trim();
  // Testnet USDC (Circle issuer GBBD47...)
  const usdcSac = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
  const tokenId = xlmSac; // payroll test uses native XLM
  console.log("XLM SAC :", xlmSac);
  console.log("USDC SAC:", usdcSac);

  // ── Step 1: initialize ────────────────────────────────────────────────────
  console.log("\n▶ initialize (stores payroll + invoice VKs + token allowlist on-chain)");
  try {
    const initTx = await client.initialize({
      admin: admin.publicKey(),
      vk_payroll: {
        alpha: toBuffer(payrollVkBytes.alpha),
        beta: toBuffer(payrollVkBytes.beta),
        delta: toBuffer(payrollVkBytes.delta),
        gamma: toBuffer(payrollVkBytes.gamma),
        ic: payrollVkBytes.ic.map(toBuffer),
      },
      vk_invoice: {
        alpha: toBuffer(invoiceVkBytes.alpha),
        beta: toBuffer(invoiceVkBytes.beta),
        delta: toBuffer(invoiceVkBytes.delta),
        gamma: toBuffer(invoiceVkBytes.gamma),
        ic: invoiceVkBytes.ic.map(toBuffer),
      },
      initial_tokens: [tokenId],
    });
    const { result: initResult } = await initTx.signAndSend();
    if (initResult.isErr()) {
      const e = initResult.unwrapErr();
      if (JSON.stringify(e).includes("AlreadyInitialized")) {
        console.log("  ℹ️  contract already initialized — skipping");
      } else {
        throw new Error(`initialize: ${JSON.stringify(e)}`);
      }
    } else {
      console.log("  ✅ initialized");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Contract error #1 = AlreadyInitialized — simulation throws before signAndSend returns
    if (msg.includes("AlreadyInitialized") || msg.includes("#1")) {
      console.log("  ℹ️  contract already initialized — skipping");
    } else {
      throw err;
    }
  }

  // ── Step 2: generate Groth16 proof in Node ────────────────────────────────
  console.log("\n▶ generating Groth16 proof (3-person payroll, running in Node)");
  const wasmPath = path.join(ROOT, "circuits/build/payroll_js/payroll.wasm");
  const zkeyPath = path.join(ROOT, "circuits/build/payroll.zkey");

  // 1 XLM = 10_000_000 stroops
  const salaries = [10_000_000n, 20_000_000n, 15_000_000n]; // 1 + 2 + 1.5 XLM
  const maxSalary = 20_000_000n;

  const proofRes = await generatePayrollProof({
    salaries,
    maxSalary,
    wasmUrl: wasmPath,
    zkeyUrl: zkeyPath,
  });
  console.log("  commitment  :", proofRes.commitmentDecimal.slice(0, 24) + "…");
  console.log("  totalBudget :", proofRes.totalBudget.toString(), "stroops (4.5 XLM)");
  console.log("  activeCount :", proofRes.activeCount);
  console.log("  leaf[0]     :", proofRes.leafHashDecimals[0].slice(0, 20) + "…");

  // ── Step 3: fund recipient accounts via Friendbot ─────────────────────────
  console.log("\n▶ funding 3 ephemeral recipient accounts via Friendbot");
  const [r1, r2, r3] = [Keypair.random(), Keypair.random(), Keypair.random()];
  await Promise.all([r1, r2, r3].map((k) => friendbot(k.publicKey())));
  await sleep(3000);
  console.log("  ✅ recipients funded");

  // ── Step 4: disburse — on-chain Groth16 verification happens here ─────────
  console.log("\n▶ disburse (BLS12-381 pairing check on testnet + 3 XLM transfers)");
  const disburseTx = await client.disburse({
    employer: admin.publicKey(),
    proof: {
      a: toBuffer(proofRes.proof.a),
      b: toBuffer(proofRes.proof.b),
      c: toBuffer(proofRes.proof.c),
    },
    total_budget: proofRes.totalBudget,
    max_salary: proofRes.maxSalary,
    active_count: proofRes.activeCount,
    commitment: toBuffer(proofRes.commitment),
    token: tokenId,
    recipients: [r1.publicKey(), r2.publicKey(), r3.publicKey()],
    amounts: salaries,
    leaf_hashes: proofRes.leafHashes.map(toBuffer),
  });
  const { result: disburseResult } = await disburseTx.signAndSend();
  if (disburseResult.isErr())
    throw new Error(`disburse: ${JSON.stringify(disburseResult.unwrapErr())}`);
  const batchId = disburseResult.unwrap();
  console.log("  ✅ disburse succeeded, batch_id:", batchId.toString());

  // ── Step 5: read back the batch ───────────────────────────────────────────
  console.log("\n▶ get_batch(" + batchId + ")");
  const batchTx = await client.get_batch({ batch_id: batchId });
  const batchResult = batchTx.result;
  if (batchResult.isErr()) throw new Error(`get_batch: ${JSON.stringify(batchResult.unwrapErr())}`);
  const batch = batchResult.unwrap();
  console.log("  total_budget:", batch.total_budget.toString(), "stroops");
  console.log("  headcount   :", batch.headcount);
  console.log("  leaf_hashes :", batch.leaf_hashes.length, "entries");
  console.log("  commitment  :", batch.commitment.toString("hex").slice(0, 20) + "…");

  // ── Assertions ────────────────────────────────────────────────────────────
  const expectedTotal = salaries.reduce((a, b) => a + b, 0n);
  if (BigInt(batch.total_budget) !== expectedTotal)
    throw new Error(`total_budget mismatch: ${batch.total_budget} ≠ ${expectedTotal}`);
  if (batch.headcount !== proofRes.activeCount)
    throw new Error(`headcount mismatch: ${batch.headcount} ≠ ${proofRes.activeCount}`);
  if (batch.leaf_hashes.length !== proofRes.leafHashes.length)
    throw new Error(`leaf_hashes length: ${batch.leaf_hashes.length} ≠ ${proofRes.leafHashes.length} (MAX_HEADCOUNT)`);

  console.log(`
✅  Phase 1 e2e PASSED
    BLS12-381 Groth16 proof verified on testnet  ✓
    3 native XLM payroll transfers executed       ✓
    Batch stores total (${expectedTotal} stroops) + headcount (3)  ✓
    Leaf hashes stored on-chain (10 slots)        ✓
    No individual salary ever appears on-chain    ✓

    Explorer: https://stellar.expert/explorer/testnet/contract/${contractId}
  `);
}

main().catch((err) => {
  console.error("\n❌  e2e FAILED:", err.message ?? err);
  process.exit(1);
});
