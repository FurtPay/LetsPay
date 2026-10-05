#!/usr/bin/env tsx
/**
 * Sets the three attestation verification keys on salary_bracket_verifier:
 * minimum_wage, pay_equity, income_proof. Run after deploy_sbv.sh + bindings.
 *
 * Usage: SECRET_KEY=$(stellar keys secret maylord) pnpm exec tsx scripts/set_attestation_vks.ts
 */
import fs from "fs";
import path from "path";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { Client } from "../client/lib/bindings/salary_bracket_verifier/src/index";
import { encodeVerificationKey } from "../client/lib/zk/groth16Codec";

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;

function toBuffer(b: Uint8Array): Buffer { return Buffer.from(b); }

function loadVk(name: string, expectedIc: number) {
  const vk = encodeVerificationKey(
    JSON.parse(fs.readFileSync(path.join(ROOT, `circuits/build/${name}_vk.json`), "utf8"))
  );
  if (vk.ic.length !== expectedIc) throw new Error(`${name} ic ${vk.ic.length} != ${expectedIc}`);
  console.log(`${name} VK ic.len ${expectedIc} ✓`);
  return {
    alpha: toBuffer(vk.alpha), beta: toBuffer(vk.beta),
    delta: toBuffer(vk.delta), gamma: toBuffer(vk.gamma),
    ic: vk.ic.map(toBuffer),
  };
}

async function main() {
  const deploy = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
  const sbvId: string = deploy.salary_bracket_verifier;
  const kp = Keypair.fromSecret(process.env.SECRET_KEY!);
  console.log("sbv :", sbvId);

  const client = new Client({
    contractId: sbvId, networkPassphrase: NETWORK, rpcUrl: RPC_URL,
    publicKey: kp.publicKey(),
    signTransaction: async (xdr: string) => {
      const tx = TransactionBuilder.fromXDR(xdr, NETWORK) as Transaction;
      tx.sign(kp);
      return { signedTxXdr: tx.toEnvelope().toXDR("base64") };
    },
  });

  const tx = await client.set_attestation_vks({
    vk_min_wage: loadVk("minimum_wage", 4),
    vk_pay_equity: loadVk("pay_equity", 4),
    vk_income: loadVk("income_proof", 10),
  });
  const { result } = await tx.signAndSend();
  if (result.isErr()) throw new Error(JSON.stringify(result.unwrapErr()));
  console.log("✅ attestation VKs set");
}

main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
