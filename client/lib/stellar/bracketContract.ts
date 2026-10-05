import { SBV_CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE } from "./config";

export function makeBracketClient(
  publicKey: string,
  signTransaction: (xdr: string) => Promise<string>
) {
  if (!SBV_CONTRACT_ID)
    throw new Error("NEXT_PUBLIC_SBV_CONTRACT_ID is not set — run: bash scripts/deploy_sbv.sh");
  // Bindings imported dynamically so the build doesn't break before they are generated
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require("@/lib/bindings/salary_bracket_verifier/src/index");
  return new Client({
    contractId: SBV_CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey,
    signTransaction: async (xdr: string) => ({ signedTxXdr: await signTransaction(xdr) }),
  });
}
