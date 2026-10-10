"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useWallet } from "@/lib/stellar/wallet";
import { makePayrollClient } from "@/lib/stellar/contract";
import { makeBracketClient } from "@/lib/stellar/bracketContract";
import {
  generateMinWageProof,
  generatePayEquityProof,
  generateIncomeProof,
} from "@/lib/zk/attestationProof";
import { loadPayrollRecords, type PayrollRecord } from "@/lib/zk/confidentialWallet";
import { LoadingSpinner, ErrorBox, SuccessBox, Card, InputField, Button } from "@/app/components/ui";

function stroopsToXlm(s: bigint): string {
  return (Number(s) / 10_000_000).toFixed(7).replace(/\.?0+$/, "");
}
function xlmToStroops(xlm: string): bigint {
  return BigInt(Math.round(parseFloat(xlm) * 10_000_000));
}

type Step = "idle" | "proving" | "signing" | "done" | "error";

export default function AttestPage() {
  const { address, connect, signTransaction } = useWallet();
  const [tab, setTab] = useState<"employer" | "employee">("employer");

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payroll attestations</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Prove facts about hidden salaries — minimum-wage compliance, pay equity, and income —
          verified on-chain, with no individual amount ever revealed.
        </p>
      </div>

      <div className="flex gap-1 border border-zinc-200 dark:border-zinc-800 rounded-lg p-1 w-fit">
        {(["employer", "employee"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t ? "bg-emerald-500 text-[#070b0a]"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
            }`}
          >
            {t === "employer" ? "Employer — compliance" : "Employee — income"}
          </button>
        ))}
      </div>

      {!address ? (
        <button onClick={connect} className={primaryBtn}>Connect wallet to continue</button>
      ) : tab === "employer" ? (
        <EmployerAttestations address={address} signTransaction={signTransaction} />
      ) : (
        <IncomeProof address={address} signTransaction={signTransaction} />
      )}
    </div>
  );
}

// ── Employer: minimum wage + pay equity ──────────────────────────────────────

function EmployerAttestations({ address, signTransaction }: {
  address: string;
  signTransaction: (xdr: string) => Promise<string>;
}) {
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [batchId, setBatchId] = useState("");
  const [minWage, setMinWage] = useState("");
  const [epsilon, setEpsilon] = useState("");
  const [groups, setGroups] = useState<number[]>([]);
  const [step, setStep] = useState<Step>("idle");
  const [kind, setKind] = useState<"min" | "equity" | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const recs = loadPayrollRecords(address);
    setRecords(recs);
    if (recs.length > 0) selectBatch(recs[recs.length - 1].batchId, recs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const record = records.find((r) => r.batchId === batchId) ?? null;

  function selectBatch(id: string, recs = records) {
    setBatchId(id);
    const r = recs.find((x) => x.batchId === id);
    setGroups(r ? r.salaries.map((_, i) => (i < Math.floor(r.salaries.length / 2) ? 0 : 1)) : []);
  }

  async function attestMinWage() {
    if (!record) return;
    setKind("min"); setMsg("");
    try {
      setStep("proving"); setMsg("Generating proof in your browser…");
      const proofRes = await generateMinWageProof({
        salaries: record.salaries.map(BigInt),
        salt: BigInt(record.salt),
        minWage: xlmToStroops(minWage),
      });
      setStep("signing"); setMsg("Submitting on-chain attestation…");
      const client = makeBracketClient(address, signTransaction);
      const tx = await client.prove_min_wage({ attester: address,
        batch_id: BigInt(batchId), min_wage: xlmToStroops(minWage),
        proof: { a: Buffer.from(proofRes.proof.a), b: Buffer.from(proofRes.proof.b), c: Buffer.from(proofRes.proof.c) },
      });
      const { result } = await tx.signAndSend();
      if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));
      setStep("done"); setMsg("");
      toast.success(`Attested: every salary in batch #${batchId} ≥ ${minWage} XLM`);
    } catch (err: unknown) {
      setStep("error"); setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function attestPayEquity() {
    if (!record) return;
    setKind("equity"); setMsg("");
    try {
      setStep("proving"); setMsg("Generating proof in your browser…");
      const proofRes = await generatePayEquityProof({
        salaries: record.salaries.map(BigInt),
        groups,
        salt: BigInt(record.salt),
        epsilon: xlmToStroops(epsilon),
      });
      setStep("signing"); setMsg("Submitting on-chain attestation…");
      const client = makeBracketClient(address, signTransaction);
      const tx = await client.prove_pay_equity({ attester: address,
        batch_id: BigInt(batchId), epsilon: xlmToStroops(epsilon),
        proof: { a: Buffer.from(proofRes.proof.a), b: Buffer.from(proofRes.proof.b), c: Buffer.from(proofRes.proof.c) },
      });
      const { result } = await tx.signAndSend();
      if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));
      setStep("done"); setMsg("");
      toast.success(`Attested: cohort pay gap ≤ ${epsilon} XLM in batch #${batchId}`);
    } catch (err: unknown) {
      setStep("error"); setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = step === "proving" || step === "signing";

  if (records.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No payrolls on this device yet. Run a confidential payroll at{" "}
        <a href="/employer" className="underline">/employer</a> first — it&apos;s saved here so you can
        attest compliance against it later.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Payroll batch</label>
        <select value={batchId} onChange={(e) => selectBatch(e.target.value)} className={inputCls}>
          {records.map((r) => (
            <option key={r.batchId} value={r.batchId}>
              Batch #{r.batchId} — {r.salaries.length} recipients · {new Date(r.executedAt).toLocaleDateString()}
            </option>
          ))}
        </select>
      </div>

      {record && (
        <p className="text-xs text-zinc-400">
          Your salaries (local only, never on-chain):{" "}
          <span className="font-mono">{record.salaries.map((s) => stroopsToXlm(BigInt(s))).join(", ")} XLM</span>
        </p>
      )}

      {/* Minimum wage */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Minimum / living wage</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Prove <strong>every</strong> salary is at least this floor. No salary is revealed.
        </p>
        <div className="flex gap-2">
          <input type="number" min="0" step="0.01" placeholder="floor (XLM)" value={minWage}
            onChange={(e) => setMinWage(e.target.value)} className={inputCls} />
          <button onClick={attestMinWage} disabled={busy || !minWage} className={primaryBtn}>
            {kind === "min" && step === "proving" ? "Proving…" : kind === "min" && step === "signing" ? "Signing…" : "Attest"}
          </button>
        </div>
      </section>

      {/* Pay equity */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Pay equity</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Assign each salary to cohort A or B, then prove the average pay gap is within ε.
          Neither salaries, averages, nor cohort sizes are revealed.
        </p>
        <div className="flex flex-wrap gap-2">
          {record?.salaries.map((_, i) => (
            <button
              key={i}
              onClick={() => setGroups((g) => g.map((v, j) => (j === i ? (v === 0 ? 1 : 0) : v)))}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                groups[i] === 0
                  ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-300"
                  : "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300"
              }`}
            >
              #{i + 1}: {groups[i] === 0 ? "A" : "B"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input type="number" min="0" step="0.01" placeholder="max gap ε (XLM)" value={epsilon}
            onChange={(e) => setEpsilon(e.target.value)} className={inputCls} />
          <button onClick={attestPayEquity} disabled={busy || !epsilon} className={primaryBtn}>
            {kind === "equity" && step === "proving" ? "Proving…" : kind === "equity" && step === "signing" ? "Signing…" : "Attest"}
          </button>
        </div>
      </section>

      {step === "done" && (
        <SuccessBox
          message="Attestation verified on-chain"
          subtext="The proof passed the BLS12-381 pairing check on Soroban. The transaction is a permanent, public record — with no salary in it."
        />
      )}
      {step === "error" && (
        <ErrorBox
          message={msg}
          onRetry={() => setStep("idle")}
          onDismiss={() => setStep("idle")}
        />
      )}
      {busy && <LoadingSpinner text={msg} />}
    </div>
  );
}

// ── Employee: proof of income over time ──────────────────────────────────────

interface NoteRow { escrowId: string; amount: string; noteBlinding: string; }

function IncomeProof({ address, signTransaction }: {
  address: string;
  signTransaction: (xdr: string) => Promise<string>;
}) {
  const [rows, setRows] = useState<NoteRow[]>([{ escrowId: "", amount: "", noteBlinding: "" }]);
  const [threshold, setThreshold] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [msg, setMsg] = useState("");

  const addRow = () => { if (rows.length < 8) setRows((r) => [...r, { escrowId: "", amount: "", noteBlinding: "" }]); };
  const update = (i: number, k: keyof NoteRow, v: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));

  async function proveIncome() {
    setMsg("");
    try {
      const valid = rows.filter((r) => r.escrowId && r.amount && r.noteBlinding);
      if (valid.length === 0) throw new Error("Add at least one note");

      setStep("proving"); setMsg("Reading notes + generating proof…");
      const payroll = makePayrollClient(address, signTransaction);

      const commitDecimals: string[] = [];
      for (const r of valid) {
        const tx = await payroll.get_escrow({ escrow_id: BigInt(r.escrowId) });
        if (tx.result.isErr()) throw new Error(`Note #${r.escrowId} not found`);
        const e = tx.result.unwrap();
        if (e.payee !== address) throw new Error(`You are not the payee of note #${r.escrowId}`);
        commitDecimals.push(BigInt("0x" + Buffer.from(e.escrow_commitment).toString("hex")).toString(10));
      }

      const proofRes = await generateIncomeProof({
        amounts: valid.map((r) => xlmToStroops(r.amount)),
        noteBlindings: valid.map((r) => BigInt(r.noteBlinding)),
        noteCommitmentDecimals: commitDecimals,
        threshold: xlmToStroops(threshold),
      });

      setStep("signing"); setMsg("Submitting on-chain attestation…");
      const attest = makeBracketClient(address, signTransaction);
      const tx = await attest.prove_income({
        employee: address,
        escrow_ids: valid.map((r) => BigInt(r.escrowId)),
        threshold: xlmToStroops(threshold),
        proof: { a: Buffer.from(proofRes.proof.a), b: Buffer.from(proofRes.proof.b), c: Buffer.from(proofRes.proof.c) },
      });
      const { result } = await tx.signAndSend();
      if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));
      setStep("done"); setMsg("");
      toast.success(`Attested: income ≥ ${threshold} XLM`);
    } catch (err: unknown) {
      setStep("error"); setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = step === "proving" || step === "signing";

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Prove your <strong>cumulative</strong> income across several payroll notes meets a threshold
        (for a loan or visa) — without revealing any individual amount. Enter each note you were paid in.
      </p>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[90px_110px_1fr] gap-2 text-xs font-medium text-zinc-500 px-1">
          <span>Note (escrow) ID</span><span>Amount (XLM)</span><span>Note blinding</span>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[90px_110px_1fr] gap-2">
            <input type="number" placeholder="1" value={row.escrowId}
              onChange={(e) => update(i, "escrowId", e.target.value)} className={inputCls} />
            <input type="number" min="0" step="0.01" placeholder="0.00" value={row.amount}
              onChange={(e) => update(i, "amount", e.target.value)} className={inputCls} />
            <input type="text" placeholder="from your claim / backup" value={row.noteBlinding}
              onChange={(e) => update(i, "noteBlinding", e.target.value)} className={`${inputCls} font-mono text-xs`} />
          </div>
        ))}
        {rows.length < 8 && (
          <button onClick={addRow} className="self-start text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors">
            + Add note
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Income threshold to prove (XLM)</label>
        <input type="number" min="0" step="0.01" placeholder="e.g. 5000" value={threshold}
          onChange={(e) => setThreshold(e.target.value)} className={`${inputCls} w-48`} />
      </div>

      {step === "done" && (
        <SuccessBox
          message="Income proven on-chain"
          subtext="You proved your total income meets the threshold without revealing any individual payment."
        />
      )}
      {step === "error" && (
        <ErrorBox
          message={msg}
          onRetry={() => setStep("idle")}
          onDismiss={() => setStep("idle")}
        />
      )}
      {busy && <LoadingSpinner text={msg} />}

      <button onClick={proveIncome} disabled={busy || !threshold} className={primaryBtn}>
        {step === "proving" ? "Proving…" : step === "signing" ? "Signing…" : "Prove income"}
      </button>
    </div>
  );
}

// ── shared ───────────────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] " +
  "px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500";
const primaryBtn =
  "self-start px-6 py-2.5 rounded-lg bg-emerald-500 text-[#070b0a] " +
  "text-sm font-medium hover:bg-emerald-400 disabled:opacity-50 transition-colors";
