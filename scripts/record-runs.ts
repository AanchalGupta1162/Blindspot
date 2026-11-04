/**
 * Record agent runs to data/runs/<id>.json (validated). Local only.
 *   npm run record:scripted                       record the demo set with the scripted reference policy (free)
 *   npm run record -- --set demo                  record the demo set with the LLM (needs MODEL_API_KEY)
 *   npm run record -- --kind load_spike --seed 3000 [--approve auto|prompt] [--model muse-spark-1.3]
 */
import "./env";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { Budget } from "../lib/agent/budget";
import { MetaClient } from "../lib/agent/client";
import { LLMAgent } from "../lib/agent/loop";
import { loadRidge } from "../lib/agent/monitor";
import { pickApprover } from "../lib/agent/approvers";
import { executeRun } from "../lib/agent/record";
import { ScriptedPolicy } from "../lib/agent/scripted";
import { SCENARIO_KINDS, ScenarioKind } from "../lib/sim/types";

/** Seeds chosen from the final-seed evaluation rows for story value: headline first, gate-refusal run second. */
export const DEMO_SET: { kind: ScenarioKind; seed: number }[] = [
  { kind: "loose_connection", seed: 3000 },
  { kind: "load_spike", seed: 3001 },
  { kind: "stuck_sensor", seed: 3000 },
  { kind: "ac_failure", seed: 3003 },
  { kind: "blocked_vent", seed: 3001 },
  { kind: "unattended_ac", seed: 3000 },
  { kind: "control", seed: 3000 },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const scripted = process.argv.includes("--scripted");
  const ridge = loadRidge();
  mkdirSync("data/runs", { recursive: true });
  const jobs = arg("kind") ? [{ kind: arg("kind") as ScenarioKind, seed: Number(arg("seed") ?? 3000) }] : DEMO_SET;
  for (const j of jobs) if (!SCENARIO_KINDS.includes(j.kind)) throw new Error(`unknown kind ${j.kind}`);
  if (!scripted && arg("set") !== "demo" && !arg("kind")) throw new Error("pass --scripted, --set demo, or --kind <kind>");

  const client = scripted ? null : new MetaClient();
  for (const j of jobs) {
    const agent = scripted
      ? new ScriptedPolicy()
      : new LLMAgent({ client: client!, budget: new Budget(), model: arg("model"), escalateModel: process.env.MODEL_ESCALATE ?? null, approve: pickApprover(arg("approve")) });
    const run = await executeRun({ ...j, agent, ridge });
    let path = `data/runs/${run.id}.json`;
    if (existsSync(path)) { run.id += `-${Date.now().toString(36)}`; path = `data/runs/${run.id}.json`; }
    writeFileSync(path, JSON.stringify(run, null, 1));
    console.log(`${run.id}: ${run.status}, alert ${run.alertMin ?? "-"} min, ${run.headline}  ($${run.usage.costUsd}) -> ${path}`);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
