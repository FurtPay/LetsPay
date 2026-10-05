# Payfurt — Setup & Deployment Guide

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Rust + `wasm32v1-none` target | stable | `rustup target add wasm32v1-none` |
| Stellar CLI | ≥ 25.x | `cargo install --locked stellar-cli --features opt` |
| Circom | 2.1.x | `npm install -g circom` |
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| pnpm | ≥ 9 | `npm install -g pnpm` |

```bash
rustc --version && stellar --version && circom --version && node --version && pnpm --version
```

---

## Repository structure

```
payfurt/
├── circuits/
│   ├── deposit_new.circom          # first-ever confidential deposit
│   ├── deposit_topup.circom        # subsequent deposit (old commitment required)
│   ├── withdraw.circom             # deshield
│   ├── escrow_lock.circom          # payer locks into confidential escrow
│   ├── escrow_settle.circom        # payee claims (existing balance)
│   ├── escrow_settle_new.circom    # payee claims (first balance)
│   ├── escrow_cancel.circom        # payer reclaims
│   ├── payroll_notes.circom        # confidential payroll — note model, 10 slots
│   ├── minimum_wage.circom         # ∀ active salary ≥ min_wage
│   ├── pay_equity.circom           # |avgA − avgB| ≤ epsilon
│   ├── income_proof.circom         # Σ active notes ≥ threshold
│   └── salary_bracket.circom       # salary ∈ [low, high], note-anchored
├── contracts/
│   ├── payroll_verifier/           # ledger, escrow, payroll, auto-receive, Groth16 verifier
│   └── salary_bracket_verifier/    # attestations + cross-call to payroll
├── client/
│   ├── app/
│   │   ├── page.tsx                # landing
│   │   ├── wallet/page.tsx         # deposit/withdraw, auto-receive, claim
│   │   ├── employer/page.tsx       # confidential payroll + auditor export
│   │   ├── invoice/page.tsx        # confidential escrow: lock / settle
│   │   ├── attest/page.tsx         # min-wage, pay-equity, income attestations
│   │   ├── auditor/page.tsx        # decrypt + verify salary packet
│   │   ├── history/page.tsx        # attestation trail
│   │   └── verify/page.tsx         # read-only note commitment checker
│   ├── lib/
│   │   ├── stellar/
│   │   │   ├── config.ts           # all env vars
│   │   │   ├── contract.ts         # makePayrollClient
│   │   │   ├── bracketContract.ts  # makeBracketClient
│   │   │   └── wallet.tsx          # WalletProvider (Stellar Wallets Kit)
│   │   ├── zk/
│   │   │   ├── depositProof.ts
│   │   │   ├── withdrawProof.ts
│   │   │   ├── escrowProof.ts
│   │   │   ├── payrollNotesProof.ts
│   │   │   ├── attestationProof.ts
│   │   │   ├── noteCrypto.ts       # x25519 ECDH note encryption/decryption
│   │   │   ├── viewKey.ts          # auditor AES-GCM view-key packet
│   │   │   ├── confidentialWallet.ts # localStorage secret manager
│   │   │   └── groth16Codec.ts
│   │   └── bindings/               # auto-generated Stellar SDK types
│   ├── public/circuits/            # .wasm + .zkey files (copied by ceremony script)
│   ├── .env.example
│   └── .env.local                  # your values (gitignored)
├── scripts/
│   ├── setup_ceremony.sh           # compile circuit → zkey → export VK
│   ├── deploy.sh                   # build + deploy payroll_verifier
│   ├── deploy_sbv.sh               # build + deploy salary_bracket_verifier
│   ├── init_sbv.ts                 # initialize SBV (VK + payroll contract address)
│   ├── set_attestation_vks.ts      # set min_wage / pay_equity / income VKs on SBV
│   ├── add_tokens.sh               # add tokens to allowlist
│   ├── e2e_confidential.ts         # ledger: deposit → top-up → withdraw (also sets all VKs)
│   ├── e2e_invoice_confidential.ts # invoice: lock → settle → withdraw
│   ├── e2e_payroll_confidential.ts # payroll: disburse → 3 claims → withdraw
│   ├── e2e_autoreceive.ts          # auto-receive end-to-end
│   ├── e2e_stealth.ts              # stealth recipient end-to-end
│   ├── e2e_attestations.ts         # min-wage + pay-equity attestations
│   ├── e2e_income_only.ts          # income proof (separate — polls for RPC lag)
│   └── e2e_bracket_confidential.ts # salary bracket proof
└── deployments/testnet.json        # live contract IDs + token SACs
```

