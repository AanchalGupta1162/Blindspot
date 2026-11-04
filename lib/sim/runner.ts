import { buildEnv, ScenarioInstance, makeScenario } from "./scenarios";
import { runTrace } from "./engine";
import { Readings, senseTrace } from "./sensors";
import { Intervention, LIMITS, NODES, SAMPLE_S, Trace, ScenarioKind } from "./types";

export interface PreparedScenario {
  scn: ScenarioInstance;
  trace: Trace; // TRUE state (hidden from the agent; used by the evaluator and the UI "truth" curve)
  readings: Readings; // what the sensors report
}

/** Deterministic: same (kind, seed) always yields identical output. */
export function prepare(kind: ScenarioKind, seed: number, interventions: Intervention[] = []): PreparedScenario {
  const scn = makeScenario(kind, seed);
  return prepareFrom(scn, interventions);
}

export function prepareFrom(scn: ScenarioInstance, interventions: Intervention[] = []): PreparedScenario {
  const trace = runTrace(buildEnv(scn, interventions), scn.durationS);
  return { scn, trace, readings: senseTrace(scn, trace) };
}

/** First sample index at which any true node exceeds its simulated limit (-1 if none). */
export function firstBreach(trace: Trace): { k: number; node: string } | null {
  for (let k = 0; k < trace.n; k++)
    for (let i = 0; i < NODES.length; i++)
      if (trace.T[i][k] > LIMITS[NODES[i]]) return { k, node: NODES[i] };
  return null;
}

/** Outcome metrics against ground truth. degree-minutes above the limit are summed over all nodes. */
export function outcomeMetrics(trace: Trace) {
  let degMin = 0;
  let peakExcess = -Infinity;
  for (let i = 0; i < NODES.length; i++) {
    for (let k = 0; k < trace.n; k++) {
      const ex = trace.T[i][k] - LIMITS[NODES[i]];
      if (ex > peakExcess) peakExcess = ex;
      if (ex > 0) degMin += (ex * SAMPLE_S) / 60;
    }
  }
  const fb = firstBreach(trace);
  return {
    limitExceeded: fb !== null,
    firstBreachMin: fb ? (fb.k * SAMPLE_S) / 60 : null,
    firstBreachNode: fb?.node ?? null,
    degreeMinutesAboveLimit: Number(degMin.toFixed(2)),
    peakMarginC: Number(peakExcess.toFixed(2)), // peak (T - limit) over all nodes; negative = within limits
  };
}
