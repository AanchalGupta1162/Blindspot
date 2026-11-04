import { PreparedScenario, outcomeMetrics, prepareFrom } from "../sim/runner";
import { Readings, SENSORS, SensorId, SENSOR_INDEX, sensorMetadata } from "../sim/sensors";
import { ALERT_MARGIN, Intervention, SAMPLE_S } from "../sim/types";
import { Diagnosis, Forecast, diagnose, forecast, toIntervention } from "../twin/twin";
import { featuresAt } from "../estimate/features";
import { RidgeModel } from "../estimate/ridge";
import { GATE, GateDecision } from "./gate";
import { ActionInput, actionKey } from "./schemas";

export interface AlertRecord {
  tMin: number;
  level: "info" | "warn" | "critical";
  message: string;
}

export type IncidentStatus = "investigating" | "needs_input" | "applied" | "escalated";

/**
 * Everything the agent can see at one moment. Ground truth (the true trace, the scenario kind)
 * stays private to this class and is used only by the evaluator after the fact.
 */
export class Incident {
  readonly readings: Readings; // truncated: no future samples
  readonly tNowS: number;
  monitorContext: { priorAtMin: number; priorSummary: string; elapsedMin: number } | null = null;
  status: IncidentStatus = "investigating";
  alerts: AlertRecord[] = [];
  simulatedKeys: string[] = [];
  simulatedWorstMargin: Record<string, number> = {};
  refusals: { key: string; codes: string[] }[] = [];
  refusalCount = 0;
  pending: { action: ActionInput; reason: string; gate: GateDecision } | null = null;
  applied: { action: ActionInput; intervention: Intervention; reason: string } | null = null;
  private diag: Diagnosis | null = null;
  private baseline = new Map<number, { f: Forecast; w: number; family: string }[]>();

  constructor(private prepared: PreparedScenario, readonly kNow: number, readonly ridge: RidgeModel | null, readonly priorInterventions: Intervention[] = []) {
    this.readings = { n: kNow + 1, data: prepared.readings.data.map((d) => d.slice(0, kNow + 1)) };
    this.tNowS = kNow * SAMPLE_S;
  }

  get id() {
    return this.prepared.scn.id;
  }
  get startHour() {
    return this.prepared.scn.startHour;
  }
  get humanDelayS() {
    return this.prepared.scn.humanDelayS;
  }
  get approvalDelayS() {
    return this.prepared.scn.approvalDelayS;
  }
  get tNowMin() {
    return Number((this.tNowS / 60).toFixed(1));
  }

  metadata(id: SensorId) {
    return sensorMetadata(this.prepared.scn, this.readings, id, this.kNow);
  }
  suspectSensors(): SensorId[] {
    return (["S1", "S2", "S3"] as SensorId[]).filter((id) => this.metadata(id).flat_suspect);
  }

  history(id: SensorId, windowMin: number) {
    const i = SENSOR_INDEX[id];
    const from = Math.max(0, this.kNow - Math.round((windowMin * 60) / SAMPLE_S));
    const strideK = Math.max(1, Math.round(((windowMin / 16) * 60) / SAMPLE_S));
    const pts: { t_min_ago: number; value: number }[] = [];
    for (let k = this.kNow; k >= from; k -= strideK) pts.push({ t_min_ago: Number((((this.kNow - k) * SAMPLE_S) / 60).toFixed(1)), value: Number(this.readings.data[i][k].toFixed(2)) });
    pts.reverse();
    const seg = Array.from(this.readings.data[i].slice(from, this.kNow + 1));
    const half = Math.floor(seg.length / 2);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const minutes = ((seg.length - 1) * SAMPLE_S) / 60;
    return {
      points: pts,
      min: Number(Math.min(...seg).toFixed(2)),
      max: Number(Math.max(...seg).toFixed(2)),
      trend_per_10min: minutes > 0 ? Number((((avg(seg.slice(half)) - avg(seg.slice(0, half))) / (minutes / 2)) * 10).toFixed(3)) : 0,
    };
  }

  estimateHidden() {
    if (!this.ridge) return null;
    const f = featuresAt(this.readings, this.kNow, this.startHour);
    if (!f) return null;
    return f;
  }

  diagnosis(): Diagnosis {
    if (!this.diag)
      this.diag = diagnose({ readings: this.readings, kNow: this.kNow, startHour: this.startHour, humanDelayS: this.humanDelayS, interventions: this.priorInterventions, excluded: this.suspectSensors() });
    return this.diag;
  }

  private ctx = () => ({ startHour: this.startHour, humanDelayS: this.humanDelayS, kNow: this.kNow });

  doNothing(horizonMin: number) {
    let hit = this.baseline.get(horizonMin);
    if (!hit) {
      hit = this.diagnosis().members.filter((m) => m.weight >= 0.002).map((m) => ({ f: forecast(m, this.ctx(), horizonMin * 60, this.priorInterventions), w: m.weight, family: m.family }));
      this.baseline.set(horizonMin, hit);
    }
    return hit;
  }

  withAction(action: ActionInput, horizonMin: number) {
    const iv = toIntervention(action, this.tNowS, this.approvalDelayS, this.humanDelayS);
    return this.diagnosis()
      .members.filter((m) => m.weight >= 0.002)
      .map((m) => ({ f: forecast(m, this.ctx(), horizonMin * 60, [...this.priorInterventions, iv]), w: m.weight, family: m.family }));
  }

  /** Probability mass on members that come within ALERT_MARGIN of a limit / breach one. */
  hazard(horizonMin: number) {
    const base = this.doNothing(horizonMin);
    const z = base.reduce((a, b) => a + b.w, 0) || 1;
    return {
      pHazard: base.filter((b) => b.f.peakMargin >= -ALERT_MARGIN).reduce((a, b) => a + b.w, 0) / z,
      pBreach: base.filter((b) => b.f.timeToLimitMin !== null).reduce((a, b) => a + b.w, 0) / z,
    };
  }

  /** Ground truth: only the evaluator and the recorder call this, after the decision. */
  groundTruthOutcome() {
    const none = outcomeMetrics(prepareFrom(this.prepared.scn).trace);
    const interventions = [...this.priorInterventions, ...(this.applied ? [this.applied.intervention] : [])];
    const acted = interventions.length ? outcomeMetrics(prepareFrom(this.prepared.scn, interventions).trace) : null;
    return {
      doNothing: none,
      withAction: acted,
      peakMarginImprovementC: acted ? Number((none.peakMarginC - acted.peakMarginC).toFixed(2)) : null,
      degreeMinutesSaved: acted ? Number((none.degreeMinutesAboveLimit - acted.degreeMinutesAboveLimit).toFixed(2)) : null,
    };
  }
}

export { SENSORS, GATE };
