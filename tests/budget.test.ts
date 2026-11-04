import { describe, expect, it } from "vitest";
import { Budget, BudgetExceeded } from "../lib/agent/budget";
import { billedOutputTokens, costUsd, priceFor } from "../lib/agent/pricing";

describe("pricing", () => {
  it("prices Spark 1.3 per the model list", () => {
    expect(costUsd("muse-spark-1.3", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })).toBeCloseTo(1.25 + 4.25, 6);
  });
  it("treats unknown models as the most expensive one", () => {
    expect(priceFor("mystery")).toEqual(priceFor("muse-wonder-1.0"));
  });
  it("counts reasoning tokens as output when they are reported separately", () => {
    expect(billedOutputTokens({ prompt_tokens: 0, completion_tokens: 100, reasoning_tokens: 900 })).toBe(1000);
    expect(billedOutputTokens({ prompt_tokens: 0, completion_tokens: 1000, reasoning_tokens: 900 })).toBe(1000);
  });
});

describe("budget guard", () => {
  it("refuses a call whose worst case would cross the per-run cap", () => {
    const b = new Budget({ runCapUsd: 0.05, devCapUsd: 100, spendFile: null });
    expect(() => b.assertCanCall("muse-spark-1.3", 10_000, 4_000)).not.toThrow();
    b.record("muse-spark-1.3", { prompt_tokens: 10_000, completion_tokens: 8_000 });
    expect(() => b.assertCanCall("muse-spark-1.3", 10_000, 4_000)).toThrow(BudgetExceeded);
  });
  it("refuses when the development total would cross its cap", () => {
    const b = new Budget({ runCapUsd: 100, devCapUsd: 0.01, spendFile: null });
    expect(() => b.assertCanCall("muse-spark-1.3", 10_000, 4_000)).toThrow(/development/);
  });
  it("accumulates token counts and models", () => {
    const b = new Budget({ spendFile: null });
    b.record("muse-spark-1.3", { prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 20 });
    expect(b.inputTokens).toBe(100);
    expect(b.reasoningTokens).toBe(20);
    expect([...b.models]).toEqual(["muse-spark-1.3"]);
  });
});

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
it("refreshes shared spend before reserving the next call", () => {
  const file = join(mkdtempSync(join(tmpdir(), "budget-")), "spend.json");
  const budget = new Budget({ spendFile: file, devCapUsd: 0.04 });
  writeFileSync(file, JSON.stringify({ totalUsd: 0.039 }));
  expect(() => budget.assertCanCall("muse-spark-1.3", 1000, 4000)).toThrow(/development/);
});
it("rejects invalid caps rather than silently disabling limits", () => {
  expect(() => new Budget({ runCapUsd: NaN, spendFile: null })).toThrow();
  expect(() => new Budget({ devCapUsd: -1, spendFile: null })).toThrow();
});
it("reconstructs replay usage without charging the development ledger twice", () => {
  const budget = new Budget({ spendFile: null });
  budget.record("muse-spark-1.3", { prompt_tokens: 1000, completion_tokens: 400 }, true);
  expect(budget.runSpent).toBeGreaterThan(0);
  expect(budget.developmentSpent).toBe(0);
});
it("reconciles a checkpointed paid response exactly once even after a crash before recording", () => {
  const file = join(mkdtempSync(join(tmpdir(), "charge-")), "spend.json");
  const usage = { prompt_tokens: 1000, completion_tokens: 400 };
  const recovered = new Budget({ spendFile: file });
  recovered.record("muse-spark-1.3", usage, true, "session:0");
  expect(recovered.developmentSpent).toBeCloseTo(0.00295);
  const again = new Budget({ spendFile: file });
  again.record("muse-spark-1.3", usage, true, "session:0");
  expect(again.developmentSpent).toBeCloseTo(0.00295);
});
import { spawn } from "node:child_process";
it("serializes paid calls across processes before checking the shared cap", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "shared-budget-")), "spend.json");
  const code = `import { Budget } from './lib/agent/budget.ts'; const b = new Budget({spendFile:process.argv[1],devCapUsd:0.02}); try { await b.call('muse-spark-1.3',1000,3000,async()=>{await new Promise(r=>setTimeout(r,100));return {model:'muse-spark-1.3',usage:{prompt_tokens:1000,completion_tokens:3000}};}); } catch(e) { if(e.scope==='development') process.exitCode=2; else { console.error(e.message); process.exitCode=3; } }`;
  const launch = () => new Promise<number | null>((resolve) => {
    const p = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, file], { stdio: "pipe" });
    p.on("close", resolve);
  });
  const exits = await Promise.all([launch(), launch()]);
  expect(exits.sort()).toEqual([0, 2]);
  expect(JSON.parse(readFileSync(file, "utf8")).totalUsd).toBeCloseTo(0.014);
});
it("keeps an uncertain call reserved and reconciles its saved response without double charging", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "uncertain-budget-")), "spend.json");
  const b = new Budget({ spendFile: file });
  await expect(b.call("muse-spark-1.3", 1000, 3000, async () => { throw new Error("connection lost"); }, false, "lost-call")).rejects.toThrow("connection lost");
  const recovered = new Budget({ spendFile: file });
  expect(recovered.developmentSpent).toBeCloseTo(0.014);
  recovered.record("muse-spark-1.3", { prompt_tokens: 1000, completion_tokens: 400 }, true, "lost-call");
  expect(recovered.developmentSpent).toBeCloseTo(0.00295);
});
