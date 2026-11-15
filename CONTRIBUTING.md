# Contributing to LetsPay

Thank you for your interest in contributing to LetsPay! This document provides guidelines for contributing to the project, with a dedicated technical guide on how LetsPay's zero-knowledge circuits work and how to safely modify and test them.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Contributor Guide for ZK Circuits](#contributor-guide-for-zk-circuits)
  - [1. Why BLS12-381 Instead of BN254](#1-why-bls12-381-instead-of-bn254)
  - [2. Critical BN254 vs. BLS12-381 Compatibility Rules](#2-critical-bn254-vs-bls12-381-compatibility-rules)
  - [3. Groth16 Proving & On-Chain Serialization](#3-groth16-proving--on-chain-serialization)
  - [4. Public vs. Private Inputs (Output-First Convention)](#4-public-vs-private-inputs-output-first-convention)
  - [5. Poseidon Commitment Construction](#5-poseidon-commitment-construction)
  - [6. Building, Modifying, and Testing Circuits](#6-building-modifying-and-testing-circuits)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)

---

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

---

## Getting Started

### Prerequisites

- **Rust** (latest stable) with `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- **Node.js** (`>= 20`) and **pnpm** (`>= 9`)
- **Stellar CLI** (`>= 25.x`)
- **Circom** (`2.1.6+`, Rust compiler from [iden3/circom](https://github.com/iden3/circom))

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/FurtPay/LetsPay.git
   cd LetsPay
   ```

2. Install dependencies across workspace roots:
   ```bash
   pnpm install
   cd circuits && pnpm install && cd ..
   cd client && pnpm install && cd ..
   ```

---

## Contributor Guide for ZK Circuits

LetsPay uses **12 Circom 2.1.6 circuits** located in `circuits/` to prove confidential ledger transitions, invoice escrows, batch payroll disbursements, and compliance attestations without revealing underlying amounts on-chain.

### 1. Why BLS12-381 Instead of BN254

Stellar Protocol 22+ (CAP-0059) provides native Soroban host functions for **BLS12-381** curve arithmetic (`bls12_381_g1_add`, `bls12_381_g1_mul`, `bls12_381_g1_msm`, `bls12_381_multi_pairing_check`).

To verify proofs directly inside Soroban smart contracts within budget limits, **every circuit in LetsPay is compiled over the BLS12-381 scalar field** using `--prime bls12381`:

- **BLS12-381 Scalar Field Prime ($r$):**
  `52435875175126190479447740508185965837690552500527637822603658699938581184513`
  (255-bit prime, ~`0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001`)

### 2. Critical BN254 vs. BLS12-381 Compatibility Rules

> ⚠️ **Never use `circomlibjs` Poseidon in JavaScript/TypeScript or use Hermez `.ptau` files!**

1. **No `circomlibjs` Poseidon in JS/TS:**
   The `circomlibjs` npm package hardcodes the **BN254** prime (`21888242871839275222246405745257275088548364400416034343698204186575808495617`) and BN254 round constants. Computing `poseidon([balance, blinding])` with `circomlibjs` produces a field element in $\mathbb{F}_{r(\text{BN254})}$ that **never matches** the `circomlib/circuits/poseidon.circom` output compiled with `--prime bls12381`.
   - **Correct pattern:** Always let the Circom WASM witness calculator compute commitments as `signal output` values via `snarkjs.groth16.fullProve(input, wasmPath, zkeyPath)` and read the resulting commitment from `publicSignals`.
2. **No Hermez / Polygon Powers-of-Tau (`.ptau`) files:**
   Standard public `.ptau` files downloaded from Hermez/Polygon are generated over BN254 and will fail or produce invalid keys for BLS12-381. Always generate or use `circuits/build/pot_bls12381_final.ptau` created via `snarkjs powersoftau new bls12-381 15` (automated by `scripts/setup_ceremony.sh`).
3. **Range-Check Widths (`LessThan(64)` / `LessEqualThan(64)`):**
   All monetary amounts in LetsPay are 7-decimal stroops fitting in unsigned 64-bit integers (`0 <= value < 2^64`). Always constrain private amounts with `Num2Bits(64)` before passing them into `LessThan(64)` or `LessEqualThan(64)` so a malicious prover cannot exploit modular wrap-around in $\mathbb{F}_r$ (`r - 1` appearing negative).

### 3. Groth16 Proving & On-Chain Serialization

1. **In-Browser Witness & Proof Generation:**
   `client/lib/zk/*Proof.ts` calls `snarkjs.groth16.fullProve(witnessInputs, "/circuits/<name>.wasm", "/circuits/<name>.zkey")`, which returns `{ proof, publicSignals }`.
2. **ZCash Uncompressed Big-Endian Encoding (`client/lib/zk/groth16Codec.ts`):**
   Soroban's CAP-0059 BLS12-381 host functions expect curve points in **ZCash uncompressed big-endian format** and scalar field elements as **32-byte big-endian `BytesN<32>`**:
   - $\pi_A \in \mathbb{G}_1$: `96 bytes` (`x: 48 bytes BE || y: 48 bytes BE`)
   - $\pi_B \in \mathbb{G}_2$: `192 bytes` (`x_c1: 48B || x_c0: 48B || y_c1: 48B || y_c0: 48B` — note that `snarkjs` outputs `[c0, c1]`, so `groth16Codec.ts` swaps the $\mathbb{F}_{p^2}$ coordinates to `c1 || c0` as required by CAP-0059)
   - $\pi_C \in \mathbb{G}_1$: `96 bytes` (`x: 48 bytes BE || y: 48 bytes BE`)
   - Public signals ($s_1, \dots, s_n \in \mathbb{F}_r$): each encoded as `BytesN<32>` (`32 bytes BE`).
3. **On-Chain Pairing Equation (`contracts/payroll_verifier/src/lib.rs`):**
   The contract computes the linear combination of public inputs:
   $$vk_x = IC_0 + \sum_{i=1}^{n} s_i \cdot IC_i$$
   using `bls12_381().g1_msm(...)` and checks the Groth16 pairing equation:
   $$e(-\pi_A, \pi_B) \cdot e(\alpha, \beta) \cdot e(vk_x, \gamma) \cdot e(\pi_C, \delta) = 1$$
   via `bls12_381().multi_pairing_check(...)`.

### 4. Public vs. Private Inputs (Output-First Convention)

In Circom, **any `signal output` of the `main` template is automatically placed first in `publicSignals`**, followed by the signals listed in `component main {public [...]}` in declaration order. Consequently:

- `vk.ic.len()` is always equal to `publicSignals.length + 1` ($IC_0$ plus one $IC_i$ per public signal).
- The Soroban verifier contract reconstructs `pub_signals` in the exact **output-first order** shown below:

| Circuit (`circuits/*.circom`) | `IC` len | Public Signals (Output-First Order) | Private Witness Inputs |
|---|---|---|---|
| `deposit_new.circom` | `3` | `[commitment, amount]` | `balance`, `blinding` |
| `deposit_topup.circom` | `4` | `[new_commitment, old_commitment, amount]` | `old_balance`, `old_blinding`, `new_blinding` |
| `withdraw.circom` | `4` | `[new_commitment, old_commitment, amount]` | `old_balance`, `old_blinding`, `new_blinding` |
| `escrow_lock.circom` | `4` | `[new_commitment, escrow_commitment, old_commitment]` | `old_balance`, `old_blinding`, `new_blinding`, `escrow_amount`, `escrow_blinding` |
| `escrow_settle.circom` | `6` | `[payee_new_commitment, escrow_commitment, invoice_min, invoice_max, payee_old_commitment]` | `escrow_amount`, `escrow_blinding`, `payee_old_balance`, `payee_old_blinding`, `payee_new_blinding` |
| `escrow_settle_new.circom` | `5` | `[payee_commitment, escrow_commitment, invoice_min, invoice_max]` | `escrow_amount`, `escrow_blinding`, `payee_blinding` |
| `escrow_cancel.circom` | `4` | `[new_commitment, escrow_commitment, old_commitment]` | `old_balance`, `old_blinding`, `new_blinding`, `escrow_amount`, `escrow_blinding` |
| `payroll_notes.circom` | `15` | `[payroll_commitment, note_commitment[0..9], total_budget, max_salary, active_count]` | `salaries[10]`, `note_blindings[10]`, `blinding_salt` |
| `minimum_wage.circom` | `4` | `[payroll_commitment, min_wage, active_count]` | `salaries[10]`, `blinding_salt` |
| `pay_equity.circom` | `4` | `[payroll_commitment, epsilon, active_count]` | `salaries[10]`, `groups[10]`, `blinding_salt` |
| `income_proof.circom` | `10` | `[note_commitment[0..7], threshold]` | `amounts[8]`, `blindings[8]`, `active[8]` |
| `salary_bracket.circom` | `4` | `[note_commitment, bracket_low, bracket_high]` | `salary`, `note_blinding` |

### 5. Poseidon Commitment Construction

LetsPay uses three standardized Poseidon commitment shapes over BLS12-381:

1. **Confidential Balance Commitment (`Poseidon(2)`):**
   $$\text{commitment} = \text{Poseidon}(2)(\text{balance}, \text{blinding})$$
   Used in `deposit_new`, `deposit_topup`, `withdraw`, and escrow settlement circuits. Every state transition requires proving knowledge of `(old_balance, old_blinding)` that hashes to the on-chain `old_commitment` and outputs `new_commitment = Poseidon(2)(new_balance, new_blinding)`.
2. **Confidential Note / Escrow Commitment (`Poseidon(2)`):**
   $$\text{note\_commitment} = \text{Poseidon}(2)(\text{amount}, \text{note\_blinding})$$
   Used for individual payroll notes and invoice escrows. For inactive slots in `payroll_notes` (`i >= active_count`), the circuit forces `salaries[i] === 0` and `note_blindings[i] === 0`, producing a deterministic zero-slot commitment `Poseidon(2)(0, 0)`.
3. **Batch Payroll Commitment (`Poseidon(11)`):**
   $$\text{payroll\_commitment} = \text{Poseidon}(11)(\text{salaries}[0], \dots, \text{salaries}[9], \text{blinding\_salt})$$
   Anchors an entire 10-slot payroll batch on-chain so compliance circuits (`minimum_wage.circom` and `pay_equity.circom`) can later prove properties about the exact same salary vector against the stored `payroll_commitment`.

### 6. Building, Modifying, and Testing Circuits

Whenever you create or modify a circuit in `circuits/<name>.circom`, follow these steps to compile, run the local dev ceremony, and verify the proof against the Soroban contract:

#### Step 1: Compile the circuit manually to check constraints and syntax

```bash
cd circuits
circom <name>.circom --r1cs --wasm --sym --prime bls12381 -l node_modules -o build
npx snarkjs r1cs info build/<name>.r1cs
cd ..
```

#### Step 2: Run the full BLS12-381 dev ceremony and export artifacts

```bash
bash scripts/setup_ceremony.sh <name>
```

This script:
1. Compiles `circuits/<name>.circom` with `--prime bls12381` into `circuits/build/`.
2. Generates `circuits/build/pot_bls12381_final.ptau` (if not already present).
3. Runs `snarkjs groth16 setup`, contributes dev entropy to `circuits/build/<name>.zkey`, and exports `circuits/build/<name>_vk.json`.
4. Copies `<name>.wasm`, `<name>.zkey`, and `<name>_vk.json` into `client/public/circuits/`.

#### Step 3: Regenerate Soroban test fixtures and run Rust verifier tests

If you changed public signals, constraints, or `.zkey` files for a circuit verified by `payroll_verifier`, regenerate the deterministic proof fixtures and run the Rust test suite:

```bash
# Generate contracts/payroll_verifier/tests/fixtures/<name>.json
pnpm exec tsx scripts/generate_fixtures.ts

# Verify the proof passes inside the Soroban CAP-0059 test environment
cargo test -p payroll_verifier proof
```

---

## Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (see [Commit Guidelines](#commit-guidelines))
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## Project Structure

```text
├── circuits/              # Circom 2.1.6 zero-knowledge circuits (BLS12-381)
├── client/                # Next.js 16 frontend application
├── contracts/             # Soroban smart contracts (Rust)
│   ├── payroll_verifier/
│   └── salary_bracket_verifier/
├── deployments/           # Network deployment records (deployments/testnet.json)
├── docs/                  # Setup and deployment documentation
└── scripts/               # Ceremony, deployment, fixture, and E2E scripts
```

## Testing

### Smart Contracts

```bash
# Run all workspace unit and fixture proof tests
cargo test --workspace

# Test payroll_verifier specifically
cargo test -p payroll_verifier

# Test salary_bracket_verifier specifically
cargo test -p salary_bracket_verifier
```

### Frontend

```bash
cd client
pnpm lint
pnpm build
```

### Circuits

```bash
# Compile and run ceremony for a specific circuit (e.g., deposit_new)
bash scripts/setup_ceremony.sh deposit_new

# Generate proof fixtures and test against the Soroban verifier
pnpm exec tsx scripts/generate_fixtures.ts
cargo test -p payroll_verifier proof
```

## Commit Guidelines

- Use clear, descriptive commit messages
- Start with a verb or conventional commit prefix (e.g., `docs:`, `feat:`, `fix:`)
- Keep the first line concise
- Add more detail in the body if needed

## Pull Request Process

1. Ensure your code follows the project's style guidelines
2. Write or update tests as needed
3. Update documentation if applicable
4. Ensure all tests pass
5. Request review from maintainers

### PR Checklist

- [ ] Code follows project style
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] Commit messages are clear
- [ ] No merge conflicts
