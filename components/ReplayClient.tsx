"use client";
import Link from "next/link";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import ridgeJson from "../data/models/ridge.json";
import type { Run } from "../lib/agent/run";
import { RidgeModel } from "../lib/estimate/ridge";
import { prepare, prepareFrom } from "../lib/sim/runner";
import { Action, SCENARIO_LABEL, ScenarioKind } from "../lib/sim/types";
import { buildSeries } from "../lib/ui/series";
import { AirChart, ConnectorChart, Marker, MeterChart, RiskChart } from "./SimChart";
import AgentFlow from "./AgentFlow";
import { Badge } from "./ui";

const ridge = ridgeJson as unknown as RidgeModel;

type Ev = Run["events"][number];
type Item =
  | { type: "trigger"; ev: Ev }
  | { type: "assistant"; ev: Ev }
  | { type: "tool"; call: Ev; result?: Ev }
  | { type: "gate"; ev: Ev; request?: Ev }
  | { type: "approval"; ev: Ev }
  | { type: "applied"; ev: Ev }
  | { type: "summary"; ev: Ev }
  | { type: "status"; ev: Ev }
  | { type: "outcome" };

function toItems(events: Ev[]): Item[] {
  const items: Item[] = [];
  let lastRequest: Ev | undefined;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind === "tool_call") {
      const next = events[i + 1];
      const res = next && next.kind === "tool_result" && next.data.name === e.data.name ? next : undefined;
      if (e.data.name === "request_action") lastRequest = e;
      items.push({ type: "tool", call: e, result: res });
      if (res) i++;
    } else if (e.kind === "gate") items.push({ type: "gate", ev: e, request: lastRequest });
    else if (e.kind === "trigger" || e.kind === "assistant" || e.kind === "approval" || e.kind === "applied" || e.kind === "summary" || e.kind === "status") items.push({ type: e.kind, ev: e } as Item);
  }
  items.push({ type: "outcome" });
  return items;
}

const actionText = (a: Record<string, unknown>) => {
  const k = String(a.kind);
  const rest = Object.entries(a).filter(([n]) => n !== "kind").map(([n, v]) => `${n}=${v}`).join(", ");
  return rest ? `${k}(${rest})` : k;
};

