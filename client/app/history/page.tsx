"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/stellar/wallet";
import { makePayrollClient } from "@/lib/stellar/contract";
import { EXPLORER_BASE, PAYROLL_CONTRACT_ID } from "@/lib/stellar/config";
import { CopyButton } from "@/app/components/CopyButton";
import type { PayrollBatch } from "@/lib/bindings/payroll_verifier/src/index";

const EXPLORER = `${EXPLORER_BASE}/${PAYROLL_CONTRACT_ID}`;

function stroopsToXlm(stroops: bigint | number): string {
  return (Number(stroops) / 10_000_000).toFixed(7).replace(/\.?0+$/, "");
}

function formatDate(unixSecs: bigint | number): string {
  return new Date(Number(unixSecs) * 1000).toLocaleString();
}

export default function HistoryPage() {
  const { address, connect, signTransaction } = useWallet();
  const [batches, setBatches] = useState<{ id: bigint; batch: PayrollBatch }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setError(null);

    const client = makePayrollClient(address, signTransaction);

    client
      .get_employer_history({ employer: address })
      .then(async (tx) => {
        const ids: bigint[] = tx.result as unknown as bigint[];
        if (ids.length === 0) { setBatches([]); return; }

        const results = await Promise.all(
          ids.map(async (id) => {
            const batchTx = await client.get_batch({ batch_id: id });
            const res = batchTx.result;
            if (res.isErr()) return null;
            return { id, batch: res.unwrap() };
          })
        );

        setBatches(
          results
            .filter((r): r is { id: bigint; batch: PayrollBatch } => r !== null)
            .reverse() // newest first
        );
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setLoading(false));
  }, [address, signTransaction]);

  if (!address) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 flex flex-col items-center gap-4 text-center">
        <p className="text-zinc-500 dark:text-zinc-400">
          Connect your wallet to view your payroll history.
        </p>
        <button
          onClick={connect}
          className="px-5 py-2.5 rounded-lg bg-emerald-500 text-[#070b0a] text-sm font-medium hover:bg-emerald-400 transition-colors"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payroll history</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 font-mono">
          {address.slice(0, 6)}…{address.slice(-4)}
        </p>
      </div>

      {loading && (
        <p className="text-sm text-zinc-500 flex items-center gap-2">
          <span className="animate-spin inline-block">⟳</span> Loading batches…
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {!loading && !error && batches.length === 0 && (
        <p className="text-sm text-zinc-500">No payroll batches found for this address.</p>
      )}

      {batches.length > 0 && (
        <div className="flex flex-col gap-4">
          {batches.map(({ id, batch }) => (
            <div
              key={id.toString()}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-zinc-400">Batch #{id.toString()}</span>
                  <span className="text-sm font-medium">{formatDate(batch.executed_at)}</span>
                </div>
                <a
                  href={EXPLORER}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors shrink-0"
                >
                  Explorer →
                </a>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-zinc-400">Total paid</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {stroopsToXlm(batch.total_budget)} XLM
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-zinc-400">Recipients</span>
                  <span className="text-sm font-semibold tabular-nums">{batch.headcount}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-zinc-400">Commitment</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400 break-all">
                      {Buffer.from(batch.commitment).toString("hex").slice(0, 12)}…
                    </span>
                    <CopyButton
                      value={BigInt("0x" + Buffer.from(batch.commitment).toString("hex")).toString(10)}
                      label="Commitment"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
