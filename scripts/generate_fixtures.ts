#!/usr/bin/env tsx
/**
 * Generates pre-computed Groth16 proof fixtures for Rust unit tests.
 *
 * Each fixture is saved to contracts/payroll_verifier/tests/fixtures/<circuit>.json
 * and contains: proof (a/b/c), VK (alpha/beta/gamma/delta/ic), and public
 * signals — all hex-encoded in the ZCash BE byte layout that Soroban expects.
 *
 * The Rust test_proof.rs tests load these fixtures at runtime and call
 * groth16::verify() in the Soroban testutils environment, confirming that a
 * real circuit proof passes the real on-chain verifier logic — without running
 * a 20–40 minute ceremony during CI.
 *
 * Prerequisites (run from payfurt/):
 *   bash scripts/setup_ceremony.sh <name>  for every circuit
 *
 * Usage:
 *   pnpm exec tsx scripts/generate_fixtures.ts
 */

import fs from "fs";
import path from "path";
import { groth16 } from "snarkjs";
import { encodeProof, encodeVerificationKey, frToBytesBE } from "../client/lib/zk/groth16Codec";

const ROOT   = path.resolve(__dirname, "..");
const BUILD  = path.join(ROOT, "circuits/build");
const OUTDIR = path.join(ROOT, "contracts/payroll_verifier/tests/fixtures");

// ── helpers ──────────────────────────────────────────────────────────────────

function toHex(b: Uint8Array): string {
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

function wasm(name: string): string {
  return path.join(BUILD, `${name}_js/${name}.wasm`);
}

function zkey(name: string): string {
  return path.join(BUILD, `${name}.zkey`);
}

function loadVk(name: string) {
  return JSON.parse(fs.readFileSync(path.join(BUILD, `${name}_vk.json`), "utf8"));
}

async function prove(circuit: string, input: Record<string, unknown>) {
  const w = wasm(circuit);
  const z = zkey(circuit);
  if (!fs.existsSync(w) || !fs.existsSync(z)) {
    throw new Error(`Missing ceremony output for ${circuit}. Run: bash scripts/setup_ceremony.sh ${circuit}`);
  }
  return groth16.fullProve(input, w, z);
}

function save(
  circuit: string,
  proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] },
  publicSignals: string[],
  vkJson: object,
) {
  const pb = encodeProof(proof);
  const vb = encodeVerificationKey(vkJson as Parameters<typeof encodeVerificationKey>[0]);

  const fixture = {
    circuit,
    proof_a: toHex(pb.a),
    proof_b: toHex(pb.b),
    proof_c: toHex(pb.c),
    vk_alpha: toHex(vb.alpha),
    vk_beta:  toHex(vb.beta),
    vk_gamma: toHex(vb.gamma),
    vk_delta: toHex(vb.delta),
    vk_ic:    vb.ic.map(toHex),
    public_signals_hex: publicSignals.map(s => toHex(frToBytesBE(BigInt(s)))),
  };

  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(path.join(OUTDIR, `${circuit}.json`), JSON.stringify(fixture, null, 2));
  console.log(`✓ ${circuit}  (${publicSignals.length} public signals)`);
  return fixture;
}

// ── fixed test values (deterministic — never random) ─────────────────────────

