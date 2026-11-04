import { expect, it } from "vitest";
import { summarizeEvaluation } from "../lib/agent/evaluation";
it("reports only the completed subset with true median lead and separate false alarms", () => {
  const row = (id: string, alertMin: number | null, breachMin: number | null) => ({ id, alertMin, breachMin, costUsd: 0.1 });
  const result = summarizeEvaluation([row("ac_failure-1", 10, 20), row("ac_failure-2", 10, 40), row("control-1", 20, null)], 20, "spark");
  expect(result.n).toBe(3);
  expect(result.complete).toBe(false);
  expect(result.medianLeadMin).toBe(20);
  expect(result.controlsWithAlert).toBe(1);
});

import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCompletedEvaluation } from "../lib/agent/evaluation-store";
it("archives an interrupted run so it can resume while retaining its billed attempt", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-resume-"));
  const sample = JSON.parse(readFileSync("data/runs/unattended_ac-3000-llm.json", "utf8"));
  sample.status = "budget_stopped";
  writeFileSync(join(dir, "run.json"), JSON.stringify(sample));
  expect(readCompletedEvaluation(join(dir, "run.json"), join(dir, "attempts"))).toBeNull();
  const archived = JSON.parse(readFileSync(join(dir, "attempts", readdirSync(join(dir, "attempts"))[0]), "utf8"));
  expect(archived.usage.costUsd).toBeGreaterThan(0);
});
