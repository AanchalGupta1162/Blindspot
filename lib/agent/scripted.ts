import { Incident } from "../tools/incident";
import { applyApproval, runTool, ToolResult } from "../tools/index";
import { ActionInput, ToolName } from "../tools/schemas";
import { Recorder, Run } from "./run";
import { AgentRunner, InvocationResult } from "./monitor";
import { TriggerEvent } from "./trigger";

/**
 * Deterministic reference policy. It calls the SAME tools and goes through the SAME safety gate as the
 * LLM agent, but every decision is a hard-coded rule, not a model. It exists to (a) test the pipeline
 * without spending money and (b) provide an honest "tools + gate, no LLM" ablation. It is labelled as such everywhere.
 */
export interface ScriptedOptions {
  approve?: (inc: Incident) => Promise<{ decision: "approved" | "rejected"; mode: "human" | "auto-simulated"; by: string }>;
}

const CANDIDATES: ActionInput[] = [
  { kind: "cut_power_circuit", circuit: "B" },
  { kind: "power_cap_rack", rack: "rackB", fraction: 0.7 },
  { kind: "power_cap_rack", rack: "rackA", fraction: 0.6 },
  { kind: "switch_backup_cooling", zone: "rackB" },
  { kind: "shed_noncritical_load" },
];
const FALLBACK: ActionInput = { kind: "dispatch_human_check" };
/** Candidates predicted to help by less than this are not worth a request (refusals are limited to 3). */
const MIN_USEFUL_C = 1.0;

