/**
 * Auditor view key — ECDH (x25519) + AES-GCM-256 encryption of salary arrays.
 *
 * Protocol:
 *   Encrypt: ephemeral x25519 keypair → ECDH with auditor's public key →
 *            AES-GCM-256 encrypt (salaries + salt) → { ephPub, ciphertext }
 *
 *   Decrypt: ECDH with auditor's private key → AES-GCM-256 decrypt →
 *            recompute Poseidon(salaries, salt) via the actual payroll circuit
 *            → compare to on-chain commitment
 *
 * Required packages (install once):
 *   cd client && pnpm add @noble/curves @noble/ciphers
 *
 * Usage note: all keys are raw Uint8Array (32 bytes). Convert hex ↔ bytes with
 * hexToBytes / bytesToHex from @noble/curves/abstract/utils.
 *
 * The commitment is recomputed via generatePayrollProof (the real BLS12-381
 * circuit) rather than a generic JS Poseidon — circomlibjs's buildPoseidon
 * hardcodes the BN254 field and would never match a value the on-chain
 * verifier accepted.
 */

import { x25519 } from "@noble/curves/ed25519.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { generatePayrollProof } from "./payrollProof";

export type ViewKeyPacket = {
  ephPub: string;      // hex-encoded 32-byte x25519 public key
  ciphertext: string;  // hex-encoded IV(12) + AES-GCM ciphertext
  batchId?: string;
  commitment?: string; // on-chain Poseidon commitment decimal string
};

/** Generate a fresh x25519 key pair for an auditor. */
export function generateAuditorKeyPair(): {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
} {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Encrypt salary array + salt for a specific auditor.
 * The resulting packet can be shared openly — only the auditor's private key decrypts it.
 */
export async function encryptSalaryPayload(
  salaries: bigint[],
  salt: bigint,
  auditorPublicKey: Uint8Array,
  meta?: { batchId?: string; commitment?: string; recipients?: string[] }
): Promise<ViewKeyPacket> {
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, auditorPublicKey);

  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      salaries: salaries.map((s) => s.toString()),
      salt: salt.toString(),
      recipients: meta?.recipients ?? [],
    })
  );

  const iv = randomBytes(12);
  const stream = gcm(shared.slice(0, 32), iv);
  const ct = stream.encrypt(plaintext);

  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv);
  combined.set(ct, iv.length);

  return {
    ephPub: bytesToHex(ephPub),
    ciphertext: bytesToHex(combined),
    batchId: meta?.batchId,
    commitment: meta?.commitment,
  };
}

/**
 * Decrypt a view-key packet and verify salaries against the on-chain Poseidon commitment.
 * Returns salaries in the same order as the payroll circuit (slot 0..9, zeros for inactive).
 */
export async function decryptAndVerify(
  packet: ViewKeyPacket,
  auditorPrivKey: Uint8Array,
  onChainCommitment?: string
): Promise<{ valid: boolean; salaries: bigint[]; salt: bigint; recipients: string[] }> {
  const ephPub = hexToBytes(packet.ephPub);
  const combined = hexToBytes(packet.ciphertext);

  const shared = x25519.getSharedSecret(auditorPrivKey, ephPub);
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);

  const stream = gcm(shared.slice(0, 32), iv);
  const plaintext = stream.decrypt(ct);
  const { salaries: salaryStrings, salt: saltString, recipients: recipientList } = JSON.parse(
    new TextDecoder().decode(plaintext)
  ) as { salaries: string[]; salt: string; recipients?: string[] };

  const salaries = salaryStrings.map(BigInt);
  const salt = BigInt(saltString);
  const recipients: string[] = recipientList ?? [];

  let valid = false;
  const commitment = onChainCommitment ?? packet.commitment;
  if (commitment) {
    // bracket bounds don't affect the commitment output — max(salaries) just
    // satisfies the circuit's sal[i] <= max_salary constraint.
    const maxSalary = salaries.reduce((a, b) => (a > b ? a : b), 1n);
    const proofRes = await generatePayrollProof({ salaries, maxSalary, salt });
    valid = proofRes.commitmentDecimal === commitment;
  }

  return { valid, salaries, salt, recipients };
}

// ── helpers ─────────────────────────────────────────────────────────────────

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
