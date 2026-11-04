import { NextResponse } from "next/server";
import { can, getCtx, orgBudgetUsd, orgSpendUsd } from "@/lib/auth/guard";
import { liveEnabled } from "@/lib/live/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getCtx();
  const spent = ctx?.orgId ? await orgSpendUsd(ctx.orgId) : 0;
  return NextResponse.json({
    live: liveEnabled(),
    signedIn: !!ctx,
    org: ctx?.orgName ?? null,
    orgId: ctx?.orgId ?? null,
    role: ctx?.role ?? null,
    canRun: can(ctx, { run: ["create"] }),
    canApprove: can(ctx, { run: ["approve"] }),
    spentUsd: Number(spent.toFixed(4)),
    budgetUsd: orgBudgetUsd(),
  });
}
