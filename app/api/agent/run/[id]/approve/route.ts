import { NextResponse } from "next/server";
import { z } from "zod";
import { can, getCtx } from "@/lib/auth/guard";
import { getSession, liveEnabled, snapshot, resolveSessionApproval } from "@/lib/live/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!liveEnabled()) return NextResponse.json({ error: "disabled" }, { status: 403 });
  const me = await getCtx();
  if (!me) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const s = getSession((await ctx.params).id, me.orgId ?? "");
  if (!s || s.actor?.orgId !== me.orgId) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!can(me, { run: ["approve"] })) return NextResponse.json({ error: "Only operators and admins can approve actions." }, { status: 403 });
  const body = z.object({ decision: z.enum(["approved", "rejected"]), approvalId: z.string().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (!resolveSessionApproval(s, body.data.approvalId, body.data.decision, `${me.name} (${me.role}) <${me.email}>`)) return NextResponse.json({ error: "This approval is no longer pending. Refresh and review the current action." }, { status: 409 });
  return NextResponse.json(snapshot(s));
}
