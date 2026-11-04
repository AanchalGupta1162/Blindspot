import { redirect } from "next/navigation";
import LabClient from "@/components/LabClient";
import { getCtx } from "@/lib/auth/guard";

export const metadata = { title: "Lab — Blindspot" };
export const dynamic = "force-dynamic";

export default async function LabPage() {
  const ctx = await getCtx();
  if (!ctx) redirect("/sign-in?next=/lab");
  if (!ctx.orgId) redirect("/workspace");
  return <LabClient />;
}
