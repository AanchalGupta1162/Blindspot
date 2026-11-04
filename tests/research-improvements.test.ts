import { expect, it } from "vitest";
import { InvestigationSchedule } from "../lib/agent/investigation-schedule";
import { faultOf } from "../lib/twin/twin";
import { Incident } from "../lib/tools/incident";
import { prepare } from "../lib/sim/runner";
it("keeps later investigations for unchanged frozen-sensor triggers but wakes on new evidence", () => {
  const s = new InvestigationSchedule(15);
  const flat = { rule: "flat" as const, detail: "sensor S1 has been exactly constant for 15 minutes", k: 100 };
  const evidence = [27,26,23,4.5,80];
  expect(s.shouldInvestigate(flat, evidence)).toBe(true); s.record(flat,evidence);
  expect(s.shouldInvestigate({...flat,k:130},evidence)).toBe(false);
  expect(s.shouldInvestigate({...flat,k:160},evidence)).toBe(false);
  expect(s.shouldInvestigate({...flat,k:160},[27,26,24,4.5,80])).toBe(true);
  expect(s.shouldInvestigate({...flat,k:190},evidence)).toBe(true);
});
it("never allows a changed trigger to bypass the cooldown", () => {
  const s = new InvestigationSchedule(15);
  s.record({rule:'flat',detail:'sensor S1 frozen',k:100},[27,26,23,4.5,80]);
  expect(s.shouldInvestigate({rule:'contact',detail:'rack B voltage',k:110},[27,26,23,4.5,900])).toBe(false);
});
it("supports both steady and accelerating connector hypotheses without future truth", () => {
  const linear = faultOf({family:'connector',tOnS:1000,mag:.5,rampS:2000,rampPower:1});
  const accelerating = faultOf({family:'connector',tOnS:1000,mag:.5,rampS:2000,rampPower:2});
  expect(accelerating(2000).rContact).toBeLessThan(linear(2000).rContact);
  expect(accelerating(3000).rContact).toBe(linear(3000).rContact);
});
it("includes a plausible breach path for the early accelerating connector regression", () => {
  const inc = new Incident(prepare('loose_connection',3000),131,null);
  expect(inc.diagnosis().members.some(m=>m.family==='connector'&&m.rampPower===2)).toBe(true);
  expect(inc.hazard(90).pBreach).toBeGreaterThan(0.05);
});

it("computes the scenario-level finite-sample upper residual quantile", async () => {
  const { upperResidualBound } = await import('../lib/estimate/forecast-calibration');
  expect(upperResidualBound([0,1,2,3,4,5,6,7,8],.8)).toBe(7);
  expect(()=>upperResidualBound([1,2],.99)).toThrow('Too few');
  expect(upperResidualBound([-4,-3,-2,-1,0,0,0,0,0],.8)).toBe(0);
});
it("reports lost coverage and does not describe an ensemble posterior as a safety guarantee", async () => {
  const { runTool } = await import('../lib/tools');
  const inc=new Incident(prepare('stuck_sensor',3000),180,null);
  const result=runTool(inc,'diagnose',{}).data as any;
  expect(result.observation_coverage.untrusted_sensors).toContain('S1');
  expect(result.observation_coverage.unobserved_due_to_sensor_failure).toContain('rackA');
  expect(result.forecast_uncertainty.probabilities_are_calibrated).toBe(false);
});
it("continues monitoring after warning without an applied action", async () => {
  const { executeRun } = await import('../lib/agent/record');
  let calls=0;
  const run=await executeRun({kind:'loose_connection',seed:3000,ridge:null,maxInvocations:2,agent:{source:'llm',model:'mock',label:'test',usage:()=>({inputTokens:0,outputTokens:0,reasoningTokens:0,costUsd:0,turns:0,models:[]}),async invoke(inc,_trigger,rec){calls++;if(calls===1){rec.push('tool_call',inc.tNowMin,{name:'notify',args:{level:'warn',message:'Keep observing'}});return 'alerted'}return 'no_action'}}});
  expect(calls).toBe(2);
  expect(run.alertMin).not.toBeNull();
  expect(run.headline).not.toContain('No alert');
});
it("does not repeatedly inspect an unchanged frozen sensor after an approved human check", async () => {
  const { runMonitor }=await import('../lib/agent/monitor');
  const { Recorder }=await import('../lib/agent/run');
  const { applyApproval }=await import('../lib/tools');
  const times:number[]=[];
  const result=await runMonitor(prepare('stuck_sensor',3000),null,{source:'llm',model:'mock',label:'test',usage:()=>({inputTokens:0,outputTokens:0,reasoningTokens:0,costUsd:0,turns:0,models:[]}),async invoke(inc){times.push(inc.tNowMin);inc.pending={action:{kind:'dispatch_human_check'},reason:'Inspect lost coverage',gate:{allowed:true} as never};applyApproval(inc);return 'alerted_and_acted'}},new Recorder(),{untilK:360});
  expect(result.applied, JSON.stringify(times)).toHaveLength(1);
});
