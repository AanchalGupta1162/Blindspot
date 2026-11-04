import type { Run } from "../agent/run";
export const FLOW_STAGES = ["Evidence", "Diagnosis", "Test actions", "Safety gate", "Approval", "Apply action"] as const;
export function agentFlow(events: Run["events"]) {
  const invocation = events.at(-1)?.invocation;
  const current = events.filter(e => e.invocation === invocation);
  const visited = new Set<number>();
  let active = -1;
  let gate: boolean | null = null;
  let approval: string | null = null;
  for (const e of current) {
    let stage = -1;
    if (e.kind === "trigger") stage = 0;
    if (e.kind === "tool_call") {
      const name = e.data.name;
      stage = name === "diagnose" || name === "estimate_hidden_zones" ? 1 : name === "simulate_action" ? 2 : name === "request_action" ? 3 : name === "notify" ? -1 : 0;
    }
    if (e.kind === "gate") { stage = 3; gate = e.data.allowed === true; }
    if (e.kind === "approval") { stage = 4; approval = String(e.data.decision); }
    if (e.kind === "applied") stage = 5;
    if (stage >= 0) { visited.add(stage); active = stage; }
  }
  return { visited, active, gate, approval };
}

export const GRAPH_NODES = [
  { id: "evidence", label: "Sensor evidence", detail: "Read observations and hidden-zone estimates", x: 28, y: 32 },
  { id: "agent", label: "Muse agent", detail: "Reason, investigate and choose tools", x: 258, y: 32 },
  { id: "diagnose", label: "Diagnosis tools", detail: "Inspect faults and estimate unmeasured zones", x: 28, y: 154 },
  { id: "simulate", label: "Action simulator", detail: "Test proposed actions against the twin", x: 258, y: 154 },
  { id: "gate", label: "Safety gate", detail: "Check allowed actions and predicted improvement", x: 258, y: 276 },
  { id: "approval", label: "Human approval", detail: "An operator approves or rejects this action", x: 28, y: 276 },
  { id: "apply", label: "Apply action", detail: "Apply an approved action in the simulation", x: 28, y: 398 },
  { id: "summary", label: "Run summary", detail: "Record the result and notify the operator", x: 258, y: 398 },
] as const;
export type GraphNodeId = typeof GRAPH_NODES[number]["id"];
export function eventNode(e: Run["events"][number]): GraphNodeId {
  if (e.kind === "trigger") return "evidence";
  if (e.kind === "gate") return "gate";
  if (e.kind === "approval") return "approval";
  if (e.kind === "applied") return "apply";
  if (e.kind === "summary") return "summary";
  if (e.kind === "tool_call" || e.kind === "tool_result") {
    const name = String(e.data.name);
    if (name === "diagnose" || name === "estimate_hidden_zones") return "diagnose";
    if (name === "simulate_action") return "simulate";
    if (name === "request_action") return "gate";
    if (name === "notify") return "summary";
    return "evidence";
  }
  return "agent";
}
export function eventSummary(e: Run["events"][number]): string {
  const d = e.data;
  if (e.kind === "trigger") return `${d.rule ?? "Sensor trigger"}: ${d.detail ?? "Investigation started"}`;
  if (e.kind === "assistant") return String(d.text || `Calling ${(d.toolCalls as string[] ?? []).join(", ")}`);
  if (e.kind === "tool_call") return `Calling ${String(d.name).replaceAll("_", " ")}`;
  if (e.kind === "tool_result") return `${String(d.name).replaceAll("_", " ")}: ${d.ok === false ? "refused / error" : "result received"}`;
  if (e.kind === "gate") return d.allowed ? "Safety checks passed" : `Safety gate refused: ${(d.reasons as string[] ?? []).join("; ")}`;
  if (e.kind === "approval") return `Operator ${d.decision}`;
  if (e.kind === "applied") return `Action applied at ${d.tApplyMin} minutes`;
  return String(d.text ?? d.message ?? d.status ?? e.kind);
}
