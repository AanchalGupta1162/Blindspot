import { redirect } from "next/navigation";
import TeamClient from "@/components/TeamClient";
import { can, getCtx } from "@/lib/auth/guard";

export const metadata = { title: "Team — Blindspot" };

export default async function Team() {
  const ctx = await getCtx();
  if (!ctx) redirect("/sign-in?next=/team");
  if (!ctx.orgId) redirect("/workspace");
  return <TeamClient canManage={can(ctx, { member: ["update"] })} meId={ctx.userId} />;
}
