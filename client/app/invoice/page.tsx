"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWallet } from "@/lib/stellar/wallet";
import { makePayrollClient } from "@/lib/stellar/contract";
import {
  generateEscrowLockProof,
  generateEscrowSettleProof,
  generateEscrowSettleNewProof,
} from "@/lib/zk/escrowProof";
import {
  loadWalletRecord,
  saveWalletRecord,
  downloadWalletBackup,
  type ConfidentialWalletRecord,
} from "@/lib/zk/confidentialWallet";
import type { InvoiceEscrow } from "@/lib/bindings/payroll_verifier/src/index";
import { XLM_SAC, USDC_SAC } from "@/lib/stellar/config";
import { CopyButton } from "@/app/components/CopyButton";

const TOKENS: Record<string, string> = {
  XLM: XLM_SAC,
  USDC: USDC_SAC,
};

function xlmToStroops(xlm: string): bigint {
  return BigInt(Math.round(parseFloat(xlm) * 10_000_000));
}

function stroopsToXlm(s: bigint | number): string {
  return (Number(s) / 10_000_000).toFixed(7).replace(/\.?0+$/, "");
}

function sacToSymbol(sac: string): string {
  return Object.entries(TOKENS).find(([, v]) => v === sac)?.[0] ?? sac.slice(0, 8) + "…";
}

type PayerStep = "idle" | "proving" | "signing" | "done" | "error";
type ContractorStep = "idle" | "loading" | "proving" | "signing" | "done" | "error";

