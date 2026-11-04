import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LLMResponse, MockClient } from "../lib/agent/client";
import { RunSchema } from "../lib/agent/run";
import { getSession, startLiveRun } from "../lib/live/session";

const reply = (content: string | null, calls: { name: string; args: unknown }[] = []): LLMResponse => ({
  message: { role: "assistant", content, tool_calls: calls.map((c, i) => ({ id: `c${i}`, function: { name: c.name, arguments: JSON.stringify(c.args) } })) },
  usage: { prompt_tokens: 3000, completion_tokens: 400 },
  model: "muse-spark-1.3",
  finishReason: calls.length ? "tool_calls" : "stop",
});
const until = async (cond: () => boolean, ms = 30000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("live session (mock model, human approval in the loop)", () => {
  it("pauses for human approval, then applies the action and saves a validated run", async () => {
    process.env.BLINDSPOT_RUNS_DIR = mkdtempSync(path.join(tmpdir(), "blindspot-"));
    process.env.RUN_BUDGET_USD = "5";
    const client = new MockClient([
      reply(null, [{ name: "simulate_action", args: { action: { kind: "power_cap_rack", rack: "rackB", fraction: 0.7 }, horizon_min: 90 } }, { name: "simulate_action", args: { action: { kind: "dispatch_human_check" }, horizon_min: 90 } }]),
      reply(null, [{ name: "request_action", args: { action: { kind: "dispatch_human_check" }, reason: "Send a technician to inspect the rack B power connection." } }]),
      reply("A technician was dispatched to inspect the rack B connector."),
    ]);
    const s = startLiveRun({ kind: "loose_connection", seed: 3000 }, () => client);
    await until(() => s.status === "needs_input");
    expect(s.pending?.action).toEqual({ kind: "dispatch_human_check" });
    expect(s.run).toBeNull(); // nothing is applied until a human decides
    s.resolve!("approved", "test operator");
    await until(() => s.status === "done");
    expect(getSession(s.id)).toBe(s);
    expect(s.run!.status).toBe("applied");
    expect(s.run!.approval).toMatchObject({ decision: "approved", mode: "human" });
    expect(s.run!.outcome.withAction?.limitExceeded).toBe(false);
    const saved = RunSchema.parse(JSON.parse(readFileSync(path.join(process.env.BLINDSPOT_RUNS_DIR!, `${s.id}.json`), "utf8")));
    expect(saved.source).toBe("llm");
    expect(saved.usage.costUsd).toBeGreaterThan(0);
  });

  it("does not apply anything when the human rejects", async () => {
    process.env.BLINDSPOT_RUNS_DIR = mkdtempSync(path.join(tmpdir(), "blindspot-"));
    const client = new MockClient([
      reply(null, [{ name: "simulate_action", args: { action: { kind: "power_cap_rack", rack: "rackB", fraction: 0.7 }, horizon_min: 90 } }, { name: "simulate_action", args: { action: { kind: "dispatch_human_check" }, horizon_min: 90 } }]),
      reply(null, [{ name: "request_action", args: { action: { kind: "dispatch_human_check" }, reason: "Send a technician to inspect the rack B power connection." } }]),
      reply("The operator declined; the alert stands."),
    ]);
    const s = startLiveRun({ kind: "loose_connection", seed: 3000 }, () => client);
    await until(() => s.status === "needs_input");
    s.resolve!("rejected", "test operator");
    await until(() => s.status === "done");
    expect(s.run!.action).toBeNull();
    expect(s.run!.status).toBe("rejected");
  });
});

import { liveEnabled } from "../lib/live/session";
describe("live-run guard", () => {
  it("is off without a key, and off on Vercel even with a key", () => {
    const saved = { k: process.env.MODEL_API_KEY, v: process.env.VERCEL };
    delete process.env.VERCEL;
    delete process.env.MODEL_API_KEY;
    expect(liveEnabled()).toBe(false);
    process.env.MODEL_API_KEY = "test-key";
    expect(liveEnabled()).toBe(true);
    process.env.VERCEL = "1";
    expect(liveEnabled()).toBe(false);
    if (saved.k === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = saved.k;
    if (saved.v === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved.v;
  });
});

import { recoverLiveRun } from "../lib/live/session";
it("recovers a pending approval without repeating paid calls or applying without approval", async () => {
  process.env.BLINDSPOT_RUNS_DIR = mkdtempSync(path.join(tmpdir(), "blindspot-recovery-"));
  const client = new MockClient([
    reply(null, [{ name: "simulate_action", args: { action: { kind: "power_cap_rack", rack: "rackB", fraction: 0.7 }, horizon_min: 90 } }, { name: "simulate_action", args: { action: { kind: "dispatch_human_check" }, horizon_min: 90 } }]),
    reply(null, [{ name: "request_action", args: { action: { kind: "dispatch_human_check" }, reason: "Inspect the rack B connection." } }]),
  ]);
  const original = startLiveRun({ kind: "loose_connection", seed: 3000 }, () => client);
  await until(() => original.status === "needs_input");
  const recovered = recoverLiveRun(original.id, () => new MockClient([reply("Approved inspection completed.")]));
  expect(recovered).not.toBeNull();
  await until(() => recovered!.status === "needs_input");
  expect(recovered!.recorder.events.filter((e) => e.kind === "applied")).toHaveLength(0);
  recovered!.resolve!("approved", "recovery operator");
  await until(() => recovered!.status === "done");
  expect(recovered!.run!.approval?.by).toBe("recovery operator");
  expect(recovered!.run!.usage.turns).toBe(3);
  expect(recovered!.run!.events.filter((e) => e.kind === "applied")).toHaveLength(1);
  expect(recovered!.run!.usage.costUsd).toBeCloseTo(0.0164, 3);
});
it("rejects checkpoint path traversal", () => {
  expect(recoverLiveRun("../../.env")).toBeNull();
});

import { startWorkspaceRun } from "../lib/live/session";
it("bounds a workspace run to its remaining allowance and rejects overlapping starts", async () => {
  process.env.PGLITE_DIR = "memory://live-budget";
  delete process.env.DATABASE_URL;
  const { ensureMigrated } = await import("../lib/db/migrate");
  const { db, schema } = await import("../lib/db");
  await ensureMigrated();
  await db.insert(schema.user).values({ id: "u", name: "Operator", email: "budget@example.test" });
  await db.insert(schema.organization).values({ id: "budget-org", name: "Budget", slug: "budget" });
  const actor = { userId: "u", orgId: "budget-org", label: "Operator" };
  const never = { complete: () => new Promise<LLMResponse>(() => {}) };
  const s = startWorkspaceRun({ kind: "loose_connection", seed: 3000, actor }, 0.01, () => never);
  await until(() => s.status === "done");
  expect(s.run!.status).toBe("budget_stopped");
  expect(s.run!.usage.costUsd).toBe(0);
  let finish!: (r: LLMResponse) => void;
  let blockedCalls = 0;
  const blocked = { complete: () => ++blockedCalls === 1 ? new Promise<LLMResponse>((resolve) => { finish = resolve; }) : Promise.resolve(reply("No hazard confirmed.")) };
  const pending = startWorkspaceRun({ kind: "loose_connection", seed: 3000, actor }, 1, () => blocked);
  expect(() => startWorkspaceRun({ kind: "loose_connection", seed: 3001, actor }, 1, () => never)).toThrow(/active/);
  expect(pending.status).toBe("running");
  finish(reply("No hazard confirmed."));
  await until(() => pending.status === "done");
});

import { readCheckpoint, writeCheckpoint } from "../lib/live/checkpoint";
import { outstandingOrgSpendUsd } from "../lib/live/session";
it("persists an uncertain in-flight recovery as terminal and reserves its remaining allowance", () => {
  const id = "uncertain-test";
  const actor = { userId: "u", orgId: "uncertain-org", label: "Operator" };
  writeCheckpoint({ version: 1, id, kind: "loose_connection", seed: 3000, actor, runCapUsd: 1, startedAt: Date.now(), status: "running", events: [], replies: [], approvals: [], run: null, error: null, inFlight: true });
  expect(recoverLiveRun(id)?.status).toBe("error");
  expect(readCheckpoint(id)?.status).toBe("error");
  expect(outstandingOrgSpendUsd(actor.orgId)).toBe(1);
  expect(() => startWorkspaceRun({ kind: "control", seed: 3000, actor }, 0.01, () => new MockClient([]))).not.toThrow();
});

import { resolveSessionApproval } from "../lib/live/session";
it("refuses a stale approval token instead of approving a later action", async () => {
  process.env.BLINDSPOT_RUNS_DIR = mkdtempSync(path.join(tmpdir(), "stale-approval-"));
  const client = new MockClient([
    reply(null, [{ name: "simulate_action", args: { action: { kind: "power_cap_rack", rack: "rackB", fraction: 0.7 }, horizon_min: 90 } }, { name: "simulate_action", args: { action: { kind: "dispatch_human_check" }, horizon_min: 90 } }]),
    reply(null, [{ name: "request_action", args: { action: { kind: "dispatch_human_check" }, reason: "Inspect connector." } }]), reply("Rejected."),
  ]);
  const s = startLiveRun({ kind: "loose_connection", seed: 3000 }, () => client);
  await until(() => s.status === "needs_input");
  const staleId = s.pending!.id;
  s.pending = { ...s.pending!, id: `${staleId}-next` };
  expect(resolveSessionApproval(s, staleId, "approved", "operator")).toBe(false);
  expect(s.status).toBe("needs_input");
  expect(s.run).toBeNull();
  expect(resolveSessionApproval(s, s.pending.id, "rejected", "operator")).toBe(true);
  await until(() => s.status === "done");
  expect(s.run!.action).toBeNull();
});
