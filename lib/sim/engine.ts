import { Action, DT, FaultState, Intervention, NODES, STEPS_PER_SAMPLE, SAMPLE_S, Trace } from "./types";

/**
 * Lumped thermal model (starting values; tuned so scenarios develop over tens of minutes):
 *   C_i dT_i/dt = P_i - k_i * f_i * (T_i - T_supply) - sum_j g_ij (T_i - T_j) - k_amb_i (T_i - T_amb) - backup
 *   C_c dT_c/dt = I^2 R_contact - h (T_c - T_rackB)
 */
export const PARAMS = {
  C: [3.0e5, 3.0e5, 4.0e5, 4.0e5, 1.2e5, 250],
  kCool: [150, 150, 70, 70, 120],
  kAmb: [8, 8, 15, 15, 10],
  g: [
    [0, 1, 25],
    [0, 4, 45],
    [1, 4, 45],
    [2, 4, 35],
    [3, 4, 35],
    [2, 3, 12],
    [0, 2, 6],
    [1, 3, 6],
  ] as const,
  Ts0: 18,
  Tbackup: 20,
  kBackup: 90,
  hConn: 0.5,
  voltage: 230,
  loadRackA: 1500,
  loadRackB: 1800,
  loadDeskOccupied: 600,
  loadDeskIdle: 80,
};

export type Params = typeof PARAMS;

export const isOccupied = (hour: number) => {
  const h = ((hour % 24) + 24) % 24;
  return h >= 9 && h < 17;
};

export const ambientAt = (tSec: number, startHour: number) =>
  30 + 1.5 * Math.sin((2 * Math.PI * (startHour + tSec / 3600 - 9)) / 24);

export interface Env {
  startHour: number;
  /** Optional physical parameters (the twin may be deliberately mismatched from the truth in robustness tests). */
  params?: Params;
  faultAt(t: number): FaultState;
  /** multiplicative load wobble for [rackA, rackB] at sample index k */
  wobble(k: number): [number, number];
  /** benign batch-job bump multipliers for [rackA, rackB] at time t */
  bump(t: number): [number, number];
  interventions: Intervention[];
  /** Latency until a human can act physically on site (seconds). */
  humanDelayS: number;
}

export interface Effective {
  acCap: number;
  vent: [number, number, number, number];
  loadMult: [number, number, number, number]; // rackA, rackB, desk1, desk2
  kExtra: [number, number, number, number];
  cutB: boolean;
  rContact: number;
}

function applyAction(a: Action, eff: Effective, fault: FaultState, atApply: FaultState) {
  switch (a.kind) {
    case "power_cap_rack":
      eff.loadMult[a.rack === "rackA" ? 0 : 1] *= a.fraction;
      break;
    case "shed_noncritical_load":
      eff.loadMult[0] *= 0.92;
      eff.loadMult[1] *= 0.92;
      eff.loadMult[2] *= 0.2;
      eff.loadMult[3] *= 0.2;
      break;
    case "switch_backup_cooling":
      eff.kExtra[["rackA", "rackB", "desk1", "desk2"].indexOf(a.zone)] += PARAMS.kBackup;
      break;
    case "clear_vent": {
      // Only repairs a blockage that exists when the person arrives.
      const i = ["rackA", "rackB", "desk1", "desk2"].indexOf(a.zone);
      if (atApply.vent[i] < 0.97) eff.vent[i] = 1;
      break;
    }
    case "dispatch_human_check":
      // A technician repairs whatever is wrong at arrival time: clears blocked vents, re-seats a loose
      // connection, removes rogue load, and brings a portable cooler for an AC fault (partial restoration only).
      // Faults that have not started yet are unaffected.
      for (let i = 0; i < 4; i++) if (atApply.vent[i] < 0.97) eff.vent[i] = 1;
      if (atApply.rContact > 0.015) eff.rContact = Math.min(eff.rContact, 0.012);
      if (atApply.spike > 1.05) eff.loadMult[1] /= Math.max(fault.spike, 1);
      if (atApply.acCap < 0.97) eff.acCap = Math.max(eff.acCap, 0.55);
      break;
    case "cut_power_circuit":
      eff.cutB = true;
      break;
  }
}

/** Latency (s) between an approved decision and the action physically taking effect. */
export function actionLatency(a: Action, humanDelayS: number): number {
  switch (a.kind) {
    case "power_cap_rack":
    case "shed_noncritical_load":
      return 60;
    case "cut_power_circuit":
      return 30;
    case "switch_backup_cooling":
      return 300;
    case "clear_vent":
    case "dispatch_human_check":
      return humanDelayS;
  }
}

export function effectiveAt(t: number, env: Env): Effective {
  const f = env.faultAt(t);
  const eff: Effective = {
    acCap: f.acCap,
    vent: [...f.vent] as Effective["vent"],
    loadMult: [1, f.spike, 1, 1],
    kExtra: [0, 0, 0, 0],
    cutB: false,
    rContact: f.rContact,
  };
  for (const iv of env.interventions) if (iv.tApply <= t) applyAction(iv.action, eff, f, env.faultAt(iv.tApply));
  return eff;
}

