import { predictRidge, RidgeModel } from "../estimate/ridge";
import { featuresAt } from "../estimate/features";
import { PreparedScenario } from "../sim/runner";
import { LIMITS, NODES, SAMPLE_S } from "../sim/types";

export interface Point {
  t: number; // minutes
  S1?: number;
  S2?: number;
  S3?: number;
  rackB?: number;
  rackBAct?: number;
  conn?: number;
  connAct?: number;
  estRackB?: number;
  estConn?: number;
  vd?: number;
  kw?: number;
  maxMargin?: number;
  maxMarginAct?: number;
}

/**
 * Build the chart rows. Everything after `reveal` (minutes) is left undefined so the chart "plays".
 * `acted` is the same scenario re-simulated with the recorded action applied (truth with action).
 */
export function buildSeries(p: PreparedScenario, ridge: RidgeModel | null, acted?: PreparedScenario | null, reveal = Infinity, observedWithActions = false): Point[] {
  const out: Point[] = [];
  const observed = observedWithActions && acted ? acted : p;
  for (let k = 0; k < p.readings.n; k++) {
    const t = (k * SAMPLE_S) / 60;
    if (t > reveal) {
      out.push({ t });
      continue;
    }
    const pt: Point = {
      t,
      maxMargin: Math.max(...NODES.map((node, i) => p.trace.T[i][k] - LIMITS[node])),
      S1: observed.readings.data[0][k],
      S2: observed.readings.data[1][k],
      S3: observed.readings.data[2][k],
      rackB: p.trace.T[1][k],
      conn: p.trace.T[5][k],
      vd: observed.readings.data[4][k],
      kw: observed.readings.data[3][k],
    };
    if (acted) {
      pt.maxMarginAct = Math.max(...NODES.map((node, i) => acted.trace.T[i][k] - LIMITS[node]));
      pt.rackBAct = acted.trace.T[1][k];
      pt.connAct = acted.trace.T[5][k];
    }
    if (ridge) {
      const f = featuresAt(observed.readings, k, p.scn.startHour);
      if (f) {
        const e = predictRidge(ridge, f);
        pt.estRackB = e[0];
        pt.estConn = e[2];
      }
    }
    out.push(pt);
  }
  return out;
}