export default function ReplayClient({ run }: { run: Run }) {
  const kind = run.scenario.kind as ScenarioKind;
  const prepared = useMemo(() => prepare(kind, run.scenario.seed), [kind, run.scenario.seed]);
  const acted = useMemo(() => {
    const actions = run.actions ?? (run.action ? [run.action] : []);
    return actions.length ? prepareFrom(prepared.scn, actions.map((a) => ({ tApply: a.tApplyMin * 60, action: a.action as unknown as Action }))) : null;
  }, [run.actions, run.action, prepared]);
  const items = useMemo(() => toItems(run.events), [run.events]);
  const full = useMemo(() => buildSeries(prepared, ridge, acted, Infinity, true), [prepared, acted]);
  const duration = run.scenario.durationMin;
  const [step, setStep] = useState(items.length - 1);
  const [playing, setPlaying] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s >= items.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 1500);
    return () => window.clearInterval(id);
  }, [playing, items.length]);
  useEffect(() => {
    if (step === items.length - 1) return;
    listRef.current?.querySelector(`[data-step="${step}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [step, items.length]);

  const item = items[step];
  const atOutcome = item.type === "outcome";
  const tEvent = item.type === "outcome" ? run.trigger?.tMin ?? 0 : item.type === "tool" ? item.call.tMin : item.ev.tMin;
  // what the agent saw is frozen at the investigation time; the outcome reveals everything that happened next
  const reveal = atOutcome ? duration : tEvent;
  const series = useMemo(() => full.map((p) => (p.t <= reveal ? (atOutcome ? p : { ...p, rackBAct: undefined, connAct: undefined, rackB: undefined, conn: undefined, maxMargin: undefined, maxMarginAct: undefined }) : { t: p.t })), [full, reveal, atOutcome]);
  const markers: Marker[] = [];
  if (atOutcome && kind !== "control") markers.push({ t: run.scenario.onsetMin, label: "Fault starts", color: "#c1c5cd", row: 0, dash: true });
  if (run.trigger) markers.push({ t: run.trigger.tMin, label: "wakes", color: "#35d6c0", row: 0 });
  if (run.alertMin !== null && step >= items.findIndex((i) => i.type === "tool" && i.call.data.name === "notify")) markers.push({ t: run.alertMin, label: "alert", color: "#5be08e", row: 1 });
  if (atOutcome) (run.actions ?? (run.action ? [run.action] : [])).forEach((a, i) => markers.push({ t: a.tApplyMin, label: `action ${i + 1}`, color: "#5be08e", row: 2, dash: true }));
  if (atOutcome && run.outcome.doNothing.firstBreachMin !== null) markers.push({ t: run.outcome.doNothing.firstBreachMin, label: "Limit crossed", color: "#ff6b6b", row: 1 });

  const isLLM = run.source === "llm";
  return (
    <div>
      <Link href="/lab" className="mono text-xs text-muted hover:text-teal">← back to the lab</Link>
      <div className="mb-5 mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs text-muted">{isLLM ? run.model : "Scripted policy · no LLM"} · Simulated recording</p>
          <h1 className="text-3xl font-semibold tracking-tight">{SCENARIO_LABEL[kind]} <span className="mono text-xl text-faint">seed {run.scenario.seed}</span></h1>
          <p className="mt-1 max-w-3xl text-muted">{run.headline}</p>
        </div>
      </div>
      <div className="mb-6" aria-label="Recorded investigation playback">
        <div className="flex flex-wrap items-center gap-2">
          <button aria-pressed={playing} onClick={() => { if (atOutcome) setStep(0); setPlaying((p) => !p); }} className="btn btn-primary playback-primary">
            <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>{playing ? "Pause investigation" : "Play investigation"}
          </button>
          <button className="btn" onClick={() => { setPlaying(false); setStep(0); }}>Restart</button>
          <button disabled={step === 0} onClick={() => { setPlaying(false); setStep(s => Math.max(0, s - 1)); }} className="btn">← Previous step</button>
          <button disabled={atOutcome} onClick={() => { setPlaying(false); setStep(s => Math.min(items.length - 1, s + 1)); }} className="btn">Next step →</button>
          <button className="btn" onClick={() => { setPlaying(false); setStep(items.length - 1); }}>View outcome</button>
        </div>
        <p className="mt-2 text-xs text-faint" aria-live="polite">{playing ? "Playing" : atOutcome ? "Final outcome" : `Step ${step + 1} / ${items.length}`}</p>

      </div>


      <div className="space-y-6">
        <div className="min-w-0 space-y-4">
          {atOutcome && <RiskChart data={series} duration={duration} markers={markers} showAct={!!acted} />}
          <details className="disclosure" open={!atOutcome}><summary>Sensor charts</summary>
            <h2 className="mb-3 text-sm font-medium">Room temperatures</h2>
            <AirChart data={series} duration={duration} markers={markers} now={atOutcome ? undefined : tEvent} showTruth={atOutcome} showEst showAct={atOutcome && !!acted} />
            <div className="mt-6 space-y-6">
              <h2 className="text-sm font-medium">Hidden connector temperature</h2>
              <ConnectorChart data={series} duration={duration} markers={markers} now={atOutcome ? undefined : tEvent} showTruth={atOutcome} showAct={atOutcome && !!acted} />
              <h2 className="text-sm font-medium">Electrical measurements</h2>
              <MeterChart data={series} duration={duration} now={atOutcome ? undefined : tEvent} />
            </div>
          </details>
          <Outcome run={run} />
        </div>

        <AgentFlow events={atOutcome ? run.events : run.events.filter(e => e.i <= (item.type === "tool" ? item.call.i : item.ev.i))} />
      </div>
      <div>
        <details className="disclosure"><summary>Raw event log</summary><div className="flex max-h-[600px] min-w-0 flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="eyebrow">Investigation · step {step + 1}/{items.length}</div>
            <div className="mono text-xs text-faint">{isLLM ? `$${run.usage.costUsd} · ${run.usage.turns} turns` : "no model calls"}</div>
          </div>
          <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {items.map((it, i) => (
              <div key={i} data-step={i} onClick={() => { setPlaying(false); setStep(i); }} className={`cursor-pointer transition-opacity ${i > step ? "hidden" : i === step ? "opacity-100" : "opacity-60 hover:opacity-100"}`}>
                <ItemCard it={it} active={i === step} run={run} />
              </div>
            ))}
          </div>
        </div></details>
      </div>
    </div>
  );
}

function Card({ tone = "line", title, right, children, active }: { tone?: "line" | "teal" | "green" | "red" | "amber" | "violet"; title: ReactNode; right?: ReactNode; children?: ReactNode; active?: boolean }) {
  const border = { line: "border-line", teal: "border-teal/50", green: "border-ok/50", red: "border-danger/50", amber: "border-amber/50", violet: "border-violet/40" }[tone];
  return (
    <div className={`rounded-xl border ${border} bg-panel2/60 p-3 ${active ? "ring-1 ring-teal/40" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium">{title}</div>
        {right}
      </div>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

function Json({ v }: { v: unknown }) {
  const s = JSON.stringify(v, null, 1);
  return <pre className="mono mt-2 max-h-56 overflow-auto rounded-lg bg-bg/70 p-2.5 text-[11px] leading-relaxed text-muted">{s.length > 3500 ? s.slice(0, 3500) + "\n…" : s}</pre>;
}

function ItemCard({ it, active, run }: { it: Item; active: boolean; run: Run }) {
  switch (it.type) {
    case "trigger":
      return <Card tone="teal" active={active} title={<>Cheap trigger fired <span className="mono text-xs text-teal">({String(it.ev.data.rule)})</span></>} right={<span className="mono text-xs text-faint">t={it.ev.tMin}m</span>}>{String(it.ev.data.detail)}. The model wakes only now; it is not polled continuously.</Card>;
    case "assistant": {
      const text = String(it.ev.data.text ?? "");
      const calls = (it.ev.data.toolCalls as string[] | undefined) ?? [];
      return (
        <Card active={active} title={run.source === "llm" ? `Agent · turn ${it.ev.data.turn ?? ""}` : "Policy"} right={run.source === "llm" ? <span className="mono text-[11px] text-faint">${String(it.ev.data.costUsd ?? 0)}</span> : undefined}>
          {text ? text : <span className="mono text-xs">calls: {calls.join(", ")}</span>}
        </Card>
      );
    }
    case "tool": {
      const name = String(it.call.data.name);
      const args = it.call.data.args as Record<string, unknown>;
      const brief = name === "simulate_action" || name === "request_action" ? actionText(args.action as Record<string, unknown>) : Object.values(args).join(", ");
      const ok = it.result?.data.ok !== false;
      return (
        <Card active={active} tone={name === "request_action" ? "amber" : "line"} title={<><span className="mono text-teal">{name}</span><span className="mono text-xs text-muted">({brief})</span></>} right={<Badge tone={ok ? "muted" : "red"}>{ok ? "tool" : "error/refused"}</Badge>}>
          {name === "simulate_action" && it.result ? <SimBars r={it.result.data.result as Record<string, any>} /> : null}
          {name === "diagnose" && it.result ? <DiagBars r={it.result.data.result as Record<string, any>} /> : null}
          {name === "notify" ? <span>{String(args.message)}</span> : null}
          {name === "request_action" ? <span>{String(args.reason)}</span> : null}
          <details className="mt-1">
            <summary className="mono text-[11px] text-faint hover:text-teal">raw result</summary>
            <Json v={it.result?.data.result} />
          </details>
        </Card>
      );
    }
    case "gate": {
      const allowed = it.ev.data.allowed === true;
      const checks = it.ev.data.checks as { name: string; pass: boolean; detail: string }[];
      return (
        <Card active={active} tone={allowed ? "green" : "red"} title={<>Safety gate · {allowed ? "PASSED" : "REFUSED"}</>} right={<Badge tone={allowed ? "green" : "red"}>deterministic code</Badge>}>
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.name} className="flex gap-2 text-[12.5px]">
                <span className={c.pass ? "text-ok" : "text-danger"}>{c.pass ? "✓" : "✕"}</span>
                <span className={c.pass ? "text-muted" : "text-ink"}>{c.detail}</span>
              </li>
            ))}
          </ul>
          {allowed && it.ev.data.worstCaseImprovementC != null && <p className="mono mt-2 text-xs text-teal">expected {String(it.ev.data.expectedImprovementC)} °C better · worst plausible {String(it.ev.data.worstCaseImprovementC)} °C better than doing nothing</p>}
        </Card>
      );
    }
    case "approval": {
      const approved = it.ev.data.decision === "approved";
      return (
        <div className="border-t border-line py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Operator decision</div>
            <Badge tone={it.ev.data.mode === "human" ? "green" : "amber"}>{it.ev.data.mode === "human" ? "real operator" : "auto-simulated"}</Badge>
          </div>
          <div className={`mt-2 text-sm ${approved ? "text-ok" : "text-danger"}`}>{approved ? "Approved" : "Rejected"}</div>
          <div className="text-sm text-muted">by {String(it.ev.data.by)}</div>
          {run.action && <div className="mono mt-2 rounded-md bg-bg/70 p-2 text-xs">{actionText(run.action.action)}</div>}
        </div>
      );
    }
    case "applied":
      return <Card active={active} tone="green" title="Action scheduled" right={<span className="mono text-xs text-faint">takes effect t={String(it.ev.data.tApplyMin)}m</span>}>Applied after approval and physical latency (remote actions are quick; physical tasks wait for a person to arrive).</Card>;
    case "summary":
      return <Card active={active} tone="teal" title="Summary">{String(it.ev.data.text)}</Card>;
    case "status":
      return <Card active={active} tone="red" title={`Run ${String(it.ev.data.status).replace("_", " ")}`}>{String(it.ev.data.message)}</Card>;
    case "outcome":
      return <Card active={active} tone="amber" title="Ground-truth outcome">The simulator knows the real temperatures. The chart now reveals what happened next, with and without the action.</Card>;
  }
}

