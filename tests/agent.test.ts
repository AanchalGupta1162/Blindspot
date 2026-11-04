import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Budget } from "../lib/agent/budget";
import { LLMResponse, MockClient } from "../lib/agent/client";
import { LLMAgent } from "../lib/agent/loop";
import { loadRidge } from "../lib/agent/monitor";
import { Recorder, RunSchema } from "../lib/agent/run";
import { executeRun } from "../lib/agent/record";
import { ScriptedPolicy } from "../lib/agent/scripted";
import { autoApprover } from "../lib/agent/approvers";
import { prepare } from "../lib/sim/runner";
import { Incident } from "../lib/tools/incident";
import { runTool } from "../lib/tools/index";
import { TriggerMonitor } from "../lib/agent/trigger";

const ridge = loadRidge();

function incidentAtTrigger(kind: Parameters<typeof prepare>[0], seed: number) {
  const p = prepare(kind, seed);
  const mon = new TriggerMonitor(p.scn.startHour, p.scn.durationS, ridge);
  mon.calibrate(p.readings);
  for (let k = 24; k < p.readings.n; k++) {
    const t = mon.check(p.readings, k);
    if (t) return { p, k, trig: t, inc: new Incident(p, k + 20, ridge) }; // 10 min after the trigger so the fit has evidence
  }
  throw new Error("no trigger");
}

const reply = (content: string | null, calls: { name: string; args: unknown }[] = [], tokens = { prompt_tokens: 2000, completion_tokens: 300 }): LLMResponse => ({
  message: { role: "assistant", content, tool_calls: calls.map((c, i) => ({ id: `c${i}-${c.name}`, function: { name: c.name, arguments: JSON.stringify(c.args) } })) },
  usage: tokens,
  model: "muse-spark-1.3",
  finishReason: calls.length ? "tool_calls" : "stop",
});

describe("no future leakage", () => {
  it("diagnosis depends only on readings up to 'now'", () => {
    const { p, inc } = incidentAtTrigger("load_spike", 8000);
    const scrambled = { ...p, readings: { n: p.readings.n, data: p.readings.data.map((d) => Float64Array.from(d, (v, k) => (k > inc.kNow ? v + 50 : v))) } };
    const inc2 = new Incident(scrambled, inc.kNow, ridge);
    expect(inc2.readings.n).toBe(inc.kNow + 1);
    expect(JSON.stringify(runTool(inc2, "diagnose", {}))).toBe(JSON.stringify(runTool(inc, "diagnose", {})));
  });
});

describe("tools", () => {
  it("rejects invalid arguments instead of throwing", () => {
    const { inc } = incidentAtTrigger("load_spike", 8000);
    const r = runTool(inc, "get_history", { sensor: "S9" });
    expect(r.ok).toBe(false);
  });
  it("blocks request_action for an untested action (the gate lives inside the tool)", () => {
    const { inc } = incidentAtTrigger("load_spike", 8000);
    const r = runTool(inc, "request_action", { action: { kind: "power_cap_rack", rack: "rackB", fraction: 0.7 }, reason: "reduce load on rack B quickly" });
    expect(r.ok).toBe(false);
    expect(r.gate!.codes).toContain("NOT_SIMULATED");
    expect(inc.applied).toBeNull();
  });
  it("escalates after three refusals", () => {
    const { inc } = incidentAtTrigger("load_spike", 8000);
    let last;
    for (let i = 0; i < 3; i++) last = runTool(inc, "request_action", { action: { kind: "power_cap_rack", rack: "rackB", fraction: 0.5 + i * 0.05 }, reason: "attempting without simulation" });
    expect(last!.signal).toBe("escalated");
    expect(inc.status).toBe("escalated");
  });
});

