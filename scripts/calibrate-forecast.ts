/** No model calls. Calibrate forecast underprediction on separate scenario seeds. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Incident } from '../lib/tools/incident';
import { loadRidge } from '../lib/agent/monitor';
import { prepare } from '../lib/sim/runner';
import { LIMITS, NODES, SAMPLE_S, SCENARIO_KINDS, type ScenarioKind } from '../lib/sim/types';
import { ForecastCalibrationSchema, upperResidualBound } from '../lib/estimate/forecast-calibration';
const ridge=loadRidge();
function score(kind:ScenarioKind,seed:number){
 const p=prepare(kind,seed);let worst=-Infinity;
 for(const minute of [60,90]){
  const k=Math.round(minute*60/SAMPLE_S), inc=new Incident(p,k,ridge);
  const items=inc.doNothing(90), z=items.reduce((n,x)=>n+x.w,0)||1;
  const plausible=items.filter(x=>x.w/z>=.03);
  const predicted=Math.max(...(plausible.length?plausible:items).map(x=>x.f.peakMargin));
  let actual=-Infinity;
  for(let j=k;j<=Math.min(p.readings.n-1,k+180);j++)for(let i=0;i<NODES.length;i++)actual=Math.max(actual,p.trace.T[i][j]-LIMITS[NODES[i]]);
  worst=Math.max(worst,actual-predicted);
 }
 return worst;
}
const seeds=[4100,4101,4102,4103], testSeeds=[4200,4201];
const scores=SCENARIO_KINDS.flatMap(kind=>seeds.map(seed=>{const s=score(kind,seed);console.log(`${kind}-${seed}: underprediction ${s.toFixed(2)} C`);return s}));
const bound=upperResidualBound(scores,.9);
const heldout=SCENARIO_KINDS.flatMap(kind=>testSeeds.map(seed=>score(kind,seed)));
const out=ForecastCalibrationSchema.parse({version:'forecast-v3',generatedAt:new Date().toISOString(),coverageTarget:.9,calibrationScenarios:scores.length,calibrationSeeds:seeds,boundC:Number(bound.toFixed(2)),horizonMin:90,heldOut:{scenarios:heldout.length,covered:heldout.filter(s=>s<=bound).length,seeds:testSeeds},note:'Empirical one-sided upper residual allowance, using a max-over-checkpoints score per scenario. Calibration seeds are separate from estimator training and the published evaluation. Coverage assumptions may fail under dependent scenarios or distribution shift; this is not a real-world safety guarantee. It does not modify or bypass gate checks.'});
mkdirSync('data/models',{recursive:true});writeFileSync('data/models/forecast-calibration.json',JSON.stringify(out,null,1));console.log(JSON.stringify(out));
