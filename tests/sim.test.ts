import { describe, expect, it } from "vitest";
import { buildEnv, makeScenario } from "../lib/sim/scenarios";
import { runTrace } from "../lib/sim/engine";
import { firstBreach, prepare } from "../lib/sim/runner";
import { SCENARIO_KINDS } from "../lib/sim/types";
import { baselineAlertIndex } from "../lib/baseline/threshold";

describe("simulator", () => {
  it("is deterministic from (kind, seed)", () => {
    const a = prepare("ac_failure", 42);
    const b = prepare("ac_failure", 42);
    expect(Array.from(a.trace.T[1])).toEqual(Array.from(b.trace.T[1]));
    expect(Array.from(a.readings.data[0])).toEqual(Array.from(b.readings.data[0]));
  });

  it("different seeds give different trajectories", () => {
    const a = prepare("ac_failure", 1);
    const b = prepare("ac_failure", 2);
    expect(Array.from(a.readings.data[0])).not.toEqual(Array.from(b.readings.data[0]));
  });

  it("more heat load means a higher steady temperature on the loaded rack", () => {
    const scn = makeScenario("control", 7);
    const lo = runTrace(buildEnv(scn), 3600);
    const hi = runTrace({ ...buildEnv(scn), faultAt: () => ({ acCap: 1, vent: [1, 1, 1, 1], spike: 1.8, rContact: 0.01 }) }, 3600 * 2);
    expect(hi.T[1][hi.n - 1]).toBeGreaterThan(lo.T[1][lo.n - 1] + 2);
  });

  it("less cooling capacity means higher temperatures", () => {
    const scn = makeScenario("control", 7);
    const base = runTrace(buildEnv(scn), 7200);
    const weak = runTrace({ ...buildEnv(scn), faultAt: () => ({ acCap: 0.3, vent: [1, 1, 1, 1], spike: 1, rContact: 0.01 }) }, 7200);
    expect(weak.T[4][weak.n - 1]).toBeGreaterThan(base.T[4][base.n - 1] + 3);
  });

  it("higher contact resistance heats the connector", () => {
    const scn = makeScenario("control", 7);
    const hot = runTrace({ ...buildEnv(scn), faultAt: () => ({ acCap: 1, vent: [1, 1, 1, 1], spike: 1, rContact: 0.4 }) }, 3600);
    const cool = runTrace(buildEnv(scn), 3600);
    expect(hot.T[5][hot.n - 1]).toBeGreaterThan(cool.T[5][cool.n - 1] + 20);
  });

  it("no-fault controls never breach a limit and never trip the threshold alarm", () => {
    for (let seed = 5000; seed < 5010; seed++) {
      const p = prepare("control", seed);
      expect(firstBreach(p.trace)).toBeNull();
      expect(baselineAlertIndex(p.readings)).toBeNull();
    }
  });

  it("each fault scenario develops a breach for most seeds", () => {
    for (const kind of SCENARIO_KINDS.filter((k) => k !== "control")) {
      let breaches = 0;
      for (let seed = 6000; seed < 6006; seed++) if (firstBreach(prepare(kind, seed).trace)) breaches++;
      expect(breaches, kind).toBeGreaterThanOrEqual(4);
    }
  });

  it("a stuck sensor reports exactly constant values after it freezes", () => {
    const p = prepare("stuck_sensor", 11);
    const k0 = Math.floor(p.scn.stuck!.tStuckS / 30);
    const tail = Array.from(p.readings.data[0].slice(k0 + 1, k0 + 40));
    expect(new Set(tail).size).toBe(1);
  });
});
