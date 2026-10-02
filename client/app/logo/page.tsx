import type { ReactNode } from "react";

const GREEN = "#5ed29c";

/* ── The four marks (24×32 viewBox, scale cleanly to a 16px favicon) ────────── */

// A · Eclipse — a coin half-concealed: value is there, half hidden.
function Eclipse({ s = 32 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="12" stroke={GREEN} strokeWidth="2.5" />
      <path d="M16 4 A12 12 0 0 1 16 28 Z" fill={GREEN} />
    </svg>
  );
}

// B · Split — a rounded tile, one half solid (public total), one half open (private detail).
function Split({ s = 32 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <defs><clipPath id="lh"><rect x="5" y="5" width="11" height="22" /></clipPath></defs>
      <rect x="5" y="5" width="22" height="22" rx="6.5" stroke={GREEN} strokeWidth="2.5" />
      <rect x="5" y="5" width="22" height="22" rx="6.5" fill={GREEN} clipPath="url(#lh)" />
    </svg>
  );
}

// C · Sealed — a shield with a check: protected and verified.
function Sealed({ s = 32 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <path d="M16 4 L26 8 V16 C26 22.5 16 28 16 28 C16 28 6 22.5 6 16 V8 Z"
        stroke={GREEN} strokeWidth="2.3" strokeLinejoin="round" />
      <path d="M11.5 16.2 l3 3 l6-7" stroke={GREEN} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// D · Commitment — a hexagon (Poseidon/hash vernacular) sealing a single value.
function Commitment({ s = 32 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <path d="M16 4 L26.4 10 V22 L16 28 L5.6 22 V10 Z" stroke={GREEN} strokeWidth="2.3" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="3.2" fill={GREEN} />
    </svg>
  );
}

const OPTIONS: { id: string; name: string; concept: string; Mark: (p: { s?: number }) => ReactNode }[] = [
  { id: "A", name: "Eclipse", concept: "A coin half-concealed — value is present, half hidden. The core promise in one shape.", Mark: Eclipse },
  { id: "B", name: "Split", concept: "One half solid, one half open — the public total and the private detail. Literally the payroll thesis.", Mark: Split },
  { id: "C", name: "Sealed", concept: "Shield + check — protected and verifiable. The most legible; also the most conventional.", Mark: Sealed },
  { id: "D", name: "Commitment", concept: "A hexagon sealing a single value — the Poseidon-commitment vernacular, cryptographic and quiet.", Mark: Commitment },
];

export default function LogoPreview() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16 flex flex-col gap-10">
      <div>
        <p className="font-jakarta text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: GREEN }}>
          Identity
        </p>
        <h1 className="mt-2 font-inter text-3xl font-extrabold tracking-tight">Pick a logo</h1>
        <p className="mt-2 text-sm text-white/55 max-w-lg">
          Four marks, same emerald-on-ink identity. Each shown as a favicon, header size, a large
          mark, and the wordmark lockup. Tell me the letter and I&apos;ll wire it into the header,
          the favicon, and the metadata.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {OPTIONS.map(({ id, name, concept, Mark }) => (
          <div key={id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <span className="font-jakarta text-xs font-bold uppercase tracking-widest text-white/40">
                {id} · {name}
              </span>
              {/* sizes */}
              <div className="flex items-end gap-4">
                <Mark s={16} />
                <Mark s={24} />
                <Mark s={40} />
              </div>
            </div>

            {/* Large mark + wordmark lockup */}
            <div className="rounded-xl border border-white/5 bg-[#070b0a] py-8 flex flex-col items-center gap-4">
              <Mark s={72} />
              <div className="flex items-center gap-2.5">
                <Mark s={22} />
                <span className="font-inter text-xl font-bold tracking-tight">Payfurt</span>
              </div>
            </div>

            {/* On light (for docs / off-brand surfaces) */}
            <div className="rounded-xl bg-white py-4 flex items-center justify-center gap-2.5">
              <Mark s={20} />
              <span className="font-inter text-lg font-bold tracking-tight text-[#070b0a]">Payfurt</span>
            </div>

            <p className="text-xs text-white/50 leading-relaxed">{concept}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-white/40">
        My pick: <span className="text-white/80">B (Split)</span> — it&apos;s the only one that
        encodes what Payfurt actually does. <span className="text-white/80">A (Eclipse)</span> is the
        safer, most iconic runner-up.
      </p>
    </div>
  );
}
