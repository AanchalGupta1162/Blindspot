import { Readings } from "../sim/sensors";
import { ALERT_MARGIN, LIMITS, SAMPLE_S } from "../sim/types";

/** M0: static threshold alarm on the visible temperature sensors, ALERT_MARGIN below each zone's limit. */
export const BASELINE_THRESHOLDS = [LIMITS.rackA - ALERT_MARGIN, LIMITS.desk1 - ALERT_MARGIN, LIMITS.ret - ALERT_MARGIN];

export function baselineAlertIndex(r: Readings, consecutive = 2): number | null {
  let run = 0;
  for (let k = 0; k < r.n; k++) {
    const hot = [0, 1, 2].some((i) => r.data[i][k] > BASELINE_THRESHOLDS[i]);
    run = hot ? run + 1 : 0;
    if (run >= consecutive) return k;
  }
  return null;
}

/** All alert episodes (for false-alarm counting): onsets separated by at least `gapS` seconds. */
export function baselineAlertEpisodes(r: Readings, consecutive = 2, gapS = 1800): number[] {
  const out: number[] = [];
  let run = 0;
  let last = -Infinity;
  for (let k = 0; k < r.n; k++) {
    const hot = [0, 1, 2].some((i) => r.data[i][k] > BASELINE_THRESHOLDS[i]);
    run = hot ? run + 1 : 0;
    if (run >= consecutive && k * SAMPLE_S - last >= gapS) {
      out.push(k);
      last = k * SAMPLE_S;
    }
  }
  return out;
}
