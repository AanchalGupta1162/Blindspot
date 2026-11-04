import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import AppNav from "@/components/AppNav";
import UserMenu from "@/components/UserMenu";
import { getCtx } from "@/lib/auth/guard";
import "./globals.css";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face" });

export const metadata: Metadata = {
  title: "Blindspot — monitoring with almost no sensors",
  description: "A verifiable monitoring agent for labs and server rooms with very few sensors. Simulated. Every decision is scored against ground truth.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx().catch(() => null);
  return (
    <html lang="en" className={mono.variable}>
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
            <div className="flex items-center gap-6">
              <Link href="/" className="flex items-center gap-2.5">
                <span className="brand-mark" aria-hidden="true">b</span>
                <span className="text-[15px] font-semibold tracking-tight">Blindspot</span>
              </Link>
              {ctx && <AppNav />}
            </div>
            <div className="flex items-center gap-2">
              <UserMenu user={ctx ? { name: ctx.name, email: ctx.email, org: ctx.orgName, role: ctx.role } : null} />
            </div>
          </div>
          {ctx && <AppNav mobile />}
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:pt-12">{children}</main>
        <footer className="border-t border-line/70 py-8 text-center text-xs text-faint">
          <p className="mx-auto max-w-2xl px-4">
            Live Muse agent · simulated sensor environment
          </p>
        </footer>
      </body>
    </html>
  );
}
