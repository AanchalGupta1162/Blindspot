import ResultsVisuals from "@/components/ResultsVisuals";
import { getResearchResults } from "@/lib/ui/runs";
import { getRun } from "@/lib/ui/runs";
import { getResults } from "@/lib/ui/runs";
export const metadata = { title: "Results — Blindspot" };
export default function ResultsPage() {
  const r = getResults()?.llm;
  const research = getResearchResults();
  if (!r) return <div><h1 className="text-2xl font-medium">Muse results</h1><p className="mt-4 text-sm text-muted">No Muse evaluation has been recorded yet.</p></div>;
  const rows = r.rows as {id:string;alertMin:number|null;breachMin:number|null;breachAvoided:boolean|null;costUsd:number;status:string}[];
  const recordings = rows.map(row => getRun(`eval-v2-${r.model}-${row.id}-llm`)).filter((run): run is NonNullable<typeof run> => run !== null);
  return <div>
    <h1 className="text-2xl font-medium">Muse results</h1>
    <p className="mt-2 text-sm text-muted">{r.model} · {r.n} simulated scenarios · Auto-simulated approvals</p>
    <div className="mt-8 grid grid-cols-2 gap-6 border-b border-line pb-8 sm:grid-cols-4">
      <Metric title="Detected before breach" value={`${r.detectedBeforeBreach}/${r.breachScenarios}`} />
      <Metric title="Median warning" value={`${r.medianLeadMin ?? "—"} min`} />
      <Metric title="Alerts on controls" value={`${r.controlsWithAlert}/${r.controls}`} />
      <Metric title="Breaches avoided" value={`${rows.filter(x => x.breachAvoided === true).length}/${r.breachScenarios}`} />
    </div>
    {research && <section className="mt-8 border-b border-line pb-8"><h2 className="text-lg font-medium">Research update</h2><p className="mt-2 text-sm text-muted">{research.n}/{research.plannedN} targeted regression cases · ${research.batchSpentUsd.toFixed(3)} of $1 cap · {research.complete ? "Complete" : "In progress"} · {research.controlsWithAlert}/{research.controls} controls raised an alert</p><div className="mt-4 overflow-x-auto"><table className="tbl"><thead><tr><th>Scenario</th><th>Previous detection</th><th>Updated detection</th><th>Updated outcome</th></tr></thead><tbody>{research.originalComparison.map(c=><tr key={c.id}><td>{c.id.replaceAll("_"," ")}</td><td>{c.before?.alertMin == null ? c.before?.breachMin == null ? "No alert" : "Missed" : `t=${c.before.alertMin}m`}</td><td>{c.after.alertMin == null ? "No alert" : `t=${c.after.alertMin}m`}</td><td>{c.after.breachMin == null ? c.after.alertMin != null ? "False alert / inspection" : "No breach" : c.after.breachAvoided ? "Breach avoided" : "Breach remains"}</td></tr>)}</tbody></table></div><details className="mt-3 text-xs text-muted"><summary>Scope and assumptions</summary><p className="mt-2">{research.note} Original 20-scenario metrics above remain unchanged.</p></details></section>}
    <ResultsVisuals rows={rows} runs={recordings} model={r.model} />
    <details className="disclosure mt-9"><summary>Individual runs</summary>
    <div className="mt-7 overflow-x-auto"><table className="tbl"><thead><tr><th>Scenario</th><th>Detection</th><th>Outcome</th><th>Cost</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}><td>{row.id.replaceAll("_"," ")}</td><td>{row.alertMin === null ? row.breachMin === null ? "No alert needed" : "Missed" : row.breachMin !== null && row.alertMin < row.breachMin ? `${(row.breachMin-row.alertMin).toFixed(1)} min early` : "Late alert"}</td><td className={row.breachMin !== null && !row.breachAvoided ? "text-danger" : "text-muted"}>{row.breachMin === null ? "No breach" : row.breachAvoided ? "Breach avoided" : "Breach remains"}</td><td>${row.costUsd.toFixed(3)}</td></tr>)}
    </tbody></table></div></details>
    <details className="disclosure mt-8"><summary>Evaluation details</summary><div className="space-y-3 pb-5 text-sm text-muted"><p>{r.note}</p><p>These are recorded Muse decisions scored against simulator truth. All listed evaluation approvals were automatic for testing; live actions require your approval. Median warning includes early detections only.</p><p>Total model cost: ${r.totalCostUsd}. No real-world safety claim is made.</p></div></details>
  </div>;
}
function Metric({title,value}:{title:string;value:string}) { return <div><p className="text-xs text-muted">{title}</p><p className="mt-2 text-2xl font-medium tabular-nums">{value}</p></div>; }
