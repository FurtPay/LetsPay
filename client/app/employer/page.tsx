"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWallet } from "@/lib/stellar/wallet";
import { makePayrollClient } from "@/lib/stellar/contract";
import { generatePayrollNotesProof } from "@/lib/zk/payrollNotesProof";
import { encryptSalaryPayload, hexToBytes } from "@/lib/zk/viewKey";
import { encryptNote } from "@/lib/zk/noteCrypto";
import { savePayrollRecord } from "@/lib/zk/confidentialWallet";
import { XLM_SAC, PAYROLL_CONTRACT_ID, EXPLORER_BASE } from "@/lib/stellar/config";
import { CopyButton } from "@/app/components/CopyButton";
import { ProgressSteps, LoadingSpinner, SuccessBox, ErrorBox, Card, InputField, Button } from "@/app/components/ui";

const TOKEN_ID = XLM_SAC;
const MAX_RECIPIENTS = 10;

interface Row {
  address: string;
  salary: string;
}

interface ClaimInfo {
  address: string;
  amount: string;       // XLM
  escrowId: string;
  noteBlinding: string;
  auto: boolean;        // true = note encrypted to their viewing key (auto-receive)
}

type Step = "idle" | "proving" | "signing" | "submitting" | "done" | "error";

export default function EmployerPage() {
  const { address, connect, signTransaction } = useWallet();
  const [rows, setRows] = useState<Row[]>([{ address: "", salary: "" }]);
  const [step, setStep] = useState<Step>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [claims, setClaims] = useState<ClaimInfo[]>([]);

  // Retained after proof generation for auditor view-key export.
  const [lastSalaries, setLastSalaries] = useState<bigint[]>([]);
  const [lastSalt, setLastSalt] = useState<bigint | null>(null);
  const [lastCommitment, setLastCommitment] = useState<string>("");

  const [auditorPubKey, setAuditorPubKey] = useState("");
  const [encrypting, setEncrypting] = useState(false);
  const [encryptError, setEncryptError] = useState("");

  const addRow = () => {
    if (rows.length < MAX_RECIPIENTS) setRows((r) => [...r, { address: "", salary: "" }]);
  };
  const removeRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i));
  const updateRow = (i: number, field: keyof Row, value: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [field]: value } : row)));

  async function runPayroll() {
    if (!address) { await connect(); return; }

    const valid = rows.filter((r) => r.address.trim() && r.salary.trim());
    if (valid.length === 0) { setStatusMsg("Add at least one recipient"); return; }

    const salaries = valid.map((r) => {
      const xlm = parseFloat(r.salary);
      if (isNaN(xlm) || xlm <= 0) throw new Error(`Invalid salary: ${r.salary}`);
      return BigInt(Math.round(xlm * 10_000_000));
    });

    // ponytail: fixed cap, not the real max — keeps `max_salary` from leaking a
    // salary upper bound on-chain (it's a public input). 10^9 XLM in stroops,
    // safely under the circuit's 64-bit range. Remove the input field too.
    const maxSal = 10_000_000_000_000_000n;

    setStatusMsg("");
    try {
      setStep("proving");
      setStatusMsg("Generating zero-knowledge proof in your browser…");

      const proofRes = await generatePayrollNotesProof({ salaries, maxSalary: maxSal });

      setLastSalaries(salaries);
      setLastSalt(proofRes.salt);
      setLastCommitment(proofRes.commitmentDecimal);

      setStep("signing");
      setStatusMsg("Proof ready — waiting for wallet signature…");

      const client = makePayrollClient(address, signTransaction);
      const recipients = valid.map((r) => r.address.trim());

      // Auto-receive: for each recipient with a registered viewing key, encrypt
      // (amount, note_blinding) to it so they can claim with one click. Empty
      // cipher = out-of-band fallback (recipient hasn't enabled auto-receive).
      setStatusMsg("Encrypting notes for auto-receive…");
      const autoReceive: boolean[] = new Array(recipients.length).fill(false);
      const noteCiphers = await Promise.all(
        recipients.map(async (addr, i) => {
          try {
            const vkTx = await client.get_viewing_key({ account: addr });
            if (vkTx.result.isErr()) return Buffer.alloc(0);
            const viewingPub = new Uint8Array(vkTx.result.unwrap());
            const cipherHex = encryptNote(salaries[i], proofRes.noteBlindings[i], viewingPub);
            autoReceive[i] = true;
            return Buffer.from(hexToBytes(cipherHex));
          } catch {
            return Buffer.alloc(0);
          }
        })
      );

      setStep("submitting");
      setStatusMsg("Submitting confidential payroll…");

      const disburseTx = await client.disburse_confidential({
        employer: address,
        proof: {
          a: Buffer.from(proofRes.proof.a),
          b: Buffer.from(proofRes.proof.b),
          c: Buffer.from(proofRes.proof.c),
        },
        total_budget: proofRes.totalBudget,
        max_salary: proofRes.maxSalary,
        active_count: proofRes.activeCount,
        commitment: Buffer.from(proofRes.commitment),
        token: TOKEN_ID,
        recipients,
        note_commitments: proofRes.noteCommitments.map((n) => Buffer.from(n)),
        note_ciphers: noteCiphers,
      });

      const { result } = await disburseTx.signAndSend();
      if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));

      const newBatchId = result.unwrap().toString();
      setBatchId(newBatchId);

      // Persist the payroll so the employer can later attest min-wage / pay-equity.
      savePayrollRecord({
        employer: address,
        batchId: newBatchId,
        token: TOKEN_ID,
        salaries: salaries.map(String),
        salt: proofRes.salt.toString(),
        commitmentDecimal: proofRes.commitmentDecimal,
        executedAt: new Date().toISOString(),
      });

      // Resolve each recipient's note escrow id so they can claim it.
      const claimInfos: ClaimInfo[] = [];
      for (let i = 0; i < recipients.length; i++) {
        const idsTx = await client.get_recipient_escrows({ recipient: recipients[i] });
        const ids = idsTx.result as unknown as bigint[];
        const escrowId = ids.length > 0 ? ids[ids.length - 1].toString() : "?";
        claimInfos.push({
          address: recipients[i],
          amount: valid[i].salary,
          escrowId,
          noteBlinding: proofRes.noteBlindings[i].toString(),
          auto: autoReceive[i],
        });
      }
      setClaims(claimInfos);

      setStep("done");
      setStatusMsg("");
      toast.success("Confidential payroll executed");
    } catch (err: unknown) {
      setStep("error");
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function exportViewKey() {
    if (!lastSalt || lastSalaries.length === 0) return;
    setEncryptError("");
    setEncrypting(true);
    try {
      const pubKeyBytes = hexToBytes(auditorPubKey.trim());
      if (pubKeyBytes.length !== 32)
        throw new Error("Auditor public key must be 32 bytes (64 hex chars)");

      const packet = await encryptSalaryPayload(
        lastSalaries,
        lastSalt,
        pubKeyBytes,
        {
          batchId: batchId ?? undefined,
          commitment: lastCommitment,
          recipients: claims.map((c) => c.address),
        }
      );

      const json = JSON.stringify(packet, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payfurt-viewkey-batch${batchId ?? "unknown"}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("View-key packet downloaded");
    } catch (err: unknown) {
      setEncryptError(err instanceof Error ? err.message : String(err));
    } finally {
      setEncrypting(false);
    }
  }

  const busy = ["proving", "signing", "submitting"].includes(step);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Run payroll</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enter recipient addresses and salaries. Only the <strong>total</strong> is paid in
          publicly — each individual salary is locked as an opaque note that the recipient
          claims into their confidential <a href="/wallet" className="underline">/wallet</a>.
          No individual amount ever appears on-chain.
        </p>
      </div>

      {/* Recipient rows */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_130px_32px] gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 px-1">
          <span>Recipient address</span>
          <span>Salary (XLM)</span>
          <span />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_130px_32px] gap-2 items-center">
            <input
              type="text"
              placeholder="GABC…"
              value={row.address}
              onChange={(e) => updateRow(i, "address", e.target.value)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-mono placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={row.salary}
              onChange={(e) => updateRow(i, "salary", e.target.value)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              onClick={() => removeRow(i)}
              disabled={rows.length === 1}
              className="text-zinc-400 hover:text-red-500 disabled:opacity-20 text-xl leading-none"
            >
              ×
            </button>
          </div>
        ))}

        {rows.length < MAX_RECIPIENTS && (
          <button
            onClick={addRow}
            className="self-start text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
          >
            + Add recipient
          </button>
        )}
      </div>

      {/* Success */}
      {step === "done" && batchId && (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950">
          <SuccessBox
            message="Confidential payroll executed"
            subtext={`Batch #${batchId} — total paid in, ${claims.length} opaque notes created. Individual salaries never touched the chain.`}
          />
          <a
            href={`${EXPLORER_BASE}/${PAYROLL_CONTRACT_ID}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-600 dark:text-emerald-400 underline mt-2 inline-block"
          >
            View on Stellar Expert →
          </a>

          {/* Per-recipient delivery */}
          <div className="border-t border-emerald-200 dark:border-emerald-800 pt-4 flex flex-col gap-3">
            <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
              Recipient delivery
            </p>
            {claims.map((c, i) => (
              <div key={i} className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-zinc-900 p-3 flex flex-col gap-1.5 text-xs">
                <span className="font-mono text-zinc-500 break-all">{c.address.slice(0, 10)}…{c.address.slice(-6)}</span>
                {c.auto ? (
                  <p className="text-emerald-700 dark:text-emerald-300">
                    ✓ Auto-delivered — encrypted to their viewing key. They&apos;ll see it waiting at{" "}
                    <a href="/wallet" className="underline">/wallet</a> on login. Nothing to share.
                  </p>
                ) : (
                  <>
                    <p className="text-amber-700 dark:text-amber-400">
                      Hasn&apos;t enabled auto-receive — share these so they can claim at{" "}
                      <a href="/wallet" className="underline">/wallet</a> (Contractor tab → claim note):
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 w-24 shrink-0">Escrow ID:</span>
                      <span className="flex-1 font-mono">{c.escrowId}</span>
                      <CopyButton value={c.escrowId} label="Escrow ID" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 w-24 shrink-0">Amount (XLM):</span>
                      <span className="flex-1 font-mono">{c.amount}</span>
                      <CopyButton value={c.amount} label="Amount" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 w-24 shrink-0">Note blinding:</span>
                      <span className="flex-1 font-mono truncate">{c.noteBlinding}</span>
                      <CopyButton value={c.noteBlinding} label="Note blinding" />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Auditor view key export */}
          <div className="border-t border-emerald-200 dark:border-emerald-800 pt-4 flex flex-col gap-3">
            <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
              Export view key for auditor (optional)
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              Encrypts the full salary list to an auditor&apos;s public key so they can verify it
              against the on-chain commitment. Generate a key pair at{" "}
              <a href="/auditor" className="underline">/auditor</a>.
            </p>
            <InputField
              type="text"
              placeholder="Auditor public key (64 hex chars)"
              value={auditorPubKey}
              onChange={(e) => setAuditorPubKey(e.target.value)}
              error={encryptError}
              className="text-xs font-mono"
            />
            <Button
              variant="secondary"
              onClick={exportViewKey}
              disabled={encrypting || !auditorPubKey}
              loading={encrypting}
              className="self-start text-xs"
            >
              {encrypting ? "Encrypting…" : "Encrypt & download packet"}
            </Button>
          </div>
        </Card>
      )}

      {busy && (
        <>
          <ProgressSteps steps={["Generate proof", "Sign transaction", "Submit to chain"]} currentStep={step === "proving" ? 0 : step === "signing" ? 1 : 2} />
          <LoadingSpinner text={statusMsg} />
        </>
      )}

      {step === "error" && (
        <ErrorBox
          message={statusMsg}
          onRetry={() => setStep("idle")}
          onDismiss={() => setStep("idle")}
        />
      )}

      {step === "idle" && statusMsg && (
        <ErrorBox message={statusMsg} onDismiss={() => setStatusMsg("")} />
      )}

      <Button
        onClick={runPayroll}
        disabled={busy}
        loading={busy}
      >
        {!address
          ? "Connect wallet to continue"
          : "Run confidential payroll"}
      </Button>
    </div>
  );
}