describe("LLM tool loop (mock model)", () => {
  it("runs a full investigate -> simulate -> request -> approve flow and records it", async () => {
    const { p, trig, inc } = incidentAtTrigger("load_spike", 8000);
    const capB = { kind: "power_cap_rack", rack: "rackB", fraction: 0.7 };
    const client = new MockClient([
      reply(null, [{ name: "sensor_metadata", args: { sensor: "S1" } }, { name: "diagnose", args: {} }]),
      reply(null, [{ name: "simulate_action", args: { action: capB, horizon_min: 90 } }, { name: "simulate_action", args: { action: { kind: "dispatch_human_check" }, horizon_min: 90 } }]),
      reply(null, [{ name: "notify", args: { level: "warn", message: "Rack B load rising; likely breach without action." } }, { name: "request_action", args: { action: capB, reason: "Cap rack B to 70% to stop the rise." } }]),
      reply("Capped rack B after approval; operator should inspect the new load."),
    ]);
    const agent = new LLMAgent({ client, budget: new Budget({ spendFile: null }), approve: autoApprover });
    const rec = new Recorder();
    const result = await agent.invoke(inc, trig, rec);
    expect(["alerted_and_acted", "alerted"]).toContain(result);
    const kinds = rec.events.map((e) => e.kind);
    expect(kinds).toContain("gate");
    expect(kinds.filter((k) => k === "tool_call").length).toBe(6);
    expect(agent.usage().turns).toBe(4);
    expect(agent.usage().costUsd).toBeGreaterThan(0);
    // tool results are fed back to the model
    const lastReq = client.calls.at(-1)!;
    expect(lastReq.messages.filter((m) => m.role === "tool").length).toBe(6);
    void p;
  });

  it("forces a summary on the last turn (no tools offered)", async () => {
    const { trig, inc } = incidentAtTrigger("load_spike", 8000);
    const loop = reply(null, [{ name: "list_sensors", args: {} }]);
    const client = new MockClient([loop, loop, loop, reply("Out of turns: no hazard confirmed.")]);
    const agent = new LLMAgent({ client, budget: new Budget({ spendFile: null }), approve: autoApprover, maxTurns: 4 });
    await agent.invoke(inc, trig, new Recorder());
    const last = client.calls.at(-1)!;
    expect(last.toolChoice).toBe("none");
    expect(last.tools).toBeUndefined();
  });

  it("stops cleanly when the budget cap is hit", async () => {
    const { trig, inc } = incidentAtTrigger("load_spike", 8000);
    const client = new MockClient([reply("never reached")]);
    const agent = new LLMAgent({ client, budget: new Budget({ runCapUsd: 0.001, spendFile: null }), approve: autoApprover });
    const rec = new Recorder();
    const result = await agent.invoke(inc, trig, rec);
    expect(result).toBe("stopped");
    expect(client.calls.length).toBe(0);
    expect(rec.events.at(-1)!.data.status).toBe("budget_stopped");
  });

  it("survives malformed tool arguments and unknown tools", async () => {
    const { trig, inc } = incidentAtTrigger("load_spike", 8000);
    const bad: LLMResponse = { ...reply(null), message: { role: "assistant", content: null, tool_calls: [{ id: "a", function: { name: "get_history", arguments: "{not json" } }, { id: "b", function: { name: "launch_missiles", arguments: "{}" } }] } };
    const client = new MockClient([bad, reply("No hazard confirmed.")]);
    const agent = new LLMAgent({ client, budget: new Budget({ spendFile: null }), approve: autoApprover });
    await expect(agent.invoke(inc, trig, new Recorder())).resolves.toBeDefined();
    const toolMsgs = client.calls.at(-1)!.messages.filter((m) => m.role === "tool") as { content: string }[];
    expect(toolMsgs[0].content).toContain("error");
    expect(toolMsgs[1].content).toContain("unknown tool");
  });
});

describe("scripted reference policy end to end", () => {
  it("raises no alert on a no-fault control", async () => {
    const run = await executeRun({ kind: "control", seed: 8001, agent: new ScriptedPolicy(), ridge });
    expect(run.alertMin).toBeNull();
    expect(run.status).toBe("no_action");
  });
  it("alerts before the breach and the accepted action goes through the gate", async () => {
    const run = await executeRun({ kind: "loose_connection", seed: 8000, agent: new ScriptedPolicy(), ridge });
    expect(run.alertMin).not.toBeNull();
    expect(run.alertMin!).toBeLessThan(run.outcome.doNothing.firstBreachMin!);
    expect(run.events.some((e) => e.kind === "gate" && e.data.allowed === true)).toBe(true);
    expect(run.source).toBe("scripted-policy");
    expect(run.model).toBeNull();
  });
});

describe("recorded runs on disk", () => {
  const dir = "data/runs";
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  it("has at least one recorded run", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files)
    it(`validates ${f}`, () => {
      const run = RunSchema.parse(JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
      expect(run.simulated).toBe(true);
      if (run.source === "scripted-policy") expect(run.model).toBeNull();
      if (run.source === "llm") expect(run.model).not.toBeNull();
    });
});
it("allows only one human-approved action in an invocation even if the model repeats requests", async () => {
  const { trig, inc } = incidentAtTrigger("loose_connection", 3000);
  let approvals = 0;
  const request = { name: "request_action", args: { action: { kind: "dispatch_human_check" }, reason: "Inspect connector." } };
  const client = new MockClient([
    reply(null, [{ name: "simulate_action", args: { action: { kind: "dispatch_human_check" }, horizon_min: 90 } }, { name: "simulate_action", args: { action: { kind: "power_cap_rack", rack: "rackB", fraction: 0.7 }, horizon_min: 90 } }]),
    reply(null, [request, request]), reply(null, [request]), reply("Inspection requested."),
  ]);
  const agent = new LLMAgent({ client, budget: new Budget({ spendFile: null }), approve: async () => { approvals++; return { decision: "approved", mode: "human", by: "test" }; } });
  const rec = new Recorder();
  await agent.invoke(inc, trig, rec);
  expect(approvals).toBe(1);
  expect(rec.events.filter((e) => e.kind === "applied")).toHaveLength(1);
});

import { pickApprover, terminalApprover } from "../lib/agent/approvers";
it("never silently auto-approves a recording without a terminal", () => {
  expect(pickApprover("prompt")).toBe(terminalApprover);
  if (!process.stdin.isTTY) expect(() => pickApprover(undefined)).toThrow(/approve/);
  expect(pickApprover("auto")).toBe(autoApprover);
});
