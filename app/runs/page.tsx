import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui";
import { can, getCtx } from "@/lib/auth/guard";
import { listOrgRuns } from "@/lib/db/runs";
import { listRuns } from "@/lib/ui/runs";

export const metadata = { title: "Runs — Blindspot" };
export const dynamic = "force-dynamic";

const sourceTone = (s: string) => (s === "llm" ? "teal" : "muted");

export default async function Runs() {
  const ctx = await getCtx();
  if (!ctx) redirect("/sign-in?next=/runs");
  if (!ctx.orgId) redirect("/workspace");
  const mine = await listOrgRuns(ctx.orgId);
  const samples = listRuns();
  const mineOutcomes = new Map(mine.map(r => {
    const o = r.outcome;
    return [r.id, o.withAction ? (o.withAction.limitExceeded ? "Breach remains" : "No breach with actions") : (o.doNothing.limitExceeded ? "Breach · no action" : "No breach")];
  }));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">Runs</h1>
        </div>
        {can(ctx, { run: ["create"] }) ? <Link href="/lab" className="btn btn-primary">Start a live run</Link> : <Badge>viewer: read-only</Badge>}
      </div>

      <p className="mt-3 text-xs text-muted">{ctx.orgName}</p>


      <div className="mt-6 overflow-x-auto">
        {mine.length === 0 ? (
          <p className="p-6 text-sm text-muted">No runs yet.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Run</th><th>Outcome</th><th>Cost</th><th /></tr></thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <td><div className="font-medium">{r.kind.replaceAll("_", " ")} <span className="mono text-xs text-faint">seed {r.seed}</span></div><div className="mt-1 text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</div></td>
                  <td><Badge tone={mineOutcomes.get(r.id)?.startsWith("Breach") ? "red" : "muted"}>{mineOutcomes.get(r.id)}</Badge></td>
                  <td className="mono">${r.costUsd.toFixed(3)}</td>
                  <td className="text-right"><Link href={`/replay/${r.id}`} className="text-teal hover:underline">Replay →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <details className="disclosure mt-10"><summary>Recorded Muse runs <span>{samples.length}</span></summary>
      <div className="mt-6 overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Scenario</th><th>Policy</th><th>Outcome</th><th /></tr></thead>
          <tbody>
            {samples.map((r) => (
              <tr key={r.id}>
                <td><div className="font-medium">{r.kind.replaceAll("_", " ")} <span className="mono text-xs text-faint">seed {r.seed}</span></div></td>
                <td><Badge tone={sourceTone(r.source) as never}>{r.source === "llm" ? r.model ?? "llm" : r.source}</Badge></td>
                <td><Badge tone={r.outcomeLabel?.startsWith("Breach") ? "red" : "muted"}>{r.outcomeLabel}</Badge></td>
                <td className="text-right"><Link href={`/replay/${r.id}`} className="text-teal hover:underline">Replay →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></details>
    </div>
  );
}
