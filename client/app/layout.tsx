import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Plus_Jakarta_Sans, Instrument_Serif } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { WalletProvider } from "@/lib/stellar/wallet";
import { Header } from "@/app/header";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "700", "800"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["500", "700"] });
const instrument = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: "italic" });

export const metadata: Metadata = {
  title: "Payfurt — Confidential Payroll on Stellar",
  description: "ZK-proven payroll disbursements. Totals and headcount on-chain. Salaries never.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} ${inter.variable} ${jakarta.variable} ${instrument.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-[#070b0a] text-zinc-100">
        <WalletProvider>
          <Header />
          <main className="flex-1">{children}</main>
        </WalletProvider>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
