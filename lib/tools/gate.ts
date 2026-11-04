import { ActionInput, ActionSchema, actionKey } from "./schemas";

/**
 * SAFETY GATE. Deterministic code, not a model call. It lives inside request_action, so the agent
 * cannot skip it. A request passes only if every check passes.
 */
export const GATE = {
  MIN_IMPROVEMENT_C: 1.0, // required peak-margin improvement versus doing nothing, for every plausible member
  MIN_HAZARD_P: 0.15, // an action is only warranted if a hazard is plausible
  WEIGHT_FLOOR: 0.03, // ensemble members lighter than this are ignored by the robustness test
  CRITICAL_HORIZON_MIN: 20, // cutting power needs a predicted breach this soon, under every plausible member
  MAX_HORIZON_MIN: 120,
  MIN_SIMULATED: 2, // distinct actions that must have been simulated first
  CRITICAL_RACK_FLOOR: 0.6, // rack B carries critical load: never cap below this
  MAX_REFUSALS: 3,
};

export interface MemberForecast {
  weight: number;
  family: string;
  doNothing: { peakMargin: number; timeToLimitMin: number | null };
  withAction: { peakMargin: number; timeToLimitMin: number | null };
}

export interface GateInput {
  rawAction: unknown;
  horizonMin: number;
  members: MemberForecast[]; // forecasts for THIS action
  pHazard: number; // weight of members whose do-nothing path gets within the alert margin of a limit
  pFault: number; // posterior mass on any fault family
  modelAdequate: boolean;
  suspectSensors: string[];
  simulatedKeys: string[]; // distinct actions simulated so far
  /** worst-case with-action peak margin for each simulated action, by key */
  simulatedWorstMargin: Record<string, number>;
  priorRefusals: { key: string; codes: string[] }[];
}

export interface GateCheck {
  name: string;
  pass: boolean;
  detail: string;
}
export interface GateDecision {
  allowed: boolean;
  codes: string[];
  reasons: string[];
  checks: GateCheck[];
  expectedImprovementC: number | null;
  worstCaseImprovementC: number | null;
}

