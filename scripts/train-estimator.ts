import { writeFileSync } from "node:fs";
import { prepare } from "../lib/sim/runner";
import { SCENARIO_KINDS } from "../lib/sim/types";
import { FEATURE_NAMES, featuresAt } from "../lib/estimate/features";
import { fitRidge } from "../lib/estimate/ridge";

/** Train seeds are disjoint from the held-out evaluation seeds (2000+). */
export const TRAIN_SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i);
export const TARGETS = ["rackB", "desk2", "conn"] as const;
const IDX = { rackB: 1, desk2: 3, conn: 5 };

export function buildDataset(seeds: number[], stride = 4) {
  const X: number[][] = [];
  const Y: number[][] = [];
  for (const kind of SCENARIO_KINDS)
    for (const seed of seeds) {
      const p = prepare(kind, seed);
      for (let k = 22; k < p.trace.n; k += stride) {
        const f = featuresAt(p.readings, k, p.scn.startHour);
        if (f) {
          X.push(f);
          Y.push(TARGETS.map((t) => p.trace.T[IDX[t]][k]));
        }
      }
    }
  return { X, Y };
}

if (process.argv[1]?.endsWith("train-estimator.ts")) {
  const { X, Y } = buildDataset(TRAIN_SEEDS);
  const model = fitRidge(X, Y, FEATURE_NAMES, [...TARGETS], 0.01, `${TRAIN_SEEDS.length} seeds x ${SCENARIO_KINDS.length} kinds (seeds ${TRAIN_SEEDS[0]}-${TRAIN_SEEDS.at(-1)})`);
  writeFileSync("data/models/ridge.json", JSON.stringify(model));
  console.log(`trained on ${X.length} rows; train residual sigma:`, model.residualSigma.map((s) => s.toFixed(2)).join(", "));
}
