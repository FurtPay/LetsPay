"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useWallet } from "@/lib/stellar/wallet";
import { makePayrollClient } from "@/lib/stellar/contract";
import { XLM_SAC, USDC_SAC } from "@/lib/stellar/config";
import {
  generateDepositNewProof,
  generateDepositTopupProof,
} from "@/lib/zk/depositProof";
import { generateWithdrawProof } from "@/lib/zk/withdrawProof";
import { generateEscrowSettleProof, generateEscrowSettleNewProof } from "@/lib/zk/escrowProof";
import {
  loadWalletRecord,
  saveWalletRecord,
  downloadWalletBackup,
  parseWalletBackupFile,
  loadViewingKey,
  saveViewingKey,
  downloadViewingKeyBackup,
  type ConfidentialWalletRecord,
  type ViewingKeyRecord,
} from "@/lib/zk/confidentialWallet";
import { generateViewingKeyPair, decryptNote } from "@/lib/zk/noteCrypto";
import { bytesToHex, hexToBytes } from "@/lib/zk/viewKey";
import { LoadingSpinner, EmptyState, ErrorBox, SuccessBox, Card, InputField, Button } from "@/app/components/ui";
import { Wallet as WalletIcon } from "lucide-react";

const TOKENS: Record<string, string> = { XLM: XLM_SAC, USDC: USDC_SAC };

function symbolFor(token: string): string {
  return Object.entries(TOKENS).find(([, v]) => v === token)?.[0] ?? token.slice(0, 6) + "…";
}

function stroopsToXlm(s: bigint): string {
  return (Number(s) / 10_000_000).toFixed(7).replace(/\.?0+$/, "");
}

function xlmToStroops(xlm: string): bigint {
  return BigInt(Math.round(parseFloat(xlm) * 10_000_000));
}

interface PendingNote {
  escrowId: bigint;
  token: string;
  tokenSymbol: string;
  amount: bigint;
  noteBlinding: bigint;
  escrowCommitmentDecimal: string;
  invoiceMin: bigint;
  invoiceMax: bigint;
  payer: string;
}

type Step = "idle" | "proving" | "signing" | "submitting" | "done" | "error";

