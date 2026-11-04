import { createInterface } from "node:readline/promises";
import { Incident } from "../tools/incident";
import { Approver } from "./loop";

export const autoApprover: Approver = async () => ({ decision: "approved", mode: "auto-simulated", by: "simulated operator (auto-approved in this recording)" });

/** Ask a real person in the terminal. This is the human-in-the-loop step. */
export const terminalApprover: Approver = async (inc: Incident) => {
  const p = inc.pending!;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n=== HUMAN APPROVAL REQUIRED ===");
  console.log(`t=${inc.tNowMin} min   action: ${JSON.stringify(p.action)}`);
  console.log(`reason: ${p.reason}`);
  console.log(`gate: expected improvement ${p.gate.expectedImprovementC} C, worst plausible ${p.gate.worstCaseImprovementC} C`);
  const ans = (await rl.question("Approve? [y/N] ")).trim().toLowerCase();
  rl.close();
  return ans === "y" || ans === "yes" ? { decision: "approved", mode: "human", by: "operator at the terminal" } : { decision: "rejected", mode: "human", by: "operator at the terminal" };
};

export function pickApprover(mode: string | undefined): Approver {
  if (mode === "auto") return autoApprover;
  if (mode === "prompt") return terminalApprover;
  if (!process.stdin.isTTY) throw new Error("A recording needs a human terminal; use --approve auto explicitly for labelled simulation tests.");
  return terminalApprover;
}
