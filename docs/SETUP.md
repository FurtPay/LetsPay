# LetsPay (Payfurt) — Local Development Setup Guide

This guide walks through setting up the complete LetsPay local development environment from a clean checkout, including Rust/Soroban contracts, Circom BLS12-381 zero-knowledge circuits, the Next.js frontend, unit/fixture tests, and end-to-end (E2E) verification scripts.

---

## 1. Prerequisites & Required Versions

Install the following tools before starting:

| Tool | Required Version | Purpose | Installation Command / Link |
|---|---|---|---|
| **Node.js** | `>= 20.x` (LTS recommended) | Next.js 16 frontend, `snarkjs` witness/prover, and `tsx` E2E scripts | [nodejs.org](https://nodejs.org/) or `nvm install 20` |
| **pnpm** | `>= 9.x` | Workspace package manager (**required** — `npm install` is unsupported) | `npm install -g pnpm` |
| **Rust & Cargo** | Latest stable (`>= 1.84`) + `wasm32v1-none` target | Compiling Soroban smart contracts (`soroban-sdk = "25.3.0"`) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` then `rustup target add wasm32v1-none` |
| **Stellar CLI** | `>= 25.x` | Building/optimizing Soroban WASM (CAP-0059 BLS12-381 host functions), deploying, and generating TS bindings | `cargo install --locked stellar-cli --features opt` |
| **Circom 2** | `2.1.6+` (Rust binary) | Compiling `.circom` circuits over the BLS12-381 scalar field (`--prime bls12381`) | Build from [iden3/circom](https://docs.circom.io/getting-started/installation/): `git clone https://github.com/iden3/circom.git && cd circom && cargo build --release && cargo install --path circom` |
| **snarkjs** | `^0.7.5` (installed via `pnpm`) | Powers-of-Tau ceremony, Groth16 `.zkey` generation, and browser proving | Installed automatically in `circuits/` and `client/` via `pnpm install` |
| **Python 3** | `>= 3.9` | JSON parsing and TypeScript binding deduplication in helper scripts | Pre-installed on macOS/Linux or [python.org](https://www.python.org/) |

Verify all tools are available on your `PATH`:

```bash
rustc --version && \
rustup target list --installed | grep wasm32v1-none && \
stellar --version && \
circom --version && \
node --version && \
pnpm --version && \
python3 --version
```

> **Important:** Make sure `circom --version` reports `2.1.x` (the Rust compiler from `iden3/circom`), **not** the deprecated `0.5.x` JavaScript package from `npm install -g circom`. Only Circom `2.1+` supports `--prime bls12381`.

---

## 2. Repository Structure

```text
LetsPay/
├── circuits/
│   ├── deposit_new.circom          # First-ever confidential deposit
│   ├── deposit_topup.circom        # Subsequent deposit (old commitment required)
│   ├── withdraw.circom             # Deshield (balance decreases, remains >= 0)
│   ├── escrow_lock.circom          # Payer locks confidential balance into escrow
│   ├── escrow_settle.circom        # Payee claims escrow (existing confidential balance)
│   ├── escrow_settle_new.circom    # Payee claims escrow (first confidential balance)
│   ├── escrow_cancel.circom        # Payer reclaims cancelled escrow
│   ├── payroll_notes.circom        # Confidential batch payroll — note model (10 slots)
│   ├── minimum_wage.circom         # Prove all active salaries >= min_wage
│   ├── pay_equity.circom           # Prove |avgA - avgB| <= epsilon
│   ├── income_proof.circom         # Prove sum of active notes >= threshold (8 slots)
│   └── salary_bracket.circom       # Prove note salary in [bracket_low, bracket_high]
├── contracts/
│   ├── payroll_verifier/           # Confidential ledger, escrow, payroll, auto-receive, Groth16 verifier
│   └── salary_bracket_verifier/    # Compliance attestations + cross-contract batch queries
├── client/
│   ├── app/                        # Next.js 16 App Router pages (/wallet, /employer, /invoice, /attest, /auditor, /history, /verify)
│   ├── lib/
│   │   ├── stellar/                # Runtime env config, contract clients, Stellar Wallets Kit provider
│   │   ├── zk/                     # Browser Groth16 proof generators, x25519 ECDH note crypto, view keys
│   │   └── bindings/               # Generated TypeScript contract bindings
│   ├── public/circuits/            # Browser .wasm, .zkey, and _vk.json artifacts
│   └── .env.example                # Frontend environment variable template
├── scripts/                        # Ceremony, deployment, fixture generation, and E2E scripts
└── deployments/testnet.json        # Active Stellar Testnet contract IDs & token SACs
```

---

## 3. Install Dependencies

Clone the repository and install dependencies across all three workspace packages (`root`, `circuits`, and `client`):

```bash
git clone https://github.com/FurtPay/LetsPay.git
cd LetsPay

# 1. Root script dependencies (tsx + @stellar/stellar-sdk for E2E & fixture scripts)
pnpm install

# 2. Circuit dependencies (circomlib + snarkjs)
cd circuits && pnpm install && cd ..

# 3. Frontend dependencies (Next.js 16, React 19, Stellar Wallets Kit, noble crypto)
cd client && pnpm install && cd ..
```

---

## 4. Environment Variables

Copy `client/.env.example` to `client/.env.local`:

```bash
cp client/.env.example client/.env.local
```

### Frontend Environment Variables (`client/.env.local`)

All frontend configuration is read at runtime in `client/lib/stellar/config.ts`:

| Variable | Required | Default / Testnet Value | Description |
|---|---|---|---|
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Yes | `https://soroban-testnet.stellar.org` | Soroban JSON-RPC endpoint used for transaction simulation, submission, and ledger queries. |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Yes | `Test SDF Network ; September 2015` | Stellar network passphrase used when signing transactions. |
| `NEXT_PUBLIC_PAYROLL_CONTRACT_ID` | Yes | `CDTL5N2EKQM7DA7UVU7EQ66FJJ6HPDAHFKNJR4BS2BUYOHFBAJUBG4XL` | Deployed `payroll_verifier` contract ID (matches `deployments/testnet.json`). |
| `NEXT_PUBLIC_SBV_CONTRACT_ID` | Yes | `CCIWKQCR3PHRBE5M6JJAUFTQOYKFQE5JNTGMX5NBERIDYNQOQRRKFEQR` | Deployed `salary_bracket_verifier` contract ID (matches `deployments/testnet.json`). |
| `NEXT_PUBLIC_XLM_SAC` | Yes | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | Stellar Asset Contract (SAC) address for native XLM on Testnet. |
| `NEXT_PUBLIC_USDC_SAC` | Yes | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | Stellar Asset Contract (SAC) address for Circle Testnet USDC. |

### CLI & E2E Script Environment Variables

When running deployment or E2E scripts in `scripts/`, the following shell environment variables are used:

| Variable | Used By | Description |
|---|---|---|
| `SECRET_KEY` | `scripts/e2e_*.ts`, `scripts/init_sbv.ts`, `scripts/set_attestation_vks.ts` | Stellar secret key (`S...`) of the funded Testnet account (e.g. `export SECRET_KEY=$(stellar keys secret maylord)`). |
| `STELLAR_IDENTITY` | `scripts/deploy.sh`, `scripts/deploy_sbv.sh`, `scripts/add_tokens.sh` | Optional Stellar CLI identity name (defaults to `maylord` if omitted). |

---

## 5. Frontend Startup

Because `client/public/circuits/` already includes pre-generated `.wasm`, `.zkey`, and `_vk.json` development ceremony artifacts and `deployments/testnet.json` points to live Testnet contracts, you can start the frontend immediately after configuring `client/.env.local`:

```bash
cd client
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser with a Stellar wallet extension installed (Freighter, LOBSTR, or xBull) switched to **Testnet**.

### Frontend Commands Reference

```bash
cd client
pnpm dev      # Start Next.js 16 development server on http://localhost:3000
pnpm build    # Build production bundle and run TypeScript typechecking
pnpm start    # Serve production build locally
pnpm lint     # Run ESLint across client/
```

### Application Routes

| Route | Description |
|---|---|
| `/` | Landing page and protocol overview |
| `/wallet` | Confidential wallet: shield (`deposit_new` / `deposit_topup`), deshield (`withdraw`), enrol x25519 viewing key, and one-click claim pending notes |
| `/employer` | Confidential batch payroll: generate `payroll_notes` Groth16 proof in browser, ECDH-encrypt notes, disburse, and export auditor view-key packet |
| `/invoice` | Confidential invoice escrow: payer locks shielded funds (`escrow_lock`); contractor settles (`escrow_settle` / `escrow_settle_new`) |
| `/attest` | Employer compliance attestations (`minimum_wage`, `pay_equity`) and employee `income_proof` |
| `/auditor` | Generate auditor x25519 key pair; decrypt and verify employer salary packets against on-chain commitment |
| `/history` | On-chain attestation and batch payment history |
| `/verify` | Read-only verifier to inspect note commitments against on-chain escrow records |

---

## 6. Smart Contract Build & Test Commands

### Build Contracts for Soroban (`wasm32v1-none`)

```bash
# Build all workspace contracts
cargo build --workspace

# Build optimized WASM binaries using Stellar CLI
stellar contract build --manifest-path contracts/payroll_verifier/Cargo.toml --optimize
stellar contract build --manifest-path contracts/salary_bracket_verifier/Cargo.toml --optimize
```

### Run Contract Unit Tests

```bash
# Run all unit tests across both contracts
cargo test --workspace

# Run payroll_verifier unit tests only
cargo test -p payroll_verifier

# Run salary_bracket_verifier unit tests only
cargo test -p salary_bracket_verifier
```

### Run Fixture-Based Groth16 Proof Verification Tests

`contracts/payroll_verifier` includes real Groth16 pairing verification tests executed inside the Soroban `testutils` host environment:

```bash
# (Optional) Regenerate fixture JSONs in contracts/payroll_verifier/tests/fixtures/
# Requires circuit artifacts in circuits/build/
pnpm exec tsx scripts/generate_fixtures.ts

# Execute the on-chain Groth16 proof verification tests
cargo test -p payroll_verifier proof
```

---

## 7. Building ZK Circuits & Running Ceremonies (Optional for Local Changes)

If you modify any `.circom` file in `circuits/`, re-run its BLS12-381 compilation and Groth16 phase-2 ceremony:

```bash
# Confidential ledger circuits
bash scripts/setup_ceremony.sh deposit_new
bash scripts/setup_ceremony.sh deposit_topup
bash scripts/setup_ceremony.sh withdraw

# Invoice escrow circuits
bash scripts/setup_ceremony.sh escrow_lock
bash scripts/setup_ceremony.sh escrow_settle
bash scripts/setup_ceremony.sh escrow_settle_new
bash scripts/setup_ceremony.sh escrow_cancel

# Confidential batch payroll (~50k constraints; allow 20–40 min)
bash scripts/setup_ceremony.sh payroll_notes

# Compliance & income attestation circuits
bash scripts/setup_ceremony.sh minimum_wage
bash scripts/setup_ceremony.sh pay_equity
bash scripts/setup_ceremony.sh income_proof
bash scripts/setup_ceremony.sh salary_bracket
```

Each run outputs `.r1cs`, `.wasm`, `.zkey`, and `_vk.json` into `circuits/build/` and automatically copies the browser proving artifacts to `client/public/circuits/`.

---

## 8. End-to-End (E2E) Testnet Commands

To run the automated E2E scripts against Stellar Testnet:

1. Create and fund a Stellar Testnet identity:

```bash
stellar keys generate maylord --network testnet
stellar keys fund maylord --network testnet
export SECRET_KEY=$(stellar keys secret maylord)
```

2. Execute the E2E verification suites from the repository root:

```bash
# 1. Confidential ledger: deposit_new -> deposit_topup -> withdraw (also uploads VKs if admin)
pnpm exec tsx scripts/e2e_confidential.ts

# 2. Confidential invoice escrow: escrow_lock -> escrow_settle -> withdraw
pnpm exec tsx scripts/e2e_invoice_confidential.ts

# 3. Confidential payroll batch: disburse_confidential -> 3 recipient claims -> withdraw
pnpm exec tsx scripts/e2e_payroll_confidential.ts

# 4. Auto-receive: register x25519 viewing key -> encrypted note -> auto-decrypt -> claim
pnpm exec tsx scripts/e2e_autoreceive.ts

# 5. Stealth recipient address payment & claim
pnpm exec tsx scripts/e2e_stealth.ts

# 6. Compliance attestations: minimum_wage & pay_equity
pnpm exec tsx scripts/e2e_attestations.ts

# 7. Employee cumulative income attestation (polls for Soroban RPC indexing lag)
pnpm exec tsx scripts/e2e_income_only.ts

# 8. Salary bracket proof verification
pnpm exec tsx scripts/e2e_bracket_confidential.ts
```

---

## 9. Common Setup Errors & Troubleshooting

| Symptom / Error | Root Cause | Resolution |
|---|---|---|
| `Unknown argument: --prime` when running `circom` | You have the legacy JavaScript `circom` (`0.5.x`) installed via `npm install -g circom` instead of the Rust Circom `2.1.x` compiler. | Uninstall the npm package (`npm uninstall -g circom`) and install Circom `2.1.6+` from source via Cargo (`cargo install --path circom`), ensuring `~/.cargo/bin` precedes `/usr/local/bin` in `PATH`. |
| `circomlib missing: (cd circuits && pnpm add -D circomlib snarkjs)` | `circuits/node_modules` has not been installed yet. | Run `cd circuits && pnpm install && cd ..` before invoking `bash scripts/setup_ceremony.sh`. |
| On-chain verification fails with `InvalidProof` / commitment mismatch after computing Poseidon in JS | `circomlibjs` hardcodes the **BN254** prime field, whereas LetsPay circuits use **BLS12-381** (`--prime bls12381`). | Never compute Poseidon commitments using `circomlibjs`. Always obtain commitments from the circuit's `snarkjs.groth16.fullProve` output (`publicSignals`) and persist the returned commitment string. |
| `Duplicate identifier 'DataKey'` or `'Errors'` after running `stellar contract bindings typescript` | `salary_bracket_verifier` cross-calls `payroll_verifier`, causing Stellar CLI to emit both contracts' `DataKey`/`Errors` enums in the generated `index.ts`. | Run the deduplication snippet in `docs/DEPLOYMENT.md` (Section 6) to strip the duplicate `export type DataKey` block in `client/lib/bindings/salary_bracket_verifier/src/index.ts`. |
| Browser console reports `404 Not Found` for `/circuits/<name>.wasm` or `/circuits/<name>.zkey` | The circuit artifacts were not copied into `client/public/circuits/`. | Run `bash scripts/setup_ceremony.sh <circuit_name>` (or verify `client/public/circuits/` is intact in `git status`). |
| `Error: NEXT_PUBLIC_PAYROLL_CONTRACT_ID is not set` in the browser | `client/.env.local` is missing or empty. | Run `cp client/.env.example client/.env.local` and verify `NEXT_PUBLIC_PAYROLL_CONTRACT_ID` and `NEXT_PUBLIC_SBV_CONTRACT_ID` match `deployments/testnet.json`. |
| `error[E0463]: can't find crate for std` or WASM build rejected with `reference-types not enabled` | Building Soroban contracts with `wasm32-unknown-unknown` on Rust `1.82+` emits WebAssembly reference types not supported by Soroban. | Always build with target `wasm32v1-none` (`rustup target add wasm32v1-none` and `stellar contract build --optimize`). |
| `e2e_income_only.ts` or attestation scripts fail immediately after payroll disbursement | Testnet RPC indexing lag between ledger close and event/state visibility. | Wait 1–2 ledgers (~5–10 seconds) and re-run `pnpm exec tsx scripts/e2e_income_only.ts`, which includes built-in polling retries. |
