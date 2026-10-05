#!/usr/bin/env tsx
/**
 * Initializes the salary_bracket_verifier contract with vk_bracket and
 * the payroll_verifier address. Called by deploy_sbv.sh.
 *
 * Usage: tsx scripts/init_sbv.ts <sbv_id> <payroll_id> <identity> <network>
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { encodeVerificationKey } from "../client/lib/zk/groth16Codec";

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";

const [sbvId, payrollId, identity, networkArg] = process.argv.slice(2);
if (!sbvId || !payrollId || !identity) {
  console.error("Usage: tsx scripts/init_sbv.ts <sbv_id> <payroll_id> <identity> [network]");
  process.exit(1);
}

const NETWORK = networkArg === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

const secretKey = process.env.SECRET_KEY ??
  execSync(`stellar keys secret ${identity}`, { encoding: "utf8" }).trim();
const admin = Keypair.fromSecret(secretKey);

function toBuffer(b: Uint8Array): Buffer { return Buffer.from(b); }

async function main() {
  // Load salary_bracket VK
  const vkPath = path.join(ROOT, "circuits/build/salary_bracket_vk.json");
  const vkJson = JSON.parse(fs.readFileSync(vkPath, "utf8"));
  const vkBytes = encodeVerificationKey(vkJson);
  if (vkBytes.ic.length !== 4)
    throw new Error(`salary_bracket VK IC len ${vkBytes.ic.length} — expected 4 (3 signals + 1)`);
  console.log("salary_bracket VK IC len: 4 ✓");

  // Load generated SBV bindings
  const bindingsPath = path.join(ROOT, "client/lib/bindings/salary_bracket_verifier/src/index.ts");
  let Client: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ Client } = require(bindingsPath));
  } catch (importErr: unknown) {
    console.log("  ❌ Failed to load SBV bindings:", (importErr as Error).message ?? importErr);
    console.log("  Run: stellar contract bindings typescript --contract-id <SBV_ID> --network testnet --output-dir client/lib/bindings/salary_bracket_verifier --overwrite");
    process.exit(1);
  }

  const client = new Client({
    contractId: sbvId,
    networkPassphrase: NETWORK,
    rpcUrl: RPC_URL,
    publicKey: admin.publicKey(),
    signTransaction: async (xdrStr: string) => {
      const tx = TransactionBuilder.fromXDR(xdrStr, NETWORK) as Transaction;
      tx.sign(admin);
      return { signedTxXdr: tx.toEnvelope().toXDR("base64") };
    },
  });

  try {
    const initTx = await client.initialize({
      admin: admin.publicKey(),
      vk_bracket: {
        alpha: toBuffer(vkBytes.alpha),
        beta:  toBuffer(vkBytes.beta),
        delta: toBuffer(vkBytes.delta),
        gamma: toBuffer(vkBytes.gamma),
        ic:    vkBytes.ic.map(toBuffer),
      },
      payroll_verifier: payrollId,
    });
    const { result } = await initTx.signAndSend();
    if (result.isErr()) {
      const e = result.unwrapErr();
      if (JSON.stringify(e).includes("AlreadyInitialized")) {
        console.log("  ℹ️  SBV already initialized — skipping");
      } else {
        throw new Error(JSON.stringify(e));
      }
    } else {
      console.log("  ✅ salary_bracket_verifier initialized");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("AlreadyInitialized") || msg.includes("#1")) {
      console.log("  ℹ️  SBV already initialized — skipping");
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error("❌ init_sbv failed:", err.message ?? err);
  process.exit(1);
});
