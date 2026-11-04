import { Rng, hashString } from "./rng";
import { Env } from "./engine";
import { FaultState, Intervention, SAMPLE_S, SCENARIO_LABEL, ScenarioKind, R_CONTACT_NOMINAL } from "./types";

export interface ScenarioInstance {
  id: string;
  kind: ScenarioKind;
  seed: number;
  label: string;
  startHour: number;
  durationS: number;
  onsetS: number;
  humanDelayS: number; // time for a person to physically reach the equipment
  approvalDelayS: number; // time for the on-call operator to review and approve a remote action
  faulty: boolean;
  fault: {
    rampS: number;
    acMin: number;
    ventMin: number;
    ventZone: 0 | 1 | 2 | 3;
    spikeMult: number;
    rEnd: number;
  };
  bump: { t0: number; lenS: number; mult: [number, number] };
  wobbleA: Float64Array;
  wobbleB: Float64Array;
  /** Sensor noise streams, order: S1 S2 S3 M1 M2 */
  noise: Float64Array[];
  bias: number[]; // calibration bias for S1 S2 S3
  calibrationDays: number[];
  stuck?: { sensor: number; tStuckS: number };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function makeScenario(kind: ScenarioKind, seed: number): ScenarioInstance {
  const rng = new Rng(hashString(`${kind}:${seed}`));
  const faulty = kind !== "control";
  const unattended = kind === "unattended_ac";
  const startHour = unattended ? rng.uniform(17.6, 19.5) : kind === "control" ? rng.uniform(7.5, 10.5) : rng.uniform(9.2, 11);
  const durationS = kind === "control" ? 8 * 3600 : 4 * 3600;
  const onsetS = Math.round(rng.uniform(35, 70) * 60);
  const n = Math.floor(durationS / SAMPLE_S) + 1;

  // AR(1) load wobble, about 3% std
  const wobbleA = new Float64Array(n);
  const wobbleB = new Float64Array(n);
  let a = 0;
  let b = 0;
  for (let k = 0; k < n; k++) {
    a = 0.97 * a + 0.007 * rng.normal();
    b = 0.97 * b + 0.007 * rng.normal();
    wobbleA[k] = 1 + a;
    wobbleB[k] = 1 + b;
  }
  const sigmas = [0.3, 0.3, 0.3, 0.04, 15];
  const noise = sigmas.map((s) => {
    const arr = new Float64Array(n);
    for (let k = 0; k < n; k++) arr[k] = s * rng.normal();
    return arr;
  });
  const calibrationDays = [0, 1, 2].map(() => Math.round(rng.uniform(20, 400)));
  const bias = calibrationDays.map((d) => (d / 400) * rng.uniform(-0.6, 0.6));

  const bumpRack = rng.pick([0, 1]);
  const bump = {
    t0: Math.round(rng.uniform(25, 150) * 60),
    lenS: Math.round(rng.uniform(8, 20) * 60),
    mult: (bumpRack === 0 ? [rng.uniform(1.15, 1.3), 1] : [1, rng.uniform(1.15, 1.3)]) as [number, number],
  };

  const fault = {
    rampS: Math.round(rng.uniform(25, 70) * 60),
    acMin: rng.uniform(0.04, 0.18),
    ventMin: kind === "stuck_sensor" ? rng.uniform(0.1, 0.27) : rng.uniform(0.08, 0.25),
    ventZone: (kind === "stuck_sensor" ? 0 : 1) as 0 | 1,
    spikeMult: rng.uniform(1.75, 2.25),
    rEnd: rng.uniform(0.32, 0.6),
  };
  if (kind === "loose_connection") fault.rampS = Math.round(rng.uniform(40, 90) * 60);

  const stuck =
    kind === "stuck_sensor"
      ? { sensor: 0, tStuckS: Math.max(600, onsetS - Math.round(rng.uniform(5, 20) * 60)) }
      : undefined;

  return {
    id: `${kind}-${seed}`,
    kind,
    seed,
    label: SCENARIO_LABEL[kind],
    startHour,
    durationS,
    onsetS,
    humanDelayS: unattended ? 2700 : 600,
    approvalDelayS: unattended ? 900 : 120,
    faulty,
    fault,
    bump,
    wobbleA,
    wobbleB,
    noise,
    bias,
    calibrationDays,
    stuck,
  };
}

export function faultAtFor(s: ScenarioInstance): (t: number) => FaultState {
  const { kind, onsetS: on, fault: f } = s;
  return (t: number) => {
    const fs: FaultState = { acCap: 1, vent: [1, 1, 1, 1], spike: 1, rContact: R_CONTACT_NOMINAL };
    const u = clamp01((t - on) / f.rampS);
    switch (kind) {
      case "ac_failure":
      case "unattended_ac":
        fs.acCap = 1 - (1 - f.acMin) * u;
        break;
      case "blocked_vent":
      case "stuck_sensor":
        fs.vent[f.ventZone] = 1 - (1 - f.ventMin) * u;
        break;
      case "load_spike":
        fs.spike = 1 + (f.spikeMult - 1) * clamp01((t - on) / 60);
        break;
      case "loose_connection":
        fs.rContact = R_CONTACT_NOMINAL + (f.rEnd - R_CONTACT_NOMINAL) * u * u;
        break;
      case "control":
        break;
    }
    return fs;
  };
}

export function buildEnv(s: ScenarioInstance, interventions: Intervention[] = []): Env {
  return {
    startHour: s.startHour,
    faultAt: faultAtFor(s),
    wobble: (k) => [s.wobbleA[Math.min(k, s.wobbleA.length - 1)], s.wobbleB[Math.min(k, s.wobbleB.length - 1)]],
    bump: (t) => (t >= s.bump.t0 && t < s.bump.t0 + s.bump.lenS ? s.bump.mult : [1, 1]),
    interventions,
    humanDelayS: s.humanDelayS,
  };
}
