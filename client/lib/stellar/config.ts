import { Networks } from "@stellar/stellar-sdk";

export const PAYROLL_CONTRACT_ID =
  process.env.NEXT_PUBLIC_PAYROLL_CONTRACT_ID ?? "";

export const SBV_CONTRACT_ID =
  process.env.NEXT_PUBLIC_SBV_CONTRACT_ID ?? "";

export const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

export const XLM_SAC =
  process.env.NEXT_PUBLIC_XLM_SAC ?? "";

export const USDC_SAC =
  process.env.NEXT_PUBLIC_USDC_SAC ?? "";

export const EXPLORER_BASE =
  `https://stellar.expert/explorer/${
    NETWORK_PASSPHRASE === Networks.PUBLIC ? "public" : "testnet"
  }/contract`;