function SimBars({ r }: { r: Record<string, any> }) {
  const a = r.do_nothing, b = r.with_action;
  const row = (label: string, x: number, color: string) => (
    <div className="flex items-center gap-2">
      <span className="w-24 text-[11px] text-faint">{label}</span>
      <div className="relative h-2 flex-1 rounded bg-bg/70"><div className="absolute left-0 top-0 h-2 rounded" style={{ width: `${Math.min(100, Math.max(2, ((x + 8) / 16) * 100))}%`, background: color }} /></div>
      <span className="mono w-14 text-right text-[11px]">{x > 0 ? "+" : ""}{x}°</span>
    </div>
  );
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-faint">worst plausible peak vs. limit (0 = at limit; left of centre is safe)</div>
      {row("do nothing", a.worst_plausible_peak_margin_c, "#ff6b6b")}
      {row("with action", b.worst_plausible_peak_margin_c, "#5be08e")}
      <div className="mono text-[11px] text-faint">takes effect in {r.takes_effect_in_min} min · P(breach) {a.p_breach} → {b.p_breach}</div>
    </div>
  );
}

function DiagBars({ r }: { r: Record<string, any> }) {
  return (
    <div className="space-y-1">
      {(r.hypotheses as { family: string; posterior: number }[]).slice(0, 4).map((h) => (
        <div key={h.family} className="flex items-center gap-2">
          <span className="mono w-24 text-[11px] text-faint">{h.family}</span>
          <div className="relative h-2 flex-1 rounded bg-bg/70"><div className="absolute left-0 top-0 h-2 rounded bg-teal" style={{ width: `${Math.max(1, h.posterior * 100)}%` }} /></div>
          <span className="mono w-10 text-right text-[11px]">{h.posterior.toFixed(2)}</span>
        </div>
      ))}
      <div className="mono text-[11px] text-faint">if nothing is done (90 min): P(breach) {r.if_nothing_is_done_90min.p_breach} · excluded sensors: {(r.sensors_excluded_from_fit as string[]).join(", ") || "none"}</div>
    </div>
  );
}