export default function WalletPage() {
  const { address, connect, signTransaction } = useWallet();
  const [tokenSymbol, setTokenSymbol] = useState("XLM");
  const token = TOKENS[tokenSymbol];

  const [record, setRecord] = useState<ConfidentialWalletRecord | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [statusMsg, setStatusMsg] = useState("");

  const [viewingKey, setViewingKey] = useState<ViewingKeyRecord | null>(null);
  const [pending, setPending] = useState<PendingNote[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!address) { setRecord(null); return; }
    setRecord(loadWalletRecord(address, token));
  }, [address, token]);

  function getClient() {
    if (!address) throw new Error("Wallet not connected");
    return makePayrollClient(address, signTransaction);
  }

  // Load viewing key + scan for encrypted notes whenever the wallet changes.
  useEffect(() => {
    if (!address) { setViewingKey(null); setPending([]); return; }
    const vk = loadViewingKey(address);
    setViewingKey(vk);
    if (vk) scanPending(vk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function scanPending(vk: ViewingKeyRecord) {
    if (!address) return;
    setScanning(true);
    try {
      const client = getClient();
      const idsTx = await client.get_recipient_escrows({ recipient: address });
      const ids = idsTx.result as unknown as bigint[];
      const viewingPriv = hexToBytes(vk.privateKeyHex);
      const found: PendingNote[] = [];
      for (const id of ids) {
        const esTx = await client.get_escrow({ escrow_id: id });
        if (esTx.result.isErr()) continue;
        const es = esTx.result.unwrap();
        if (es.settled) continue;
        const cipherTx = await client.get_note_cipher({ escrow_id: id });
        if (cipherTx.result.isErr()) continue; // no cipher → out-of-band note
        const cipherHex = bytesToHex(new Uint8Array(cipherTx.result.unwrap()));
        try {
          const { amount, noteBlinding } = decryptNote(cipherHex, viewingPriv);
          found.push({
            escrowId: id,
            token: es.token,
            tokenSymbol: symbolFor(es.token),
            amount,
            noteBlinding,
            escrowCommitmentDecimal: BigInt("0x" + Buffer.from(es.escrow_commitment).toString("hex")).toString(10),
            invoiceMin: BigInt(es.invoice_min),
            invoiceMax: BigInt(es.invoice_max),
            payer: es.payer,
          });
        } catch { /* not decryptable with our key — skip */ }
      }
      setPending(found);
    } catch {
      /* scan is best-effort */
    } finally {
      setScanning(false);
    }
  }

  async function enableAutoReceive() {
    if (!address) { await connect(); return; }
    try {
      const kp = generateViewingKeyPair();
      const rec: ViewingKeyRecord = {
        account: address,
        privateKeyHex: bytesToHex(kp.privateKey),
        publicKeyHex: bytesToHex(kp.publicKey),
      };
      const client = getClient();
      const tx = await client.register_viewing_key({
        account: address,
        viewing_pubkey: Buffer.from(kp.publicKey),
      });
      const { result } = await tx.signAndSend();
      if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));
      saveViewingKey(rec);
      downloadViewingKeyBackup(rec);
      setViewingKey(rec);
      toast.success("Auto-receive enabled — viewing key backed up");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function claimNote(note: PendingNote) {
    if (!address) return;
    setStatusMsg("");
    try {
      setStep("proving");
      setStatusMsg("Claiming your pay — generating proof…");
      const client = getClient();
      const existing = loadWalletRecord(address, note.token);
      let newRecord: ConfidentialWalletRecord;

      if (!existing) {
        const res = await generateEscrowSettleNewProof({
          amount: note.amount, escrowBlinding: note.noteBlinding,
          escrowCommitmentDecimal: note.escrowCommitmentDecimal,
          invoiceMin: note.invoiceMin, invoiceMax: note.invoiceMax,
        });
        setStep("signing");
        setStatusMsg("Proof ready — waiting for wallet signature…");
        const tx = await client.settle_escrow_new({
          payee: address, escrow_id: note.escrowId,
          payee_commitment: Buffer.from(res.commitment),
          proof: { a: Buffer.from(res.proof.a), b: Buffer.from(res.proof.b), c: Buffer.from(res.proof.c) },
        });
        const { result } = await tx.signAndSend();
        if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));
        newRecord = {
          account: address, token: note.token,
          balance: res.balance.toString(), blinding: res.blinding.toString(),
          commitmentDecimal: res.commitmentDecimal, updatedAt: new Date().toISOString(),
        };
      } else {
        const res = await generateEscrowSettleProof({
          amount: note.amount, escrowBlinding: note.noteBlinding,
          escrowCommitmentDecimal: note.escrowCommitmentDecimal,
          invoiceMin: note.invoiceMin, invoiceMax: note.invoiceMax,
          payeeOldBalance: BigInt(existing.balance),
          payeeOldBlinding: BigInt(existing.blinding),
          payeeOldCommitmentDecimal: existing.commitmentDecimal,
        });
        setStep("signing");
        setStatusMsg("Proof ready — waiting for wallet signature…");
        const tx = await client.settle_escrow({
          payee: address, escrow_id: note.escrowId,
          new_commitment: Buffer.from(res.newCommitment),
          proof: { a: Buffer.from(res.proof.a), b: Buffer.from(res.proof.b), c: Buffer.from(res.proof.c) },
        });
        const { result } = await tx.signAndSend();
        if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));
        newRecord = {
          account: address, token: note.token,
          balance: res.newBalance.toString(), blinding: res.newBlinding.toString(),
          commitmentDecimal: res.newCommitmentDecimal, updatedAt: new Date().toISOString(),
        };
      }

      saveWalletRecord(newRecord);
      downloadWalletBackup(newRecord);
      if (note.token === token) setRecord(newRecord);
      setPending((p) => p.filter((n) => n.escrowId !== note.escrowId));
      setStep("idle");
      setStatusMsg("");
      toast.success(`Claimed ${stroopsToXlm(note.amount)} ${note.tokenSymbol}`);
    } catch (err: unknown) {
      setStep("error");
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function deposit() {
    if (!address) { await connect(); return; }
    setStatusMsg("");
    try {
      const amount = xlmToStroops(depositAmount);
      if (amount <= 0n) throw new Error("Amount must be > 0");

      setStep("proving");
      setStatusMsg("Generating zero-knowledge proof in your browser…");

      const client = getClient();
      let newRecord: ConfidentialWalletRecord;

      if (!record) {
        const proofRes = await generateDepositNewProof({ amount });
        setStep("signing");
        setStatusMsg("Proof ready — waiting for wallet signature…");

        const tx = await client.deposit_new({
          account: address,
          token,
          amount,
          commitment: Buffer.from(proofRes.commitment),
          proof: {
            a: Buffer.from(proofRes.proof.a),
            b: Buffer.from(proofRes.proof.b),
            c: Buffer.from(proofRes.proof.c),
          },
        });
        setStep("submitting");
        setStatusMsg("Submitting deposit…");
        const { result } = await tx.signAndSend();
        if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));

        newRecord = {
          account: address,
          token,
          balance: proofRes.balance.toString(),
          blinding: proofRes.blinding.toString(),
          commitmentDecimal: proofRes.commitmentDecimal,
          updatedAt: new Date().toISOString(),
        };
      } else {
        const proofRes = await generateDepositTopupProof({
          oldBalance: BigInt(record.balance),
          oldBlinding: BigInt(record.blinding),
          oldCommitmentDecimal: record.commitmentDecimal,
          amount,
        });
        setStep("signing");
        setStatusMsg("Proof ready — waiting for wallet signature…");

        const tx = await client.deposit_topup({
          account: address,
          token,
          amount,
          new_commitment: Buffer.from(proofRes.newCommitment),
          proof: {
            a: Buffer.from(proofRes.proof.a),
            b: Buffer.from(proofRes.proof.b),
            c: Buffer.from(proofRes.proof.c),
          },
        });
        setStep("submitting");
        setStatusMsg("Submitting deposit…");
        const { result } = await tx.signAndSend();
        if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));

        newRecord = {
          account: address,
          token,
          balance: proofRes.newBalance.toString(),
          blinding: proofRes.newBlinding.toString(),
          commitmentDecimal: proofRes.newCommitmentDecimal,
          updatedAt: new Date().toISOString(),
        };
      }

      saveWalletRecord(newRecord);
      setRecord(newRecord);
      downloadWalletBackup(newRecord);
      toast.success("Deposit succeeded — backup file downloaded");

      setStep("done");
      setStatusMsg("");
      setDepositAmount("");
    } catch (err: unknown) {
      setStep("error");
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function withdraw() {
    if (!address) { await connect(); return; }
    if (!record) { setStatusMsg("No confidential balance to withdraw from"); return; }
    setStatusMsg("");
    try {
      const amount = xlmToStroops(withdrawAmount);
      if (amount <= 0n) throw new Error("Amount must be > 0");
      if (amount > BigInt(record.balance)) throw new Error("Amount exceeds current confidential balance");

      setStep("proving");
      setStatusMsg("Generating zero-knowledge proof in your browser…");

      const proofRes = await generateWithdrawProof({
        oldBalance: BigInt(record.balance),
        oldBlinding: BigInt(record.blinding),
        oldCommitmentDecimal: record.commitmentDecimal,
        amount,
      });

      setStep("signing");
      setStatusMsg("Proof ready — waiting for wallet signature…");

      const client = getClient();
      const tx = await client.withdraw({
        account: address,
        token,
        amount,
        new_commitment: Buffer.from(proofRes.newCommitment),
        proof: {
          a: Buffer.from(proofRes.proof.a),
          b: Buffer.from(proofRes.proof.b),
          c: Buffer.from(proofRes.proof.c),
        },
      });
      setStep("submitting");
      setStatusMsg("Submitting withdrawal…");
      const { result } = await tx.signAndSend();
      if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));

      const newRecord: ConfidentialWalletRecord = {
        account: address,
        token,
        balance: proofRes.newBalance.toString(),
        blinding: proofRes.newBlinding.toString(),
        commitmentDecimal: proofRes.newCommitmentDecimal,
        updatedAt: new Date().toISOString(),
      };
      saveWalletRecord(newRecord);
      setRecord(newRecord);
      downloadWalletBackup(newRecord);
      toast.success("Withdrawal succeeded — backup file downloaded");

      setStep("done");
      setStatusMsg("");
      setWithdrawAmount("");
    } catch (err: unknown) {
      setStep("error");
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function restoreFromFile(file: File) {
    try {
      const text = await file.text();
      const restored = parseWalletBackupFile(text);
      if (restored.account !== address) {
        throw new Error(`Backup is for a different account (${restored.account.slice(0, 8)}…)`);
      }
      saveWalletRecord(restored);
      setRecord(restored);
      toast.success("Wallet restored from backup");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = ["proving", "signing", "submitting"].includes(step);

  if (!address) {
    return (
      <EmptyState
        icon={WalletIcon}
        title="Connect your wallet"
        description="Connect your wallet to view your confidential balance and manage private payments."
        action={
          <Button onClick={connect}>Connect Wallet</Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Confidential wallet</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Your balance here is stored on-chain only as a Poseidon commitment — no amount is
          ever visible. Deposits and withdrawals are the only visible boundary.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Token</label>
        <select
          value={tokenSymbol}
          onChange={(e) => setTokenSymbol(e.target.value)}
          className={inputCls + " w-32"}
        >
          {Object.keys(TOKENS).map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>

      <Card>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Confidential balance ({tokenSymbol})</span>
          <span className="text-2xl font-semibold tabular-nums">
            {record ? stroopsToXlm(BigInt(record.balance)) : "0"} {tokenSymbol}
          </span>
          {record && (
            <span className="text-xs text-zinc-400 mt-1">
              Last updated {new Date(record.updatedAt).toLocaleString()} — known only on this device
            </span>
          )}
          {!record && (
            <span className="text-xs text-zinc-400 mt-1">
              No confidential balance yet on this device — deposit below, or restore from a backup file.
            </span>
          )}
        </div>
      </Card>

      {/* Pending pay (auto-received notes) */}
      {pending.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            Pending pay — {pending.length} note{pending.length > 1 ? "s" : ""} waiting
          </h2>
          {pending.map((n) => (
            <div key={n.escrowId.toString()} className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-4 flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold tabular-nums">
                  {stroopsToXlm(n.amount)} {n.tokenSymbol}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                  from {n.payer.slice(0, 8)}… · note #{n.escrowId.toString()}
                </span>
              </div>
              <button
                onClick={() => claimNote(n)}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors shrink-0"
              >
                Claim
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Auto-receive enrollment */}
      {!viewingKey ? (
        <Card className="border-zinc-200 dark:border-zinc-800">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Enable auto-receive</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Register a viewing key once so employers can pay you confidentially and the funds show
              up here automatically — no copy-pasting claim secrets. Your viewing key is backed up to a file.
            </p>
            <Button variant="secondary" onClick={enableAutoReceive}>Enable auto-receive</Button>
          </div>
        </Card>
      ) : (
        <SuccessBox
          message="Auto-receive enabled"
          subtext={scanning ? "Scanning for pending pay…" : "Confidential payments land here automatically."}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Deposit (shield)</h2>
        <div className="flex gap-2">
          <InputField
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className="flex-1"
          />
          <Button onClick={deposit} disabled={busy || !depositAmount} loading={step === "proving" || step === "signing" || step === "submitting"}>
            Deposit
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Withdraw (deshield)</h2>
        <div className="flex gap-2">
          <InputField
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            className="flex-1"
          />
          <Button onClick={withdraw} disabled={busy || !withdrawAmount || !record} loading={step === "proving" || step === "signing" || step === "submitting"}>
            Withdraw
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Restore from backup</h2>
        <input
          type="file"
          accept="application/json"
          onChange={(e) => e.target.files?.[0] && restoreFromFile(e.target.files[0])}
          className="text-sm"
        />
      </section>

      {step === "error" && (
        <ErrorBox
          message={statusMsg}
          onRetry={() => setStep("idle")}
          onDismiss={() => setStep("idle")}
        />
      )}
      {busy && (
        <LoadingSpinner text={statusMsg} />
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] " +
  "px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 " +
  "focus:ring-emerald-500";

const primaryBtn =
  "px-6 py-2.5 rounded-lg bg-emerald-500 text-[#070b0a] " +
  "text-sm font-medium hover:bg-emerald-400 disabled:opacity-50 transition-colors";

const secondaryBtn =
  "self-start px-5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm " +
  "font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors";