---

## 1. Install dependencies

```bash
# Circuit dependencies (circomlib)
cd circuits && pnpm install && cd ..

# Frontend
cd client && pnpm install && cd ..

# Script runner (tsx + stellar-sdk for e2e scripts)
pnpm install
```

---

## 2. Run ZK ceremonies

Each ceremony compiles a circuit over BLS12-381, runs a Powers-of-Tau phase 1 (shared, generated once), runs a circuit-specific phase 2, exports a `.zkey` and a `_vk.json`, and copies the `.wasm` + `.zkey` to `client/public/circuits/` for browser use.

> **Time budget:** small circuits (`deposit_new`, `withdraw`, etc.) finish in 3–5 min each. `payroll_notes` has 15 public signals and ~50k constraints — `groth16 setup` takes **20–40 min** on a standard laptop. Run it first and let it finish before continuing. All 12 ceremonies together take roughly 2 hours on first run.

> **Package manager:** the project uses **pnpm** throughout. `npm install` will fail. Install pnpm with `npm install -g pnpm` if it is not already available.

```bash
# Confidential ledger
bash scripts/setup_ceremony.sh deposit_new
bash scripts/setup_ceremony.sh deposit_topup
bash scripts/setup_ceremony.sh withdraw

# Invoice escrow
bash scripts/setup_ceremony.sh escrow_lock
bash scripts/setup_ceremony.sh escrow_settle
bash scripts/setup_ceremony.sh escrow_settle_new
bash scripts/setup_ceremony.sh escrow_cancel

# Confidential payroll (slowest — run first, allow 20–40 min for groth16 setup)
bash scripts/setup_ceremony.sh payroll_notes

# Attestations
bash scripts/setup_ceremony.sh minimum_wage
bash scripts/setup_ceremony.sh pay_equity
bash scripts/setup_ceremony.sh income_proof

# Salary bracket (note-anchored)
bash scripts/setup_ceremony.sh salary_bracket
```

Expected outputs per circuit:

```
circuits/build/<name>.r1cs
circuits/build/<name>.zkey
circuits/build/<name>_vk.json
circuits/build/<name>_js/<name>.wasm
client/public/circuits/<name>.wasm
client/public/circuits/<name>.zkey
```

> These are dev-ceremony keys (single local contribution). Run a proper multi-party ceremony before mainnet.

---

## 3. Configure a Stellar identity

```bash
stellar keys generate maylord --network testnet
stellar keys fund maylord --network testnet
stellar account show $(stellar keys address maylord) --network testnet
```

---

## 4. Deploy contracts

### 4a. payroll_verifier

```bash
bash scripts/deploy.sh testnet maylord
```

Builds the Rust contract, deploys to testnet, initializes it (admin + VKs for ledger, escrow, and payroll circuits), and writes the contract ID to `deployments/testnet.json`.

### 4b. salary_bracket_verifier

```bash
bash scripts/deploy_sbv.sh testnet maylord
```

Builds, deploys, and initializes the SBV with its salary bracket VK and the payroll contract address. Also sets the attestation VKs for `minimum_wage`, `pay_equity`, and `income_proof`.

---

## 5. Environment variables

```bash
cp client/.env.example client/.env.local
```

Fill in `client/.env.local`:

