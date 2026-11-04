import { RidgeModel } from "../estimate/ridge";
import { prepare } from "../sim/runner";
import { SAMPLE_S, ScenarioKind } from "../sim/types";
import { AgentRunner, runMonitor } from "./monitor";
import { Recorder, Run, RunSchema } from "./run";

function headline(r: { status: Run["status"]; action: Run["action"]; outcome: Run["outcome"]; alertMin: number | null }): string {
  const o = r.outcome;
  if (r.status === "no_action" && r.alertMin === null) return "No alert raised.";
  const bits: string[] = [];
  if (r.alertMin !== null) bits.push(`alert at ${r.alertMin.toFixed(0)} min`);
  if (o.doNothing.firstBreachMin !== null) bits.push(`limit would be breached at ${o.doNothing.firstBreachMin.toFixed(0)} min without action`);
  if (r.action && o.withAction) bits.push(o.withAction.limitExceeded ? "limit still breached after action" : "no limit breach with the action");
  if (r.status === "escalated") bits.push("escalated to a human after 3 gate refusals");
  return bits.join("; ") + ".";
}

export interface ExecuteOptions {
  kind: ScenarioKind;
  seed: number;
  agent: AgentRunner;
  ridge: RidgeModel | null;
  maxInvocations?: number;
  /** Supply a recorder to observe events while the run is in progress (live UI). */
  recorder?: Recorder;
}

/** Run the monitor + agent on one scenario and assemble a validated Run record. */
export async function executeRun(o: ExecuteOptions): Promise<Run> {
  const prepared = prepare(o.kind, o.seed);
  const rec = o.recorder ?? new Recorder();
  const m = await runMonitor(prepared, o.ridge, o.agent, rec, { maxInvocations: o.maxInvocations });
  const inc = m.incident;
  const outcome = inc ? inc.groundTruthOutcome() : { doNothing: (await import("../sim/runner")).outcomeMetrics(prepared.trace), withAction: null, peakMarginImprovementC: null, degreeMinutesSaved: null };

  let status: Run["status"] = "no_action";
  if (m.result === "stopped") status = "budget_stopped";
  else if (m.result === "escalated") status = "escalated";
  else if (m.result === "alerted_and_acted" || m.applied.length) status = "applied";
  else if (m.result === "rejected") status = "rejected";
  else if (m.result === "alerted") status = "no_action";

  const alerts = rec.events.filter((e) => e.kind === "tool_call" && e.data.name === "notify" && ["warn", "critical"].includes(String((e.data.args as { level?: string }).level)));
  const passed = rec.events.find((e) => e.kind === "gate" && e.data.allowed === true);
  const alertMin = alerts.length || passed ? Math.min(...[...alerts, ...(passed ? [passed] : [])].map((e) => e.tMin)) : null;

  const approvalEv = rec.events.find((e) => e.kind === "approval");
  const actions = m.applied.map((a) => ({ action: a.action as unknown as Record<string, unknown>, reason: a.reason, tApplyMin: Number((a.intervention.tApply / 60).toFixed(1)), approvalDelayMin: Number((prepared.scn.approvalDelayS / 60).toFixed(1)) }));
  const action = actions[0] ?? null;

  const run: Run = {
    schemaVersion: 1,
    id: `${o.kind}-${o.seed}-${o.agent.source}`,
    source: o.agent.source,
    model: o.agent.model,
    label: o.agent.label,
    headline: "",
    createdAt: new Date().toISOString(),
    simulated: true,
    scenario: { kind: o.kind, seed: o.seed, startHour: Number(prepared.scn.startHour.toFixed(2)), durationMin: prepared.scn.durationS / 60, onsetMin: prepared.scn.onsetS / 60 },
    trigger: m.first ? { tMin: Number(((m.first.k * SAMPLE_S) / 60).toFixed(1)), rule: m.first.trigger.rule, detail: m.first.trigger.detail } : null,
    invocations: m.invocations,
    status,
    alertMin,
    action,
    actions,
    approval: approvalEv ? (approvalEv.data as unknown as NonNullable<Run["approval"]>) : null,
    outcome,
    usage: o.agent.usage(),
    events: rec.events,
  };
  run.headline = headline(run);
  return RunSchema.parse(run);
}
