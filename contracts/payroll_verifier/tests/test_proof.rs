//! Fixture-based Groth16 proof tests.
//!
//! Each test loads a pre-computed proof from tests/fixtures/<circuit>.json,
//! reconstructs the Soroban BLS12-381 types, and calls groth16::verify() with
//! the real verifying key.
//!
//! Missing fixture → skip notice (never fails on absent file).
//!
//! Generate fixtures:  pnpm exec tsx scripts/generate_fixtures.ts
//! Run these tests:    cargo test -p payroll_verifier proof

use payroll_verifier::groth16::{self, Proof, VerificationKey};
use serde_json::Value;
use soroban_sdk::{
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    BytesN, Env, Vec,
};

fn hex_to_arr<const N: usize>(hex: &str) -> [u8; N] {
    assert_eq!(hex.len(), N * 2, "expected {} hex chars, got {}", N * 2, hex.len());
    let mut out = [0u8; N];
    for (i, chunk) in hex.as_bytes().chunks(2).enumerate() {
        out[i] = u8::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap();
    }
    out
}

fn load_fixture(circuit: &str) -> Option<Value> {
    let p = format!(
        "{}/tests/fixtures/{circuit}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let s = std::fs::read_to_string(&p).ok()?;
    Some(serde_json::from_str(&s).expect("fixture JSON is malformed"))
}

fn decode(env: &Env, v: &Value) -> (Proof, VerificationKey, Vec<Fr>) {
    let proof = Proof {
        a: G1Affine::from_bytes(BytesN::from_array(
            env,
            &hex_to_arr::<96>(v["proof_a"].as_str().unwrap()),
        )),
        b: G2Affine::from_bytes(BytesN::from_array(
            env,
            &hex_to_arr::<192>(v["proof_b"].as_str().unwrap()),
        )),
        c: G1Affine::from_bytes(BytesN::from_array(
            env,
            &hex_to_arr::<96>(v["proof_c"].as_str().unwrap()),
        )),
    };

    let ic_arr = v["vk_ic"].as_array().unwrap();
    let mut ic = Vec::new(env);
    for h in ic_arr {
        ic.push_back(G1Affine::from_bytes(BytesN::from_array(
            env,
            &hex_to_arr::<96>(h.as_str().unwrap()),
        )));
    }
    let vk = VerificationKey {
        alpha: G1Affine::from_bytes(BytesN::from_array(
            env,
            &hex_to_arr::<96>(v["vk_alpha"].as_str().unwrap()),
        )),
        beta: G2Affine::from_bytes(BytesN::from_array(
            env,
            &hex_to_arr::<192>(v["vk_beta"].as_str().unwrap()),
        )),
        gamma: G2Affine::from_bytes(BytesN::from_array(
            env,
            &hex_to_arr::<192>(v["vk_gamma"].as_str().unwrap()),
        )),
        delta: G2Affine::from_bytes(BytesN::from_array(
            env,
            &hex_to_arr::<192>(v["vk_delta"].as_str().unwrap()),
        )),
        ic,
    };

    let sig_arr = v["public_signals_hex"].as_array().unwrap();
    let mut signals = Vec::new(env);
    for s in sig_arr {
        signals.push_back(Fr::from_bytes(BytesN::from_array(
            env,
            &hex_to_arr::<32>(s.as_str().unwrap()),
        )));
    }

    (proof, vk, signals)
}

macro_rules! proof_test {
    ($fn_name:ident, $circuit:literal) => {
        #[test]
        fn $fn_name() {
            let Some(fixture) = load_fixture($circuit) else {
                eprintln!(
                    "skip: {}.json not found — run: pnpm exec tsx scripts/generate_fixtures.ts",
                    $circuit
                );
                return;
            };
            let env = Env::default();
            let (proof, vk, signals) = decode(&env, &fixture);
            groth16::verify(&env, &vk, &proof, &signals).unwrap_or_else(|e| {
                panic!("groth16::verify failed for {}: {:?}", $circuit, e)
            });
        }
    };
}

proof_test!(proof_deposit_new,       "deposit_new");
proof_test!(proof_deposit_topup,     "deposit_topup");
proof_test!(proof_withdraw,          "withdraw");
proof_test!(proof_escrow_lock,       "escrow_lock");
proof_test!(proof_escrow_settle,     "escrow_settle");
proof_test!(proof_escrow_settle_new, "escrow_settle_new");
proof_test!(proof_escrow_cancel,     "escrow_cancel");
proof_test!(proof_payroll_notes,     "payroll_notes");
proof_test!(proof_minimum_wage,      "minimum_wage");
proof_test!(proof_pay_equity,        "pay_equity");
proof_test!(proof_income_proof,      "income_proof");
proof_test!(proof_salary_bracket,    "salary_bracket");
