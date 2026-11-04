import "server-only";
import { ResearchEvaluationSchema } from "../agent/evaluation";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Run, RunSchema } from "../agent/run";

const dir = path.join(process.cwd(), "data", "runs");

export interface RunSummary {
  id: string;
  kind: string;
  seed: number;
  source: Run["source"];
  model: string | null;
  status: Run["status"];
  headline: string;
  alertMin: number | null;
  breachMin: number | null;
  outcomeLabel?: string;
}

export function listRuns(): RunSummary[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => RunSchema.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))))
    .filter(r => r.source === "llm")
    .map((r) => ({
      id: r.id,
      kind: r.scenario.kind,
      seed: r.scenario.seed,
      source: r.source,
      model: r.model,
      status: r.status,
      headline: r.headline,
      alertMin: r.alertMin,
      breachMin: r.outcome.doNothing.firstBreachMin,
      outcomeLabel: r.outcome.withAction ? (r.outcome.withAction.limitExceeded ? "Breach remains" : "No breach with actions") : (r.outcome.doNothing.limitExceeded ? "Breach · no action" : "No breach"),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getRun(id: string): Run | null {
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(id)) return null;
  const f = path.join(dir, `${id}.json`);
  return existsSync(f) ? RunSchema.parse(JSON.parse(readFileSync(f, "utf8"))) : null;
}

export function getResults(): Record<string, any> | null {
  const f = path.join(process.cwd(), "data", "eval", "results.json");
  if (!existsSync(f)) return null;
  const results = JSON.parse(readFileSync(f, "utf8"));
  const llmFile = path.join(process.cwd(), "data", "eval", "llm-results.json");
  if (existsSync(llmFile)) results.llm = JSON.parse(readFileSync(llmFile, "utf8"));
  return results;
}

export function getResearchResults() {
 const f=path.join(process.cwd(),"data/eval/research-results.json");
 return existsSync(f)?ResearchEvaluationSchema.parse(JSON.parse(readFileSync(f,"utf8"))):null;
}