export class ScriptedPolicy implements AgentRunner {
  source = "scripted-policy" as const;
  model = null;
  label = "Scripted reference policy (deterministic rules over the same tools and gate; not LLM output)";
  turns = 0;
  constructor(private opts: ScriptedOptions = {}) {}
  usage(): Run["usage"] {
    return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, turns: this.turns, models: [] };
  }

  async invoke(inc: Incident, trigger: TriggerEvent, rec: Recorder): Promise<InvocationResult> {
    const call = (name: ToolName, args: Record<string, unknown> = {}): ToolResult => {
      rec.push("tool_call", inc.tNowMin, { name, args });
      const res = runTool(inc, name, args);
      rec.push("tool_result", inc.tNowMin, { name, ok: res.ok, result: res.data });
      if (res.gate) rec.push("gate", inc.tNowMin, { allowed: res.gate.allowed, checks: res.gate.checks, reasons: res.gate.reasons, expectedImprovementC: res.gate.expectedImprovementC, worstCaseImprovementC: res.gate.worstCaseImprovementC });
      return res;
    };
    const say = (text: string) => rec.push("assistant", inc.tNowMin, { text });
    this.turns++;

    say(`Trigger fired (${trigger.rule}): ${trigger.detail}. Checking which sensors can be trusted, then fitting fault hypotheses.`);
    call("list_sensors");
    for (const s of ["S1", "S2", "S3"] as const) call("sensor_metadata", { sensor: s });
    call("estimate_hidden_zones");
    const dg = call("diagnose");
    const d = dg.data as { p_fault: number; hypotheses: { family: string; posterior: number }[]; if_nothing_is_done_90min: { p_hazard_within_alert_margin: number; p_breach: number }; };
    const top = d.hypotheses[0];
    const suspects = inc.suspectSensors();
    const pH = d.if_nothing_is_done_90min.p_hazard_within_alert_margin;
    const pB = d.if_nothing_is_done_90min.p_breach;
    const hazardous = (d.p_fault >= 0.6 && (pH >= 0.25 || pB >= 0.2)) || (top.family === "connector" && top.posterior >= 0.8);
    if (!hazardous && suspects.length > 0) call("notify", { level: "info", message: `Sensor(s) ${suspects.join(",")} are exactly flat and look stuck; the area they cover is not monitored.` });

    if (!hazardous && suspects.length === 0) {
      say(`Most likely explanation: ${top.family} (posterior ${top.posterior}). P(hazard within alert margin)=${pH}. No plausible path to a limit breach, so no alert. Will re-check if the trigger fires again.`);
      rec.push("summary", inc.tNowMin, { text: "No action: trigger explained by benign behaviour.", outcome: "no_action" });
      return "no_action";
    }

    if (hazardous) call("notify", { level: pB >= 0.5 ? "critical" : "warn", message: `Developing thermal/electrical problem. Most likely: ${top.family} (posterior ${top.posterior}); P(breach within 90 min)=${pB}.${suspects.length ? ` Sensor(s) ${suspects.join(",")} look stuck and were excluded.` : ""}` });
    say(hazardous ? "Alerting the operator now, then testing candidate actions in the twin before requesting any." : "A sensor is blind but no hazard is proven; testing a precautionary human check in the twin.");

    // Simulate every candidate; request them best-first. The most aggressive option will often be tempting and get refused.
    const scored: { a: ActionInput; exp: number; worst: number }[] = [];
    for (const a of [...CANDIDATES, FALLBACK]) {
      const r = call("simulate_action", { action: a, horizon_min: 90 });
      const data = r.data as { with_action: { expected_peak_margin_c: number; worst_plausible_peak_margin_c: number }; do_nothing: { expected_peak_margin_c: number } };
      scored.push({ a, exp: data.do_nothing.expected_peak_margin_c - data.with_action.expected_peak_margin_c, worst: data.with_action.worst_plausible_peak_margin_c });
    }
    // Best worst-case outcome first. At most two non-fallback requests, so one request is always left for the human check.
    const ranked = scored.filter((x) => x.exp >= MIN_USEFUL_C).sort((x, y) => x.worst - y.worst).slice(0, 2);
    const fallback = scored.find((x) => x.a.kind === "dispatch_human_check")!;
    const order = ranked.some((x) => x.a.kind === "dispatch_human_check") ? ranked : [...ranked, fallback];
    for (const { a, exp, worst } of order) {
      if (inc.status === "escalated") break;
      say(`Requesting ${a.kind} (expected improvement ${exp.toFixed(1)} C versus doing nothing, worst plausible peak margin ${worst.toFixed(1)} C).`);
      const reason =
        a.kind === "dispatch_human_check"
          ? `A person can inspect and repair what the model suspects (${top.family}, posterior ${top.posterior}).${suspects.length ? ` Sensor(s) ${suspects.join(",")} look stuck, so the area they cover is unmonitored.` : ""} Cheap to do, costly to ignore.`
          : `Predicted to lower the peak temperature margin by ${exp.toFixed(1)} C versus doing nothing, under the leading fault hypotheses.`;
      const res = call("request_action", { action: a, reason });
      if (res.signal === "escalated") {
        rec.push("summary", inc.tNowMin, { text: `Three requests refused by the safety gate; escalated to a human operator.`, outcome: "escalated" });
        return "escalated";
      }
      if (res.signal === "needs_input") {
        const verdict = await (this.opts.approve ?? (async () => ({ decision: "approved" as const, mode: "auto-simulated" as const, by: "simulated operator (auto-approved in scripted recording)" })))(inc);
        rec.push("approval", inc.tNowMin, verdict);
        if (verdict.decision === "approved") {
          const iv = applyApproval(inc);
          rec.push("applied", inc.tNowMin, { action: inc.applied!.action, tApplyMin: Number((iv.tApply / 60).toFixed(1)) });
          rec.push("summary", inc.tNowMin, { text: `Applied ${a.kind} after human approval.`, outcome: "applied" });
          return "alerted_and_acted";
        }
        inc.status = "investigating";
        inc.pending = null;
        return "rejected";
      }
    }
    rec.push("summary", inc.tNowMin, { text: "Alert sent; no action passed the safety gate.", outcome: "alerted" });
    return "alerted";
  }
}
