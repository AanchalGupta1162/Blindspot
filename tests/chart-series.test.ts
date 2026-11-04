import { expect, it } from "vitest";
import { prepare } from "../lib/sim/runner";
import { LIMITS, NODES } from "../lib/sim/types";
import { buildSeries } from "../lib/ui/series";
it("charts compare every zone against its own limit and respect the reveal time", () => {
  const p = prepare("loose_connection", 3000);
  const points = buildSeries(p, null);
  for (const [k, point] of points.entries()) {
    expect(point.maxMargin).toBeCloseTo(Math.max(...NODES.map((node, i) => p.trace.T[i][k] - LIMITS[node])));
  }
  expect(points.some(p => p.maxMargin! > 0)).toBe(true);
  expect(buildSeries(p, null, p)[100].maxMarginAct).toBe(points[100].maxMargin);
  expect(buildSeries(p, null, null, 0)[1]).toEqual({ t: 0.5 });
});
