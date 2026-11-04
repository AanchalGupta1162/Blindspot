/** Targeted regression only, with a $1 incremental development-spend ceiling. Historical evaluation is untouched. */
import './env';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { z } from 'zod';
import { Budget } from '../lib/agent/budget';
import { MetaClient } from '../lib/agent/client';
import { LLMAgent } from '../lib/agent/loop';
import { autoApprover } from '../lib/agent/approvers';
import { executeRun } from '../lib/agent/record';
import { loadRidge } from '../lib/agent/monitor';
import { EvaluationRowSchema, ResearchEvaluationSchema, summarizeEvaluation } from '../lib/agent/evaluation';
import { RunSchema } from '../lib/agent/run';
import type { ScenarioKind } from '../lib/sim/types';
const jobs: {kind:ScenarioKind;seed:number}[]=[{kind:'stuck_sensor',seed:3000},{kind:'stuck_sensor',seed:3001},{kind:'unattended_ac',seed:3002},{kind:'loose_connection',seed:3000},{kind:'control',seed:3000}];
const Manifest=z.object({version:z.literal('research-v3'),startSpendUsd:z.number().nonnegative(),capUsd:z.number().positive().max(1)});
async function main(){
 mkdirSync('.data/qa',{recursive:true}); mkdirSync('data/eval',{recursive:true});
 const mf='.data/qa/research-batch.json';
 const startSpend=new Budget().developmentSpent;
 const manifest=existsSync(mf)?Manifest.parse(JSON.parse(readFileSync(mf,'utf8'))):Manifest.parse({version:'research-v3',startSpendUsd:startSpend,capUsd:1});
 if(!existsSync(mf))writeFileSync(mf,JSON.stringify(manifest));
 const model=process.env.MODEL_DEFAULT??'muse-spark-1.3',ridge=loadRidge(),client=new MetaClient();
 const old=JSON.parse(readFileSync('data/eval/llm-results.json','utf8'));
 const rows:ReturnType<typeof EvaluationRowSchema.parse>[]=[], runIds:string[]=[];
 let spent=0;
 const write=()=>{const out={...summarizeEvaluation(rows,jobs.length,model),version:'research-v3',note:'Targeted regression on three previously missed cases, one connector case and one no-fault control. Selected using prior failures; NOT a new blind evaluation or a replacement for the original 20-scenario results. Auto-simulated approvals. Any benefit from dispatched inspection assumes successful repair in the simulator.',runIds,batchCapUsd:manifest.capUsd,batchSpentUsd:Number(spent.toFixed(4)),originalComparison:rows.map(row=>({id:row.id,before:old.rows.find((x:any)=>x.id===row.id)??null,after:row}))};ResearchEvaluationSchema.parse(out);writeFileSync('data/eval/research-results.json.tmp',JSON.stringify(out,null,1));renameSync('data/eval/research-results.json.tmp','data/eval/research-results.json')};
 for(const job of jobs){
  const id=`research-v3-${model}-${job.kind}-${job.seed}-llm`, file=`data/runs/${id}.json`;
  let run=existsSync(file)?RunSchema.parse(JSON.parse(readFileSync(file,'utf8'))):null;
  if(!run){
   const remaining=manifest.startSpendUsd+manifest.capUsd-new Budget().developmentSpent;
   if(remaining<.06){console.log('Research batch cap reached');break}
   const budget=new Budget({runCapUsd:Math.min(.4,remaining),devCapUsd:Math.min(Number(process.env.DEV_BUDGET_USD??60),manifest.startSpendUsd+manifest.capUsd)});
   const agent=new LLMAgent({client,budget,model,escalateModel:null,approve:autoApprover});
   run=await executeRun({...job,agent,ridge});run.id=id;writeFileSync(file,JSON.stringify(RunSchema.parse(run),null,1));
  }
  spent+=run.usage.costUsd;runIds.push(id);
  const interrupted=run.status==='budget_stopped'||run.events.some(e=>e.kind==='status'&&['paused','budget_stopped'].includes(String(e.data.status)));
  if(!interrupted)rows.push(EvaluationRowSchema.parse({id:`${job.kind}-${job.seed}`,status:run.status,alertMin:run.alertMin,breachMin:run.outcome.doNothing.firstBreachMin,costUsd:run.usage.costUsd,turns:run.usage.turns,action:run.action?.action??null,peakImprovementC:run.outcome.peakMarginImprovementC,breachAvoided:run.outcome.withAction?run.outcome.doNothing.limitExceeded&&!run.outcome.withAction.limitExceeded:null}));
  write();console.log(`${id}: ${run.status}, alert ${run.alertMin}, breach avoided ${!run.outcome.doNothing.limitExceeded?'no expected breach':run.outcome.withAction?!run.outcome.withAction.limitExceeded:'no action'}, $${run.usage.costUsd}; batch $${spent.toFixed(4)}/$1`);
  if(interrupted)break;
 }
 write();
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
