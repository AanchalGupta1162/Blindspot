import { describe, expect, it } from "vitest";
import { AgentRunner, loadRidge } from "../lib/agent/monitor";
import { executeRun } from "../lib/agent/record";
import { applyApproval } from "../lib/tools";
import { Intervention } from "../lib/sim/types";
import { prepare } from "../lib/sim/runner";
import { Incident } from "../lib/tools/incident";

const usage = () => ({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, turns: 0, models: [] });
describe("follow-up monitoring", () => {
  it("re-investigates after cooling takes effect and scores both approved interventions", async () => {
    const times: number[] = [];
    const runner: AgentRunner = {
      source: "scripted-policy", model: null, label: "test policy", usage,
      async invoke(inc, _trigger, rec) {
        times.push(inc.tNowMin);
        const action = times.length === 1 ? { kind: "switch_backup_cooling" as const, zone: "rackB" as const } : { kind: "shed_noncritical_load" as const };
        // Gate behavior has its own tests: this runner supplies an approved test intervention.
        inc.pending = { action, reason: "test intervention", gate: { allowed: true } as never };
        rec.push("approval", inc.tNowMin, { decision: "approved", mode: "auto-simulated", by: "test" });
        const iv = applyApproval(inc);
        rec.push("applied", inc.tNowMin, { action, tApplyMin: iv.tApply / 60 });
        return "alerted_and_acted";
      },
    };
    const run = await executeRun({ kind: "unattended_ac", seed: 3000, ridge: loadRidge(), agent: runner, maxInvocations: 2 });
    expect(times).toHaveLength(2);
    expect(times[1]).toBeGreaterThanOrEqual(times[0] + 20);
    expect(run.actions).toHaveLength(2);
    expect(run.action?.action.kind).toBe("switch_backup_cooling");
    expect(run.outcome.withAction!.degreeMinutesAboveLimit).toBeLessThan(106);
    expect(run.outcome.doNothing.firstBreachMin).toBe(133.5);
  });

  it("fits already-applied cooling rather than treating it as an unexplained fault", () => {
    const iv: Intervention = { tApply: 5400, action: { kind: "switch_backup_cooling", zone: "rackB" } };
    const inc = new Incident(prepare("unattended_ac", 3000, [iv]), 240, loadRidge(), [iv]);
    expect(inc.diagnosis().modelAdequate).toBe(true);
    expect(inc.withAction({ kind: "shed_noncritical_load" }, 90)[0].f.peakMargin).toBeLessThan(inc.doNothing(90)[0].f.peakMargin);
  });
});
it("preserves applied actions but reports a later budget stop as interrupted", async () => {
  let calls = 0;
  const runner: AgentRunner = { source: "scripted-policy", model: null, label: "test", usage,
    async invoke(inc) {
      if (++calls === 2) return "stopped";
      inc.pending = { action: { kind: "switch_backup_cooling", zone: "rackB" }, reason: "test", gate: { allowed: true } as never };
      applyApproval(inc);
      return "alerted_and_acted";
    },
  };
  const run = await executeRun({ kind: "unattended_ac", seed: 3000, ridge: loadRidge(), agent: runner, maxInvocations: 2 });
  expect(run.status).toBe("budget_stopped");
  expect(run.actions).toHaveLength(1);
  expect(run.outcome.withAction).not.toBeNull();
});
