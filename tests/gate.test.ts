import { describe, expect, it } from "vitest";
import { GATE, GateInput, MemberForecast, evaluateGate } from "../lib/tools/gate";
import { actionKey } from "../lib/tools/schemas";

const cap = { kind: "power_cap_rack", rack: "rackB", fraction: 0.7 } as const;
const cut = { kind: "cut_power_circuit", circuit: "B" } as const;
const backup = { kind: "switch_backup_cooling", zone: "rackB" } as const;

const member = (w: number, nothing: number, withA: number, ttl: number | null = 30): MemberForecast => ({
  weight: w,
  family: "x",
  doNothing: { peakMargin: nothing, timeToLimitMin: ttl },
  withAction: { peakMargin: withA, timeToLimitMin: withA > 0 ? 40 : null },
});

const base = (over: Partial<GateInput> = {}): GateInput => ({
  rawAction: cap,
  horizonMin: 90,
  members: [member(0.7, 3, -1), member(0.3, 4, 0)],
  pHazard: 0.8,
  pFault: 0.95,
  modelAdequate: true,
  suspectSensors: [],
  simulatedKeys: [actionKey(cap), actionKey(backup)],
  simulatedWorstMargin: { [actionKey(cap)]: 0, [actionKey(backup)]: 2 },
  priorRefusals: [],
  ...over,
});

describe("safety gate", () => {
  it("accepts a robustly beneficial, tested action", () => {
    const d = evaluateGate(base());
    expect(d.allowed).toBe(true);
    expect(d.worstCaseImprovementC).toBeGreaterThanOrEqual(GATE.MIN_IMPROVEMENT_C);
  });

  it("refuses actions outside the catalog", () => {
    const d = evaluateGate(base({ rawAction: { kind: "reboot_building" } }));
    expect(d.allowed).toBe(false);
    expect(d.codes).toContain("NOT_IN_CATALOG");
  });

  it("refuses invalid arguments", () => {
    expect(evaluateGate(base({ rawAction: { kind: "power_cap_rack", rack: "rackB", fraction: 0.1 } })).allowed).toBe(false);
  });

  it("refuses an action that was not simulated first", () => {
    const d = evaluateGate(base({ simulatedKeys: [actionKey(backup), actionKey(cut)] }));
    expect(d.allowed).toBe(false);
    expect(d.codes).toContain("NOT_SIMULATED");
  });

  it("requires at least two distinct simulated actions", () => {
    const d = evaluateGate(base({ simulatedKeys: [actionKey(cap)] }));
    expect(d.allowed).toBe(false);
    expect(d.codes).toContain("TOO_FEW_SIMULATED");
  });

  it("refuses when one plausible hypothesis sees no meaningful gain", () => {
    const d = evaluateGate(base({ members: [member(0.7, 3, -1), member(0.3, 3, 2.5)] }));
    expect(d.allowed).toBe(false);
    expect(d.codes).toContain("NOT_ROBUST");
  });

  it("refuses an action when no hazard is plausible", () => {
    const d = evaluateGate(base({ pHazard: 0.02 }));
    expect(d.allowed).toBe(false);
    expect(d.codes).toContain("NO_HAZARD");
  });

  it("refuses when the model does not explain the data", () => {
    const d = evaluateGate(base({ modelAdequate: false }));
    expect(d.allowed).toBe(false);
    expect(d.codes).toContain("MODEL_INADEQUATE");
  });

  it("will not cap the critical rack below the floor", () => {
    const low = { kind: "power_cap_rack", rack: "rackB", fraction: 0.45 } as const;
    const d = evaluateGate(base({ rawAction: low, simulatedKeys: [actionKey(low), actionKey(backup)] }));
    expect(d.allowed).toBe(false);
    expect(d.codes).toContain("CRITICAL_LOAD_FLOOR");
  });

  it("refuses to cut power unless a breach is imminent under every hypothesis", () => {
    const d = evaluateGate(base({ rawAction: cut, simulatedKeys: [actionKey(cut), actionKey(backup)], members: [member(0.7, 3, -4, 45), member(0.3, 4, -3, 50)] }));
    expect(d.allowed).toBe(false);
    expect(d.codes).toContain("NOT_IMMINENT");
  });

  it("allows cutting power only as a last resort when a breach is imminent", () => {
    const ok = evaluateGate(base({ rawAction: cut, simulatedKeys: [actionKey(cut), actionKey(backup)], simulatedWorstMargin: { [actionKey(backup)]: 3, [actionKey(cut)]: -5 }, members: [member(0.7, 6, -4, 8), member(0.3, 7, -3, 10)] }));
    expect(ok.allowed).toBe(true);
    const notLast = evaluateGate(base({ rawAction: cut, simulatedKeys: [actionKey(cut), actionKey(backup)], simulatedWorstMargin: { [actionKey(backup)]: -2, [actionKey(cut)]: -5 }, members: [member(0.7, 6, -4, 8), member(0.3, 7, -3, 10)] }));
    expect(notLast.allowed).toBe(false);
    expect(notLast.codes).toContain("LESS_SEVERE_AVAILABLE");
  });

  it("does not repeat a refused request", () => {
    const d = evaluateGate(base({ priorRefusals: [{ key: actionKey(cap), codes: ["NOT_ROBUST"] }] }));
    expect(d.allowed).toBe(false);
    expect(d.codes).toContain("REPEATED_REFUSAL");
  });

  it("allows a human check when a sensor is suspect, even with no predicted hazard", () => {
    const check = { kind: "dispatch_human_check" } as const;
    const d = evaluateGate(base({ rawAction: check, simulatedKeys: [actionKey(check), actionKey(cap)], pHazard: 0, pFault: 0.1, suspectSensors: ["S1"] }));
    expect(d.allowed).toBe(true);
  });

  it("refuses a human check when nothing is wrong", () => {
    const check = { kind: "dispatch_human_check" } as const;
    const d = evaluateGate(base({ rawAction: check, simulatedKeys: [actionKey(check), actionKey(cap)], pHazard: 0, pFault: 0.05 }));
    expect(d.allowed).toBe(false);
    expect(d.codes).toContain("CHECK_NOT_WARRANTED");
  });
});
