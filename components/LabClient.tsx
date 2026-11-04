"use client";
import { useEffect, useMemo, useState } from "react";
import ridgeJson from "../data/models/ridge.json";
import { TriggerMonitor } from "../lib/agent/trigger";
import { baselineAlertIndex } from "../lib/baseline/threshold";
import { RidgeModel, predictRidge } from "../lib/estimate/ridge";
import { featuresAt } from "../lib/estimate/features";
import { firstBreach, prepare } from "../lib/sim/runner";
import { ALERT_MARGIN, LIMITS, SAMPLE_S, SCENARIO_KINDS, SCENARIO_LABEL, ScenarioKind } from "../lib/sim/types";
import { buildSeries } from "../lib/ui/series";
import { AirChart, ConnectorChart, Marker, MeterChart } from "./SimChart";
import LivePanel from "./LivePanel";

const ridge = ridgeJson as unknown as RidgeModel;
const SPEEDS = [6, 20, 60];

export default function LabClient() {
  const [kind, setKind] = useState<ScenarioKind>("loose_connection");
  const [seed, setSeed] = useState(3000);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const data = useMemo(() => {
    const p = prepare(kind, seed);
    const full = buildSeries(p, ridge, null);
    const m0 = baselineAlertIndex(p.readings);
    const fb = firstBreach(p.trace);
    const mon = new TriggerMonitor(p.scn.startHour, p.scn.durationS, ridge);
    mon.calibrate(p.readings);
    let trig: { k: number; rule: string; detail: string } | null = null;
    for (let k = 24; k < p.readings.n; k++) {
      const t = mon.check(p.readings, k);
      if (t) {
        trig = t;
        break;
      }
    }
    let m1: number | null = null;
    let run = 0;
    for (let k = 22; k < p.readings.n && m1 === null; k++) {
      const e = predictRidge(ridge, featuresAt(p.readings, k, p.scn.startHour)!);
      const hot = e[0] > LIMITS.rackB - ALERT_MARGIN || e[1] > LIMITS.desk2 - ALERT_MARGIN || e[2] > LIMITS.conn - ALERT_MARGIN;
      run = hot ? run + 1 : 0;
      if (run >= 2) m1 = k;
    }
    return { p, full, m0: m0 === null ? null : (m0 * SAMPLE_S) / 60, breach: fb ? { t: (fb.k * SAMPLE_S) / 60, node: fb.node } : null, trig: trig ? { t: (trig.k * SAMPLE_S) / 60, rule: trig.rule, detail: trig.detail } : null, m1: m1 === null ? null : (m1 * SAMPLE_S) / 60 };
  }, [kind, seed]);

  const duration = data.p.scn.durationS / 60;
  useEffect(() => {
    setNow(0);
    setPlaying(false);
  }, [kind, seed]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setNow((n) => {
        const nx = n + SPEEDS[speed] * 0.08;
        if (nx >= duration) {
          setPlaying(false);
          return duration;
        }
        return nx;
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [playing, speed, duration]);

  const series = useMemo(() => data.full.map((pt) => (pt.t <= now ? pt : { t: pt.t })), [data.full, now]);
  const markers: Marker[] = [];
  if (data.m0 !== null && data.m0 <= now) markers.push({ t: data.m0, label: "alarm", color: "#f5a524", row: 0 });
  if (data.trig && data.trig.t <= now) markers.push({ t: data.trig.t, label: "wakes", color: "#35d6c0", row: 1 });
  if (data.breach && data.breach.t <= now) markers.push({ t: data.breach.t, label: "breach", color: "#ff6b6b", row: 2 });

  const state = (t: number | null) => (t !== null && t <= now ? { on: true, label: `alert at ${t.toFixed(0)} min` } : { on: false, label: now >= duration ? "never fired" : "silent" });
  const s0 = state(data.m0);
  const s1 = state(data.m1);
  const s2 = state(data.trig?.t ?? null);

  return <div>
    <h1 className="mb-6 text-2xl font-medium">Lab</h1>
    <div className="mb-6 flex flex-wrap items-end gap-4">
      <label className="text-xs text-muted"><span className="mb-1 block">Scenario</span>
        <select value={kind} onChange={e => setKind(e.target.value as ScenarioKind)} className="w-64 rounded-md border border-line bg-panel2 px-3 py-2 text-sm text-ink">
          {SCENARIO_KINDS.map(k => <option key={k} value={k}>{SCENARIO_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted"><span className="mb-1 block">Seed</span>
        <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value) || 0)} className="mono w-24 rounded-md border border-line bg-panel2 px-3 py-2 text-sm text-ink" />
      </label>
    </div>
    <LivePanel kind={kind} seed={seed} />
    <section className="mt-8 border-t border-line pt-6" aria-label="Simulation playback and sensor graphs">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Sensor timeline</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button aria-pressed={playing} onClick={() => { if (now >= duration) setNow(0); setPlaying(p => !p); }} className="btn btn-primary playback-primary">
            <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>{playing ? "Pause simulation" : now >= duration ? "Replay simulation" : "Play simulation"}
          </button>
          {SPEEDS.map((s, i) => <button key={s} aria-label={`Playback speed ${s} times`} aria-pressed={speed === i} onClick={() => setSpeed(i)} className={`mono rounded-md border px-2 py-2 text-xs ${speed === i ? "border-teal text-teal" : "border-line text-muted"}`}>{s}×</button>)}
        </div>
      </div>
      <p className="mb-4 text-xs text-muted">Scenario playback without interventions. The live agent runs independently above.</p>
      <div className="mb-5 flex flex-wrap gap-x-7 gap-y-2 border-b border-line pb-4 text-xs text-muted">
        <span>Threshold <span className={s0.on ? "text-amber" : "text-faint"}>{s0.label}</span></span>
        <span>Estimator <span className={s1.on ? "text-amber" : "text-faint"}>{s1.label}</span></span>
        <span>Agent trigger <span className={s2.on ? "text-teal" : "text-faint"}>{s2.label}</span></span>
      </div>
      <AirChart data={series} duration={duration} markers={markers} now={now} showTruth showEst />
      <div className="mt-4 space-y-6">
        <ConnectorChart data={series} duration={duration} markers={markers} now={now} />
        <MeterChart data={series} duration={duration} now={now} />
      </div>
      <input type="range" min={0} max={duration} step={0.5} value={now} onChange={e => { setPlaying(false); setNow(Number(e.target.value)); }} className="mt-4 w-full" aria-label="Simulation time" />
      <div className="mono mt-1 flex justify-between text-xs text-faint"><span>t = {now.toFixed(0)} min</span><span>{duration} min</span></div>
      {data.breach && now >= data.breach.t && <p className="mt-4 text-sm text-danger">Limit crossed at {data.breach.t.toFixed(0)} min · {data.breach.node}</p>}
    </section>
  </div>;
}
