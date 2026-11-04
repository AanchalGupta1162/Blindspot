import { redirect } from "next/navigation";
import WorkspaceClient from "@/components/WorkspaceClient";
import { getCtx } from "@/lib/auth/guard";

export const metadata = { title: "Workspaces — Blindspot" };

export default async function Workspace() {
  const ctx = await getCtx();
  if (!ctx) redirect("/sign-in?next=/workspace");
  return <WorkspaceClient activeId={ctx.orgId} />;
}
