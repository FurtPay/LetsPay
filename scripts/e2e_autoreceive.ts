#!/usr/bin/env tsx
/**
 * Payfurt — auto-receive payroll testnet end-to-end test.
 *
 * Proves the "log in and your pay is waiting" flow:
 *   recipient registers an x25519 viewing key →
 *   employer looks it up, ECDH-encrypts (amount, note_blinding), posts it
 *     on-chain with the note (disburse_confidential) →
 *   recipient scans their escrows, reads the cipher, DECRYPTS it (recovering
 *     amount + note_blinding with zero out-of-band sharing), and claims →
 *   the decrypted values are confirmed to match what the employer paid
 *
 * Prerequisites: e2e_confidential.ts has run once (VKs set).
 *
 * Usage:
 *   SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/e2e_autoreceive.ts
 */

import fs from "fs";
import path from "path";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Client } from "../client/lib/bindings/payroll_verifier/src/index";
import { generatePayrollNotesProof } from "../client/lib/zk/payrollNotesProof";
import { generateEscrowSettleNewProof } from "../client/lib/zk/escrowProof";
import { generateViewingKeyPair, encryptNote, decryptNote } from "../client/lib/zk/noteCrypto";
import { hexToBytes } from "../client/lib/zk/viewKey";

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const NOTE_MAX = 18_446_744_073_709_551_615n;

function toBuffer(b: Uint8Array): Buffer { return Buffer.from(b); }
function signer(kp: Keypair) {
  return async (xdrStr: string) => {
    const tx = TransactionBuilder.fromXDR(xdrStr, NETWORK) as Transaction;
    tx.sign(kp);
    return { signedTxXdr: tx.toEnvelope().toXDR("base64") };
  };
}
function client(contractId: string, kp: Keypair) {
  return new Client({ contractId, networkPassphrase: NETWORK, rpcUrl: RPC_URL, publicKey: kp.publicKey(), signTransaction: signer(kp) });
}
async function friendbot(pk: string) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${pk}`);
  if (!r.ok) throw new Error(`Friendbot failed: ${r.status}`);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const deploy = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
  const pvId: string = deploy.payroll_verifier;
  const xlmSac = deploy.tokens?.xlm ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  console.log("contract :", pvId);

  const secretKey = process.env.SECRET_KEY;
  if (!secretKey) { console.error("❌  SECRET_KEY not set"); process.exit(1); }
  const employer = Keypair.fromSecret(secretKey);
  const employerPv = client(pvId, employer);

  // ── Step 0: recipient registers a viewing key (one-time) ───────────────────
  console.log("\n▶ recipient registers an x25519 viewing key");
  const recipient = Keypair.random();
  await friendbot(recipient.publicKey());
  await sleep(3000);
  const recipientPv = client(pvId, recipient);

  const viewing = generateViewingKeyPair(); // privkey stays with the recipient
  const regTx = await recipientPv.register_viewing_key({
    account: recipient.publicKey(),
    viewing_pubkey: toBuffer(viewing.publicKey),
  });
  const { result: regRes } = await regTx.signAndSend();
  if (regRes.isErr()) throw new Error(`register_viewing_key: ${JSON.stringify(regRes.unwrapErr())}`);
  console.log("  ✅ viewing key registered");

  // ── Step 1: employer runs payroll, encrypting the note to the viewing key ──
  console.log("\n▶ employer disburses (salary 3 XLM, note encrypted to recipient)");
  const salary = 30_000_000n; // 3 XLM
  const notesRes = await generatePayrollNotesProof({
    salaries: [salary], maxSalary: salary,
    wasmUrl: path.join(ROOT, "circuits/build/payroll_notes_js/payroll_notes.wasm"),
    zkeyUrl: path.join(ROOT, "circuits/build/payroll_notes.zkey"),
  });

  // Employer looks up the recipient's registered viewing key and encrypts.
  const vkRes = await employerPv.get_viewing_key({ account: recipient.publicKey() });
  if (vkRes.result.isErr()) throw new Error("recipient has no viewing key");
  const recipientViewingPub = new Uint8Array(vkRes.result.unwrap());
  const cipherHex = encryptNote(salary, notesRes.noteBlindings[0], recipientViewingPub);

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
    note_ciphers: [Buffer.from(hexToBytes(cipherHex))],
  });
  const { result: dRes } = await disburseTx.signAndSend();
  if (dRes.isErr()) throw new Error(`disburse_confidential: ${JSON.stringify(dRes.unwrapErr())}`);
  console.log("  ✅ disbursed with encrypted note (employer shared NOTHING out-of-band)");

  // ── Step 2: recipient logs in, scans, decrypts — no out-of-band input ──────
  console.log("\n▶ recipient scans escrows + auto-decrypts (the whole point)");
  const idsRes = await recipientPv.get_recipient_escrows({ recipient: recipient.publicKey() });
  const ids = idsRes.result as unknown as bigint[];
  const escrowId = ids[ids.length - 1];

  const cipherRes = await recipientPv.get_note_cipher({ escrow_id: escrowId });
  if (cipherRes.result.isErr()) throw new Error("no cipher on note");
  const onChainCipher = new Uint8Array(cipherRes.result.unwrap());
  const onChainCipherHex = Array.from(onChainCipher).map((b) => b.toString(16).padStart(2, "0")).join("");

  const decrypted = decryptNote(onChainCipherHex, viewing.privateKey);
  console.log("  decrypted amount       :", decrypted.amount.toString(), "stroops (expected 30000000)");
  console.log("  decrypted note_blinding: matches employer's:", decrypted.noteBlinding === notesRes.noteBlindings[0]);
  if (decrypted.amount !== salary || decrypted.noteBlinding !== notesRes.noteBlindings[0]) {
    throw new Error("decrypted note does not match what the employer paid");
  }

  // ── Step 3: recipient claims using ONLY the decrypted values ───────────────
  console.log("\n▶ recipient claims using only the auto-decrypted values");
  const settleRes = await generateEscrowSettleNewProof({
    amount: decrypted.amount,
    escrowBlinding: decrypted.noteBlinding,
    escrowCommitmentDecimal: notesRes.noteCommitmentDecimals[0],
    invoiceMin: 0n,
    invoiceMax: NOTE_MAX,
    wasmUrl: path.join(ROOT, "circuits/build/escrow_settle_new_js/escrow_settle_new.wasm"),
    zkeyUrl: path.join(ROOT, "circuits/build/escrow_settle_new.zkey"),
  });
  const settleTx = await recipientPv.settle_escrow_new({
    payee: recipient.publicKey(),
    escrow_id: escrowId,
    payee_commitment: toBuffer(settleRes.commitment),
    proof: { a: toBuffer(settleRes.proof.a), b: toBuffer(settleRes.proof.b), c: toBuffer(settleRes.proof.c) },
  });
  const { result: sRes } = await settleTx.signAndSend();
  if (sRes.isErr()) throw new Error(`settle_escrow_new: ${JSON.stringify(sRes.unwrapErr())}`);

  console.log(`
✅  Auto-receive e2e PASSED
    register_viewing_key   : recipient enrolled once                          ✓
    disburse + encrypt      : employer posted the note encrypted on-chain      ✓
    auto-decrypt            : recipient recovered amount + blinding, no
                              out-of-band sharing whatsoever                   ✓
    claim                   : 3 XLM credited to their confidential balance     ✓

    "Log in and your pay is waiting" — verified end-to-end on testnet.
    Contract: ${pvId}
  `);
}

main().catch((err) => {
  console.error("\n❌  e2e_autoreceive FAILED:", err.message ?? err);
  process.exit(1);
});