export function evaluateGate(inp: GateInput): GateDecision {
  const checks: GateCheck[] = [];
  const add = (name: string, pass: boolean, detail: string, code?: string) => checks.push({ name, pass, detail: pass ? detail : `${detail}${code ? ` [${code}]` : ""}` });
  const fail = () => checks.filter((c) => !c.pass);
  const done = (exp: number | null, worst: number | null): GateDecision => {
    const bad = fail();
    return {
      allowed: bad.length === 0,
      codes: bad.map((c) => /\[(\w+)\]$/.exec(c.detail)?.[1] ?? c.name),
      reasons: bad.map((c) => c.detail),
      checks,
      expectedImprovementC: exp,
      worstCaseImprovementC: worst,
    };
  };

  // 1. catalog + arguments
  const parsed = ActionSchema.safeParse(inp.rawAction);
  add("in_catalog", parsed.success, parsed.success ? "action is in the catalog and its arguments validate" : `invalid action: ${parsed.success ? "" : parsed.error.issues.map((i) => i.message).join("; ")}`, "NOT_IN_CATALOG");
  if (!parsed.success) return done(null, null);
  const action: ActionInput = parsed.data;
  const key = actionKey(action);

  // 2. horizon
  add("horizon_bound", inp.horizonMin <= GATE.MAX_HORIZON_MIN, `prediction horizon ${inp.horizonMin} min is within ${GATE.MAX_HORIZON_MIN} min`, "HORIZON_TOO_LONG");

  // 3. simulated first
  const simulatedThis = inp.simulatedKeys.includes(key);
  add("simulated_first", simulatedThis && inp.simulatedKeys.length >= GATE.MIN_SIMULATED, simulatedThis ? `tested ${inp.simulatedKeys.length} distinct actions in simulation` : "this exact action was not tested with simulate_action first", "NOT_SIMULATED");
  if (simulatedThis && inp.simulatedKeys.length < GATE.MIN_SIMULATED)
    checks[checks.length - 1] = { name: "simulated_first", pass: false, detail: `only ${inp.simulatedKeys.length} action(s) simulated; need at least ${GATE.MIN_SIMULATED} distinct [TOO_FEW_SIMULATED]` };

  // 4. repeated refusal for the same reason
  const prior = inp.priorRefusals.filter((r) => r.key === key);
  add("not_repeat_refusal", prior.length === 0, "this action has not been refused before", "REPEATED_REFUSAL");

  // 5. constraints on action arguments (critical load)
  if (action.kind === "power_cap_rack" && action.rack === "rackB")
    add("critical_load_floor", action.fraction >= GATE.CRITICAL_RACK_FLOOR, `rack B (critical load) cap of ${action.fraction} is not below ${GATE.CRITICAL_RACK_FLOOR}`, "CRITICAL_LOAD_FLOOR");

  const live = inp.members.filter((m) => m.weight >= GATE.WEIGHT_FLOOR);
  const wsum = inp.members.reduce((a, m) => a + m.weight, 0) || 1;

  // 6. information-seeking action: a human check is low-risk and allowed whenever there is doubt or a hazard.
  if (action.kind === "dispatch_human_check") {
    const warranted = inp.suspectSensors.length > 0 || inp.pHazard >= GATE.MIN_HAZARD_P || inp.pFault >= 0.5 || !inp.modelAdequate;
    add("check_warranted", warranted, `human check is warranted (suspect sensors: ${inp.suspectSensors.join(",") || "none"}; P(hazard)=${inp.pHazard.toFixed(2)}; P(fault)=${inp.pFault.toFixed(2)})`, "CHECK_NOT_WARRANTED");
    const exp = expectedImprovement(inp.members, wsum);
    return done(exp, worstCase(live));
  }

  // 7. model must explain the data well enough to trust a prediction
  add("model_adequate", inp.modelAdequate, "the twin explains the observed data", "MODEL_INADEQUATE");

  // 8. a hazard must be plausible
  add("hazard_plausible", inp.pHazard >= GATE.MIN_HAZARD_P, `P(hazard within horizon)=${inp.pHazard.toFixed(2)} >= ${GATE.MIN_HAZARD_P}`, "NO_HAZARD");

  // 9. robust improvement across every plausible hypothesis
  let robust = true;
  let culprit = "";
  for (const m of live) {
    const gain = m.doNothing.peakMargin - m.withAction.peakMargin;
    const safeAnyway = m.doNothing.peakMargin < -3 && m.withAction.peakMargin <= m.doNothing.peakMargin + 0.3;
    if (gain < GATE.MIN_IMPROVEMENT_C && !safeAnyway) {
      robust = false;
      culprit = `under hypothesis '${m.family}' (weight ${m.weight.toFixed(2)}) the action improves peak by only ${gain.toFixed(1)} C`;
      break;
    }
  }
  add("robust_improvement", robust, `improves the predicted peak by >= ${GATE.MIN_IMPROVEMENT_C} C under every plausible hypothesis`, "NOT_ROBUST");
  if (!robust) checks[checks.length - 1].detail = `${culprit} (needs >= ${GATE.MIN_IMPROVEMENT_C} C under every plausible hypothesis) [NOT_ROBUST]`;

  // 10. no new breach introduced
  const worse = live.find((m) => m.withAction.peakMargin > Math.max(m.doNothing.peakMargin, -GATE.MIN_IMPROVEMENT_C) + 0.3);
  add("no_new_hazard", !worse, "the action does not create a new predicted limit breach", "SIDE_EFFECT");

  // 11. cutting power: strictest gate
  if (action.kind === "cut_power_circuit") {
    const imminent = live.length > 0 && live.every((m) => m.doNothing.timeToLimitMin !== null && m.doNothing.timeToLimitMin <= GATE.CRITICAL_HORIZON_MIN);
    add("cut_imminent_breach", imminent, `every plausible hypothesis predicts a breach within ${GATE.CRITICAL_HORIZON_MIN} min without action`, "NOT_IMMINENT");
    const lessSevere = Object.entries(inp.simulatedWorstMargin).filter(([k]) => !k.includes("cut_power_circuit"));
    const insufficient = lessSevere.length > 0 && lessSevere.every(([, worst]) => worst > 0);
    add("cut_last_resort", insufficient, "less severe simulated actions were insufficient (still predict a breach)", "LESS_SEVERE_AVAILABLE");
  }

  return done(expectedImprovement(inp.members, wsum), worstCase(live));
}

function expectedImprovement(ms: MemberForecast[], wsum: number): number | null {
  if (ms.length === 0) return null;
  return Number((ms.reduce((a, m) => a + (m.weight * (m.doNothing.peakMargin - m.withAction.peakMargin)) / wsum, 0)).toFixed(2));
}
function worstCase(live: MemberForecast[]): number | null {
  if (live.length === 0) return null;
  return Number(Math.min(...live.map((m) => m.doNothing.peakMargin - m.withAction.peakMargin)).toFixed(2));
}
