import { expect, it } from "vitest";
import { agentFlow } from "../lib/ui/agent-flow";
import type { Run } from "../lib/agent/run";
it("shows gate refusal and rejection without implying an applied action", () => {
  const e = [{ i: 0, invocation: 1, tMin: 1, kind: "gate", data: { allowed: false } }, { i: 1, invocation: 1, tMin: 1, kind: "approval", data: { decision: "rejected" } }] as Run["events"];
  const s = agentFlow(e);
  expect(s.gate).toBe(false); expect(s.approval).toBe("rejected"); expect(s.visited.has(5)).toBe(false);
});
it("resets the diagram for a follow-up investigation", () => {
  const s = agentFlow([{i:0,invocation:1,tMin:1,kind:"applied",data:{}},{i:1,invocation:2,tMin:2,kind:"trigger",data:{}}] as Run["events"]);
  expect([...s.visited]).toEqual([0]); expect(s.active).toBe(0);
});

import { eventNode, eventSummary, GRAPH_NODES } from "../lib/ui/agent-flow";
it("maps tool results and calls to the same graph node", () => {
  for (const kind of ["tool_call", "tool_result"] as const) {
    expect(eventNode({ i: 0, tMin: 1, invocation: 1, kind, data: { name: "simulate_action" } } as Run["events"][number])).toBe("simulate");
    expect(eventNode({ i: 0, tMin: 1, invocation: 1, kind, data: { name: "estimate_hidden_zones" } } as Run["events"][number])).toBe("diagnose");
  }
  expect(GRAPH_NODES.length).toBe(8);
});
it("makes refusals and human decisions readable without suggesting success", () => {
  expect(eventSummary({i:0,tMin:1,invocation:1,kind:"gate",data:{allowed:false,reasons:["Unsafe"]}} as Run["events"][number])).toContain("refused: Unsafe");
  expect(eventSummary({i:0,tMin:1,invocation:1,kind:"approval",data:{decision:"rejected"}} as Run["events"][number])).toBe("Operator rejected");
});
