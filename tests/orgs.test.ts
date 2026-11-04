import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://orgs-test";
delete process.env.DATABASE_URL;

const sample = () => {
  const dir = path.join(process.cwd(), "data", "runs");
  const f = readdirSync(dir).find((x) => x.endsWith("-llm.json"))!;
  return JSON.parse(readFileSync(path.join(dir, f), "utf8"));
};

describe("role permissions", () => {
  it("admin manages members and runs the agent; operator only runs; viewer is read-only", async () => {
    const { roles } = await import("../lib/auth/permissions");
    const ok = (r: keyof typeof roles, perm: object) => roles[r].authorize(perm as never).success;
    expect(ok("admin", { member: ["create", "update", "delete"] })).toBe(true);
    expect(ok("admin", { run: ["create", "approve"] })).toBe(true);
    expect(ok("operator", { run: ["create", "approve"] })).toBe(true);
    expect(ok("operator", { member: ["create"] })).toBe(false);
    expect(ok("operator", { organization: ["delete"] })).toBe(false);
    expect(ok("viewer", { run: ["create"] })).toBe(false);
    expect(ok("viewer", { run: ["approve"] })).toBe(false);
    expect(ok("viewer", { member: ["update"] })).toBe(false);
  });
});

describe("organisation-scoped runs (embedded Postgres)", () => {
  let orgA = "";
  let orgB = "";
  let userA = "";
  beforeAll(async () => {
    const { ensureMigrated } = await import("../lib/db/migrate");
    const { db, schema } = await import("../lib/db");
    await ensureMigrated();
    userA = "u-a";
    await db.insert(schema.user).values([{ id: "u-a", name: "A", email: "a@t.test" }, { id: "u-b", name: "B", email: "b@t.test" }]);
    orgA = "org-a";
    orgB = "org-b";
    await db.insert(schema.organization).values([{ id: orgA, name: "A", slug: "a" }, { id: orgB, name: "B", slug: "b" }]);
  });

  it("stores a run for one organisation and hides it from another", async () => {
    const { saveOrgRun, listOrgRuns, getOrgRun } = await import("../lib/db/runs");
    const run = { ...sample(), id: "run-for-a" };
    await saveOrgRun(run, { userId: userA, orgId: orgA, label: "A (admin)" });

    expect((await listOrgRuns(orgA)).map((r) => r.id)).toEqual(["run-for-a"]);
    expect(await listOrgRuns(orgB)).toEqual([]);
    expect((await getOrgRun(orgA, "run-for-a"))?.id).toBe("run-for-a");
    expect(await getOrgRun(orgB, "run-for-a")).toBeNull();
  });

  it("is idempotent and records who approved", async () => {
    const { saveOrgRun, listOrgRuns } = await import("../lib/db/runs");
    const base = sample();
    const run = { ...base, id: "run-approved", approval: { decision: "approved", mode: "human", by: "Ada (admin) <a@t.test>" } };
    await saveOrgRun(run, { userId: userA, orgId: orgA, label: "A" });
    await saveOrgRun(run, { userId: userA, orgId: orgA, label: "A" });
    const rows = (await listOrgRuns(orgA)).filter((r) => r.id === "run-approved");
    expect(rows).toHaveLength(1);
    expect(rows[0].approvedBy).toBe("Ada (admin) <a@t.test>");
  });

  it("sums model spend per organisation only", async () => {
    const { db, schema } = await import("../lib/db");
    const { eq, sum } = await import("drizzle-orm");
    const spent = async (id: string) => Number((await db.select({ t: sum(schema.run.costUsd) }).from(schema.run).where(eq(schema.run.organizationId, id)))[0].t ?? 0);
    expect(await spent(orgB)).toBe(0);
    expect(await spent(orgA)).toBeGreaterThanOrEqual(0);
  });
});
