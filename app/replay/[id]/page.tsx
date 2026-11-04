import { notFound, redirect } from "next/navigation";
import ReplayClient from "@/components/ReplayClient";
import { getCtx } from "@/lib/auth/guard";
import { getOrgRun } from "@/lib/db/runs";
import { getRun } from "@/lib/ui/runs";

export const dynamic = "force-dynamic";

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx) redirect(`/sign-in?next=/replay/${encodeURIComponent(id)}`);
  // bundled samples are visible to everyone; a workspace's own runs only to its members
  const run = getRun(id) ?? (ctx.orgId ? await getOrgRun(ctx.orgId, id) : null);
  if (!run) notFound();
  return <ReplayClient run={run} />;
}
