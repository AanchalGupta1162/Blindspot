import { isOccupied, PARAMS } from "../sim/engine";
import { Readings, mean } from "../sim/sensors";
import { SAMPLE_S } from "../sim/types";

export const FEATURE_NAMES = ["s1", "s2", "s3", "ds1", "ds2", "ds3", "d13", "d23", "pwr", "pdev", "vdrop_v", "contact_w", "occ", "pdev_x_s3", "d13_sq", "d23_sq", "s1_sq", "s3_sq", "s1_x_s2", "d13_x_s3", "d13_x_d23", "ds1_x_d13", "contact_sq", "vd_x_pwr"];
export const MIN_HISTORY = 22; // samples (11 min) needed to form slopes

export const nominalTotalKw = (occupied: boolean) =>
  (PARAMS.loadRackA + PARAMS.loadRackB + (occupied ? 2 * PARAMS.loadDeskOccupied : 2 * PARAMS.loadDeskIdle)) / 1000;

const sm = (arr: ArrayLike<number>, k: number) => mean(arr, k - 2, k + 1);

/** Features available to the monitor at sample k (uses readings up to and including k only). */
export function featuresAt(r: Readings, k: number, startHour: number): number[] | null {
  if (k < MIN_HISTORY) return null;
  const [S1, S2, S3, M1, M2] = r.data;
  const s1 = sm(S1, k), s2 = sm(S2, k), s3 = sm(S3, k);
  const lag = 20;
  const ds1 = (s1 - sm(S1, k - lag)) / ((lag * SAMPLE_S) / 60);
  const ds2 = (s2 - sm(S2, k - lag)) / ((lag * SAMPLE_S) / 60);
  const ds3 = (s3 - sm(S3, k - lag)) / ((lag * SAMPLE_S) / 60);
  const pwr = sm(M1, k);
  const occ = isOccupied(startHour + (k * SAMPLE_S) / 3600) ? 1 : 0;
  const pdev = pwr - nominalTotalKw(!!occ);
  const vd = sm(M2, k) / 1000;
  const iB = PARAMS.loadRackB / PARAMS.voltage; // nominal rack B feed current (A)
  const contact = vd * iB;
  const d13 = s1 - s3;
  const d23 = s2 - s3;
  return [
    s1, s2, s3, ds1, ds2, ds3, d13, d23, pwr, pdev, vd, contact, occ, pdev * s3,
    d13 * d13, d23 * d23, s1 * s1, s3 * s3, s1 * s2, d13 * s3, d13 * d23, ds1 * d13, contact * contact, vd * pwr,
  ];
}