```env
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NEXT_PUBLIC_PAYROLL_CONTRACT_ID=<from deployments/testnet.json>
NEXT_PUBLIC_SBV_CONTRACT_ID=<from deployments/testnet.json>
NEXT_PUBLIC_XLM_SAC=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
NEXT_PUBLIC_USDC_SAC=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

All contract IDs are read from env at runtime — nothing is hardcoded in source.

---

## 6. Generate TypeScript bindings

Run after every deploy. Each bindings file needs a one-line dedupe patch to remove a duplicate `DataKey`/`Errors` enum that the CLI pulls in from the cross-contract ABI.

```bash
PV_ID=$(python3 -c "import json; print(json.load(open('deployments/testnet.json'))['payroll_verifier'])")
stellar contract bindings typescript \
  --contract-id "$PV_ID" --network testnet \
  --output-dir client/lib/bindings/payroll_verifier --overwrite

SBV_ID=$(python3 -c "import json; print(json.load(open('deployments/testnet.json'))['salary_bracket_verifier'])")
stellar contract bindings typescript \
  --contract-id "$SBV_ID" --network testnet \
  --output-dir client/lib/bindings/salary_bracket_verifier --overwrite
```

If the SBV bindings contain a duplicated `DataKey` or `Errors` type (both the SBV's own and the payroll's pulled in via cross-contract ABI), remove the second occurrence with a Python one-liner:

```bash
python3 -c "
import re, pathlib
f = pathlib.Path('client/lib/bindings/salary_bracket_verifier/src/index.ts')
txt = f.read_text()
# Remove second DataKey block
txt = re.sub(r'(export type DataKey = .*?;)\n\n\1', r'\1', txt, flags=re.DOTALL)
f.write_text(txt)
"
```

---

## 7. Initialize salary_bracket_verifier

If `deploy_sbv.sh` couldn't initialize automatically (bindings not yet generated at that point):

```bash
SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/init_sbv.ts
SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/set_attestation_vks.ts
```

---

## 8. Fixture-based proof tests

After the ceremonies are complete, generate pre-computed proof fixtures and run the Rust proof tests. These tests verify a real Groth16 proof against the real verifying key inside the Soroban testutils environment — without needing an RPC connection or a live deployment.

```bash
# Generate one fixture JSON per circuit (~5 min, uses existing .zkey and .wasm files)
pnpm exec tsx scripts/generate_fixtures.ts

# Run the fixture-based proof tests
cargo test -p payroll_verifier proof
```

Each fixture is saved to `contracts/payroll_verifier/tests/fixtures/<circuit>.json` and contains the proof (π_A, π_B, π_C), the verifying key, and the public signals — all hex-encoded in the ZCash BE layout that Soroban expects. Commit the `tests/fixtures/` directory so CI can run these tests without re-running the ceremonies.

If a fixture file is missing (ceremony not yet run), the corresponding test prints a skip notice and passes — it never fails on a missing file.

---

## 9. End-to-end verification

Run each script to confirm a full proof → on-chain verify → state update round-trip on testnet. `e2e_confidential.ts` also sets every VK on `payroll_verifier` as a side effect.

```bash
export SECRET_KEY=$(stellar keys secret maylord)

pnpm exec tsx scripts/e2e_confidential.ts          # ledger (also sets all VKs)
pnpm exec tsx scripts/e2e_invoice_confidential.ts
pnpm exec tsx scripts/e2e_payroll_confidential.ts
pnpm exec tsx scripts/e2e_autoreceive.ts
pnpm exec tsx scripts/e2e_stealth.ts
pnpm exec tsx scripts/e2e_attestations.ts
pnpm exec tsx scripts/e2e_income_only.ts           # income proof (separate — RPC lag)
pnpm exec tsx scripts/e2e_bracket_confidential.ts
```

---

## 10. Add tokens to allowlist

```bash
bash scripts/add_tokens.sh testnet maylord
```

Adds USDC. EURC is skipped on testnet (no official Circle testnet issuer).

---

## 11. Run the frontend

```bash
cd client && pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

**Routes:**

| Route | Description |
|---|---|
| `/` | Landing page |
| `/wallet` | Confidential balance: deposit, withdraw, enable auto-receive, claim pending pay |
| `/employer` | Confidential payroll: ZK proof in browser → disburse → auditor view-key export |
| `/invoice` | Confidential invoice escrow: payer locks; contractor settles |
| `/attest` | Employer: minimum-wage + pay-equity attestations. Employee: income proof |
| `/auditor` | Generate x25519 key pair; decrypt + verify encrypted salary packet |
| `/history` | Attestation trail for the connected wallet |
| `/verify` | Read-only: check a note commitment against an on-chain escrow |

