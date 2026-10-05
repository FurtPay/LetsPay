import { Client } from "@/lib/bindings/payroll_verifier/src/index";
import { PAYROLL_CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE } from "./config";

export function makePayrollClient(
  publicKey: string,
  signTransaction: (xdr: string) => Promise<string>
) {
  if (!PAYROLL_CONTRACT_ID) throw new Error("NEXT_PUBLIC_PAYROLL_CONTRACT_ID is not set");
  return new Client({
    contractId: PAYROLL_CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey,
    signTransaction: async (xdr) => ({ signedTxXdr: await signTransaction(xdr) }),
  });
}
