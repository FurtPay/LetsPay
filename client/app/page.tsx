"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const GREEN = "#5ed29c";

const groups = [
  {
    title: "Hold & move value privately",
    features: [
      { label: "Confidential wallet", desc: "A balance stored on-chain only as a commitment. Deposit, withdraw, receive — the amount is never a public number.", href: "/wallet", cta: "Open wallet" },
      { label: "Invoice escrow", desc: "Lock funds confidentially; the contractor proves the amount is in range and is credited. The invoice value never appears.", href: "/invoice", cta: "Create invoice" },
    ],
  },
  {
    title: "Run payroll",
    features: [
      { label: "Confidential payroll", desc: "Only the total is public — each salary is an opaque note the recipient claims. The split never touches the chain.", href: "/employer", cta: "Run payroll" },
      { label: "Auto-receive", desc: "Recipients enrol once; pay is encrypted to their key and waiting when they log in. One click to claim.", href: "/wallet", cta: "Enable auto-receive" },
    ],
  },
  {
    title: "Prove without revealing",
    features: [
      { label: "Compliance attestations", desc: "Prove every salary clears a living wage, or that cohorts are paid equitably — on-chain, no salary disclosed.", href: "/attest", cta: "Attest compliance" },
      { label: "Income & bracket proofs", desc: "An employee proves their bracket or cumulative income for a loan or visa, anchored to the notes they were paid.", href: "/employee", cta: "Prove income" },
    ],
  },
  {
    title: "Audit & inspect",
    features: [
      { label: "Auditor view key", desc: "Hand an auditor an encrypted salary list only they can open and verify against the on-chain commitment.", href: "/auditor", cta: "Open auditor" },
      { label: "Attestation trail", desc: "An auditable, public proof-of-payment history per employer — totals and headcounts, never amounts.", href: "/history", cta: "View history" },
    ],
  },
];

const pillars = [
  ["Amounts hidden", "Balances are Poseidon commitments; every move is gated by a Groth16 proof verified on-chain."],
  ["Verifiable, not visible", "Prove minimum-wage, pay-equity, and income about salaries that stay secret."],
  ["Not a mixer", "Confidential amounts between identified parties — only the values are private."],
];

function useHlsBackground(src: string) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // Safari plays HLS natively.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }
    let hls: { destroy: () => void } | undefined;
    let cancelled = false;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return;
      const h = new Hls({ enableWorker: false });
      h.loadSource(src);
      h.attachMedia(video);
      hls = h;
    });
    return () => { cancelled = true; hls?.destroy(); };
  }, [src]);
  return ref;
}

