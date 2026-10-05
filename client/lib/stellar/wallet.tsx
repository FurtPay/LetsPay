"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { StellarWalletsKit, SwkAppDarkTheme, SwkAppLightTheme } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { Networks } from "@stellar/stellar-sdk";

const NETWORK = Networks.TESTNET;

/** App-branded modal theme — Tailwind zinc + emerald, matched to the OS colour scheme. */
function brandedTheme() {
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const base = dark ? SwkAppDarkTheme : SwkAppLightTheme;
  const c = dark
    ? { bg: "#09090b", bg2: "#18181b", fgStrong: "#fafafa", fg: "#d4d4d8", fg2: "#71717a", border: "#27272a" }
    : { bg: "#ffffff", bg2: "#fafafa", fgStrong: "#18181b", fg: "#3f3f46", fg2: "#71717a", border: "#e4e4e7" };
  return {
    ...base,
    background: c.bg,
    "background-secondary": c.bg2,
    "foreground-strong": c.fgStrong,
    foreground: c.fg,
    "foreground-secondary": c.fg2,
    border: c.border,
    primary: "#059669",            // emerald-600 — the app accent
    "primary-foreground": "#ffffff",
    danger: "#ef4444",
    "border-radius": "0.625rem",
    "font-family": "ui-sans-serif, system-ui, -apple-system, sans-serif",
  };
}

let kitInitialized = false;
function ensureKit() {
  if (kitInitialized) return;
  StellarWalletsKit.init({
    modules: defaultModules(),
    network: NETWORK,
    theme: brandedTheme(),
    authModal: { showInstallLabel: true }, // users without a wallet get install links
  });
  kitInitialized = true;
}

/**
 * Closing the modal rejects too — the kit throws an empty `{}` with no message.
 * Treat any message-less rejection as a cancel; only surface rejections that
 * carry a real error message (and aren't themselves a cancel phrase).
 */
function isUserCancel(err: unknown): boolean {
  const m = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!m.trim()) return true; // modal closed — no error to show
  return /clos|cancel|dismiss|reject|abort|denied/.test(m.toLowerCase());
}

interface WalletState {
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  switchAccount: () => Promise<void>;
  disconnect: () => void;
  openProfile: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    ensureKit();
    StellarWalletsKit.getAddress()
      .then(({ address: addr }) => setAddress(addr))
      .catch(() => {}); // not previously connected — expected, stay silent
  }, []);

  const connect = useCallback(async () => {
    ensureKit();
    setConnecting(true);
    try {
      const { address: addr } = await StellarWalletsKit.authModal();
      setAddress(addr);
    } catch (err) {
      if (!isUserCancel(err)) {
        console.error("[wallet] connect failed:", err);
        toast.error(err instanceof Error ? err.message : "Wallet connection failed");
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  // Re-read the account currently active in the wallet extension. Use after
  // switching accounts in Freighter so the app follows along (a stale address
  // is what makes the network reject a signed tx with `txBadAuth`).
  const switchAccount = useCallback(async () => {
    try {
      const { address: addr } = await StellarWalletsKit.fetchAddress();
      setAddress(addr);
      toast.success(`Now using ${addr.slice(0, 4)}…${addr.slice(-4)}`);
    } catch {
      await connect(); // not connected yet — open the picker instead
    }
  }, [connect]);

  const disconnect = useCallback(() => {
    StellarWalletsKit.disconnect();
    setAddress(null);
  }, []);

  const openProfile = useCallback(() => {
    StellarWalletsKit.profileModal().catch(() => {});
  }, []);

  const signTransaction = useCallback(async (xdr: string) => {
    if (!address) throw new Error("Wallet not connected");

    // Guard: a wallet on the wrong network or account signs a valid-looking tx
    // that the network then rejects with an opaque `txBadAuth`. Catch it here.
    const { networkPassphrase: walletNet } = await StellarWalletsKit.getNetwork();
    if (walletNet !== NETWORK) {
      throw new Error(
        `Your wallet is on the wrong network. Switch it to Testnet ("${NETWORK}") and try again.`
      );
    }

    const { signedTxXdr, signerAddress } = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: NETWORK,
      address,
    });
    if (signerAddress && signerAddress !== address) {
      throw new Error(
        `Your wallet signed with a different account (${signerAddress.slice(0, 6)}…) ` +
        `than the connected one (${address.slice(0, 6)}…). Select the connected account in your wallet, or reconnect.`
      );
    }
    return signedTxXdr;
  }, [address]);

  return (
    <WalletContext.Provider value={{ address, connecting, connect, switchAccount, disconnect, openProfile, signTransaction }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
