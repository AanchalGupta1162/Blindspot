import type { Run } from "../lib/agent/run";
type EvalRow={id:string;alertMin:number|null;breachMin:number|null;breachAvoided:boolean|null;costUsd:number;status:string};
export default function ResultsVisuals({rows,runs,model}:{rows:EvalRow[];runs:Run[];model:string}){
 const breaches=rows.filter(x=>x.breachMin!==null), early=breaches.filter(x=>x.alertMin!==null&&x.alertMin<x.breachMin!);
 const avoided=breaches.filter(x=>x.breachAvoided), failed=breaches.length-avoided.length;
 const usage=runs.reduce((a,r)=>({input:a.input+r.usage.inputTokens,output:a.output+r.usage.outputTokens,reasoning:a.reasoning+r.usage.reasoningTokens,turns:a.turns+r.usage.turns}),{input:0,output:0,reasoning:0,turns:0});
 const calls=runs.flatMap(r=>r.events.filter(e=>e.kind==='tool_call'));
 const count=(names:string[])=>calls.filter(e=>names.includes(String(e.data.name))).length;
 const gates=runs.flatMap(r=>r.events.filter(e=>e.kind==='gate'));
 const kinds=[...new Set(rows.map(r=>r.id.replace(/-\d+$/,'')))];
 const n=(x:number)=>x.toLocaleString('en-US');
 return <div className="mt-10 space-y-10">
   <section><h2 className="text-lg font-medium">Detection and intervention</h2><p className="mt-1 text-xs text-muted">Different measures: an early warning does not guarantee a successful intervention.</p><div className="mt-5 space-y-4">
     <Bar title="Detected early" value={early.length} total={breaches.length} color="var(--teal)" /><Bar title="Breach avoided" value={avoided.length} total={breaches.length} color="var(--green)" /><Bar title="Breach remained" value={failed} total={breaches.length} color="var(--red)" />
   </div></section>
   <section><h2 className="text-lg font-medium">What Muse did</h2><p className="mt-1 text-xs text-muted">Observed calls across {runs.length} evaluation recordings. Model decisions are separate from deterministic calculations.</p><div className="usage-flow mt-5">
     {[['Inspect evidence',count(['list_sensors','sensor_metadata','get_reading','get_history'])],['Diagnose',count(['diagnose','estimate_hidden_zones'])],['Test actions',count(['simulate_action'])],['Request action',count(['request_action'])]].map(([title,value])=><div key={title}><span className="text-xs text-muted">{title}</span><strong className="mt-2 block text-2xl font-medium">{value}</strong></div>)}
   </div><p className="mt-4 text-sm text-muted">Muse selects tools and interventions. The physics twin computes forecasts; the gate validates requests; approval controls execution.</p><p className="mt-2 text-xs text-muted">Gate outcomes: {gates.filter(e=>e.data.allowed===true).length} passed · {gates.filter(e=>e.data.allowed!==true).length} refused. These are requests, not unique scenarios.</p></section>
   <section><h2 className="text-lg font-medium">By scenario</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{kinds.map(kind=>{const group=breaches.filter(x=>x.id.startsWith(kind+'-'));const detected=group.filter(x=>x.alertMin!==null&&x.alertMin<x.breachMin!);return group.length?<Bar key={kind} title={kind.replaceAll('_',' ')} value={detected.length} total={group.length} color="var(--teal)" />:null})}</div><p className="mt-3 text-xs text-muted">Early detection / breaching cases. No-fault controls are reported separately above.</p></section>
   <section className="border-t border-line pt-6"><h2 className="text-lg font-medium">Model usage</h2><p className="mt-1 text-sm text-muted">{model} · {n(usage.turns)} total turns · ${rows.reduce((a,r)=>a+r.costUsd,0).toFixed(3)} recorded cost</p><div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">{[['Input tokens',usage.input],['Output tokens',usage.output],['Reasoning tokens',usage.reasoning],['Tool calls',calls.length]].map(([label,value])=><div key={label}><p className="text-xs text-muted">{label}</p><p className="mt-2 text-xl tabular-nums">{n(Number(value))}</p></div>)}</div><p className="mt-3 text-xs text-muted">Reasoning tokens are included in output tokens, not added again. This subset used Spark; Wonder escalation was not used.</p></section>
 </div>;
}
function Bar({title,value,total,color}:{title:string;value:number;total:number;color:string}){return <div><div className="mb-2 flex justify-between gap-3 text-sm"><span>{title}</span><span className="tabular-nums text-muted">{value}/{total}</span></div><div className="h-2 overflow-hidden rounded bg-panel2" role="img" aria-label={`${title}: ${value} of ${total}`}><div className="h-full rounded" style={{width:`${total?value/total*100:0}%`,background:color}} /></div></div>}
