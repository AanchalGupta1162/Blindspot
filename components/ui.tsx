import { ReactNode } from "react";

export function Badge({ children, tone = "muted", className = "" }: { children: ReactNode; tone?: "muted" | "teal" | "amber" | "red" | "green" | "violet"; className?: string }) {
  const tones = {
    muted: "text-muted",
    teal: "text-teal",
    amber: "text-amber",
    red: "text-danger",
    green: "text-ok",
    violet: "text-violet",
  };
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${tones[tone]} ${className}`}>{children}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "teal" | "amber" | "red" | "green" }) {
  const color = tone === "teal" ? "text-teal" : tone === "amber" ? "text-amber" : tone === "red" ? "text-danger" : tone === "green" ? "text-ok" : "text-ink";
  return (
    <div className="py-4">
      <div className="eyebrow">{label}</div>
      <div className={`mt-3 text-3xl font-medium leading-none tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Section({ eyebrow, title, children, right }: { eyebrow?: string; title: string; children?: ReactNode; right?: ReactNode }) {
  return (
    <section className="mt-12">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium tracking-tight">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}
