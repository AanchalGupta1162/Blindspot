import { ScenarioInstance } from "./scenarios";
import { SAMPLE_S, Trace } from "./types";

export type SensorId = "S1" | "S2" | "S3" | "M1" | "M2";
export interface SensorSpec {
  id: SensorId;
  label: string;
  location: string;
  kind: "temperature" | "power" | "voltage_drop";
  unit: string;
  sigma: number; // nominal noise (1 sigma)
}

/** The only things the monitoring system can see: 3 temperature sensors + 2 electrical meters. */
export const SENSORS: SensorSpec[] = [
  { id: "S1", label: "Rack A inlet temperature", location: "Rack A (hot aisle side)", kind: "temperature", unit: "°C", sigma: 0.3 },
  { id: "S2", label: "Desk row 1 air temperature", location: "Desk row 1", kind: "temperature", unit: "°C", sigma: 0.3 },
  { id: "S3", label: "Return air temperature", location: "AC return duct", kind: "temperature", unit: "°C", sigma: 0.3 },
  { id: "M1", label: "UPS total power", location: "UPS output (all loads)", kind: "power", unit: "kW", sigma: 0.04 },
  { id: "M2", label: "Rack B power-strip voltage drop", location: "Rack B feed, strip vs. panel", kind: "voltage_drop", unit: "mV", sigma: 15 },
];
export const SENSOR_INDEX: Record<SensorId, number> = { S1: 0, S2: 1, S3: 2, M1: 3, M2: 4 };

export interface Readings {
  n: number;
  data: Float64Array[]; // [sensor][k]
}

/** Turn the true trace into sensor readings: noise, calibration bias and (optionally) a stuck sensor. */
export function senseTrace(s: ScenarioInstance, tr: Trace): Readings {
  const data = SENSORS.map(() => new Float64Array(tr.n));
  for (let k = 0; k < tr.n; k++) {
    data[0][k] = tr.T[0][k] + s.bias[0] + s.noise[0][k];
    data[1][k] = tr.T[2][k] + s.bias[1] + s.noise[1][k];
    data[2][k] = tr.T[4][k] + s.bias[2] + s.noise[2][k];
    data[3][k] = tr.totalKw[k] + s.noise[3][k];
    data[4][k] = tr.vdropMv[k] + s.noise[4][k];
  }
  if (s.stuck) {
    const k0 = Math.floor(s.stuck.tStuckS / SAMPLE_S);
    const frozen = data[s.stuck.sensor][k0];
    for (let k = k0; k < tr.n; k++) data[s.stuck.sensor][k] = frozen;
  }
  return { n: tr.n, data };
}

export function std(xs: ArrayLike<number>, from: number, to: number): number {
  let m = 0;
  const n = to - from;
  if (n <= 1) return 0;
  for (let i = from; i < to; i++) m += xs[i];
  m /= n;
  let v = 0;
  for (let i = from; i < to; i++) v += (xs[i] - m) ** 2;
  return Math.sqrt(v / (n - 1));
}

export function mean(xs: ArrayLike<number>, from: number, to: number): number {
  let m = 0;
  for (let i = from; i < to; i++) m += xs[i];
  return m / Math.max(1, to - from);
}

/** Sensor metadata the agent can inspect. Flatness is computed from data actually seen so far. */
export function sensorMetadata(s: ScenarioInstance, r: Readings, id: SensorId, kNow: number) {
  const spec = SENSORS.find((x) => x.id === id)!;
  const i = SENSOR_INDEX[id];
  const w = Math.min(40, kNow); // last 20 minutes
  const flat = std(r.data[i], kNow - w + 1, kNow + 1);
  const days = i < 3 ? s.calibrationDays[i] : null;
  return {
    id,
    label: spec.label,
    location: spec.location,
    unit: spec.unit,
    nominal_noise_sigma: spec.sigma,
    last_calibration_days_ago: days,
    std_last_20min: Number(flat.toFixed(4)),
    flat_suspect: flat < spec.sigma * 0.1 && kNow >= 40,
  };
}
