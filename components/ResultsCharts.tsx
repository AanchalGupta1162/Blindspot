"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface KindRow {
  kind: string;
  n: number;
  m0: { detected: number; medianLeadMin: number | null };
  m1: { detected: number; medianLeadMin: number | null };
  m2s: { detected: number; medianLeadMin: number | null };
}

const COLORS = { m0: "#f5a524", m1: "#6aa9ff", m2s: "#35d6c0" };
const NAMES = { m0: "Threshold alarm", m1: "Regression only", m2s: "Tools + gate (scripted policy)" };
const tip = { background: "#0d131b", border: "1px solid #223042", borderRadius: 8, fontSize: 12, fontFamily: "var(--font-mono)" };

export default function ResultsCharts({ rows }: { rows: KindRow[] }) {
  const det = rows.map((r) => ({ kind: r.kind, m0: r.m0.detected, m1: r.m1.detected, m2s: r.m2s.detected, n: r.n }));
  const lead = rows.map((r) => ({ kind: r.kind, m0: r.m0.medianLeadMin ?? 0, m1: r.m1.medianLeadMin ?? 0, m2s: r.m2s.medianLeadMin ?? 0 }));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="panel p-4">
        <div className="eyebrow mb-1">Caught before the limit was breached</div>
        <p className="mb-3 text-xs text-muted">Scenarios (of 7 per kind) where the first alert came before the true breach.</p>
        <div className="h-[300px]">
          <ResponsiveContainer>
            <BarChart data={det} margin={{ top: 4, right: 4, bottom: 28, left: -18 }}>
              <CartesianGrid stroke="#1a2635" vertical={false} />
              <XAxis dataKey="kind" stroke="#33455c" angle={-25} textAnchor="end" interval={0} height={50} tickFormatter={(v: string) => v.replace("_", " ")} />
              <YAxis domain={[0, 7]} allowDecimals={false} stroke="#33455c" />
              <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: "var(--font-mono)", paddingTop: 8 }} />
              {(["m0", "m1", "m2s"] as const).map((k) => (
                <Bar key={k} dataKey={k} name={NAMES[k]} fill={COLORS[k]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="panel p-4">
        <div className="eyebrow mb-1">Median warning time</div>
        <p className="mb-3 text-xs text-muted">Minutes between the first alert and the true breach (among scenarios caught in time; 0 = none caught).</p>
        <div className="h-[300px]">
          <ResponsiveContainer>
            <BarChart data={lead} margin={{ top: 4, right: 4, bottom: 28, left: -18 }}>
              <CartesianGrid stroke="#1a2635" vertical={false} />
              <XAxis dataKey="kind" stroke="#33455c" angle={-25} textAnchor="end" interval={0} height={50} tickFormatter={(v: string) => v.replace("_", " ")} />
              <YAxis stroke="#33455c" unit="m" />
              <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: "var(--font-mono)", paddingTop: 8 }} />
              {(["m0", "m1", "m2s"] as const).map((k) => (
                <Bar key={k} dataKey={k} name={NAMES[k]} fill={COLORS[k]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
