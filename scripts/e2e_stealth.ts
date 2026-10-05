#!/usr/bin/env tsx
/**
 * Stealth recipients e2e — hides WHO is paid, not just how much.
 *
 * The employer pays each note to a fresh one-time Stellar address and encrypts
 * that address's secret key (with amount + blinding) to the recipient's viewing
 * key. The recipient decrypts, controls the one-time key, and claims — so their
 * real identity never appears on-chain. No contract change: the one-time address
 * is just a normal payee.
 *
 *   on-chain you see: a payment to GFRESH…, claimed by GFRESH…
 *   you do NOT see:   the recipient's real address, anywhere
 *
 * Usage: SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/e2e_stealth.ts
 */
import fs from "fs";
import path from "path";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Client as PayrollClient } from "../client/lib/bindings/payroll_verifier/src/index";
import { generatePayrollNotesProof } from "../client/lib/zk/payrollNotesProof";
import { generateEscrowSettleNewProof } from "../client/lib/zk/escrowProof";
import { generateViewingKeyPair, encryptNote, decryptNote } from "../client/lib/zk/noteCrypto";
import { hexToBytes, bytesToHex } from "../client/lib/zk/viewKey";

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const NOTE_MAX = 18_446_744_073_709_551_615n;
const C = (n: string) => path.join(ROOT, `circuits/build/${n}`);
const buf = (b: Uint8Array) => Buffer.from(b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const signer = (kp: Keypair) => async (xdr: string) => {
  const tx = TransactionBuilder.fromXDR(xdr, NETWORK) as Transaction;
  tx.sign(kp);
  return { signedTxXdr: tx.toEnvelope().toXDR("base64") };
};
const client = (id: string, kp: Keypair) =>
  new PayrollClient({ contractId: id, networkPassphrase: NETWORK, rpcUrl: RPC_URL, publicKey: kp.publicKey(), signTransaction: signer(kp) });
async function friendbot(pk: string) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${pk}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
}

async function main() {
  const deploy = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
  const pvId: string = deploy.payroll_verifier;
  const xlm = deploy.tokens.xlm;
  const employer = Keypair.fromSecret(process.env.SECRET_KEY!);
  const pv = client(pvId, employer);

  // Recipient: real identity is only an off-chain viewing key.
  const recipientViewing = generateViewingKeyPair();
  console.log("contract :", pvId);

  // ── employer: pay to a FRESH one-time address, encrypt its key to the recipient ──
  console.log("\n▶ employer pays 3 XLM to a one-time stealth address");
  const salary = 30_000_000n;
  const notes = await generatePayrollNotesProof({
    salaries: [salary], maxSalary: 10_000_000_000_000_000n,
    wasmUrl: C("payroll_notes_js/payroll_notes.wasm"), zkeyUrl: C("payroll_notes.zkey"),
  });
  const oneTime = Keypair.random(); // the stealth address — only the recipient will learn its key
  const cipher = encryptNote(salary, notes.noteBlindings[0], recipientViewing.publicKey, oneTime.secret());

  const dTx = await pv.disburse_confidential({
    employer: employer.publicKey(),
    proof: { a: buf(notes.proof.a), b: buf(notes.proof.b), c: buf(notes.proof.c) },
    total_budget: notes.totalBudget, max_salary: notes.maxSalary, active_count: notes.activeCount,
    commitment: buf(notes.commitment), token: xlm,
    recipients: [oneTime.publicKey()], // ← stealth address, NOT the recipient's identity
    note_commitments: notes.noteCommitments.map(buf),
    note_ciphers: [Buffer.from(hexToBytes(cipher))],
  });
  const { result: dRes } = await dTx.signAndSend();
  if (dRes.isErr()) throw new Error(`disburse: ${JSON.stringify(dRes.unwrapErr())}`);
  console.log("  ✅ note paid to stealth address:", oneTime.publicKey());

  // ── recipient: scan, decrypt the one-time key, claim — never using their real address ──
  console.log("\n▶ recipient decrypts the note and claims via the one-time key");
  // Reads can be sourced by anyone (employer here) — the stealth account isn't funded yet.
  const idsTx = await pv.get_recipient_escrows({ recipient: oneTime.publicKey() });
  const ids = idsTx.result as unknown as bigint[];
  const escrowId = ids[ids.length - 1];

  const cipherTx = await pv.get_note_cipher({ escrow_id: escrowId });
  if (cipherTx.result.isErr()) throw new Error("no cipher");
  const dec = decryptNote(bytesToHex(new Uint8Array(cipherTx.result.unwrap())), recipientViewing.privateKey);
  if (!dec.oneTimeSecret) throw new Error("no one-time key in cipher");
  const claimed = Keypair.fromSecret(dec.oneTimeSecret);
  if (claimed.publicKey() !== oneTime.publicKey()) throw new Error("decrypted key mismatch");
  console.log("  decrypted one-time key controls:", claimed.publicKey());

  await friendbot(claimed.publicKey()); // fund the stealth address for its tx fee
  await sleep(3000);

  const settle = await generateEscrowSettleNewProof({
    amount: dec.amount, escrowBlinding: dec.noteBlinding,
    escrowCommitmentDecimal: notes.noteCommitmentDecimals[0],
    invoiceMin: 0n, invoiceMax: NOTE_MAX,
    wasmUrl: C("escrow_settle_new_js/escrow_settle_new.wasm"), zkeyUrl: C("escrow_settle_new.zkey"),
  });
  const sTx = await client(pvId, claimed).settle_escrow_new({
    payee: claimed.publicKey(), escrow_id: escrowId,
    payee_commitment: buf(settle.commitment),
    proof: { a: buf(settle.proof.a), b: buf(settle.proof.b), c: buf(settle.proof.c) },
  });
  const { result: sRes } = await sTx.signAndSend();
  if (sRes.isErr()) throw new Error(`settle: ${JSON.stringify(sRes.unwrapErr())}`);

  console.log(`
✅  Stealth recipients e2e PASSED
    paid to    : ${oneTime.publicKey()}  (fresh one-time address)
    claimed by : ${claimed.publicKey()}  (same — recipient controls it)
    The recipient's real address appears NOWHERE on-chain. Only their off-chain
    viewing key let them discover and claim the payment.
  `);
}

main().catch((e) => { console.error("\n❌", e.message ?? e); process.exit(1); });
