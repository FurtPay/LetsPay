/**
 * Encodes snarkjs Groth16 artifacts (decimal-string coordinates) into the byte
 * layout Soroban's BLS12-381 host expects (ZCash/EIP-2537/IETF standard — all
 * coordinates are BIG-ENDIAN, and Fq2 elements use imaginary-first ordering).
 *
 *   - G1Affine = BE(x) ‖ BE(y)                              (96 bytes)
 *   - G2Affine = BE(x.c1) ‖ BE(x.c0) ‖ BE(y.c1) ‖ BE(y.c0)  (192 bytes)
 *   - Fr scalar = BE(v)                                       (32 bytes)
 *
 * Verified: snarkjs `G1.toUncompressed` / `G2.toUncompressed` produce this exact
 * layout, and the Soroban host's bls12_381_g1_mul / g1_add accept it.
 */

const FP_SIZE = 48;

function fpToBE(v: bigint): Uint8Array {
  const out = new Uint8Array(FP_SIZE);
  for (let i = FP_SIZE - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error("Fp coordinate exceeds 48 bytes");
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** snarkjs G1 point `[x, y, z]` (z == "1", already affine) → 96 bytes BE. */
export function g1ToBytes(p: string[]): Uint8Array {
  return concat(fpToBE(BigInt(p[0])), fpToBE(BigInt(p[1])));
}

/**
 * snarkjs G2 point `[[x.c0, x.c1], [y.c0, y.c1], [z..]]` → 192 bytes.
 * ZCash convention: imaginary part (c1) precedes real part (c0) for each Fq2 element.
 */
export function g2ToBytes(p: string[][]): Uint8Array {
  return concat(
    fpToBE(BigInt(p[0][1])), // x.c1 (imaginary)
    fpToBE(BigInt(p[0][0])), // x.c0 (real)
    fpToBE(BigInt(p[1][1])), // y.c1 (imaginary)
    fpToBE(BigInt(p[1][0])), // y.c0 (real)
  );
}

/** Scalar field element (e.g. the commitment) → 32-byte big-endian (`Fr::from_bytes`). */
export function frToBytesBE(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error("Fr scalar exceeds 32 bytes");
  return out;
}

export interface ProofBytes {
  a: Uint8Array; // 96
  b: Uint8Array; // 192
  c: Uint8Array; // 96
}

export interface VerificationKeyBytes {
  alpha: Uint8Array; // 96
  beta: Uint8Array; // 192
  gamma: Uint8Array; // 192
  delta: Uint8Array; // 192
  ic: Uint8Array[]; // each 96
}

/** snarkjs `proof.json` object → on-chain `Proof` bytes. */
export function encodeProof(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): ProofBytes {
  return {
    a: g1ToBytes(proof.pi_a),
    b: g2ToBytes(proof.pi_b),
    c: g1ToBytes(proof.pi_c),
  };
}

/** snarkjs `verification_key.json` object → on-chain `VerificationKey` bytes. */
export function encodeVerificationKey(vk: {
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  IC: string[][];
}): VerificationKeyBytes {
  return {
    alpha: g1ToBytes(vk.vk_alpha_1),
    beta: g2ToBytes(vk.vk_beta_2),
    gamma: g2ToBytes(vk.vk_gamma_2),
    delta: g2ToBytes(vk.vk_delta_2),
    ic: vk.IC.map((p) => g1ToBytes(p)),
  };
}
