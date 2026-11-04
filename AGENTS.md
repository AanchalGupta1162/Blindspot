import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui";
import { can, getCtx, orgBudgetUsd, orgSpendUsd } from "@/lib/auth/guard";
import { listOrgRuns } from "@/lib/db/runs";
import { listRuns } from "@/lib/ui/runs";

export const metadata = { title: "Runs — Blindspot" };
export const dynamic = "force-dynamic";

const sourceTone = (s: string) => (s === "llm" ? "teal" : "muted");

export default async function Runs() {
  const ctx = await getCtx();
  if (!ctx) redirect("/sign-in?next=/runs");
  if (!ctx.orgId) redirect("/workspace");
  const [mine, spent] = await Promise.all([listOrgRuns(ctx.orgId), orgSpendUsd(ctx.orgId)]);
  const samples = listRuns();
  const mineOutcomes = new Map(mine.map(r => {
    const o = r.outcome;
    return [r.id, o.withAction ? (o.withAction.limitExceeded ? "Breach remains" : "No breach with actions") : (o.doNothing.limitExceeded ? "Breach · no action" : "No breach")];
  }));
  const budget = orgBudgetUsd();

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">Runs</h1>
        </div>
        {can(ctx, { run: ["create"] }) ? <Link href="/lab" className="btn btn-primary">Start a live run</Link> : <Badge>viewer: read-only</Badge>}
      </div>

      <p className="mt-3 text-xs text-muted">{ctx.orgName} · ${spent.toFixed(2)} of ${budget.toFixed(2)} used</p>


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

### Room placement demo (2026-11-05)

`/room` is a member-only navigation tab showing an interactive SVG room layout with racks, desk rows, UPS, AC return and the five sensor positions. Selectable sensor markers and accessible HTML controls show placement descriptions based on the existing simulator sensor catalog. A blind-spot toggle highlights unmeasured Rack B, desk row 2 and the connector. Layout is illustrative, not to scale, and not hardware-installation guidance. No new physics, hardware or model calls are added.

### Demo story, architecture and Muse results (2026-11-05)

Navigation follows Presentation → Architecture → Room → Lab → Runs → Results → Team. Member-only `/presentation` offers seven slides, keyboard navigation, sources and browser fullscreen. Incident losses are attributed preliminary reports, including Bengaluru’s solvent-related cause outside this model. Global IEA power data and Uptime survey costs are context, not global lab-fire prevalence. `/architecture` exposes interactive pipeline nodes separating Muse decisions, deterministic tools/gate, approval and storage. Results visualizes early detection vs avoided/remained breaches, fault-type detection, actual recorded tool calls, tokens/turns and costs. It does not claim the evaluation proves Muse is uniquely required. Reasoning tokens are a subset of output usage.

### 2026-11-05 demo / research update

- Architecture now has one interactive node per stage, animated paths, stack/model/tool details, operator/admin roles and storage. Pause and reduced-motion support are available.
- Presentation has three slides with locally served, attributed incident photographs and plain source credits. Photo provenance is in `docs/DEMO-SOURCES.md`.
- Live/replay workflow is a selectable graph beside event logs. Live polling is serialized, aborted on mutations, and ignores stale responses. Approval submissions have a synchronous duplicate guard. Navigation shows immediate loading feedback and avoids prefetching all authenticated pages.
- Monitor allows up to six budget-capped investigations, uses new sensor evidence to schedule follow-ups, continues after warning-only responses, and avoids repeat inspections of unchanged frozen-sensor evidence. Compact prior context is provided to Muse.
- Connector twin includes linear and accelerating ramps. `diagnose` explicitly identifies lost sensor coverage and model-conditional probabilities. Empirical forecast calibration is limited to untreated 90-minute windows at monitoring minutes 60/90; 12/14 held-out scenarios were covered, so it is not a safety guarantee and is omitted after interventions.
- `calibrate:forecast` is offline/no API. `eval:research` is a separately labelled five-case targeted regression with a persistent $1 incremental spend ceiling. Historical evaluation and original recordings remain intact.

### 2026-11-05 documentation and live-focused cleanup

README now documents the complete demo, architecture, stack, tools, roles, persistence, research results and limitations; `docs/PROJECT-GUIDE.md` provides the detailed technical explanation. Lab no longer renders the standalone browser simulation player, estimator/threshold status strip or sample-recording picker: it focuses on live Muse runs. Underlying scenario generation and replay remain intact. Workspace budget totals are removed from Runs UI, while server accounting/caps remain enforced. The repeated header/footer simulation-only labels are replaced by one accurate footer: “Live Muse agent · simulated sensor environment.” Architecture removes the path legend and uses a viewport-bounded compact map. There is no physical hardware connection.

### Neon connection recovery (2026-11-05)

Observed Postgres `57P01` during an authenticated page load. Session/context reads now retry once for explicitly identified transient connection errors, including wrapped driver causes. Other failures propagate. Model calls and mutations are not wrapped. The Postgres pool handles failed idle-client error events and bounds connection establishment to eight seconds. Regression tests cover recovery, nontransient errors and retry exhaustion.

### Lab sensor timeline restored (2026-11-05)

At the user's request, Lab again includes simulation play/pause/replay, 6×/20×/60× speeds, a time scrubber, air temperatures/hidden-temperature estimates, connector temperature and electrical-meter charts, plus threshold/estimator/trigger status and breach markers. This sits below the live Muse graph/log workflow. Playback is the untreated scenario and independent of the live run; it does not imply that live interventions are rendered on these charts. No scripted agent runs or budget banners were restored.
