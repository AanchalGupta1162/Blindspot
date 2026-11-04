import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MockClient, LLMResponse } from "../lib/agent/client";
process.env.PGLITE_DIR = "memory://live-workspace";
delete process.env.DATABASE_URL;

it("saves a completed live flow in its workspace and hides it from other workspaces", async () => {
  const { ensureMigrated } = await import("../lib/db/migrate");
  const { db, schema } = await import("../lib/db");
  const { startLiveRun, getSession } = await import("../lib/live/session");
  const { getOrgRun } = await import("../lib/db/runs");
  await ensureMigrated();
  await db.insert(schema.user).values({ id: "operator", name: "Operator", email: "operator@example.test" });
  await db.insert(schema.organization).values({ id: "lab", name: "Lab", slug: "lab" });
  const response = (calls: { name: string; args: unknown }[] = []): LLMResponse => ({ message: { role: "assistant", content: calls.length ? null : "Inspect the connection.", tool_calls: calls.map((c, i) => ({ id: `c${i}`, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }, model: "muse-spark-1.3", usage: { prompt_tokens: 100, completion_tokens: 100 }, finishReason: "stop" });
  process.env.BLINDSPOT_SESSIONS_DIR = mkdtempSync(join(tmpdir(), "workspace-session-"));
  const client = new MockClient([
    response([{ name: "simulate_action", args: { action: { kind: "dispatch_human_check" }, horizon_min: 90 } }, { name: "simulate_action", args: { action: { kind: "power_cap_rack", rack: "rackB", fraction: 0.7 }, horizon_min: 90 } }]),
    response([{ name: "request_action", args: { action: { kind: "dispatch_human_check" }, reason: "Inspect the connection." } }]), response(),
  ]);
  const s = startLiveRun({ kind: "loose_connection", seed: 3000, actor: { userId: "operator", orgId: "lab", label: "Operator" } }, () => client);
  const wait = async (fn: () => boolean) => { for (let i = 0; i < 1000 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); expect(fn()).toBe(true); };
  await wait(() => s.status === "needs_input");
  expect(getSession(s.id, "other-lab")).toBeNull();
  s.resolve!("approved", "Operator");
  await wait(() => s.status === "done");
  expect((await getOrgRun("lab", s.id))?.approval?.by).toBe("Operator");
  expect(await getOrgRun("other-lab", s.id)).toBeNull();
});
