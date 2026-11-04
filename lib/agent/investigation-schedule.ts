import { SAMPLE_S } from "../sim/types";
import type { TriggerEvent } from "./trigger";

export const evidenceChanged = (current: number[], previous: number[]) => current.some((x,i) => Math.abs(x-previous[i]) >= [0.8,0.8,0.7,0.4,80][i]);

/** Cheap observation-only scheduler. Repeated identical warnings must not spend all model calls early. */
export class InvestigationSchedule {
  private lastK = -Infinity;
  private seen = new Map<string, { k: number; evidence: number[] }>();
  constructor(private cooldownMin: number) {}
  private key(t: TriggerEvent) { return `${t.rule}:${t.rule === "flat" ? t.detail.match(/S[123]/)?.[0] : t.detail.split(" ").slice(0,2).join(" ")}`; }
  shouldInvestigate(t: TriggerEvent, evidence: number[]) {
    if ((t.k-this.lastK)*SAMPLE_S < this.cooldownMin*60) return false;
    const prior = this.seen.get(this.key(t));
    if (!prior) return true;
    const elapsed = (t.k-prior.k)*SAMPLE_S/60;
    const changed = evidenceChanged(evidence, prior.evidence);
    return changed || elapsed >= (t.rule === "flat" ? 45 : 30);
  }
  record(t: TriggerEvent, evidence: number[]) { this.lastK=t.k; this.seen.set(this.key(t),{k:t.k,evidence:[...evidence]}); }
}
