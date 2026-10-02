"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/stellar/wallet";

function SplitMark({ s = 20 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs><clipPath id="hdr-lh"><rect x="5" y="5" width="11" height="22" /></clipPath></defs>
      <rect x="5" y="5" width="22" height="22" rx="6.5" stroke="#5ed29c" strokeWidth="2.5" />
      <rect x="5" y="5" width="22" height="22" rx="6.5" fill="#5ed29c" clipPath="url(#hdr-lh)" />
    </svg>
  );
}

const NAV = [
  ["/wallet", "Wallet"], ["/employer", "Payroll"], ["/invoice", "Invoice"],
  ["/attest", "Attest"], ["/auditor", "Auditor"], ["/history", "History"],
] as const;

/** Deterministic colour from an address — a tiny visual identity per account. */
function addrColor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return `hsl(${h} 65% 55%)`;
}

export function Header() {
  const { address, connecting, connect, switchAccount, disconnect, openProfile } = useWallet();
  const onLanding = usePathname() === "/";

  return (
    <header
      className={
        onLanding
          ? "absolute top-0 inset-x-0 z-20 bg-transparent"
          : "border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
      }
    >
      <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className={`flex items-center gap-2 font-semibold tracking-tight ${
              onLanding ? "text-white" : "text-zinc-900 dark:text-zinc-50"
            }`}
          >
            <SplitMark s={20} />
            Payfurt
          </Link>
          <nav
            className={`hidden md:flex gap-4 text-sm ${
              onLanding ? "text-white/60" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={
                  onLanding
                    ? "hover:text-[#5ed29c] transition-colors"
                    : "hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
                }
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {address ? (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Testnet
            </span>
            <button
              onClick={openProfile}
              title="View account"
              className="group flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-700 pl-1.5 pr-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <span className="size-5 rounded-full" style={{ background: addrColor(address) }} />
              <span className="text-xs font-mono text-zinc-600 dark:text-zinc-300">
                {address.slice(0, 4)}…{address.slice(-4)}
              </span>
            </button>
            <button
              onClick={switchAccount}
              title="Switch account — re-syncs with the account active in your wallet"
              className="grid place-items-center size-7 rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-emerald-500 hover:border-emerald-300 dark:hover:border-emerald-800 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </button>
            <button
              onClick={disconnect}
              title="Disconnect"
              className="grid place-items-center size-7 rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-red-500 hover:border-red-300 dark:hover:border-red-800 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            className="inline-flex items-center gap-2 text-sm px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors"
          >
            {connecting ? (
              <><span className="animate-spin inline-block size-3.5 rounded-full border-2 border-white/40 border-t-white" /> Connecting…</>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
                  <rect x="2" y="6" width="20" height="13" rx="2" />
                  <path d="M2 10h20M16 14h.01" />
                </svg>
                Connect wallet
              </>
            )}
          </button>
        )}
      </div>
    </header>
  );
}
