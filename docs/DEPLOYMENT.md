# Stellar Testnet Deployment & Verification Guide

This document explains how LetsPay (`payroll_verifier` and `salary_bracket_verifier`) smart contracts are built, deployed, initialized, and verified on **Stellar Testnet**, how [`deployments/testnet.json`](../deployments/testnet.json) is structured, and how Testnet configuration differs from a production **Stellar Mainnet** deployment.

---

## 1. Live Stellar Testnet Contract Addresses

The canonical Testnet deployment records live in [`deployments/testnet.json`](../deployments/testnet.json):

| Contract / Asset | Stellar Testnet Address (`C...`) | Purpose | Explorer Link |
|---|---|---|---|
| `payroll_verifier` | `CDTL5N2EKQM7DA7UVU7EQ66FJJ6HPDAHFKNJR4BS2BUYOHFBAJUBG4XL` | Core confidential balance ledger (`deposit_new`, `deposit_topup`, `withdraw`), confidential invoice escrow (`create_escrow`, `settle_escrow`, `settle_escrow_new`, `cancel_escrow`), confidential batch payroll (`disburse_confidential`), and x25519 auto-receive viewing key registry | [View on stellar.expert](https://stellar.expert/explorer/testnet/contract/CDTL5N2EKQM7DA7UVU7EQ66FJJ6HPDAHFKNJR4BS2BUYOHFBAJUBG4XL) |
| `salary_bracket_verifier` | `CCIWKQCR3PHRBE5M6JJAUFTQOYKFQE5JNTGMX5NBERIDYNQOQRRKFEQR` | Zero-knowledge compliance attestations (`prove_min_wage`, `prove_pay_equity`, `prove_income`) and salary bracket verification; cross-calls `payroll_verifier` to read batch commitments | [View on stellar.expert](https://stellar.expert/explorer/testnet/contract/CCIWKQCR3PHRBE5M6JJAUFTQOYKFQE5JNTGMX5NBERIDYNQOQRRKFEQR) |
| `XLM` (Native SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | Wrapped native Stellar Lumens token contract on Testnet | [View on stellar.expert](https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) |
| `USDC` (Testnet SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | Circle Testnet USDC Stellar Asset Contract | [View on stellar.expert](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |

---

## 2. Understanding `deployments/testnet.json`

`deployments/testnet.json` is the single source of truth read by deployment scripts (`scripts/deploy_sbv.sh`, `scripts/add_tokens.sh`, `scripts/init_sbv.ts`, `scripts/set_attestation_vks.ts`) and E2E test suites (`scripts/e2e_*.ts`).

```json
{
  "network": "testnet",
  "identity": "maylord",
  "payroll_verifier": "CDTL5N2EKQM7DA7UVU7EQ66FJJ6HPDAHFKNJR4BS2BUYOHFBAJUBG4XL",
  "deployed_at": "2026-06-22T22:49:01Z",
  "tokens": {
    "xlm": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "usdc": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
  },
  "_note": "Current build: confidential ledger, invoice escrow, confidential payroll (note model), and auto-receive (viewing keys + encrypted notes). salary_bracket_verifier redeployed against this payroll address.",
  "payroll_verifier_prev": "CCGSMNZVLXQKAGEWMUPUHHGPXAXHTFZNLRTSSZPBOS3MZROTQFVHTWTE",
  "salary_bracket_verifier": "CCIWKQCR3PHRBE5M6JJAUFTQOYKFQE5JNTGMX5NBERIDYNQOQRRKFEQR"
}
```

### Field Reference

| Field | Type | Description |
|---|---|---|
| `network` | `string` | Target Stellar CLI network name (`"testnet"`). |
| `identity` | `string` | Stellar CLI local key identity used as deployer and contract `admin` (default: `"maylord"`). |
| `payroll_verifier` | `string` | Active `payroll_verifier` contract address (`C...`). Written by `scripts/deploy.sh`. |
| `salary_bracket_verifier` | `string` | Active `salary_bracket_verifier` contract address (`C...`). Written by `scripts/deploy_sbv.sh`. |
| `deployed_at` | `string` | ISO-8601 UTC timestamp of when `payroll_verifier` was deployed. |
| `tokens.xlm` | `string` | Native XLM Stellar Asset Contract (SAC) address allow-listed on `payroll_verifier`. |
| `tokens.usdc` | `string` | Testnet USDC SAC address allow-listed via `scripts/add_tokens.sh`. |
| `payroll_verifier_prev` | `string` | Previous `payroll_verifier` contract ID retained for historical reference after a fresh redeploy. |
| `_note` | `string` | Human-readable summary of the capabilities enabled in the current deployment. |

> **Redeployment Coupling:** Because `salary_bracket_verifier` stores the `payroll_verifier` contract address at initialization time to perform cross-contract `get_batch` calls, **redeploying `payroll_verifier` always requires redeploying `salary_bracket_verifier` afterward**.

---

## 3. End-to-End Testnet Deployment Process

### Step 1: Provision and Fund a Deployer Identity

```bash
stellar keys generate maylord --network testnet
stellar keys fund maylord --network testnet
stellar account show $(stellar keys address maylord) --network testnet
```

### Step 2: Ensure Circuit Verification Keys (`_vk.json`) Exist

Deployment initialization reads the exported Groth16 verification keys from `circuits/build/*_vk.json` (or `client/public/circuits/*_vk.json`). If `circuits/build/` is empty, either copy the pre-generated keys from `client/public/circuits/` or run `scripts/setup_ceremony.sh`:

```bash
mkdir -p circuits/build
cp client/public/circuits/*_vk.json circuits/build/
```

### Step 3: Build & Deploy `payroll_verifier`

Run `scripts/deploy.sh`:

```bash
bash scripts/deploy.sh testnet maylord
```

What `scripts/deploy.sh` does:
1. Compiles and optimizes `contracts/payroll_verifier` via `stellar contract build --manifest-path contracts/payroll_verifier/Cargo.toml --optimize`.
2. Deploys `target/wasm32v1-none/release/payroll_verifier.optimized.wasm` to Stellar Testnet using `--source maylord`.
3. Writes `payroll_verifier` and `deployed_at` to `deployments/testnet.json`.

### Step 4: Initialize `payroll_verifier` & Register All Circuit VKs

Run `scripts/e2e_confidential.ts` with the deployer's secret key to initialize `payroll_verifier` (if not yet initialized) and upload all Groth16 verifying keys (`deposit_new`, `deposit_topup`, `withdraw`, `escrow_lock`, `escrow_settle`, `escrow_settle_new`, `escrow_cancel`, `payroll_notes`) plus allow-list XLM:

```bash
export SECRET_KEY=$(stellar keys secret maylord)
pnpm exec tsx scripts/e2e_confidential.ts
```

### Step 5: Allow-List Additional Tokens (USDC)

```bash
bash scripts/add_tokens.sh testnet maylord
```

This resolves the native XLM SAC and Circle Testnet USDC SAC (`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`), invokes `add_token` on `payroll_verifier`, and records the `tokens` map in `deployments/testnet.json`.

### Step 6: Build, Deploy, and Initialize `salary_bracket_verifier`

```bash
bash scripts/deploy_sbv.sh testnet maylord
```

What `scripts/deploy_sbv.sh` does:
1. Reads `payroll_verifier` from `deployments/testnet.json`.
2. Builds and optimizes `contracts/salary_bracket_verifier`.
3. Deploys `salary_bracket_verifier.optimized.wasm` to Testnet.
4. Invokes `scripts/init_sbv.ts` to initialize the contract with `vk_bracket` and the `payroll_verifier` address.
5. Updates `salary_bracket_verifier` in `deployments/testnet.json`.

Next, register the three compliance attestation verifying keys (`minimum_wage`, `pay_equity`, `income_proof`) on `salary_bracket_verifier`:

```bash
SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/set_attestation_vks.ts
```

### Step 7: Regenerate TypeScript Client Bindings & Update `.env.local`

```bash
PV_ID=$(python3 -c "import json; print(json.load(open('deployments/testnet.json'))['payroll_verifier'])")
stellar contract bindings typescript \
  --contract-id "$PV_ID" --network testnet \
  --output-dir client/lib/bindings/payroll_verifier --overwrite

SBV_ID=$(python3 -c "import json; print(json.load(open('deployments/testnet.json'))['salary_bracket_verifier'])")
stellar contract bindings typescript \
  --contract-id "$SBV_ID" --network testnet \
  --output-dir client/lib/bindings/salary_bracket_verifier --overwrite

# Deduplicate cross-contract DataKey type in salary_bracket_verifier bindings
python3 -c "
import re, pathlib
f = pathlib.Path('client/lib/bindings/salary_bracket_verifier/src/index.ts')
txt = f.read_text()
txt = re.sub(r'(export type DataKey = .*?;)\n\n\1', r'\1', txt, flags=re.DOTALL)
f.write_text(txt)
"
```

Finally, update `NEXT_PUBLIC_PAYROLL_CONTRACT_ID` and `NEXT_PUBLIC_SBV_CONTRACT_ID` in `client/.env.local`.

---

## 4. Testnet Verification Procedures

After deploying or when verifying the existing Testnet deployment, run the following checks:

### 4.1 Read-Only CLI Inspection

Verify that the contracts are live and initialized on Stellar Testnet using `stellar contract invoke`:

```bash
PV_ID=$(python3 -c "import json; print(json.load(open('deployments/testnet.json'))['payroll_verifier'])")
XLM_SAC=$(python3 -c "import json; print(json.load(open('deployments/testnet.json'))['tokens']['xlm'])")

# Check whether XLM is allow-listed on payroll_verifier (returns true)
stellar contract invoke \
  --id "$PV_ID" \
  --network testnet \
  -- is_token_supported \
  --token "$XLM_SAC"
```

### 4.2 Full On-Chain Proof & Settlement Verification Suite

Run the end-to-end TypeScript verification scripts against Stellar Testnet:

```bash
export SECRET_KEY=$(stellar keys secret maylord)

pnpm exec tsx scripts/e2e_confidential.ts          # Confidential deposit, top-up, withdraw
pnpm exec tsx scripts/e2e_invoice_confidential.ts  # Confidential escrow lock & settle
pnpm exec tsx scripts/e2e_payroll_confidential.ts  # Batch payroll disburse & 3 recipient claims
pnpm exec tsx scripts/e2e_autoreceive.ts           # Viewing key enrolment & ECDH note claim
pnpm exec tsx scripts/e2e_attestations.ts          # Min-wage & pay-equity on-chain attestations
pnpm exec tsx scripts/e2e_income_only.ts           # Employee income proof attestation
pnpm exec tsx scripts/e2e_bracket_confidential.ts  # Salary bracket proof verification
```

---

## 5. Testnet vs. Production (Mainnet) Configuration

Do **not** reuse Testnet keys, ceremony artifacts, or single-key admin configurations in production. The table below summarizes the mandatory separation between **Testnet** and **Production (Mainnet)**:

| Dimension | Stellar Testnet (Development) | Stellar Mainnet (Production) |
|---|---|---|
| **Network CLI Flag** | `--network testnet` | `--network mainnet` |
| **Soroban RPC URL (`NEXT_PUBLIC_STELLAR_RPC_URL`)** | `https://soroban-testnet.stellar.org` | Dedicated high-availability Mainnet Soroban RPC provider (e.g., validation cloud / QuickNode / self-hosted Captive Core) |
| **Network Passphrase (`NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`)** | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| **Deployment Manifest** | `deployments/testnet.json` | `deployments/mainnet.json` (kept strictly separate) |
| **Groth16 Trusted Setup (`.zkey` & `_vk.json`)** | Single local dev contribution generated via `scripts/setup_ceremony.sh` (toxic waste known locally — **insecure for real funds**) | Multi-Party Computation (MPC) phase-1 & phase-2 ceremony with independent contributors and verifiable beacon randomness before exporting production `.zkey` and `_vk.json` |
| **Contract `admin` Authority** | Single local CLI key (`maylord`) funded by Friendbot | Multi-signature Stellar account (e.g., 3-of-5 hardware-backed signers) or governance contract |
| **Contract Upgrade Path** | Fresh contract redeployment (`deploy.sh` + `deploy_sbv.sh`) to bypass the 7-day timelock during rapid iteration | In-place timelocked upgrades via `propose_upgrade(admin, new_wasm_hash)` followed by a mandatory **7-day timelock delay** before `execute_upgrade(admin)` |
| **Token Allow-List (`XLM` / `USDC` / `EURC`)** | Testnet XLM SAC & Circle Testnet USDC (`GBBD47...`); EURC skipped | Mainnet native XLM SAC, official Circle Mainnet USDC (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`), and official Circle Mainnet EURC |
| **Confidential State Backup** | Browser `localStorage` + JSON auto-download | Hardware/encrypted vault backup workflow with user recovery verification prior to large shielding operations |
