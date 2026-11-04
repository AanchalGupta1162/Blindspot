import "server-only";
import { cache } from "react";
import { and, eq, sum } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "../db";
import { withDatabaseReadRetry } from "../db/read-retry";
import { auth } from "./auth";
import { RoleName, roles } from "./permissions";

export interface Ctx {
  userId: string;
  name: string;
  email: string;
  orgId: string | null;
  orgName: string | null;
  role: RoleName | null;
}

/** Current signed-in user plus their role in the active organisation (null when signed out). */
export const getCtx = cache(() => withDatabaseReadRetry(async (): Promise<Ctx | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const orgId = (s.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  let role: RoleName | null = null;
  let orgName: string | null = null;
  if (orgId) {
    const [row] = await db
      .select({ role: schema.member.role, name: schema.organization.name })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(and(eq(schema.member.userId, s.user.id), eq(schema.member.organizationId, orgId)))
      .limit(1);
    if (row && row.role in roles) role = row.role as RoleName;
    orgName = row?.name ?? null;
  }
  return { userId: s.user.id, name: s.user.name, email: s.user.email, orgId: role ? orgId : null, orgName, role };
}));

export type Perm = { run: ("create" | "approve")[] } | { member: ("create" | "update" | "delete")[] };

export function can(ctx: Ctx | null, perm: Perm): boolean {
  if (!ctx?.role || !ctx.orgId) return false;
  return roles[ctx.role].authorize(perm as never).success;
}

/** Spend by an organisation across all its recorded runs. */
export async function orgSpendUsd(orgId: string): Promise<number> {
  const [r] = await db.select({ total: sum(schema.run.costUsd) }).from(schema.run).where(eq(schema.run.organizationId, orgId));
  return Number(r?.total ?? 0);
}
export const orgBudgetUsd = () => Number(process.env.ORG_BUDGET_USD ?? 20);