export default function InvoicePage() {
  const { address, connect, signTransaction } = useWallet();
  const [tab, setTab] = useState<"payer" | "contractor">("payer");

  // ── Payer state ────────────────────────────────────────────────────────────
  const [payerForm, setPayerForm] = useState({
    payee: "", amount: "", invoiceMin: "", invoiceMax: "", token: "XLM",
  });
  const [payerStep, setPayerStep] = useState<PayerStep>("idle");
  const [payerMsg, setPayerMsg] = useState("");
  const [escrowResult, setEscrowResult] = useState<{
    id: string; amount: string; escrowBlinding: string;
  } | null>(null);

  // ── Contractor state ───────────────────────────────────────────────────────
  const [escrowId, setEscrowId] = useState("");
  const [settleAmount, setSettleAmount] = useState("");
  const [escrowBlindingInput, setEscrowBlindingInput] = useState("");
  const [escrowData, setEscrowData] = useState<InvoiceEscrow | null>(null);
  const [contractorStep, setContractorStep] = useState<ContractorStep>("idle");
  const [contractorMsg, setContractorMsg] = useState("");

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getClient() {
    if (!address) throw new Error("Wallet not connected");
    return makePayrollClient(address, signTransaction);
  }

  // ── Payer: create escrow ───────────────────────────────────────────────────
  async function createEscrow() {
    if (!address) { await connect(); return; }
    setPayerMsg("");
    try {
      const token = TOKENS[payerForm.token];
      const record = loadWalletRecord(address, token);
      if (!record) {
        throw new Error(`No confidential balance for ${payerForm.token} on this device — deposit via /wallet first`);
      }

      const amount = xlmToStroops(payerForm.amount);
      const min = xlmToStroops(payerForm.invoiceMin);
      const max = xlmToStroops(payerForm.invoiceMax);
      if (amount <= 0n) throw new Error("Amount must be > 0");
      if (min > max) throw new Error("Min must be ≤ max");
      if (amount < min || amount > max) throw new Error("Amount must be within [min, max]");
      if (amount > BigInt(record.balance)) throw new Error("Amount exceeds your confidential balance");

      setPayerStep("proving");
      setPayerMsg("Generating zero-knowledge proof in your browser…");

      const lockRes = await generateEscrowLockProof({
        oldBalance: BigInt(record.balance),
        oldBlinding: BigInt(record.blinding),
        oldCommitmentDecimal: record.commitmentDecimal,
        amount,
      });

      setPayerStep("signing");
      setPayerMsg("Proof ready — waiting for wallet signature…");

      const client = getClient();
      const tx = await client.create_escrow({
        payer: address,
        payee: payerForm.payee.trim(),
        token,
        invoice_min: min,
        invoice_max: max,
        new_commitment: Buffer.from(lockRes.newCommitment),
        escrow_commitment: Buffer.from(lockRes.escrowCommitment),
        proof: {
          a: Buffer.from(lockRes.proof.a),
          b: Buffer.from(lockRes.proof.b),
          c: Buffer.from(lockRes.proof.c),
        },
      });
      const { result } = await tx.signAndSend();
      if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));

      const newRecord: ConfidentialWalletRecord = {
        account: address,
        token,
        balance: lockRes.newBalance.toString(),
        blinding: lockRes.newBlinding.toString(),
        commitmentDecimal: lockRes.newCommitmentDecimal,
        updatedAt: new Date().toISOString(),
      };
      saveWalletRecord(newRecord);
      downloadWalletBackup(newRecord);
      toast.success("Escrow created — wallet backup downloaded");

      const id = result.unwrap().toString();
      setEscrowResult({
        id,
        amount: payerForm.amount,
        escrowBlinding: lockRes.escrowBlinding.toString(),
      });
      setPayerStep("done");
      setPayerMsg("");
    } catch (err: unknown) {
      setPayerStep("error");
      setPayerMsg(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Contractor: load escrow ────────────────────────────────────────────────
  async function loadEscrow() {
    if (!escrowId) return;
    setContractorStep("loading");
    setContractorMsg("Loading escrow…");
    setEscrowData(null);
    try {
      const client = makePayrollClient(
        address ?? "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        async () => { throw new Error("unreachable"); }
      );
      const tx = await client.get_escrow({ escrow_id: BigInt(escrowId) });
      const res = tx.result;
      if (res.isErr()) throw new Error(JSON.stringify(res.unwrapErr()));
      setEscrowData(res.unwrap());
      setContractorStep("idle");
      setContractorMsg("");
    } catch (err: unknown) {
      setContractorStep("error");
      setContractorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Contractor: settle escrow ──────────────────────────────────────────────
  async function settleEscrow() {
    if (!address) { await connect(); return; }
    if (!escrowData) return;
    setContractorMsg("");
    try {
      const amount = xlmToStroops(settleAmount);
      const escrowBlinding = BigInt(escrowBlindingInput);
      const escrowCommitmentDecimal = BigInt(
        "0x" + Buffer.from(escrowData.escrow_commitment).toString("hex")
      ).toString(10);
      const invoiceMin = BigInt(escrowData.invoice_min);
      const invoiceMax = BigInt(escrowData.invoice_max);

      setContractorStep("proving");
      setContractorMsg("Generating zero-knowledge proof in your browser…");

      const client = getClient();
      const record = loadWalletRecord(address, escrowData.token);

      let newRecord: ConfidentialWalletRecord;

      if (!record) {
        const settleRes = await generateEscrowSettleNewProof({
          amount, escrowBlinding, escrowCommitmentDecimal, invoiceMin, invoiceMax,
        });

        setContractorStep("signing");
        setContractorMsg("Proof ready — waiting for wallet signature…");

        const tx = await client.settle_escrow_new({
          payee: address,
          escrow_id: BigInt(escrowId),
          payee_commitment: Buffer.from(settleRes.commitment),
          proof: {
            a: Buffer.from(settleRes.proof.a),
            b: Buffer.from(settleRes.proof.b),
            c: Buffer.from(settleRes.proof.c),
          },
        });
        const { result } = await tx.signAndSend();
        if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));

        newRecord = {
          account: address,
          token: escrowData.token,
          balance: settleRes.balance.toString(),
          blinding: settleRes.blinding.toString(),
          commitmentDecimal: settleRes.commitmentDecimal,
          updatedAt: new Date().toISOString(),
        };
      } else {
        const settleRes = await generateEscrowSettleProof({
          amount, escrowBlinding, escrowCommitmentDecimal, invoiceMin, invoiceMax,
          payeeOldBalance: BigInt(record.balance),
          payeeOldBlinding: BigInt(record.blinding),
          payeeOldCommitmentDecimal: record.commitmentDecimal,
        });

        setContractorStep("signing");
        setContractorMsg("Proof ready — waiting for wallet signature…");

        const tx = await client.settle_escrow({
          payee: address,
          escrow_id: BigInt(escrowId),
          new_commitment: Buffer.from(settleRes.newCommitment),
          proof: {
            a: Buffer.from(settleRes.proof.a),
            b: Buffer.from(settleRes.proof.b),
            c: Buffer.from(settleRes.proof.c),
          },
        });
        const { result } = await tx.signAndSend();
        if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));

        newRecord = {
          account: address,
          token: escrowData.token,
          balance: settleRes.newBalance.toString(),
          blinding: settleRes.newBlinding.toString(),
          commitmentDecimal: settleRes.newCommitmentDecimal,
          updatedAt: new Date().toISOString(),
        };
      }

      saveWalletRecord(newRecord);
      downloadWalletBackup(newRecord);
      toast.success("Escrow settled — wallet backup downloaded");

      setContractorStep("done");
      setContractorMsg("");
    } catch (err: unknown) {
      setContractorStep("error");
      setContractorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const payerBusy = ["proving", "signing"].includes(payerStep);
  const contractorBusy = ["loading", "proving", "signing"].includes(contractorStep);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invoice escrow</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Payer locks funds from their confidential balance; contractor proves the invoice is
          within the agreed range and is credited confidentially. The amount never appears
          on-chain — only deposits and withdrawals at <a href="/wallet" className="underline">/wallet</a> are visible.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border border-zinc-200 dark:border-zinc-800 rounded-lg p-1 w-fit">
        {(["payer", "contractor"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t
                ? "bg-emerald-500 text-[#070b0a]"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
            }`}
          >
            {t === "payer" ? "Payer — create escrow" : "Contractor — settle"}
          </button>
        ))}
      </div>

      {/* ── PAYER TAB ─────────────────────────────────────────────────────── */}
      {tab === "payer" && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Field label="Payee address (contractor)">
              <input
                type="text" placeholder="GABC…"
                value={payerForm.payee}
                onChange={(e) => setPayerForm({ ...payerForm, payee: e.target.value })}
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount to lock">
                <AmountInput
                  value={payerForm.amount}
                  onChange={(v) => setPayerForm({ ...payerForm, amount: v })}
                />
              </Field>
              <Field label="Token">
                <select
                  value={payerForm.token}
                  onChange={(e) => setPayerForm({ ...payerForm, token: e.target.value })}
                  className={inputCls}
                >
                  {Object.keys(TOKENS).map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice min">
                <AmountInput
                  value={payerForm.invoiceMin}
                  onChange={(v) => setPayerForm({ ...payerForm, invoiceMin: v })}
                />
              </Field>
              <Field label="Invoice max">
                <AmountInput
                  value={payerForm.invoiceMax}
                  onChange={(v) => setPayerForm({ ...payerForm, invoiceMax: v })}
                />
              </Field>
            </div>
            <p className="text-xs text-zinc-400">
              Requires an existing confidential balance for the selected token — deposit at{" "}
              <a href="/wallet" className="underline">/wallet</a> first if you haven&apos;t.
            </p>
          </div>

          {payerStep === "done" && escrowResult && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-5 flex flex-col gap-3">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                Escrow #{escrowResult.id} created ✓
              </p>
              <div className="flex flex-col gap-1">
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  Share all three values with the contractor (out-of-band — none of this is on-chain):
                </p>
                <CopyField label="Escrow ID" value={escrowResult.id} />
                <CopyField label="Amount (XLM)" value={escrowResult.amount} mono />
                <CopyField label="Escrow blinding (secret)" value={escrowResult.escrowBlinding} mono />
              </div>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                The contractor enters these in the &quot;Contractor — settle&quot; tab to claim funds confidentially.
              </p>
            </div>
          )}

          {payerStep === "error" && (
            <ErrorBox msg={payerMsg} />
          )}
          {payerBusy && <Spinner msg={payerMsg} />}

          <button
            onClick={createEscrow}
            disabled={payerBusy}
            className={primaryBtn}
          >
            {!address ? "Connect wallet to continue"
              : payerStep === "proving" ? "Generating proof…"
              : payerStep === "signing" ? "Sign in wallet…"
              : "Lock funds in escrow"}
          </button>
        </div>
      )}

      {/* ── CONTRACTOR TAB ────────────────────────────────────────────────── */}
      {tab === "contractor" && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Field label="Escrow ID (from payer)">
                  <input
                    type="text" placeholder="1"
                    value={escrowId}
                    onChange={(e) => setEscrowId(e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </div>
              <button
                onClick={loadEscrow}
                disabled={!escrowId || contractorBusy}
                className="mb-0 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors"
              >
                Load
              </button>
            </div>

            {escrowData && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-2 text-sm">
                <p className="font-medium">Escrow details</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <span className="text-zinc-400">Agreed range</span>
                  <span className="font-mono">
                    [{stroopsToXlm(escrowData.invoice_min)},&nbsp;
                     {stroopsToXlm(escrowData.invoice_max)}] {sacToSymbol(escrowData.token)}
                  </span>
                  <span className="text-zinc-400">Payer</span>
                  <span className="font-mono break-all">{escrowData.payer.slice(0, 8)}…</span>
                  <span className="text-zinc-400">Settled</span>
                  <span>{escrowData.settled ? "Yes" : "No"}</span>
                </div>
              </div>
            )}

            <Field label="Amount (from payer, out-of-band)">
              <AmountInput value={settleAmount} onChange={setSettleAmount} />
            </Field>
            <Field label="Escrow blinding (from payer, out-of-band)">
              <input
                type="text" placeholder="12345…"
                value={escrowBlindingInput}
                onChange={(e) => setEscrowBlindingInput(e.target.value)}
                className={`${inputCls} font-mono text-xs`}
              />
            </Field>
          </div>

          {contractorStep === "done" && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-5">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                Escrow settled ✓
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
                Your confidential balance has been credited. View or withdraw it at{" "}
                <a href="/wallet" className="underline">/wallet</a>.
              </p>
            </div>
          )}

          {contractorStep === "error" && <ErrorBox msg={contractorMsg} />}
          {contractorBusy && <Spinner msg={contractorMsg} />}

          <button
            onClick={settleEscrow}
            disabled={contractorBusy || !escrowData || escrowData.settled || !settleAmount || !escrowBlindingInput}
            className={primaryBtn}
          >
            {!address ? "Connect wallet to continue"
              : escrowData?.settled ? "Already settled"
              : contractorStep === "proving" ? "Generating proof…"
              : contractorStep === "signing" ? "Sign in wallet…"
              : "Settle escrow"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── shared components ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function AmountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        type="number" min="0" step="0.0000001" placeholder="0.00"
        value={value} onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">
        XLM
      </span>
    </div>
  );
}

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-zinc-500 w-36 shrink-0">{label}:</span>
      <span className={`flex-1 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
      <CopyButton value={value} label={label} />
    </div>
  );
}

function Spinner({ msg }: { msg: string }) {
  return (
    <p className="text-sm text-zinc-500 flex items-center gap-2">
      <span className="animate-spin inline-block">⟳</span> {msg}
    </p>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
      <p className="text-sm text-red-700 dark:text-red-300">{msg}</p>
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
