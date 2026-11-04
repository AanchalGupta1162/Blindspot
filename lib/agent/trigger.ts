import { nominalSteadyState, runTrace } from "../sim/engine";
import { Readings, mean, std } from "../sim/sensors";
import { ALERT_MARGIN, LIMITS, SAMPLE_S } from "../sim/types";
import { featuresAt } from "../estimate/features";
import { predictRidge, RidgeModel } from "../estimate/ridge";
import { twinEnv } from "../twin/twin";

/**
 * Cheap trigger: wakes the agent. The LLM is never polled continuously. Four deterministic rules:
 *  residual   - visible readings drift from the nominal twin's expectation
 *  contact    - electrical signature of a high-resistance connection
 *  flat       - a temperature sensor stopped moving
 *  ridge_high - the regression estimate of a hidden zone is close to its limit
 */
export interface TriggerEvent {
  k: number;
  rule: "residual" | "contact" | "flat" | "ridge_high";
  detail: string;
}

export class TriggerMonitor {
  private nominal: Float64Array[];
  private offsets: number[] = [0, 0, 0, 0, 0];
  constructor(private startHour: number, private durationS: number, private ridge: RidgeModel | null) {
    const tr = runTrace(twinEnv({ family: "none", tOnS: 0, mag: 0, rampS: 1 }, startHour, 600), durationS, nominalSteadyState(startHour));
    this.nominal = [tr.T[0], tr.T[2], tr.T[4], tr.totalKw, tr.vdropMv];
  }

  /** Calibrate sensor offsets on the first 10 healthy minutes (no faults begin before then). */
  calibrate(r: Readings) {
    for (let s = 0; s < 5; s++) this.offsets[s] = mean(r.data[s], 0, 20) - mean(this.nominal[s], 0, 20);
  }

  check(r: Readings, k: number): TriggerEvent | null {
    if (k < 24) return null;
    const res = (s: number) => mean(r.data[s], k - 3, k + 1) - mean(this.nominal[s], k - 3, k + 1) - this.offsets[s];
    // sustained over 4 consecutive samples
    const sustained = (s: number, th: number) => [0, 1, 2, 3, 4, 5].every((j) => {
      const kk = k - j;
      const v = mean(r.data[s], kk - 3, kk + 1) - mean(this.nominal[s], kk - 3, kk + 1) - this.offsets[s];
      return Math.abs(v) > th;
    });
    for (const [s, th, name] of [[0, 1.1, "S1"], [1, 0.8, "S2"], [2, 0.7, "S3"]] as const)
      if (sustained(s, th) && Math.sign(res(s)) > 0) return { k, rule: "residual", detail: `${name} is ${res(s).toFixed(1)} C above the nominal expectation` };
    if (sustained(3, 0.5) && res(3) > 0) return { k, rule: "residual", detail: `UPS power is ${res(3).toFixed(2)} kW above the nominal expectation` };
    const vd = res(4);
    if (sustained(4, 40) && vd > 0) return { k, rule: "contact", detail: `rack B strip voltage drop is ${vd.toFixed(0)} mV above nominal` };
    // flat sensor: exactly constant for 15 minutes while another temperature channel still moves
    const flatWin = 30;
    const flatSensors = [0, 1, 2].filter((s) => std(r.data[s], k - flatWin + 1, k + 1) < 0.01);
    const moving = [0, 1, 2].filter((s) => std(r.data[s], k - flatWin + 1, k + 1) > 0.08);
    if (flatSensors.length > 0 && moving.length > 0) return { k, rule: "flat", detail: `sensor S${flatSensors[0] + 1} has been exactly constant for 15 minutes` };
    if (this.ridge) {
      const f = featuresAt(r, k, this.startHour);
      if (f) {
        const est = predictRidge(this.ridge, f);
        const lim = [LIMITS.rackB, LIMITS.desk2, LIMITS.conn];
        const trig = [lim[0] - 2.5, lim[1] - 2, lim[2] - 5];
        for (let i = 0; i < 3; i++)
          if (est[i] >= trig[i]) return { k, rule: "ridge_high", detail: `${this.ridge.targets[i]} estimated at ${est[i].toFixed(1)} C (limit ${lim[i]})` };
      }
    }
    return null;
  }
}

export { ALERT_MARGIN, SAMPLE_S };
