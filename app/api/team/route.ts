import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { can, getCtx } from "@/lib/auth/guard";
import { ROLE_NAMES } from "@/lib/auth/permissions";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Members of the active organisation. Any member may read the list. */
export async function GET() {
  const me = await getCtx();
  if (!me?.orgId) return NextResponse.json({ error: "Sign in and pick an organisation." }, { status: 401 });
  const rows = await db
    .select({ id: schema.member.id, userId: schema.member.userId, role: schema.member.role, name: schema.user.name, email: schema.user.email, joined: schema.member.createdAt })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, me.orgId))
    .orderBy(schema.member.createdAt);
  return NextResponse.json({ members: rows, me: { userId: me.userId, role: me.role } });
}

const Add = z.object({ email: z.string().email(), role: z.enum(ROLE_NAMES) });

/** Admin adds an existing Blindspot user to the organisation. */
export async function POST(req: Request) {
  const me = await getCtx();
  if (!me?.orgId) return NextResponse.json({ error: "Sign in and pick an organisation." }, { status: 401 });
  if (!can(me, { member: ["create"] })) return NextResponse.json({ error: "Only admins can add members." }, { status: 403 });
  const body = Add.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Enter a valid email and role." }, { status: 400 });
  const [u] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, body.data.email.toLowerCase())).limit(1);
  if (!u) return NextResponse.json({ error: "No Blindspot account has that email yet. Ask them to sign up first." }, { status: 404 });
  const [dup] = await db.select({ id: schema.member.id }).from(schema.member).where(and(eq(schema.member.userId, u.id), eq(schema.member.organizationId, me.orgId))).limit(1);
  if (dup) return NextResponse.json({ error: "That person is already a member." }, { status: 409 });
  await auth.api.addMember({ body: { userId: u.id, organizationId: me.orgId, role: body.data.role } });
  return NextResponse.json({ ok: true });
}

const Patch = z.object({ memberId: z.string(), role: z.enum(ROLE_NAMES).optional(), remove: z.boolean().optional() });

/** Admin changes a role or removes a member. The last admin cannot be demoted or removed. */
export async function PATCH(req: Request) {
  const me = await getCtx();
  if (!me?.orgId) return NextResponse.json({ error: "Sign in and pick an organisation." }, { status: 401 });
  if (!can(me, { member: ["update"] })) return NextResponse.json({ error: "Only admins can change members." }, { status: 403 });
  const body = Patch.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const members = await db.select().from(schema.member).where(eq(schema.member.organizationId, me.orgId));
  const target = members.find((m) => m.id === body.data.memberId);
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
  const admins = members.filter((m) => m.role === "admin");
  const losesAdmin = target.role === "admin" && (body.data.remove || (body.data.role && body.data.role !== "admin"));
  if (losesAdmin && admins.length <= 1) return NextResponse.json({ error: "An organisation needs at least one admin." }, { status: 409 });
  if (body.data.remove) await db.delete(schema.member).where(eq(schema.member.id, target.id));
  else if (body.data.role) await db.update(schema.member).set({ role: body.data.role }).where(eq(schema.member.id, target.id));
  return NextResponse.json({ ok: true });
}
