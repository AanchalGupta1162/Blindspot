"use client";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Point } from "../lib/ui/series";
import { ALERT_MARGIN, LIMITS } from "../lib/sim/types";

export interface Marker {
  t: number;
  label: string;
  color: string;
  dash?: boolean;
  /** vertical placement of the label to avoid overlaps */
  row?: number;
}

const C = {
  S1: "#346bb3",
  S2: "#8054ac",
  S3: "#677480",
  truth: "#c54a4a",
  est: "#298478",
  act: "#327b52",
  limit: "#9b721e",
};

/** Must be called as a function (not used as a component): Recharts only renders direct ReferenceLine children. */
function markerLines(markers: Marker[]) {
  return markers.map((m, i) => (
    <ReferenceLine
      key={`${m.label}-${i}`}
      x={m.t}
      stroke={m.color}
      strokeDasharray={m.dash ? "4 4" : undefined}
      strokeOpacity={0.9}
      strokeWidth={1.5}
    />
  ));
}

const tooltipStyle = { background: "#ffffff", color: "#20262d", border: "1px solid #dce0e4", borderRadius: 8, fontSize: 12, fontFamily: "var(--font-mono)" };
const fmt = (v: unknown) => (typeof v === "number" ? v.toFixed(1) : String(v));

export function AirChart({ data, duration, markers, now, showTruth = true, showEst = true, showAct }: { data: Point[]; duration: number; markers: Marker[]; now?: number; showTruth?: boolean; showEst?: boolean; showAct?: boolean }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <Legend color={C.S1} label="S1 rack A sensor" />
        <Legend color={C.S2} label="S2 desk row 1 sensor" />
        <Legend color={C.S3} label="S3 return-air sensor" />
        {showTruth && <Legend color={C.truth} label="Rack B · without action" dashed />}
        {showEst && <Legend color={C.est} label="rack B — regression estimate" />}
        {showAct && <Legend color={C.act} label="Rack B · with recorded actions" />}
        <Legend color={C.limit} label={`limit ${LIMITS.rackB}°C`} dashed />
      </div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 20, right: 20, bottom: 8, left: -8 }}>
            <CartesianGrid stroke="#e1e5e9" vertical={false} />
            <XAxis minTickGap={30} dataKey="t" type="number" domain={[0, duration]} tickFormatter={(v) => `${Math.round(v)}m`} stroke="#8a949f" ticks={ticks(duration)} />
            <YAxis domain={["auto", "auto"]} stroke="#8a949f" tickFormatter={(v) => `${v}°`} />
            <Tooltip contentStyle={tooltipStyle} formatter={fmt} labelFormatter={(v) => `t = ${Number(v).toFixed(1)} min`} />
            <ReferenceArea y1={LIMITS.rackB - ALERT_MARGIN} y2={LIMITS.rackB} fill="#9b721e" fillOpacity={0.06} />
            <ReferenceLine y={LIMITS.rackB} ifOverflow="extendDomain" label={{ value: "35°C simulated limit", fill: C.limit, fontSize: 11, position: "insideBottomRight" }} stroke={C.limit} strokeDasharray="5 4" />
            {markerLines(markers)}
            {now !== undefined && <ReferenceLine x={now} stroke="#e8eef5" strokeOpacity={0.35} />}
            <Line dataKey="S3" name="Return air sensor" stroke={C.S3} strokeWidth={1.7} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="S2" name="Desk row 1 sensor" stroke={C.S2} strokeWidth={1.7} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="S1" name="Rack A sensor" stroke={C.S1} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
            {showEst && <Line dataKey="estRackB" name="Rack B estimate" stroke={C.est} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />}
            {showTruth && <Line dataKey="rackB" name="Rack B · without action" stroke={C.truth} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls />}
            {showAct && <Line dataKey="rackBAct" name="Rack B · with actions" stroke={C.act} strokeWidth={3} dot={false} isAnimationActive={false} connectNulls />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ConnectorChart({ data, duration, markers, now, showAct, showTruth = true }: { data: Point[]; duration: number; markers: Marker[]; now?: number; showAct?: boolean; showTruth?: boolean }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {showTruth && <Legend color={C.truth} label="Connector · without action" dashed />}
        <Legend color={C.est} label="regression estimate" />
        {showAct && <Legend color={C.act} label="With recorded actions" />}
        <Legend color={C.limit} label={`limit ${LIMITS.conn}°C`} dashed />
      </div>
      <div className="h-[280px] w-full">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 20, right: 20, bottom: 8, left: -8 }}>
            <CartesianGrid stroke="#e1e5e9" vertical={false} />
            <XAxis minTickGap={30} dataKey="t" type="number" domain={[0, duration]} tickFormatter={(v) => `${Math.round(v)}m`} stroke="#8a949f" ticks={ticks(duration)} />
            <YAxis domain={["auto", "auto"]} stroke="#8a949f" tickFormatter={(v) => `${v}°`} />
            <Tooltip contentStyle={tooltipStyle} formatter={fmt} labelFormatter={(v) => `t = ${Number(v).toFixed(1)} min`} />
            <ReferenceLine y={LIMITS.conn} ifOverflow="extendDomain" label={{ value: "70°C simulated limit", fill: C.limit, fontSize: 11, position: "insideBottomRight" }} stroke={C.limit} strokeDasharray="5 4" />
            {markerLines(markers)}
            {now !== undefined && <ReferenceLine x={now} stroke="#e8eef5" strokeOpacity={0.35} />}
            <Line dataKey="estConn" name="Connector estimate" stroke={C.est} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
            {showTruth && <Line dataKey="conn" name="Connector · without action" stroke={C.truth} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls />}
            {showAct && <Line dataKey="connAct" name="Connector · with actions" stroke={C.act} strokeWidth={3} dot={false} isAnimationActive={false} connectNulls />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function MeterChart({ data, duration, now }: { data: Point[]; duration: number; now?: number }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <Legend color="#8054ac" label="M2 rack B strip voltage drop (mV, left)" />
        <Legend color="#9b721e" label="M1 UPS total power (kW, right)" />
      </div>
      <div className="h-[220px] w-full">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#e1e5e9" vertical={false} />
            <XAxis minTickGap={30} dataKey="t" type="number" domain={[0, duration]} tickFormatter={(v) => `${Math.round(v)}m`} stroke="#8a949f" ticks={ticks(duration)} />
            <YAxis yAxisId="l" stroke="#8a949f" domain={["auto", "auto"]} />
            <YAxis yAxisId="r" orientation="right" stroke="#8a949f" domain={["auto", "auto"]} />
            <Tooltip contentStyle={tooltipStyle} formatter={fmt} labelFormatter={(v) => `t = ${Number(v).toFixed(1)} min`} />
            {now !== undefined && <ReferenceLine yAxisId="l" x={now} stroke="#e8eef5" strokeOpacity={0.35} />}
            <Line yAxisId="l" dataKey="vd" name="Voltage drop (mV)" stroke="#8054ac" strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />
            <Line yAxisId="r" dataKey="kw" name="Total power (kW)" stroke="#9b721e" strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ticks(duration: number) {
  const step = duration > 300 ? 60 : 30;
  return Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} /></svg>
      {label}
    </span>
  );
}

