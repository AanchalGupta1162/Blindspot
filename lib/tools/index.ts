import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { loadForecastCalibration } from "../estimate/forecast-calibration";
import { predictRidge, RidgeModel } from "../estimate/ridge";
import { SENSORS } from "../sim/sensors";
import { ALERT_MARGIN, LIMITS, Node } from "../sim/types";
import { toIntervention } from "../twin/twin";
import { GATE, GateDecision, MemberForecast, evaluateGate } from "./gate";
import { Incident } from "./incident";
import { ActionInput, ToolName, ToolSchemas, actionKey } from "./schemas";

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_sensors: "List the visible sensors (3 temperature sensors, 2 electrical meters) and the current time. These are the ONLY measurements available; most of the room is not instrumented.",
  get_reading: "Latest reading of one sensor.",
  get_history: "Downsampled history of one sensor over the last window_min minutes, with min/max and a trend per 10 minutes.",
  sensor_metadata: "Location, nominal noise, calibration age and recent flatness of a sensor. A temperature sensor that is exactly flat for 20 minutes may be stuck: check before trusting it.",
  estimate_hidden_zones: "Fast regression estimate (no physics) of the temperature in hidden zones (rack B, desk row 2, UPS connector) with 1-sigma error, from visible sensors only. Cannot see some faults; use diagnose to confirm.",
  diagnose: "Fit physical fault hypotheses (AC degradation, blocked vent, load increase, loose connector, none) to the sensor history using a physics twin. Returns the posterior over hypotheses and what each predicts if nothing is done. Flat sensors are excluded automatically.",
  simulate_action: "What-if: roll the plausible hypotheses forward with a candidate action applied after approval and latency. Returns predicted peak margin (hottest zone temperature minus its limit, negative = within limits) and time-to-limit, with and without the action, per hypothesis. Test at least two different actions before requesting one.",
  request_action: "Request an action. A deterministic safety gate checks it against the simulation; it is refused unless it is demonstrably better than doing nothing under every plausible hypothesis. If it passes, a human operator must approve before anything is applied. Three refusals escalate to a human.",
  notify: "Send an alert to the on-call operator (info, warn or critical). Use warn/critical only when a limit breach is plausible.",
};

