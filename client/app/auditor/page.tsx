"use client";

import { useState } from "react";
import {
  generateAuditorKeyPair,
  decryptAndVerify,
  bytesToHex,
  type ViewKeyPacket,
} from "@/lib/zk/viewKey";
import { CopyButton } from "@/app/components/CopyButton";

export default function AuditorPage() {
  // ── Key pair generation ────────────────────────────────────────────────────
  const [keyPair, setKeyPair] = useState<{
    privateKey: string;
    publicKey: string;
  } | null>(null);

  function genKeyPair() {
    const { privateKey, publicKey } = generateAuditorKeyPair();
    setKeyPair({ privateKey: bytesToHex(privateKey), publicKey: bytesToHex(publicKey) });
  }

  // ── Decrypt & verify ───────────────────────────────────────────────────────
  const [packetJson, setPacketJson] = useState("");
  const [privateKeyHex, setPrivateKeyHex] = useState("");
  const [commitment, setCommitment] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    salaries: bigint[];
    salt: bigint;
    recipients: string[];
  } | null>(null);
  const [verifyError, setVerifyError] = useState("");

  async function decryptPacket() {
    setVerifyResult(null);
    setVerifyError("");
    setVerifying(true);
    try {
      let packet: ViewKeyPacket;
      try {
        packet = JSON.parse(packetJson);
      } catch {
        throw new Error("Invalid JSON — paste the full packet from the employer");
      }
      if (!packet.ephPub || !packet.ciphertext)
        throw new Error("Packet missing ephPub or ciphertext");

      const privBytes = hexToBytes(privateKeyHex.trim());
      if (privBytes.length !== 32)
        throw new Error("Private key must be 32 bytes (64 hex chars)");

      const commitmentToVerify = commitment.trim() || packet.commitment || undefined;
      const result = await decryptAndVerify(packet, privBytes, commitmentToVerify);
      setVerifyResult(result);
    } catch (err: unknown) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditor</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Generate a key pair to receive encrypted salary data, then decrypt and verify it
          against an on-chain payroll commitment.
        </p>
      </div>

      {/* ── Section A: Generate key pair ─────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">1. Generate auditor key pair</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Share the <strong>public key</strong> with the employer so they can encrypt the
          salary payload for you. Keep the <strong>private key</strong> secret — only you
          can decrypt with it.
        </p>
        <button onClick={genKeyPair} className={secondaryBtn}>
          Generate new key pair
        </button>

        {keyPair && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-3">
            <KeyRow label="Public key (share with employer)" value={keyPair.publicKey} />
            <KeyRow label="Private key (keep secret)" value={keyPair.privateKey} secret />
          </div>
        )}
      </section>

      <hr className="border-zinc-200 dark:border-zinc-800" />

      {/* ── Section B: Decrypt & verify ──────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">2. Decrypt & verify</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Paste the encrypted packet from the employer, enter your private key, and
          optionally the on-chain commitment to verify the salaries match.
        </p>

        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">Encrypted packet (JSON)</label>
          <textarea
            rows={5}
            placeholder={'{"ephPub":"…","ciphertext":"…","batchId":"…","commitment":"…"}'}
            value={packetJson}
            onChange={(e) => setPacketJson(e.target.value)}
            className={`${inputCls} resize-none font-mono text-xs`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Your private key (hex)</label>
          <input
            type="password"
            placeholder="64 hex chars"
            value={privateKeyHex}
            onChange={(e) => setPrivateKeyHex(e.target.value)}
            className={`${inputCls} font-mono`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">
            On-chain commitment{" "}
            <span className="font-normal text-zinc-400">— optional, from Stellar Expert</span>
          </label>
          <input
            type="text"
            placeholder="2049730932…"
            value={commitment}
            onChange={(e) => setCommitment(e.target.value)}
            className={`${inputCls} font-mono text-xs`}
          />
        </div>

        {verifying && (
          <p className="text-sm text-zinc-500 flex items-center gap-2">
            <span className="animate-spin inline-block">⟳</span> Decrypting and verifying…
          </p>
        )}

        {verifyError && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{verifyError}</p>
          </div>
        )}

        {verifyResult && (
          <div className={`rounded-xl border p-5 flex flex-col gap-4 ${
            verifyResult.valid
              ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950"
              : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950"
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-lg">{verifyResult.valid ? "✓" : "⚠"}</span>
              <p className={`text-sm font-semibold ${
                verifyResult.valid
                  ? "text-emerald-800 dark:text-emerald-200"
                  : "text-amber-800 dark:text-amber-200"
              }`}>
                {verifyResult.valid
                  ? "Commitment matches on-chain ✓"
                  : "Decrypted — commitment not verified (no commitment provided or mismatch)"}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                Decrypted salaries (active slots):
              </p>
              <div className="flex flex-col gap-1 text-xs font-mono">
                {verifyResult.salaries
                  .map((s, i) => ({ s, i }))
                  .filter(({ s }) => s > 0n)
                  .map(({ s, i }) => {
                    const addr = verifyResult.recipients[i];
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-zinc-400 shrink-0 w-12">Slot {i}</span>
                        {addr ? (
                          <span className="text-zinc-500 truncate flex-1" title={addr}>
                            {addr.slice(0, 6)}…{addr.slice(-6)}
                          </span>
                        ) : (
                          <span className="text-zinc-600 flex-1">—</span>
                        )}
                        <span className="shrink-0">{stroopsToXlm(s)} XLM</span>
                        {addr && <CopyButton value={addr} label="Address" />}
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className={`flex flex-col gap-1 border-t pt-3 ${
              verifyResult.valid
                ? "border-emerald-200 dark:border-emerald-800"
                : "border-amber-200 dark:border-amber-800"
            }`}>
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Employer salt{" "}
                <span className="font-normal text-zinc-400">
                  — needed for bracket proofs at /attest
                </span>
              </p>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs font-mono break-all">
                  {verifyResult.salt.toString()}
                </span>
                <CopyButton value={verifyResult.salt.toString()} label="Employer salt" />
              </div>
            </div>
          </div>
        )}

        <button
          onClick={decryptPacket}
          disabled={verifying || !packetJson || !privateKeyHex}
          className={primaryBtn}
        >
          Decrypt & verify
        </button>
      </section>
    </div>
  );
}

// ── shared components ────────────────────────────────────────────────────────

function KeyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [show, setShow] = useState(!secret);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`flex-1 text-xs font-mono break-all ${!show ? "blur-sm select-none" : ""}`}>
          {value}
        </span>
        <div className="flex gap-1 shrink-0">
          {secret && (
            <button
              onClick={() => setShow((s) => !s)}
              className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-2 py-1"
            >
              {show ? "Hide" : "Show"}
            </button>
          )}
          <CopyButton
            value={value}
            label={label}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-2 py-1"
          />
        </div>
      </div>
    </div>
  );
}

function stroopsToXlm(s: bigint | number): string {
  return (Number(s) / 10_000_000).toFixed(7).replace(/\.?0+$/, "");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
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
  "font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors";