/** Ground truth only: every zone is compared with its own simulated limit. */
export function RiskChart({ data, duration, markers, showAct }: { data: Point[]; duration: number; markers: Marker[]; showAct: boolean }) {
  const high = Math.max(3, ...data.map(p => Math.max(p.maxMargin ?? -100, p.maxMarginAct ?? -100))) + 2;
  return <div>
    <h2 className="text-base font-medium">Temperature above limit</h2>
    <p className="mt-1 mb-4 text-xs text-muted">Hottest zone · 0°C is its simulated limit</p>
    <div className="mb-3 flex flex-wrap gap-5 text-xs text-muted"><Legend color={C.truth} label="Without action" />{showAct && <Legend color={C.act} label="With recorded actions" />}</div>
    <div className="h-[310px] w-full"><ResponsiveContainer><LineChart data={data} margin={{ top: 20, right: 20, bottom: 8, left: 0 }}>
      <CartesianGrid stroke="#e1e5e9" vertical={false} />
      <XAxis minTickGap={30} dataKey="t" type="number" domain={[0, duration]} ticks={ticks(duration)} tickFormatter={v => `${Math.round(v)}m`} />
      <YAxis domain={["auto", high]} tickFormatter={v => `${v > 0 ? "+" : ""}${v}°`} />
      <Tooltip contentStyle={tooltipStyle} formatter={fmt} labelFormatter={v => `${Number(v).toFixed(1)} min`} />
      <ReferenceArea y1={0} y2={high} fill={C.truth} fillOpacity={0.08} />
      <ReferenceLine y={0} stroke={C.limit} strokeWidth={1.5} label={{ value: "Simulated limit", position: "insideTopRight", fill: C.limit, fontSize: 11 }} />
      {markerLines(markers)}
      <Line dataKey="maxMargin" name="Without action · °C above limit" stroke={C.truth} strokeWidth={3} dot={false} isAnimationActive={false} />
      {showAct && <Line dataKey="maxMarginAct" name="With actions · °C above limit" stroke={C.act} strokeWidth={3} strokeDasharray="7 3" dot={false} isAnimationActive={false} />}
    </LineChart></ResponsiveContainer></div>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3 text-xs text-muted">{[...markers].sort((a,b) => a.t-b.t).map((m,i) => <span key={i}><span style={{ color: m.color }}>●</span> {m.label} <span className="text-ink tabular-nums">{m.t.toFixed(1)} min</span></span>)}</div>
  </div>;
}
