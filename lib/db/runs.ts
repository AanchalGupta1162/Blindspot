import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { Run, RunSchema } from "../agent/run";
import { db, schema } from "./index";

export async function saveOrgRun(value: Run, actor: { userId: string; orgId: string; label: string }) {
  const run = RunSchema.parse(value);
  const approvedBy = run.approval && run.approval.decision === "approved" ? run.approval.by : null;
  await db
    .insert(schema.run)
    .values({
      id: run.id,
      organizationId: actor.orgId,
      createdBy: actor.userId,
      approvedBy,
      kind: run.scenario.kind,
      seed: run.scenario.seed,
      source: run.source,
      model: run.model,
      status: run.status,
      headline: run.headline,
      alertMin: run.alertMin,
      breachMin: run.outcome.doNothing.firstBreachMin,
      costUsd: run.usage?.costUsd ?? 0,
      data: run,
    })
    .onConflictDoNothing();
}

export async function listOrgRuns(orgId: string) {
  return db
    .select({
      id: schema.run.id, kind: schema.run.kind, seed: schema.run.seed, source: schema.run.source, model: schema.run.model,
      status: schema.run.status, headline: schema.run.headline, alertMin: schema.run.alertMin, breachMin: schema.run.breachMin,
      outcome: sql<Run["outcome"]>`${schema.run.data}->'outcome'`,
      costUsd: schema.run.costUsd, approvedBy: schema.run.approvedBy, createdAt: schema.run.createdAt,
    })
    .from(schema.run)
    .where(eq(schema.run.organizationId, orgId))
    .orderBy(desc(schema.run.createdAt));
}

export async function getOrgRun(orgId: string, id: string): Promise<Run | null> {
  const [r] = await db.select({ data: schema.run.data }).from(schema.run).where(and(eq(schema.run.organizationId, orgId), eq(schema.run.id, id))).limit(1);
  return r ? RunSchema.parse(r.data) : null;
}