function Outcome({ run }: { run: Run }) {
  const o = run.outcome;
  const fmt = (x: number | null, u = "") => (x === null ? "—" : `${x}${u}`);
  const rows: [string, string, string][] = [
    ["Limit breached", o.doNothing.limitExceeded ? `yes, at ${fmt(o.doNothing.firstBreachMin, " min")} (${o.doNothing.firstBreachNode})` : "no", o.withAction ? (o.withAction.limitExceeded ? `yes, at ${fmt(o.withAction.firstBreachMin, " min")}` : "no") : "—"],
    ["Peak vs. limit", `${o.doNothing.peakMarginC > 0 ? "+" : ""}${o.doNothing.peakMarginC} °C`, o.withAction ? `${o.withAction.peakMarginC > 0 ? "+" : ""}${o.withAction.peakMarginC} °C` : "—"],
    ["Degree-minutes above limit", String(o.doNothing.degreeMinutesAboveLimit), o.withAction ? String(o.withAction.degreeMinutesAboveLimit) : "—"],
  ];
  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Outcome</h2>
        <span className="mono text-xs text-faint">alert {run.alertMin !== null ? `${run.alertMin.toFixed(0)} min` : "none"} · onset {run.scenario.onsetMin.toFixed(0)} min</span>
      </div>
      <p className={`mb-4 text-lg font-medium ${o.withAction?.limitExceeded || (!o.withAction && o.doNothing.limitExceeded) ? "text-danger" : "text-ok"}`}>{o.withAction ? (o.withAction.limitExceeded ? "The limit is still exceeded after intervention." : "No limit breach with the recorded actions.") : (o.doNothing.limitExceeded ? "A simulated limit is exceeded. No action was applied." : "No simulated limit is exceeded.")}</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-faint"><th className="py-1 font-normal"></th><th className="py-1 font-normal">Do nothing</th><th className="py-1 font-normal">With recorded actions</th></tr></thead>
        <tbody>
          {rows.map(([a, b, c]) => (
            <tr key={a} className="border-t border-line"><td className="py-2 pr-3 text-muted">{a}</td><td className="mono py-2 pr-3">{b}</td><td className="mono py-2 text-teal">{c}</td></tr>
          ))}
        </tbody>
      </table>

    </div>
  );
}
