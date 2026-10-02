"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWallet } from "@/lib/stellar/wallet";
import { makePayrollClient } from "@/lib/stellar/contract";
import { makeBracketClient } from "@/lib/stellar/bracketContract";
import { generateBracketProof } from "@/lib/zk/bracketProof";
import type { InvoiceEscrow } from "@/lib/bindings/payroll_verifier/src/index";

type Step = "idle" | "loading" | "loaded" | "proving" | "signing" | "submitting" | "done" | "error";

function stroopsInput(xlm: string): bigint {
  const n = parseFloat(xlm);
  if (isNaN(n) || n <= 0) throw new Error(`Invalid XLM amount: ${xlm}`);
  return BigInt(Math.round(n * 10_000_000));
}

export default function EmployeePage() {
  const { address, connect, signTransaction } = useWallet();

  const [escrowId, setEscrowId] = useState("");
  const [mySalary, setMySalary] = useState("");
  const [noteBlinding, setNoteBlinding] = useState("");
  const [bracketLow, setBracketLow] = useState("");
  const [bracketHigh, setBracketHigh] = useState("");

  const [step, setStep] = useState<Step>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [escrow, setEscrow] = useState<InvoiceEscrow | null>(null);

  async function loadEscrow() {
    if (!address) { await connect(); return; }
    setStep("loading");
    setStatusMsg("");
    setEscrow(null);
    try {
      const client = makePayrollClient(address, signTransaction);
      const tx = await client.get_escrow({ escrow_id: BigInt(escrowId) });
      if (tx.result.isErr()) throw new Error("Note / escrow not found");
      const e = tx.result.unwrap();
      if (e.payee !== address) {
        throw new Error("This note belongs to a different address — connect the recipient wallet");
      }
      setEscrow(e);
      setStep("loaded");
    } catch (err: unknown) {
      setStep("error");
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitBracketProof() {
    if (!address || !escrow) return;
    setStatusMsg("");
    try {
      const salary = stroopsInput(mySalary);
      const blinding = BigInt(noteBlinding);
      const low = stroopsInput(bracketLow);
      const high = stroopsInput(bracketHigh);

      if (salary < low || salary > high)
        throw new Error("Salary is outside the declared bracket");

      setStep("proving");
      setStatusMsg("Generating bracket proof in your browser…");

      const proofRes = await generateBracketProof({
        salary,
        noteBlinding: blinding,
        bracketLow: low,
        bracketHigh: high,
      });

      // Local pre-check: the proof's note commitment must match the on-chain note.
      const onChain = BigInt("0x" + Buffer.from(escrow.escrow_commitment).toString("hex")).toString(10);
      if (proofRes.noteCommitmentDecimal !== onChain) {
        throw new Error("Salary + note blinding don't match this note on-chain — check your values");
      }

      setStep("signing");
      setStatusMsg("Proof ready — waiting for wallet signature…");

      const bracketClient = makeBracketClient(address, signTransaction);
      const tx = await bracketClient.prove_bracket({
        employee: address,
        escrow_id: BigInt(escrowId),
        bracket_low: low,
        bracket_high: high,
        proof: {
          a: Buffer.from(proofRes.proof.a),
          b: Buffer.from(proofRes.proof.b),
          c: Buffer.from(proofRes.proof.c),
        },
      });

      setStep("submitting");
      setStatusMsg("Submitting bracket attestation…");

      const { result } = await tx.signAndSend();
      if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));

      setStep("done");
      setStatusMsg("");
      toast.success("Bracket attested on-chain");
    } catch (err: unknown) {
      setStep("error");
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = ["loading", "proving", "signing", "submitting"].includes(step);
  const loaded = ["loaded", "proving", "signing", "submitting", "done"].includes(step);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Salary bracket proof</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Prove your salary falls within a declared range to a third party (bank, landlord)
          without revealing the exact amount. Anchored to the confidential note you were paid
          in — your salary stays private.
        </p>
      </div>

      {/* Step 1 — Load note */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          1. Load your payroll note
        </h2>
        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-sm font-medium">
              Escrow ID{" "}
              <span className="font-normal text-zinc-400">— from your employer when paid</span>
            </label>
            <input
              type="number"
              min="1"
              placeholder="e.g. 1"
              value={escrowId}
              onChange={(e) => { setEscrowId(e.target.value); setStep("idle"); setEscrow(null); }}
              className={inputCls}
            />
          </div>
          <button onClick={loadEscrow} disabled={busy || !escrowId} className={secondaryBtn}>
            {step === "loading" ? "Loading…" : "Load note"}
          </button>
        </div>

        {loaded && escrow && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/[0.03] px-4 py-3 text-xs text-zinc-500 flex flex-col gap-0.5">
            <span>Note #{escrowId} — payer {escrow.payer.slice(0, 8)}…, you are the payee ✓</span>
            <span className="font-mono break-all">
              note commitment: {Buffer.from(escrow.escrow_commitment).toString("hex").slice(0, 20)}…
            </span>
          </div>
        )}
      </section>

      {/* Step 2 — Salary + bracket */}
      {loaded && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            2. Prove a bracket
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">My salary (XLM)</label>
              <input
                type="number" min="0.01" step="0.01" placeholder="private"
                value={mySalary}
                onChange={(e) => setMySalary(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Note blinding</label>
              <input
                type="text" placeholder="from employer (out-of-band)"
                value={noteBlinding}
                onChange={(e) => setNoteBlinding(e.target.value)}
                className={`${inputCls} font-mono text-xs`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Bracket low (XLM)</label>
              <input
                type="number" min="0" step="0.01" placeholder="e.g. 50000"
                value={bracketLow}
                onChange={(e) => setBracketLow(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Bracket high (XLM)</label>
              <input
                type="number" min="0" step="0.01" placeholder="e.g. 100000"
                value={bracketHigh}
                onChange={(e) => setBracketHigh(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {step === "done" ? (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-5">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                Bracket attested on-chain ✓
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
                Your salary in note #{escrowId} has been proven to lie within{" "}
                {bracketLow}–{bracketHigh} XLM. No salary amount was revealed.
              </p>
            </div>
          ) : (
            <button
              onClick={submitBracketProof}
              disabled={busy || !mySalary || !noteBlinding || !bracketLow || !bracketHigh}
              className={primaryBtn}
            >
              {step === "proving" ? "Generating proof…"
                : step === "signing" ? "Sign in wallet…"
                : step === "submitting" ? "Submitting…"
                : "Prove & attest"}
            </button>
          )}
        </section>
      )}

      {step === "error" && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
          <p className="text-sm text-red-700 dark:text-red-300">{statusMsg}</p>
        </div>
      )}

      {busy && ["proving", "signing", "submitting"].includes(step) && (
        <p className="text-sm text-zinc-500 flex items-center gap-2">
          <span className="animate-spin inline-block">⟳</span> {statusMsg}
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] " +
  "px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 " +
  "focus:ring-emerald-500";

const primaryBtn =
  "self-start px-6 py-2.5 rounded-lg bg-zinc-900 dark:bg-zinc-50 text-white " +
  "dark:text-zinc-900 text-sm font-medium hover:bg-emerald-400 " +
  "disabled:opacity-50 transition-colors";

const secondaryBtn =
  "self-start px-5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm " +
  "font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors";
