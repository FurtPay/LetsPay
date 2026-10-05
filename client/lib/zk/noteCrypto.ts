/**
 * Auto-receive note encryption (Phase 4).
 *
 * The employer encrypts each recipient's (amount, note_blinding) to the
 * recipient's x25519 viewing public key via ECDH + AES-GCM, and posts the
 * ciphertext on-chain (opaque). The recipient's wallet decrypts it with their
 * viewing private key and can claim the note with one click — no out-of-band
 * sharing, and the amount stays shielded (only the recipient can decrypt).
 *
 * Wire format (hex): ephPub(32) ‖ iv(12) ‖ AES-GCM ciphertext.
 * Reuses the same primitives as the auditor view key (viewKey.ts).
 */

import { x25519 } from "@noble/curves/ed25519.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { bytesToHex, hexToBytes } from "./viewKey";

/** Fresh x25519 viewing keypair for a recipient (stored in their wallet backup). */
export function generateViewingKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Encrypt a note payload to a recipient's viewing public key → hex ciphertext.
 * `oneTimeSecret` (Stellar secret S...) is set for stealth payments: the note is
 * paid to a fresh one-time address and only the recipient can recover the key to
 * claim it, so their real identity never appears on-chain.
 */
export function encryptNote(
  amount: bigint,
  noteBlinding: bigint,
  recipientViewingPub: Uint8Array,
  oneTimeSecret?: string
): string {
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, recipientViewingPub);

  const payload: Record<string, string> = { amount: amount.toString(), noteBlinding: noteBlinding.toString() };
  if (oneTimeSecret) payload.oneTimeSecret = oneTimeSecret;
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const iv = randomBytes(12);
  const ct = gcm(shared.slice(0, 32), iv).encrypt(plaintext);

  const out = new Uint8Array(ephPub.length + iv.length + ct.length);
  out.set(ephPub, 0);
  out.set(iv, ephPub.length);
  out.set(ct, ephPub.length + iv.length);
  return bytesToHex(out);
}

/** Decrypt a hex note ciphertext with the recipient's viewing private key. */
export function decryptNote(
  cipherHex: string,
  viewingPriv: Uint8Array
): { amount: bigint; noteBlinding: bigint; oneTimeSecret?: string } {
  const bytes = hexToBytes(cipherHex);
  const ephPub = bytes.slice(0, 32);
  const iv = bytes.slice(32, 44);
  const ct = bytes.slice(44);

  const shared = x25519.getSharedSecret(viewingPriv, ephPub);
  const plaintext = gcm(shared.slice(0, 32), iv).decrypt(ct);
  const { amount, noteBlinding, oneTimeSecret } = JSON.parse(new TextDecoder().decode(plaintext)) as {
    amount: string;
    noteBlinding: string;
    oneTimeSecret?: string;
  };
  return { amount: BigInt(amount), noteBlinding: BigInt(noteBlinding), oneTimeSecret };
}