export class Sim {
  t = 0;
  private dT = new Float64Array(6);
  x: Float64Array; // temperatures per node
  constructor(public env: Env, x0: Float64Array | number[]) {
    this.x = Float64Array.from(x0);
  }

  clone(env: Env = this.env): Sim {
    const s = new Sim(env, this.x);
    s.t = this.t;
    return s;
  }

  private get p(): Params {
    return this.env.params ?? PARAMS;
  }

  loads(t: number, k: number, eff: Effective) {
    const PARAMS = this.p;
    const w = this.env.wobble(k);
    const b = this.env.bump(t);
    const occ = isOccupied(this.env.startHour + t / 3600);
    const desk = occ ? PARAMS.loadDeskOccupied : PARAMS.loadDeskIdle;
    const P = [
      PARAMS.loadRackA * w[0] * b[0] * eff.loadMult[0],
      PARAMS.loadRackB * w[1] * b[1] * eff.loadMult[1] * (eff.cutB ? 0 : 1),
      desk * eff.loadMult[2],
      desk * eff.loadMult[3],
    ];
    return P;
  }

  step() {
    const PARAMS = this.p;
    const { x, t } = this;
    const k = Math.floor(t / SAMPLE_S);
    const eff = effectiveAt(t, this.env);
    const P = this.loads(t, k, eff);
    const Tamb = ambientAt(t, this.env.startHour);
    const Tsup = PARAMS.Ts0 + (1 - eff.acCap) * Math.max(0, x[4] - PARAMS.Ts0);
    const dT = this.dT;
    for (let i = 0; i < 5; i++) {
      const vent = i < 4 ? eff.vent[i] : 1;
      let q = (i < 4 ? P[i] : 0) - PARAMS.kCool[i] * vent * (x[i] - Tsup) - PARAMS.kAmb[i] * (x[i] - Tamb);
      if (i < 4) q -= eff.kExtra[i] * (x[i] - PARAMS.Tbackup);
      dT[i] = q;
    }
    for (const [i, j, g] of PARAMS.g) {
      const flow = g * (x[i] - x[j]);
      dT[i] -= flow;
      dT[j] += flow;
    }
    const I = P[1] / PARAMS.voltage;
    dT[5] = I * I * eff.rContact - PARAMS.hConn * (x[5] - x[1]);
    for (let i = 0; i < 6; i++) x[i] += (DT * dT[i]) / PARAMS.C[i];
    this.t += DT;
  }

  advanceTo(tEnd: number) {
    while (this.t < tEnd - 1e-9) this.step();
  }

  /** Electrical meters derived from the present state. */
  meters(k: number) {
    const PARAMS = this.p;
    const eff = effectiveAt(this.t, this.env);
    const P = this.loads(this.t, k, eff);
    const I = P[1] / PARAMS.voltage;
    return {
      loadW: P,
      vdropMv: I * eff.rContact * 1000,
      totalKw: (P[0] + P[1] + P[2] + P[3] + I * I * eff.rContact) / 1000,
      rContact: eff.rContact,
    };
  }
}

const steadyCache = new Map<string, Float64Array>();

/** Nominal steady state for a given start hour (occupancy at start), no faults, no wobble. */
export function nominalSteadyState(startHour: number): Float64Array {
  const key = String(isOccupied(startHour));
  const hit = steadyCache.get(key);
  if (hit) return hit;
  const env: Env = {
    startHour,
    faultAt: () => ({ acCap: 1, vent: [1, 1, 1, 1], spike: 1, rContact: 0.01 }),
    wobble: () => [1, 1],
    bump: () => [1, 1],
    interventions: [],
    humanDelayS: 600,
  };
  const s = new Sim(env, [27, 28, 25, 25, 23, 40]);
  // Pre-warm with the clock pinned to t=0 so occupancy stays at its start-of-scenario value.
  for (let i = 0; i < (5 * 3600) / DT; i++) {
    s.t = 0;
    s.step();
  }
  s.t = 0;
  steadyCache.set(key, s.x);
  return s.x;
}

/** Run a full trace of an environment from a nominal steady state. */
export function runTrace(env: Env, durationS: number, x0?: Float64Array): Trace {
  const n = Math.floor(durationS / SAMPLE_S) + 1;
  const T = NODES.map(() => new Float64Array(n));
  const loadW = [0, 1, 2, 3].map(() => new Float64Array(n));
  const tArr = new Float64Array(n);
  const rContact = new Float64Array(n);
  const vdropMv = new Float64Array(n);
  const totalKw = new Float64Array(n);
  const sim = new Sim(env, x0 ?? nominalSteadyState(env.startHour));
  for (let k = 0; k < n; k++) {
    const m = sim.meters(k);
    tArr[k] = sim.t;
    for (let i = 0; i < 6; i++) T[i][k] = sim.x[i];
    for (let i = 0; i < 4; i++) loadW[i][k] = m.loadW[i];
    rContact[k] = m.rContact;
    vdropMv[k] = m.vdropMv;
    totalKw[k] = m.totalKw;
    for (let s = 0; s < STEPS_PER_SAMPLE; s++) sim.step();
  }
  return { n, t: tArr, T, loadW, rContact, vdropMv, totalKw };
}
