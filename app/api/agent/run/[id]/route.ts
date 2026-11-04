import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth/guard";
import { getSession, liveEnabled, snapshot } from "@/lib/live/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!liveEnabled()) return NextResponse.json({ error: "disabled" }, { status: 403 });
  const me = await getCtx();
  if (!me) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const s = getSession((await ctx.params).id, me.orgId ?? "");
  // another organisation's run looks exactly like a missing one
  if (!s || s.actor?.orgId !== me.orgId) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(snapshot(s));
}
