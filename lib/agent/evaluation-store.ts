import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { RunSchema } from "./run";
export function readCompletedEvaluation(file: string, attemptsDir: string) {
  if (!existsSync(file)) return null;
  const run = RunSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  if (run.status === "budget_stopped" || run.events.some((e) => e.kind === "status" && ["paused", "budget_stopped"].includes(String(e.data.status)))) {
    mkdirSync(attemptsDir, { recursive: true });
    renameSync(file, join(attemptsDir, `${basename(file, ".json")}-${Date.now()}.json`));
    return null;
  }
  return run;
}
