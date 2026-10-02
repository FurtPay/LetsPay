//! Groth16 verification over BLS12-381, ported from the canonical
//! `stellar/soroban-examples/groth16_verifier`.
//!
//! BLS12-381 pairing host functions are available on Soroban (CAP-0059), so the
//! contract verifies the proof on-chain and trusts the public inputs. Poseidon is
//! NOT computed here — it runs inside the circuit; the `payroll_commitment` public
//! input is taken on faith *because* the proof binds it.

use soroban_sdk::{
    contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    vec, Env, Vec,
};

use crate::error::Error;

/// Groth16 verification key (BLS12-381). Marshaled to/from JSON off-chain by
/// `scripts/snarkjs_to_soroban.ts`. `ic.len()` must equal `num_public_inputs + 1`.
#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha: G1Affine,
    pub beta: G2Affine,
    pub gamma: G2Affine,
    pub delta: G2Affine,
    pub ic: Vec<G1Affine>,
}

/// Groth16 proof (BLS12-381): A in G1, B in G2, C in G1.
#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
}

/// Verifies `e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1`,
/// where `vk_x = ic[0] + sum(pub_signals[i] * ic[i+1])`.
///
/// Returns `Err(InvalidProof)` on a failed pairing check and
/// `Err(MalformedVerifyingKey)` if the public-input count doesn't match the VK.
pub fn verify(
    env: &Env,
    vk: &VerificationKey,
    proof: &Proof,
    pub_signals: &Vec<Fr>,
) -> Result<(), Error> {
    if pub_signals.len() + 1 != vk.ic.len() {
        return Err(Error::MalformedVerifyingKey);
    }

    let bls = env.crypto().bls12_381();

    // vk_x = ic[0] + Σ pub_signals[i] * ic[i+1]
    let mut vk_x = vk.ic.get(0).unwrap();
    for (s, v) in pub_signals.iter().zip(vk.ic.iter().skip(1)) {
        let prod = bls.g1_mul(&v, &s);
        vk_x = bls.g1_add(&vk_x, &prod);
    }

    let neg_a = -proof.a.clone();
    let vp1 = vec![env, neg_a, vk.alpha.clone(), vk_x, proof.c.clone()];
    let vp2 = vec![
        env,
        proof.b.clone(),
        vk.beta.clone(),
        vk.gamma.clone(),
        vk.delta.clone(),
    ];

    if bls.pairing_check(vp1, vp2) {
        Ok(())
    } else {
        Err(Error::InvalidProof)
    }
}