const BAL         = 100_000;  // stroops
const BLIND_A     = 1_234_567;
const BLIND_B     = 9_876_543;
const LOCK_BLIND  = 222_222;
const PAYEE_BLIND = 333_333;

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── deposit_new ────────────────────────────────────────────────────
  const { proof: dnP, publicSignals: dnS } = await prove("deposit_new", {
    balance:  String(BAL),
    blinding: String(BLIND_A),
    amount:   String(BAL),
  });
  save("deposit_new", dnP, dnS, loadVk("deposit_new"));
  const commitmentA = dnS[0]; // Poseidon(BAL, BLIND_A)

  // ── deposit_topup ──────────────────────────────────────────────────
  const { proof: tuP, publicSignals: tuS } = await prove("deposit_topup", {
    old_balance:  String(BAL),
    old_blinding: String(BLIND_A),
    new_blinding: String(BLIND_B),
    old_commitment: commitmentA,
    amount:       "50000",
  });
  save("deposit_topup", tuP, tuS, loadVk("deposit_topup"));

  // ── withdraw ───────────────────────────────────────────────────────
  const { proof: wdP, publicSignals: wdS } = await prove("withdraw", {
    old_balance:  String(BAL),
    old_blinding: String(BLIND_A),
    new_blinding: String(BLIND_B),
    old_commitment: commitmentA,
    amount:       "40000",
  });
  save("withdraw", wdP, wdS, loadVk("withdraw"));

  // ── escrow_lock ───────────────────────────────────────────────────
  // Payer locks 30000 out of BAL. Public: old_commitment = commitmentA.
  // sigs[0] = payer_new_commitment, sigs[1] = escrow_commitment, sigs[2] = old_commitment
  const { proof: lockP, publicSignals: lockS } = await prove("escrow_lock", {
    old_balance:      String(BAL),
    old_blinding:     String(BLIND_A),
    amount:           "30000",
    escrow_blinding:  String(LOCK_BLIND),
    new_blinding:     String(BLIND_B),
    old_commitment:   commitmentA,
  });
  save("escrow_lock", lockP, lockS, loadVk("escrow_lock"));
  const escrowCommitment   = lockS[1]; // Poseidon(30000, LOCK_BLIND)
  const payerAfterLockComm = lockS[0]; // Poseidon(70000, BLIND_B)

  // ── escrow_cancel ─────────────────────────────────────────────────
  // Payer reclaims the 30000 they locked.
  const { proof: cancelP, publicSignals: cancelS } = await prove("escrow_cancel", {
    amount:               "30000",
    escrow_blinding:      String(LOCK_BLIND),
    payer_old_balance:    "70000",         // BAL - 30000
    payer_old_blinding:   String(BLIND_B),
    payer_new_blinding:   String(BLIND_B + 1),
    escrow_commitment:    escrowCommitment,
    payer_old_commitment: payerAfterLockComm,
  });
  save("escrow_cancel", cancelP, cancelS, loadVk("escrow_cancel"));

  // ── payee deposit_new (for escrow_settle) ─────────────────────────
  const { publicSignals: payeeDnS } = await prove("deposit_new", {
    balance:  String(BAL),
    blinding: String(PAYEE_BLIND),
    amount:   String(BAL),
  });
  const payeeCommitment = payeeDnS[0]; // Poseidon(BAL, PAYEE_BLIND)

  // ── escrow_settle ─────────────────────────────────────────────────
  // Payee claims the 30000 escrow into their existing confidential balance.
  const { proof: settleP, publicSignals: settleS } = await prove("escrow_settle", {
    amount:              "30000",
    escrow_blinding:     String(LOCK_BLIND),
    payee_old_balance:   String(BAL),
    payee_old_blinding:  String(PAYEE_BLIND),
    payee_new_blinding:  String(PAYEE_BLIND + 1),
    escrow_commitment:   escrowCommitment,
    invoice_min:         "1000",
    invoice_max:         "50000",
    payee_old_commitment: payeeCommitment,
  });
  save("escrow_settle", settleP, settleS, loadVk("escrow_settle"));

  // ── escrow_settle_new ─────────────────────────────────────────────
  // Payee claims the same escrow into a brand-new confidential balance.
  const { proof: snP, publicSignals: snS } = await prove("escrow_settle_new", {
    amount:          "30000",
    escrow_blinding: String(LOCK_BLIND),
    payee_balance:   "30000",        // == amount
    payee_blinding:  String(PAYEE_BLIND),
    escrow_commitment: escrowCommitment,
    invoice_min:     "1000",
    invoice_max:     "50000",
  });
  save("escrow_settle_new", snP, snS, loadVk("escrow_settle_new"));

  // ── payroll_notes ─────────────────────────────────────────────────
  const SALARIES     = [50000, 30000, 20000, 0, 0, 0, 0, 0, 0, 0];
  const NOTE_BLIND   = [111,   222,   333,   0, 0, 0, 0, 0, 0, 0];
  const IS_ACTIVE    = SALARIES.map(s => s > 0 ? 1 : 0);
  const SALT         = 999_999;

  const { proof: pnP, publicSignals: pnS } = await prove("payroll_notes", {
    sal:          SALARIES.map(String),
    salt:         String(SALT),
    is_active:    IS_ACTIVE.map(String),
    note_blinding: NOTE_BLIND.map(String),
    total_budget: "100000",
    max_salary:   "50000",
    active_count: "3",
  });
  save("payroll_notes", pnP, pnS, loadVk("payroll_notes"));
  const payrollCommitment = pnS[0];          // Poseidon(salaries..., salt)
  const noteCommitments   = pnS.slice(1, 11); // note_commitment[0..9]

  // ── minimum_wage ──────────────────────────────────────────────────
  const { proof: mwP, publicSignals: mwS } = await prove("minimum_wage", {
    sal:       SALARIES.map(String),
    salt:      String(SALT),
    is_active: IS_ACTIVE.map(String),
    min_wage:  "10000",
    active_count: "3",
  });
  save("minimum_wage", mwP, mwS, loadVk("minimum_wage"));

  // ── pay_equity ────────────────────────────────────────────────────
  // Group A (0): slots 0 and 2 → avg 35000. Group B (1): slot 1 → avg 30000.
  // |35000 − 30000| = 5000 ≤ epsilon=10000 ✓
  const { proof: peP, publicSignals: peS } = await prove("pay_equity", {
    sal:       SALARIES.map(String),
    salt:      String(SALT),
    is_active: IS_ACTIVE.map(String),
    group:     [0, 1, 0, 0, 0, 0, 0, 0, 0, 0].map(String),
    epsilon:   "10000",
    active_count: "3",
  });
  save("pay_equity", peP, peS, loadVk("pay_equity"));

  // ── income_proof ──────────────────────────────────────────────────
  // 8-slot circuit. Use notes 0 and 1 from payroll: 50000 + 30000 = 80000 >= 60000 ✓
  // Inactive slots pass note_commitment=0; the circuit gates the hash check on is_active[j].
  const ipNotes = [
    noteCommitments[0], noteCommitments[1],
    "0", "0", "0", "0", "0", "0",
  ];
  const { proof: ipP, publicSignals: ipS } = await prove("income_proof", {
    amount:          [50000, 30000, 0, 0, 0, 0, 0, 0].map(String),
    note_blinding:   [111,   222,   0, 0, 0, 0, 0, 0].map(String),
    is_active:       [1,     1,     0, 0, 0, 0, 0, 0].map(String),
    note_commitment: ipNotes,
    threshold:       "60000",
  });
  save("income_proof", ipP, ipS, loadVk("income_proof"));

  // ── salary_bracket ────────────────────────────────────────────────
  // Prove salary=50000 in [40000, 60000]. note_commitment must match payroll slot 0.
  const { proof: sbP, publicSignals: sbS } = await prove("salary_bracket", {
    salary:         "50000",
    note_blinding:  "111",
    bracket_low:    "40000",
    bracket_high:   "60000",
  });
  // The circuit outputs note_commitment = Poseidon(50000, 111).
  // Verify it matches what payroll_notes produced for slot 0.
  if (sbS[0] !== noteCommitments[0]) {
    console.warn(`⚠ salary_bracket note_commitment mismatch: got ${sbS[0]}, expected ${noteCommitments[0]}`);
  }
  save("salary_bracket", sbP, sbS, loadVk("salary_bracket"));

  console.log(`\nAll fixtures written to ${OUTDIR}/`);
  console.log("Commit contracts/payroll_verifier/tests/fixtures/ to include them in the repo.");
  console.log("Run: cargo test -p payroll_verifier proof  to verify.");
}

main().catch(err => { console.error(err); process.exit(1); });
