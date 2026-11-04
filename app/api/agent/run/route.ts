import { NextResponse } from "next/server";
import { z } from "zod";
import { can, getCtx, orgBudgetUsd, orgSpendUsd } from "@/lib/auth/guard";
import { liveEnabled, snapshot, startWorkspaceRun, outstandingOrgSpendUsd } from "@/lib/live/session";
import { SCENARIO_KINDS } from "@/lib/sim/types";

export const dynamic = "force-dynamic";

const Body = z.object({ kind: z.enum(SCENARIO_KINDS as [string, ...string[]]), seed: z.number().int().min(0).max(1_000_000), model: z.string().max(80).optional() });

export async function POST(req: Request) {
  if (!liveEnabled()) return NextResponse.json({ error: "Live runs are disabled here. They run only on the builder's machine with a local key." }, { status: 403 });
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Sign in to run the agent." }, { status: 401 });
  if (!can(ctx, { run: ["create"] })) return NextResponse.json({ error: "Your role cannot run the agent. Ask an admin for the operator role." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const spent = await orgSpendUsd(ctx.orgId!) + outstandingOrgSpendUsd(ctx.orgId!);
  if (spent >= orgBudgetUsd()) return NextResponse.json({ error: `Organisation budget reached ($${spent.toFixed(2)} of $${orgBudgetUsd().toFixed(2)}).` }, { status: 402 });
  try {
  const s = startWorkspaceRun({ kind: parsed.data.kind as never, seed: parsed.data.seed, model: parsed.data.model, actor: { userId: ctx.userId, orgId: ctx.orgId!, label: `${ctx.name} (${ctx.role})` } }, orgBudgetUsd() - spent);
  return NextResponse.json(snapshot(s));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