export function toolSpecs() {
  return (Object.keys(ToolSchemas) as ToolName[]).map((name) => {
    const schema = zodToJsonSchema(ToolSchemas[name], { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>;
    delete schema.$schema;
    return { type: "function" as const, function: { name, description: TOOL_DESCRIPTIONS[name], parameters: schema } };
  });
}

export interface ToolResult {
  ok: boolean;
  data: unknown;
  /** Present when request_action reached a gate decision. */
  gate?: GateDecision;
  /** Terminal signal for the loop. */
  signal?: "needs_input" | "escalated";
}

const r1 = (x: number) => Number(x.toFixed(1));

function summarize(items: { f: { peakMargin: number; timeToLimitMin: number | null }; w: number }[]) {
  const z = items.reduce((a, b) => a + b.w, 0) || 1;
  const live = items.filter((i) => i.w / z >= GATE.WEIGHT_FLOOR);
  const breaching = items.filter((i) => i.f.timeToLimitMin !== null).sort((a, b) => a.f.timeToLimitMin! - b.f.timeToLimitMin!);
  let acc = 0;
  let med: number | null = null;
  for (const b of breaching) {
    acc += b.w / z;
    if (acc >= 0.5) {
      med = b.f.timeToLimitMin;
      break;
    }
  }
  return {
    p_breach: Number((breaching.reduce((a, b) => a + b.w, 0) / z).toFixed(2)),
    expected_peak_margin_c: r1(items.reduce((a, b) => a + (b.w / z) * b.f.peakMargin, 0)),
    worst_plausible_peak_margin_c: r1(Math.max(...(live.length ? live : items).map((i) => i.f.peakMargin))),
    median_time_to_limit_min: med,
  };
}

export function runTool(inc: Incident, name: ToolName, rawArgs: unknown): ToolResult {
  const ridge = inc.ridge;
  const schema = ToolSchemas[name];
  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, data: { error: "invalid arguments", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } };
  const args = parsed.data as never as Record<string, unknown>;

  switch (name) {
    case "list_sensors":
      return { ok: true, data: { now_min_since_monitoring_started: inc.tNowMin, sensors: SENSORS.map((s) => ({ id: s.id, label: s.label, location: s.location, kind: s.kind, unit: s.unit })), note: "Everything else in the room is unobserved. Limits are simulated thresholds." } };

    case "get_reading": {
      const id = args.sensor as (typeof SENSORS)[number]["id"];
      const i = SENSORS.findIndex((s) => s.id === id);
      return { ok: true, data: { sensor: id, t_min: inc.tNowMin, value: Number(inc.readings.data[i][inc.kNow].toFixed(2)), unit: SENSORS[i].unit } };
    }

    case "get_history":
      return { ok: true, data: { sensor: args.sensor, window_min: args.window_min, ...inc.history(args.sensor as never, args.window_min as number) } };

    case "sensor_metadata":
      return { ok: true, data: inc.metadata(args.sensor as never) };

    case "estimate_hidden_zones": {
      const f = inc.estimateHidden();
      if (!f || !ridge) return { ok: false, data: { error: "not enough history yet (need ~11 minutes)" } };
      const est = predictRidge(ridge, f);
      const nodes: Node[] = ["rackB", "desk2", "conn"];
      const suspect = inc.suspectSensors();
      return {
        ok: true,
        data: {
          t_min: inc.tNowMin,
          zones: nodes.map((n, i) => ({ zone: n, estimate_c: r1(est[i]), sigma_c: r1(ridge.residualSigma[i]), simulated_limit_c: LIMITS[n], margin_to_limit_c: r1(LIMITS[n] - est[i]) })),
          caveats: [
            "Regression trained on simulated scenarios; its error is larger for faults that barely disturb the visible sensors (for example a blocked vent on rack B).",
            ...(suspect.length ? [`Sensors flagged flat: ${suspect.join(", ")}. This estimate uses them and may be unreliable.`] : []),
          ],
        },
      };
    }

    case "diagnose": {
      const d = inc.diagnosis();
      const haz = inc.hazard(90);
      const base = inc.doNothing(90);
      const calibration = loadForecastCalibration();
      const coverage = d.excluded.map(id => ({S1: "rackA", S2: "desk1", S3: "ret", M1: "power", M2: "connector"})[id]);
      return {
        ok: true,
        data: {
          t_min: inc.tNowMin,
          model_adequate: d.modelAdequate,
          chi2_per_dof: d.chi2PerDof,
          sensors_excluded_from_fit: d.excluded,
          observation_coverage: {
            untrusted_sensors: d.excluded,
            unobserved_due_to_sensor_failure: coverage,
            inspection_warranted: d.excluded.length > 0,
            note: "Normal readings elsewhere cannot establish that a zone with a failed sensor is safe. A dispatched human check inspects and repairs existing faults in this simulation.",
          },
          forecast_uncertainty: {
            probabilities_are_calibrated: false,
            interpretation: "Probabilities are relative weights within fitted hypotheses, not measured probabilities of safety. Missing fault dynamics can make all hypotheses wrong.",
            ...(calibration && !inc.priorInterventions.length ? {
              empirical_upper_allowance_c: calibration.boundC,
              worst_plausible_peak_margin_plus_allowance_c: r1(summarize(base).worst_plausible_peak_margin_c + calibration.boundC),
              calibration_scenarios: calibration.calibrationScenarios,
              held_out_scenarios_covered: `${calibration.heldOut.covered}/${calibration.heldOut.scenarios}`,
              scope: "Untreated 90-minute forecasts at monitoring minutes 60 and 90; not validated for post-intervention forecasts.",
              note: calibration.note,
            } : {}),
          },
          p_fault: Number((1 - (d.families.find((f) => f.family === "none")?.posterior ?? 0)).toFixed(3)),
          hypotheses: d.families.slice(0, 4).map((f) => ({ family: f.family, posterior: f.posterior, description: f.best.description })),
          if_nothing_is_done_90min: {
            p_hazard_within_alert_margin: Number(haz.pHazard.toFixed(2)),
            ...summarize(base),
            alert_margin_c: ALERT_MARGIN,
          },
          note: "Hypothesis posteriors are tempered because residuals are autocorrelated. Early in a fault several hypotheses can fit; prefer actions that work under all of them.",
        },
      };
    }

    case "simulate_action": {
      const action = args.action as ActionInput;
      const horizon = args.horizon_min as number;
      const key = actionKey(action);
      const base = inc.doNothing(horizon);
      const act = inc.withAction(action, horizon);
      if (!inc.simulatedKeys.includes(key)) inc.simulatedKeys.push(key);
      const sumAct = summarize(act);
      inc.simulatedWorstMargin[key] = sumAct.worst_plausible_peak_margin_c;
      const iv = toIntervention(action, inc.tNowS, inc.approvalDelayS, inc.humanDelayS);
      return {
        ok: true,
        data: {
          action,
          takes_effect_in_min: Number(((iv.tApply - inc.tNowS) / 60).toFixed(1)),
          horizon_min: horizon,
          do_nothing: summarize(base),
          with_action: sumAct,
          per_hypothesis: act
            .map((a) => {
              const b = base.find((x) => x.w === a.w && x.family === a.family)!;
              return { family: a.family, weight: Number(a.w.toFixed(3)), peak_margin_c_do_nothing: r1(b.f.peakMargin), peak_margin_c_with_action: r1(a.f.peakMargin), time_to_limit_min_do_nothing: b.f.timeToLimitMin, time_to_limit_min_with_action: a.f.timeToLimitMin };
            })
            .sort((x, y) => y.weight - x.weight)
            .slice(0, 6),
          reading_guide: "peak_margin_c = hottest (zone temperature - its limit) over the horizon; negative means within limits.",
        },
      };
    }

    case "request_action": {
      const action = args.action as ActionInput;
      const horizon = 90;
      const key = actionKey(action);
      const base = inc.doNothing(horizon);
      const act = inc.withAction(action, horizon);
      const z = base.reduce((a, b) => a + b.w, 0) || 1;
      const members: MemberForecast[] = act.map((a) => {
        const b = base.find((x) => x.w === a.w && x.family === a.family)!;
        return { weight: a.w / z, family: a.family, doNothing: { peakMargin: b.f.peakMargin, timeToLimitMin: b.f.timeToLimitMin }, withAction: { peakMargin: a.f.peakMargin, timeToLimitMin: a.f.timeToLimitMin } };
      });
      const d = inc.diagnosis();
      const haz = inc.hazard(horizon);
      const decision = evaluateGate({
        rawAction: action,
        horizonMin: horizon,
        members,
        pHazard: haz.pHazard,
        pFault: 1 - (d.families.find((f) => f.family === "none")?.posterior ?? 0),
        modelAdequate: d.modelAdequate,
        suspectSensors: inc.suspectSensors(),
        simulatedKeys: inc.simulatedKeys,
        simulatedWorstMargin: inc.simulatedWorstMargin,
        priorRefusals: inc.refusals,
      });
      if (!decision.allowed) {
        inc.refusals.push({ key, codes: decision.codes });
        inc.refusalCount += 1;
        const escalate = inc.refusalCount >= GATE.MAX_REFUSALS;
        if (escalate) inc.status = "escalated";
        return {
          ok: false,
          gate: decision,
          signal: escalate ? "escalated" : undefined,
          data: {
            status: escalate ? "escalated" : "refused",
            reasons: decision.reasons,
            message: escalate ? "Three requests were refused. This incident is escalated to a human operator; stop requesting actions." : "Refused by the safety gate. Nothing was applied. Revise using the reasons.",
            refusals_so_far: inc.refusalCount,
          },
        };
      }
      inc.pending = { action, reason: args.reason as string, gate: decision };
      inc.status = "needs_input";
      return {
        ok: true,
        gate: decision,
        signal: "needs_input",
        data: { status: "needs_input", message: "Passed the safety gate. Waiting for human approval before anything is applied.", expected_improvement_c: decision.expectedImprovementC, worst_plausible_improvement_c: decision.worstCaseImprovementC },
      };
    }

    case "notify": {
      inc.alerts.push({ tMin: inc.tNowMin, level: args.level as "info" | "warn" | "critical", message: args.message as string });
      return { ok: true, data: { delivered: true, level: args.level, t_min: inc.tNowMin } };
    }
  }
}

/** Called by the loop after a human approves a pending action. */
export function applyApproval(inc: Incident) {
  if (!inc.pending) throw new Error("nothing pending");
  const iv = toIntervention(inc.pending.action, inc.tNowS, inc.approvalDelayS, inc.humanDelayS);
  inc.applied = { action: inc.pending.action, intervention: iv, reason: inc.pending.reason };
  inc.status = "applied";
  inc.pending = null;
  return iv;
}

export function rejectApproval(inc: Incident) {
  inc.pending = null;
  inc.status = "investigating";
}

export type { z };
