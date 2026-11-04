import { expect, it } from "vitest";
import { prepare } from "../lib/sim/runner";
import { buildSeries } from "../lib/ui/series";
it("shows the observations actually seen after an approved action in replay", () => {
  const untreated = prepare("unattended_ac", 3000);
  const acted = prepare("unattended_ac", 3000, [{ tApply: 5400, action: { kind: "switch_backup_cooling", zone: "rackB" } }]);
  const series = buildSeries(untreated, null, acted, Infinity, true);
  expect(series[240].S3).toBe(acted.readings.data[2][240]);
  expect(series[240].S3).not.toBe(untreated.readings.data[2][240]);
  expect(series[240].rackB).toBe(untreated.trace.T[1][240]);
});
