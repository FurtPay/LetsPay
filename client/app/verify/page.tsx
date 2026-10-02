"use client";

import { useState } from "react";
import { useWallet } from "@/lib/stellar/wallet";
import { makePayrollClient } from "@/lib/stellar/contract";

export default function VerifyPage() {
  const { address, connect, signTransaction } = useWallet();

  const [escrowId, setEscrowId] = useState("");
  const [noteCommitmentInput, setNoteCommitmentInput] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    matches: boolean;
    onChainHex: string;
    payee: string;
    escrowId: string;
  } | null>(null);
  const [error, setError] = useState("");

  async function verify() {
    if (!address) { await connect(); return; }
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const inputHex = noteCommitmentInput.trim().replace(/^0x/, "");
      if (inputHex.length !== 64) throw new Error("Note commitment must be 32 bytes (64 hex chars)");

      const client = makePayrollClient(address, signTransaction);
      const tx = await client.get_escrow({ escrow_id: BigInt(escrowId) });
      if (tx.result.isErr()) throw new Error("Note / escrow not found");
      const escrow = tx.result.unwrap();

      const onChainHex = Buffer.from(escrow.escrow_commitment).toString("hex");

      setResult({
        matches: onChainHex === inputHex,
        onChainHex,
        payee: escrow.payee,
        escrowId,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify note commitment</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Check whether an employee&apos;s provided note commitment matches an on-chain payroll
          note. Combined with their bracket attestation, this confirms a salary claim without
          revealing the amount.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Escrow / note ID</label>
          <input
            type="number"
            min="1"
            placeholder="e.g. 1"
            value={escrowId}
            onChange={(e) => { setEscrowId(e.target.value); setResult(null); }}
            className={inputCls}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Note commitment (hex)</label>
          <input
            type="text"
            placeholder="64 hex chars"
            value={noteCommitmentInput}
            onChange={(e) => { setNoteCommitmentInput(e.target.value); setResult(null); }}
            className={`${inputCls} font-mono text-xs`}
          />
          <p className="text-xs text-zinc-400">
            Provided by the employee — `Poseidon(salary, note_blinding)`, the note they were paid in.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {result && (
          <div className={`rounded-xl border p-5 flex flex-col gap-2 ${
            result.matches
              ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950"
              : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950"
          }`}>
            <p className={`text-sm font-semibold ${
              result.matches
                ? "text-emerald-800 dark:text-emerald-200"
                : "text-red-700 dark:text-red-300"
            }`}>
              {result.matches
                ? `Note commitment matches escrow #${result.escrowId} ✓`
                : `Note commitment does NOT match escrow #${result.escrowId} ✗`}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              payee: <span className="font-mono">{result.payee.slice(0, 10)}…{result.payee.slice(-6)}</span>
            </p>
            <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 break-all">
              on-chain: {result.onChainHex}
            </p>
          </div>
        )}

        <button
          onClick={verify}
          disabled={loading || !escrowId || !noteCommitmentInput}
          className="self-start px-6 py-2.5 rounded-lg bg-emerald-500 text-[#070b0a] text-sm font-medium hover:bg-emerald-400 disabled:opacity-50 transition-colors"
        >
          {!address ? "Connect wallet to verify" : loading ? "Verifying…" : "Verify"}
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] " +
  "px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 " +
  "focus:ring-emerald-500";
