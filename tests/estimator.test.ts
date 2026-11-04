import { describe, expect, it } from "vitest";
import { loadRidge } from "../lib/agent/monitor";
import { featuresAt } from "../lib/estimate/features";
import { predictRidge } from "../lib/estimate/ridge";
import { prepare } from "../lib/sim/runner";
import { SCENARIO_KINDS } from "../lib/sim/types";

describe("hidden-zone estimator (held-out seeds)", () => {
  it("has bounded error on seeds it was not trained on", () => {
    const ridge = loadRidge();
    expect(ridge, "run `npm run train` first").not.toBeNull();
    const se = [0, 0, 0];
    let n = 0;
    for (const kind of SCENARIO_KINDS)
      for (const seed of [7000, 7001, 7002]) {
        const p = prepare(kind, seed);
        for (let k = 22; k < p.readings.n; k += 6) {
          const est = predictRidge(ridge!, featuresAt(p.readings, k, p.scn.startHour)!);
          [1, 3, 5].forEach((node, t) => (se[t] += (est[t] - p.trace.T[node][k]) ** 2));
          n++;
        }
      }
    const [rackB, desk2, conn] = se.map((s) => Math.sqrt(s / n));
    expect(rackB).toBeLessThan(3.5);
    expect(desk2).toBeLessThan(1);
    expect(conn).toBeLessThan(4.5);
  });
});
