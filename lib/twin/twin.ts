import { Env, PARAMS, Params, nominalSteadyState, runTrace } from "../sim/engine";
import { Rng } from "../sim/rng";
import { Readings, SENSORS, SensorId, SENSOR_INDEX } from "../sim/sensors";
import { Action, FaultState, Intervention, LIMITS, Node, NODES, R_CONTACT_NOMINAL, SAMPLE_S, nominalFault } from "../sim/types";
import { actionLatency } from "../sim/engine";

/**
 * The "twin": the same lumped physics, nominal parameters, with a *hypothesised* fault.
 * It never sees ground truth. Hypotheses are fitted to the sensor history, then rolled forward
 * (with or without a candidate action) to predict what happens next.
 */
export type Family = "none" | "ac" | "vent_rackA" | "vent_rackB" | "load_rackB" | "connector";

export interface HypSpec {
  family: Family;
  tOnS: number; // fault onset
  mag: number; // plateau magnitude (see faultOf)
  rampS: number; // time to reach the plateau
  rampPower?: 1 | 2; // connector growth shape; omitted preserves historical linear hypotheses
}

export interface Hypothesis extends HypSpec {
  sse: number;
  weight: number;
  description: string;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function faultOf(h: HypSpec): (t: number) => FaultState {
  return (t) => {
    const fs = nominalFault();
    if (h.family === "none") return fs;
    const u = clamp01((t - h.tOnS) / Math.max(h.rampS, 1));
    switch (h.family) {
      case "ac":
        fs.acCap = 1 - h.mag * u; // mag = fraction of cooling capacity lost
        break;
      case "vent_rackA":
        fs.vent[0] = 1 - h.mag * u; // mag = fraction of airflow blocked
        break;
      case "vent_rackB":
        fs.vent[1] = 1 - h.mag * u;
        break;
      case "load_rackB":
        fs.spike = 1 + (h.mag - 1) * u; // mag = load multiplier
        break;
      case "connector":
        fs.rContact = R_CONTACT_NOMINAL + (h.mag - R_CONTACT_NOMINAL) * u ** (h.rampPower ?? 1); // mag = final ohms
        break;
    }
    return fs;
  };
}

/**
 * Robustness experiments only: make the twin's physics differ from the simulator's by +/- `rel` (relative),
 * so we can measure how much performance depends on the twin being a perfect copy. Off (undefined) by default.
 */
let TWIN_PARAMS: Params | undefined;
export function setTwinMismatch(rel: number, seed = 1) {
  if (rel <= 0) {
    TWIN_PARAMS = undefined;
    return;
  }
  const r = new Rng(seed * 7919);
  const f = () => 1 + rel * r.uniform(-1, 1);
  TWIN_PARAMS = {
    ...PARAMS,
    C: PARAMS.C.map((c) => c * f()),
    kCool: PARAMS.kCool.map((c) => c * f()),
    kAmb: PARAMS.kAmb.map((c) => c * f()),
    g: PARAMS.g.map(([i, j, g]) => [i, j, g * f()]) as unknown as Params["g"],
    hConn: PARAMS.hConn * f(),
    loadRackA: PARAMS.loadRackA * f(),
    loadRackB: PARAMS.loadRackB * f(),
  };
}

export function twinEnv(h: HypSpec, startHour: number, humanDelayS: number, interventions: Intervention[] = []): Env {
  return {
    startHour,
    params: TWIN_PARAMS,
    faultAt: faultOf(h),
    wobble: () => [1, 1],
    bump: () => [1, 1],
    interventions,
    humanDelayS,
  };
}

export function describeHypothesis(h: HypSpec, tNowS: number): string {
  const ago = Math.max(0, Math.round((tNowS - h.tOnS) / 60));
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  switch (h.family) {
    case "none":
      return "No fault: readings are explained by the nominal model";
    case "ac":
      return `AC cooling capacity degrading (up to ${pct(h.mag)} lost, ramp ~${Math.round(h.rampS / 60)} min), onset ~${ago} min ago`;
    case "vent_rackA":
      return `Rack A vent/airflow blocked (up to ${pct(h.mag)}), onset ~${ago} min ago`;
    case "vent_rackB":
      return `Rack B vent/airflow blocked (up to ${pct(h.mag)}), onset ~${ago} min ago`;
    case "load_rackB":
      return `Rack B load increased to ~${h.mag.toFixed(2)}x nominal, ~${ago} min ago`;
    case "connector":
      return `Rack B power connector resistance ${h.rampPower === 2 ? "accelerating" : "rising steadily"} (to ~${h.mag.toFixed(2)} ohm), onset ~${ago} min ago`;
  }
}

/* ----------------------------- fitting ----------------------------- */

const SIGMA_EFF: Record<SensorId, number> = { S1: 0.35, S2: 0.35, S3: 0.35, M1: 0.1, M2: 20 };

export interface FitInput {
  readings: Readings;
  kNow: number;
  startHour: number;
  humanDelayS: number;
  interventions?: Intervention[]; // previously approved actions, included in fitting
  excluded: SensorId[]; // sensors known/suspected to be faulty (e.g. stuck)
}

interface Prepared {
  y: Float64Array[]; // observed (bias-corrected) per sensor
  weights: number[];
  dof: number;
}

function simulatedSensors(h: HypSpec, inp: FitInput, tEnd: number) {
  const tr = runTrace(twinEnv(h, inp.startHour, inp.humanDelayS, inp.interventions), tEnd, nominalSteadyState(inp.startHour));
  return [tr.T[0], tr.T[2], tr.T[4], tr.totalKw, tr.vdropMv];
}

function prepareObs(inp: FitInput): Prepared {
  const { readings, kNow } = inp;
  const nominal = simulatedSensors({ family: "none", tOnS: 0, mag: 0, rampS: 1 }, inp, kNow * SAMPLE_S);
  const y: Float64Array[] = [];
  const weights: number[] = [];
  let used = 0;
  for (let s = 0; s < SENSORS.length; s++) {
    const id = SENSORS[s].id;
    // Estimate each sensor's constant offset from the first 10 healthy minutes (no fault starts before then).
    let off = 0;
    for (let k = 0; k < 20; k++) off += (readings.data[s][k] - nominal[s][k]) / 20;
    const arr = new Float64Array(kNow + 1);
    for (let k = 0; k <= kNow; k++) arr[k] = readings.data[s][k] - off;
    y.push(arr);
    const w = inp.excluded.includes(id) ? 0 : 1 / SIGMA_EFF[id] ** 2;
    weights.push(w);
    if (w > 0) used++;
  }
  return { y, weights, dof: used * (kNow + 1) };
}

function sse(h: HypSpec, inp: FitInput, obs: Prepared): number {
  const pred = simulatedSensors(h, inp, inp.kNow * SAMPLE_S);
  let total = 0;
  for (let s = 0; s < pred.length; s++) {
    if (obs.weights[s] === 0) continue;
    let acc = 0;
    for (let k = 0; k <= inp.kNow; k += 2) acc += (obs.y[s][k] - pred[s][k]) ** 2;
    total += acc * 2 * obs.weights[s];
  }
  return total;
}

const GRIDS: Record<Exclude<Family, "none">, { mags: number[]; ramps: number[] }> = {
  ac: { mags: [0.4, 0.6, 0.8, 0.95], ramps: [1200, 2700, 5000] },
  vent_rackA: { mags: [0.5, 0.7, 0.85, 0.93], ramps: [1200, 2700, 5000] },
  vent_rackB: { mags: [0.5, 0.7, 0.85, 0.93], ramps: [1200, 2700, 5000] },
  load_rackB: { mags: [1.3, 1.6, 2.0, 2.4], ramps: [60] },
  connector: { mags: [0.08, 0.2, 0.4, 0.7], ramps: [1200, 2700, 5000] },
};
const BOUNDS: Record<Exclude<Family, "none">, [number, number]> = {
  ac: [0.1, 0.97],
  vent_rackA: [0.1, 0.95],
  vent_rackB: [0.1, 0.95],
  load_rackB: [1.05, 3],
  connector: [0.03, 1],
};

interface Candidate {
  spec: HypSpec;
  sse: number;
}

function fitFamily(fam: Exclude<Family, "none">, inp: FitInput, obs: Prepared): { coarse: Candidate[]; all: Candidate[] } {
  const tNow = inp.kNow * SAMPLE_S;
  const lo = 900;
  const hi = Math.max(lo, tNow - 300);
  const tOns = Array.from({ length: 6 }, (_, i) => Math.round(lo + ((hi - lo) * i) / 5));
  const [mlo, mhi] = BOUNDS[fam];
  const all: Candidate[] = [];
  const coarse: Candidate[] = [];
  const evalSpec = (spec: HypSpec, isCoarse = false) => {
    const c = { spec, sse: sse(spec, inp, obs) };
    all.push(c);
    if (isCoarse) coarse.push(c);
    return c;
  };
  let best: Candidate | null = null;
  for (const tOn of tOns)
    for (const mag of GRIDS[fam].mags)
      for (const ramp of GRIDS[fam].ramps) for (const rampPower of fam === "connector" ? [1, 2] as const : [1] as const) {
        const c = evalSpec({ family: fam, tOnS: tOn, mag, rampS: ramp, rampPower }, true);
        if (!best || c.sse < best.sse) best = c;
      }
  // Refine each supported growth shape independently. Otherwise a slightly better linear
  // coarse fit can prevent an accelerating explanation from ever receiving local refinement.
  for (const power of fam === "connector" ? [1, 2] as const : [1] as const) {
    let shapeBest = all.filter(c => c.spec.rampPower === power).sort((a,b) => a.sse-b.sse)[0];
    let step = tOns.length > 1 ? (tOns[1] - tOns[0]) / 2 : 300;
    let mf = 0.15, rf = 0.4;
    for (let round = 0; round < 3; round++) {
      const b = shapeBest.spec;
      for (const dt of [-step, 0, step])
        for (const m of [1 - mf, 1, 1 + mf])
          for (const r of fam === "load_rackB" ? [1] : [1 - rf, 1, 1 + rf]) {
            const c = evalSpec({ family: fam,
              tOnS: Math.min(Math.max(lo, b.tOnS + dt), hi),
              mag: Math.min(Math.max(mlo, fam === "load_rackB" ? 1 + (b.mag - 1) * m : b.mag * m), mhi),
              rampS: b.rampS * r, rampPower: power });
            if (c.sse < shapeBest.sse) shapeBest = c;
          }
      step /= 2; mf /= 2; rf /= 2;
    }
  }
  all.sort((a, c) => a.sse - c.sse);
  return { coarse, all };
}

export interface FamilyPosterior {
  family: Family;
  posterior: number;
  best: Hypothesis;
}

export interface Diagnosis {
  kNow: number;
  dof: number;
  noFaultSse: number;
  bestSse: number;
  chi2PerDof: number;
  modelAdequate: boolean;
  excluded: SensorId[];
  families: FamilyPosterior[]; // best first
  /** Weighted ensemble of plausible (family, parameters) members; weights sum to 1. */
  members: Hypothesis[];
}

const FAMILY_PRIOR: Record<Family, number> = { none: 0.5, ac: 0.1, vent_rackA: 0.1, vent_rackB: 0.1, load_rackB: 0.1, connector: 0.1 };
/** Residuals are strongly autocorrelated (slow load wobble), so raw chi-square overstates the evidence. */
const BASE_TEMPER = 4;
const MEMBERS_PER_FAMILY = 5;

const logSumExp = (xs: number[]) => {
  const m = Math.max(...xs);
  return m + Math.log(xs.reduce((a, x) => a + Math.exp(x - m), 0));
};

export function diagnose(inp: FitInput): Diagnosis {
  const tNow = inp.kNow * SAMPLE_S;
  const obs = prepareObs(inp);
  const none: HypSpec = { family: "none", tOnS: 0, mag: 0, rampS: 1 };
  const noneSse = sse(none, inp, obs);
  const fits = new Map<Family, { coarse: Candidate[]; all: Candidate[] }>();
  if (inp.kNow >= 30) for (const fam of Object.keys(GRIDS) as (keyof typeof GRIDS)[]) fits.set(fam, fitFamily(fam, inp, obs));

  let sse0 = noneSse;
  for (const f of fits.values()) sse0 = Math.min(sse0, f.all[0].sse);
  const T = Math.max(BASE_TEMPER, sse0 / obs.dof);

  // Family evidence: likelihood averaged over the (uniform) parameter grid, so flexible families pay an Occam penalty.
  let ref = noneSse;
  for (const f of fits.values()) for (const c of f.coarse) ref = Math.min(ref, c.sse);
  const logEv = new Map<Family, number>([["none", -(noneSse - ref) / (2 * T)]]);
  for (const [fam, f] of fits) logEv.set(fam, logSumExp(f.coarse.map((c) => -(c.sse - ref) / (2 * T))) - Math.log(f.coarse.length));
  const fams = [...logEv.keys()];
  const logPost = fams.map((f) => Math.log(FAMILY_PRIOR[f]) + logEv.get(f)!);
  const lz = logSumExp(logPost);
  const posterior = new Map<Family, number>(fams.map((f, i) => [f, Math.exp(logPost[i] - lz)]));

  const mk = (spec: HypSpec, sseV: number, weight: number): Hypothesis => ({
    ...spec,
    sse: Number(sseV.toFixed(1)),
    weight: Number(weight.toFixed(4)),
    description: describeHypothesis(spec, tNow),
  });

  const families: FamilyPosterior[] = [];
  const members: Hypothesis[] = [];
  families.push({ family: "none", posterior: Number(posterior.get("none")!.toFixed(3)), best: mk(none, noneSse, posterior.get("none")!) });
  members.push(mk(none, noneSse, posterior.get("none")!));
  for (const [fam, f] of fits) {
    const pf = posterior.get(fam)!;
    const best = f.all[0];
    // members whose tempered likelihood is within e^-3 of the family's best...
    const near = f.all.filter((c) => c.sse - best.sse <= 6 * T);
    // ...spread across the plateau magnitude, so "keeps getting worse" stays represented in the ensemble
    near.sort((a, b) => a.spec.mag - b.spec.mag);
    const kept: Candidate[] = [];
    const n = Math.min(MEMBERS_PER_FAMILY, near.length);
    for (let i = 0; i < n; i++) {
      const c = near[n === 1 ? 0 : Math.round((i * (near.length - 1)) / (n - 1))];
      if (!kept.includes(c)) kept.push(c);
    }
    if (!kept.includes(best)) kept.push(best);
    const raw = kept.map((c) => Math.exp(-(c.sse - best.sse) / (2 * T)));
    const zf = raw.reduce((a, b) => a + b, 0);
    families.push({ family: fam, posterior: Number(pf.toFixed(3)), best: mk(best.spec, best.sse, pf) });
    kept.forEach((c, i) => members.push(mk(c.spec, c.sse, (pf * raw[i]) / zf)));
  }
  families.sort((a, b) => b.posterior - a.posterior);
  members.sort((a, b) => b.weight - a.weight);
  const chi2PerDof = sse0 / obs.dof;
  return {
    kNow: inp.kNow,
    dof: obs.dof,
    noFaultSse: Number(noneSse.toFixed(1)),
    bestSse: Number(sse0.toFixed(1)),
    chi2PerDof: Number(chi2PerDof.toFixed(2)),
    modelAdequate: chi2PerDof < 4,
    excluded: inp.excluded,
    families,
    members,
  };
}

/* ----------------------------- forecasting ----------------------------- */

export interface Forecast {
  peak: Record<Node, number>;
  peakMargin: number; // max over nodes of (T - limit), degrees; negative = within limits
  timeToLimitMin: number | null; // from now
  firstNode: Node | null;
  degreeMinutes: number; // above-limit exposure over the horizon
}

export function forecast(h: HypSpec, inp: Pick<FitInput, "startHour" | "humanDelayS" | "kNow">, horizonS: number, interventions: Intervention[] = []): Forecast {
  const tNow = inp.kNow * SAMPLE_S;
  const tr = runTrace(twinEnv(h, inp.startHour, inp.humanDelayS, interventions), tNow + horizonS, nominalSteadyState(inp.startHour));
  const peak = {} as Record<Node, number>;
  let peakMargin = -Infinity;
  let first: { k: number; node: Node } | null = null;
  let degMin = 0;
  for (let i = 0; i < NODES.length; i++) {
    let mx = -Infinity;
    for (let k = inp.kNow; k < tr.n; k++) {
      const v = tr.T[i][k];
      if (v > mx) mx = v;
      const ex = v - LIMITS[NODES[i]];
      if (ex > 0) {
        degMin += (ex * SAMPLE_S) / 60;
        if (!first || k < first.k) first = { k, node: NODES[i] };
      }
    }
    peak[NODES[i]] = Number(mx.toFixed(1));
    peakMargin = Math.max(peakMargin, mx - LIMITS[NODES[i]]);
  }
  return {
    peak,
    peakMargin: Number(peakMargin.toFixed(2)),
    timeToLimitMin: first ? Number((((first.k - inp.kNow) * SAMPLE_S) / 60).toFixed(1)) : null,
    firstNode: first?.node ?? null,
    degreeMinutes: Number(degMin.toFixed(1)),
  };
}

/** Convert an approved decision at time tNow into a timed intervention (approval + action latency). */
export function toIntervention(a: Action, tNowS: number, approvalDelayS: number, humanDelayS: number): Intervention {
  return { tApply: tNowS + approvalDelayS + actionLatency(a, humanDelayS), action: a };
}

export { SENSOR_INDEX };