export default function Home() {
  const videoRef = useHlsBackground(
    "https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8"
  );

  return (
    <div className="text-white font-inter">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[100svh] overflow-hidden flex items-center">
        {/* Background video */}
        <video
          ref={videoRef}
          autoPlay muted loop playsInline
          className="absolute inset-0 size-full object-cover opacity-60"
        />
        {/* Overlays for readability */}
        <div className="absolute inset-0 bg-linear-to-r from-[#070b0a] via-[#070b0a]/40 to-transparent" />
        <div className="absolute inset-0 bg-linear-to-t from-[#070b0a] via-transparent to-[#070b0a]/30" />

        {/* Central glow */}
        <svg className="absolute left-1/2 -translate-x-1/2 -top-24 w-[900px] max-w-none opacity-70 pointer-events-none" viewBox="0 0 900 400" aria-hidden>
          <defs>
            <filter id="glow"><feGaussianBlur stdDeviation="25" /></filter>
            <radialGradient id="g" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#5ed29c" stopOpacity="0.55" />
              <stop offset="60%" stopColor="#0e7d63" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#070b0a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="450" cy="200" rx="420" ry="150" fill="url(#g)" filter="url(#glow)" />
        </svg>

        {/* Grid lines */}
        <div className="absolute inset-0 hidden md:block pointer-events-none">
          <div className="absolute top-0 bottom-0 left-1/4 w-px bg-white/10" />
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/10" />
          <div className="absolute top-0 bottom-0 left-3/4 w-px bg-white/10" />
        </div>

        {/* Content */}
        <div className="relative z-10 mx-auto max-w-5xl w-full px-6 pt-14">
          <div className="max-w-2xl flex flex-col items-start">
            <p className="hero-rise font-jakarta font-bold text-[11px] tracking-[0.18em] uppercase" style={{ color: GREEN }}>
              Confidential payments · Stellar testnet
            </p>

            <h1 className="hero-rise mt-4 font-inter font-extrabold uppercase tracking-tight leading-[0.95] text-[40px] sm:text-[56px] lg:text-[72px]">
              Confidential payroll,
              <br />
              proven <span className="font-instrument lowercase tracking-normal text-white/95">on-chain</span>
              <span style={{ color: GREEN }}>.</span>
            </h1>

            <p className="hero-rise mt-6 max-w-lg text-[14px] leading-relaxed text-white/70">
              Pay salaries and invoices on Stellar without exposing the amounts — and still prove
              minimum-wage, pay-equity, and income, with zero-knowledge proofs the network checks itself.
            </p>

            <div className="hero-rise mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/employer"
                className="group inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold uppercase tracking-wide text-[#070b0a] transition-transform hover:scale-[1.02]"
                style={{ background: GREEN }}
              >
                Run payroll
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/wallet"
                className="rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-white/80 hover:bg-white/5 hover:text-white transition-colors"
              >
                Open wallet
              </Link>
            </div>

            {/* Verified facts — grounds the claim, not decoration */}
            <div className="hero-rise mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] text-white/40">
              <span className="flex items-center gap-1.5"><span className="size-1 rounded-full bg-emerald-400" /> Groth16 · BLS12-381</span>
              <span className="h-3 w-px bg-white/10 hidden sm:block" />
              <span>10 ZK circuits, verified on testnet</span>
              <span className="h-3 w-px bg-white/10 hidden sm:block" />
              <span>Poseidon commitments · Soroban</span>
            </div>

            {/* Zero-knowledge note — compact glass paragraph */}
            <div className="liquid-glass hero-rise mt-6 w-full max-w-md rounded-xl p-4 flex items-start gap-3">
              <span className="font-jakarta text-[11px] tracking-widest text-white/40 whitespace-nowrap pt-px">[ 2026 ]</span>
              <p className="text-[12px] leading-relaxed text-white/55">
                <span className="text-white/90">Zero-<span className="font-instrument text-[15px]">knowledge</span>.</span>{" "}
                Groth16 proofs over BLS12-381, checked by Soroban — no salary in the transaction.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pillars ──────────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-8 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-xl overflow-hidden border border-white/10 bg-white/10">
          {pillars.map(([k, v]) => (
            <div key={k} className="bg-[#070b0a]/70 backdrop-blur-sm p-5 flex flex-col gap-1.5">
              <span className="text-sm font-semibold" style={{ color: GREEN }}>{k}</span>
              <span className="text-sm text-white/55 leading-relaxed">{v}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Feature groups ───────────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl px-6 py-16 flex flex-col gap-12">
        {groups.map(({ title, features }) => (
          <section key={title} className="flex flex-col gap-4">
            <h2 className="font-jakarta text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">{title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {features.map(({ label, desc, href, cta }) => (
                <Link
                  key={label}
                  href={href}
                  className="group rounded-xl border border-white/10 bg-white/[0.02] p-5 flex flex-col gap-2 hover:border-[#5ed29c]/50 hover:bg-white/[0.04] transition-all"
                >
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-sm text-white/55 leading-relaxed flex-1">{desc}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium transition-all group-hover:gap-2" style={{ color: GREEN }}>
                    {cta} <ArrowRight className="size-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col sm:flex-row justify-between gap-4 text-xs text-white/40">
          <span>Groth16 · BLS12-381 (CAP-0059) · Poseidon commitments · Soroban</span>
          <span>Built for Stellar Hacks: Real-World ZK</span>
        </div>
      </footer>
    </div>
  );
}