---

## Live testnet deployment

| Resource | Value |
|---|---|
| `payroll_verifier` | `CDTL5N2EKQM7DA7UVU7EQ66FJJ6HPDAHFKNJR4BS2BUYOHFBAJUBG4XL` |
| `salary_bracket_verifier` | `CCIWKQCR3PHRBE5M6JJAUFTQOYKFQE5JNTGMX5NBERIDYNQOQRRKFEQR` |
| Network | Stellar Testnet |
| XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| USDC SAC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Explorer | [stellar.expert →](https://stellar.expert/explorer/testnet/contract/CDTL5N2EKQM7DA7UVU7EQ66FJJ6HPDAHFKNJR4BS2BUYOHFBAJUBG4XL) |

> The contract is redeployed fresh on each change (the 7-day upgrade timelock makes in-place upgrades impractical under a hackathon timeline). Always read the current IDs from `deployments/testnet.json`. Redeploying `payroll_verifier` forces a `salary_bracket_verifier` redeploy too since SBV cross-calls payroll by address.

---

## Circuit signal reference

### Confidential ledger

| Circuit | IC len | Signals (output-first) |
|---|---|---|
| `deposit_new` | 3 | `[commitment, amount]` |
| `deposit_topup` | 4 | `[new_commitment, old_commitment, amount]` |
| `withdraw` | 4 | `[new_commitment, old_commitment, amount]` |

### Confidential escrow

| Circuit | IC len | Signals (output-first) |
|---|---|---|
| `escrow_lock` | 4 | `[new_commitment, escrow_commitment, old_commitment]` |
| `escrow_settle` | 6 | `[payee_new_commitment, escrow_commitment, invoice_min, invoice_max, payee_old_commitment]` |
| `escrow_settle_new` | 5 | `[payee_commitment, escrow_commitment, invoice_min, invoice_max]` |
| `escrow_cancel` | 4 | `[new_commitment, escrow_commitment, old_commitment]` |

### Confidential payroll

| Circuit | IC len | Signals (output-first) |
|---|---|---|
| `payroll_notes` | 15 | `[payroll_commitment, note_commitment[0..9], total_budget, max_salary, active_count]` |

### Attestations

| Circuit | IC len | Signals (output-first) | Key constraint |
|---|---|---|---|
| `minimum_wage` | 4 | `[payroll_commitment, min_wage, active_count]` | ∀ active i: `sal[i] >= min_wage` |
| `pay_equity` | 4 | `[payroll_commitment, epsilon, active_count]` | `\|sumA·cntB − sumB·cntA\| <= epsilon·cntA·cntB` |
| `income_proof` | 10 | `[note_commitment[0..7], threshold]` | `Σ active amount >= threshold` |

### Salary bracket

| Circuit | IC len | Signals (output-first) |
|---|---|---|
| `salary_bracket` | 4 | `[note_commitment, bracket_low, bracket_high]` |

> **BN254 vs BLS12-381:** All circuits are compiled with `--prime bls12381`. Commitments are Poseidon over the BLS12-381 scalar field. `circomlibjs` hardcodes BN254 — never use it to recompute commitments. Always carry the last-known `commitmentDecimal` from `groth16.fullProve` output.

---

## Security notes

- All ZK keys are dev-ceremony (single local contribution). Run a proper multi-party ceremony for mainnet.
- Contract upgrade is timelocked (7-day delay via `propose_upgrade → execute_upgrade`).
- Payroll commitments are employer-scoped nullifiers — cannot be replayed.
- CEI pattern is enforced in all escrow and ledger flows (state written before any outbound transfer).
- Soroban persistent storage entries are TTL-bumped on every access.
- The confidential wallet backup file is the sole recovery path for shielded funds. Losing it with no copy is equivalent to losing a seed phrase.
