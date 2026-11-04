import { readFileSync, existsSync } from "node:fs";
import { RidgeModel } from "../estimate/ridge";
import { PreparedScenario, prepareFrom } from "../sim/runner";
import { Intervention, SAMPLE_S } from "../sim/types";
import { Incident } from "../tools/incident";
import { Recorder, Run } from "./run";
import { InvestigationSchedule, evidenceChanged } from "./investigation-schedule";
import { TriggerEvent, TriggerMonitor } from "./trigger";

export function loadRidge(path = "data/models/ridge.json"): RidgeModel | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as RidgeModel) : null;
}

export type InvocationResult = "alerted_and_acted" | "alerted" | "escalated" | "no_action" | "rejected" | "stopped";

export interface AgentRunner {
  source: Run["source"];
  model: string | null;
  label: string;
  /** Investigate one trigger. Appends to the recorder. */
  invoke(inc: Incident, trigger: TriggerEvent, rec: Recorder): Promise<InvocationResult>;
  usage(): Run["usage"];
}

export interface MonitorOptions {
  maxInvocations?: number;
  cooldownMin?: number;
  /** Stop scanning at this sample index (default: end of scenario). */
  untilK?: number;
}

/**
 * Scan the sensor stream with the cheap trigger and wake the agent when it fires.
 * The agent is never polled continuously: at most `maxInvocations` investigations per run.
 */
export async function runMonitor(prepared: PreparedScenario, ridge: RidgeModel | null, agent: AgentRunner, rec: Recorder, opts: MonitorOptions = {}) {
  const { scn, readings } = prepared;
  const mon = new TriggerMonitor(scn.startHour, scn.durationS, ridge);
  mon.calibrate(readings);
  const maxInv = opts.maxInvocations ?? 6;
  const cooldownK = Math.round(((opts.cooldownMin ?? 15) * 60) / SAMPLE_S);
  const schedule = new InvestigationSchedule(opts.cooldownMin ?? 15);
  const end = Math.min(opts.untilK ?? readings.n - 1, readings.n - 1);
  let lastK = -Infinity;
  let active = prepared;
  const interventions: Intervention[] = [];
  const applied: NonNullable<Incident["applied"]>[] = [];
  let first: { k: number; trigger: TriggerEvent } | null = null;
  let incident: Incident | null = null;
  let result: InvocationResult = "no_action";
  let invocations = 0;
  let inspectedFlat: { sensor: string; baselineK: number } | null = null;
  const evidenceAt = (r: typeof readings, k: number) => r.data.map(channel => { let sum=0; for(let j=k-3;j<=k;j++) sum+=channel[j]; return sum/4; });
  for (let k = 24; k <= end && invocations < maxInv; k++) {
    if (k - lastK < cooldownK) continue;
    const trig = mon.check(active.readings, k);
    if (!trig) continue;
    const evidence = evidenceAt(active.readings,k);
    if (inspectedFlat && trig.rule === "flat" && trig.detail.includes(inspectedFlat.sensor) && k >= inspectedFlat.baselineK && !evidenceChanged(evidence,evidenceAt(active.readings,inspectedFlat.baselineK))) continue;
    if (!schedule.shouldInvestigate(trig,evidence)) continue;
    incident = new Incident(active, k, ridge, [...interventions]);
    // Forecasts use only observed history and known approved actions, never simulator truth.
    if (interventions.length && !incident.suspectSensors().length && incident.hazard(90).pHazard < 0.15) { lastK=k; continue; }
    schedule.record(trig,evidence);
    const previous = rec.events.filter(e=>e.kind === "summary").at(-1);
    if (previous) incident.monitorContext = { priorAtMin: previous.tMin, priorSummary: String(previous.data.text ?? "").slice(0,1400), elapsedMin: Number((incident.tNowMin-previous.tMin).toFixed(1)) };
    invocations++;
    rec.invocation = invocations;
    lastK = k;
    first ??= { k, trigger: trig };
    rec.push("trigger", incident.tNowMin, { rule: trig.rule, detail: trig.detail });
    result = await agent.invoke(incident, trig, rec);
    if (incident.applied) {
      applied.push(incident.applied);
      interventions.push(incident.applied.intervention);
      active = prepareFrom(scn, interventions);
      if (incident.applied.action.kind === "dispatch_human_check" && trig.rule === "flat") inspectedFlat = { sensor: trig.detail.match(/S[123]/)?.[0] ?? "", baselineK: Math.min(end, Math.ceil(incident.applied.intervention.tApply / SAMPLE_S) + cooldownK) };
      // Wait until the intervention has taken effect, then allow a fresh observation window.
      lastK = Math.ceil(incident.applied.intervention.tApply / SAMPLE_S);
      k = Math.max(k, lastK);
    } else if (!["no_action", "alerted"].includes(result)) break;
  }
  return { first, incident, result, invocations, applied };
}
