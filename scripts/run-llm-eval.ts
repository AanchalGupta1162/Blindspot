/** Sequential, resumable evaluation. Never overwrites human demo recordings. */
import "./env";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { Budget } from "../lib/agent/budget";
import { autoApprover } from "../lib/agent/approvers";
import { MetaClient } from "../lib/agent/client";
import { EvaluationRowSchema, summarizeEvaluation } from "../lib/agent/evaluation";
import { LLMAgent } from "../lib/agent/loop";
import { loadRidge } from "../lib/agent/monitor";
import { executeRun } from "../lib/agent/record";
import { readCompletedEvaluation } from "../lib/agent/evaluation-store";
import { RunSchema } from "../lib/agent/run";
import { SCENARIO_KINDS } from "../lib/sim/types";

async function main() {
  const base = Number(process.env.EVAL_SEED_BASE ?? 3000);
  const cap = Number(process.env.EVAL_BUDGET_USD ?? 3);
  if (!Number.isSafeInteger(base) || base < 0 || !Number.isFinite(cap) || cap <= 0) throw new Error("Invalid evaluation seed or budget");
  const model = process.env.MODEL_DEFAULT ?? "muse-spark-1.3";
  const jobs = SCENARIO_KINDS.flatMap((kind) => Array.from({ length: kind === "control" ? 2 : 3 }, (_, i) => ({ kind, seed: base + i })));
  const ridge = loadRidge();
  const client = new MetaClient();
  mkdirSync("data/runs", { recursive: true });
  mkdirSync("data/eval", { recursive: true });
  const rows: ReturnType<typeof EvaluationRowSchema.parse>[] = [];
  const attemptsDir = "data/eval/attempts";
  for (const job of jobs) readCompletedEvaluation(`data/runs/eval-v2-${model}-${job.kind}-${job.seed}-llm.json`, attemptsDir);
  const attemptCost = existsSync(attemptsDir) ? readdirSync(attemptsDir).filter((f) => f.startsWith(`eval-v2-${model}-`) && f.endsWith(".json")).reduce((sum, f) => sum + RunSchema.parse(JSON.parse(readFileSync(`${attemptsDir}/${f}`, "utf8"))).usage.costUsd, 0) : 0;
  const cached = new Map(jobs.map((job) => {
    const id = `eval-v2-${model}-${job.kind}-${job.seed}-llm`;
    return [id, readCompletedEvaluation(`data/runs/${id}.json`, attemptsDir)] as const;
  }));
  let total = attemptCost + [...cached.values()].reduce((n, run) => n + (run?.usage.costUsd ?? 0), 0);
  const writeSummary = () => {
    const out = { ...summarizeEvaluation(rows, jobs.length, model), attemptCostUsd: attemptCost, batchSpentUsd: Number(total.toFixed(4)), batchCapUsd: cap };
    writeFileSync("data/eval/llm-results.json.tmp", JSON.stringify(out, null, 1));
    renameSync("data/eval/llm-results.json.tmp", "data/eval/llm-results.json");
  };
  for (const job of jobs) {
    const id = `eval-v2-${model}-${job.kind}-${job.seed}-llm`;
    const file = `data/runs/${id}.json`;
    let run = cached.get(id) ?? null;
    if (run) {
      if (run.model !== model || run.scenario.kind !== job.kind || run.scenario.seed !== job.seed || run.id !== id) throw new Error(`Evaluation record does not match ${id}`);
    } else {
      const remaining = cap - total;
      if (remaining < 0.05) { console.log("Evaluation batch cap reached; resume by raising EVAL_BUDGET_USD deliberately."); break; }
      const budget = new Budget({ runCapUsd: Math.min(Number(process.env.RUN_BUDGET_USD ?? 1.5), remaining) });
      const agent = new LLMAgent({ client, budget, model, escalateModel: null, approve: autoApprover });
      run = await executeRun({ ...job, agent, ridge });
      run.id = id;
      writeFileSync(file, JSON.stringify(RunSchema.parse(run), null, 1));
      total += run.usage.costUsd;
    }
    const interrupted = run.status === "budget_stopped" || run.events.some((e) => e.kind === "status" && ["paused", "budget_stopped"].includes(String(e.data.status)));
    if (!interrupted) rows.push(EvaluationRowSchema.parse({ id: `${job.kind}-${job.seed}`, status: run.status, alertMin: run.alertMin, breachMin: run.outcome.doNothing.firstBreachMin, costUsd: run.usage.costUsd, turns: run.usage.turns, action: run.action?.action ?? null, peakImprovementC: run.outcome.peakMarginImprovementC, breachAvoided: run.outcome.withAction ? run.outcome.doNothing.limitExceeded && !run.outcome.withAction.limitExceeded : null }));
    writeSummary();
    console.log(`${id}: ${run.status}, alert=${run.alertMin ?? "none"}, $${run.usage.costUsd}; batch $${total.toFixed(4)}/$${cap}`);
    if (interrupted) {
      console.log("Stopped batch after a budget/API pause. The partial subset is saved.");
      break;
    }
  }
  writeSummary();
  console.log(`Saved ${rows.length}/${jobs.length} scenarios to data/eval/llm-results.json`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
