/**
 * Deterministic evaluation against simulator ground truth (no LLM judge).
 *   M0  threshold alarm on the visible temperature sensors (3 C below each limit)
 *   M1  ridge-regression estimate of hidden zones, alert when within 3 C of a limit
 *   M2s scripted reference policy: same tools + same safety gate as the LLM agent, rule-based decisions (no LLM)
 *   M2  the LLM agent: merged from data/eval/llm-results.json when it has been recorded locally
 * Held-out seeds (2000+) are disjoint from the estimator's training seeds (1000-1023).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { baselineAlertEpisodes, baselineAlertIndex } from "../lib/baseline/threshold";
import { loadRidge } from "../lib/agent/monitor";
import { executeRun } from "../lib/agent/record";
import { ScriptedPolicy } from "../lib/agent/scripted";
import { FEATURE_NAMES, featuresAt } from "../lib/estimate/features";
import { fitRidge, predictRidge } from "../lib/estimate/ridge";
import { firstBreach, prepare } from "../lib/sim/runner";
import { ALERT_MARGIN, LIMITS, SAMPLE_S, ScenarioKind, SCENARIO_KINDS } from "../lib/sim/types";
import { GATE } from "../lib/tools/gate";
import { setTwinMismatch } from "../lib/twin/twin";
import { buildDataset, TRAIN_SEEDS } from "./train-estimator";

/**
 * Seeds 2000-2099 were used while developing/tuning the policy. The reported evaluation uses fresh seeds (3000+)
 * that were not inspected during development. Override with EVAL_SEED_BASE=2000 to reproduce the dev numbers.
 */
const BASE = Number(process.env.EVAL_SEED_BASE ?? 3000);
const FAULT_SEEDS = Array.from({ length: 7 }, (_, i) => BASE + i);
const CONTROL_SEEDS = Array.from({ length: 8 }, (_, i) => BASE + i);
const min = (k: number) => (k * SAMPLE_S) / 60;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : null);
const r2 = (x: number | null) => (x === null ? null : Number(x.toFixed(2)));

interface Row {
  id: string;
  kind: ScenarioKind;
  seed: number;
  faulty: boolean;
  onsetMin: number;
  breachMin: number | null;
  breachNode: string | null;
  m0AlertMin: number | null;
  m1AlertMin: number | null;
  m2sAlertMin: number | null;
  m2sStatus: string;
  m2sAction: string | null;
  m2sGateRequests: number;
  m2sGateRefusals: number;
  m2sPeakImprovementC: number | null;
  m2sBreachAvoided: boolean | null;
  m0FalseAlarms: number;
  m1FalseAlarms: number;
  m2sFalseAlarms: number;
  m2sInvocations: number;
}

async function main() {
  const ridge = loadRidge();
  if (!ridge) throw new Error("run `npm run train` first (data/models/ridge.json missing)");
  const rows: Row[] = [];
  const sqErr: Record<string, { se: number[]; n: number }> = {};
  const IDX = [1, 3, 5];

  for (const kind of SCENARIO_KINDS) {
    const seeds = kind === "control" ? CONTROL_SEEDS : FAULT_SEEDS;
    for (const seed of seeds) {
      const p = prepare(kind, seed);
      const fb = firstBreach(p.trace);
      const hoursScale = p.scn.durationS / 3600 / 8; // normalise false alarms to per-8h

      // M0
      const m0 = baselineAlertIndex(p.readings);
      const m0eps = baselineAlertEpisodes(p.readings);

      // M1 (also accumulates RMSE)
      let m1: number | null = null;
      let run = 0;
      let m1eps = 0;
      let lastEp = -Infinity;
      const acc = (sqErr[kind] ??= { se: [0, 0, 0], n: 0 });
      for (let k = 22; k < p.readings.n; k++) {
        const f = featuresAt(p.readings, k, p.scn.startHour)!;
        const est = predictRidge(ridge, f);
        const hot = est[0] > LIMITS.rackB - ALERT_MARGIN || est[1] > LIMITS.desk2 - ALERT_MARGIN || est[2] > LIMITS.conn - ALERT_MARGIN;
        run = hot ? run + 1 : 0;
        if (run >= 2 && m1 === null) m1 = k;
        if (run >= 2 && k * SAMPLE_S - lastEp >= 1800) {
          m1eps++;
          lastEp = k * SAMPLE_S;
        }
        if (k % 4 === 0) {
          for (let t = 0; t < 3; t++) acc.se[t] += (est[t] - p.trace.T[IDX[t]][k]) ** 2;
          acc.n++;
        }
      }

      // M2s
      const rec = await executeRun({ kind, seed, agent: new ScriptedPolicy(), ridge });
      const alerts = rec.events.filter((e) => e.kind === "tool_call" && e.data.name === "notify" && ["warn", "critical"].includes(String((e.data.args as { level?: string }).level))).map((e) => e.tMin);
      const reqs = rec.events.filter((e) => e.kind === "gate");
      const gates = reqs.length;
      const refused = reqs.filter((e) => e.data.allowed === false).length;
      const m2sAlert = rec.alertMin;

      rows.push({
        id: p.scn.id,
        kind,
        seed,
        faulty: p.scn.faulty,
        onsetMin: r2(p.scn.onsetS / 60)!,
        breachMin: fb ? min(fb.k) : null,
        breachNode: fb?.node ?? null,
        m0AlertMin: m0 === null ? null : min(m0),
        m1AlertMin: m1 === null ? null : min(m1),
        m2sAlertMin: m2sAlert,
        m2sStatus: rec.status,
        m2sAction: rec.action ? String((rec.action.action as { kind: string }).kind) : null,
        m2sGateRequests: gates,
        m2sGateRefusals: refused,
        m2sPeakImprovementC: rec.outcome.peakMarginImprovementC,
        m2sBreachAvoided: rec.action && rec.outcome.withAction ? rec.outcome.doNothing.limitExceeded && !rec.outcome.withAction.limitExceeded : null,
        m0FalseAlarms: kind === "control" ? Number((m0eps.length / hoursScale / (1 / 1)).toFixed(2)) * 0 + m0eps.length : 0,
        m1FalseAlarms: kind === "control" ? m1eps : 0,
        m2sFalseAlarms: kind === "control" ? alerts.length : 0,
        m2sInvocations: rec.invocations,
      });
      process.stdout.write(".");
    }
  }
  process.stdout.write("\n");

  // ---- summaries ----
  const faulted = rows.filter((r) => r.faulty);
  const breaching = faulted.filter((r) => r.breachMin !== null);
  const controls = rows.filter((r) => !r.faulty);
  const summarize = (key: "m0AlertMin" | "m1AlertMin" | "m2sAlertMin", fa: "m0FalseAlarms" | "m1FalseAlarms" | "m2sFalseAlarms") => {
    const leads = breaching.map((r) => (r[key] === null ? null : r.breachMin! - (r[key] as number)));
    const early = leads.filter((l): l is number => l !== null && l > 0);
    const late = leads.filter((l): l is number => l !== null && l <= 0);
    const preOnset = breaching.filter((r) => r[key] !== null && (r[key] as number) < r.onsetMin).length;
    return {
      breachScenarios: breaching.length,
      detectedBeforeBreach: early.length,
      detectedLate: late.length,
      missed: leads.filter((l) => l === null).length,
      alertsBeforeFaultOnset: preOnset,
      medianLeadMin: r2(median(early)),
      meanLeadMin: r2(early.length ? early.reduce((a, b) => a + b, 0) / early.length : null),
      falseAlarmsPer8hControls: r2(controls.reduce((a, r) => a + r[fa], 0) / controls.length),
      controlsWithFalseAlarm: controls.filter((r) => r[fa] > 0).length,
    };
  };
  const byKind = SCENARIO_KINDS.filter((k) => k !== "control").map((kind) => {
    const rs = breaching.filter((r) => r.kind === kind);
    const lead = (key: "m0AlertMin" | "m1AlertMin" | "m2sAlertMin") => {
      const ls = rs.map((r) => (r[key] === null ? null : r.breachMin! - (r[key] as number)));
      return { detected: ls.filter((l) => l !== null && l > 0).length, medianLeadMin: r2(median(ls.filter((l): l is number => l !== null && l > 0))) };
    };
    return { kind, n: rs.length, m0: lead("m0AlertMin"), m1: lead("m1AlertMin"), m2s: lead("m2sAlertMin") };
  });

  const acted = faulted.filter((r) => r.m2sAction);
  const gate = {
    note: "Gate and policy run on the twin's forecasts; improvements below are measured on the TRUE simulator (action applied vs doing nothing).",
    runsWithAcceptedAction: acted.length,
    requestsTotal: rows.reduce((a, r) => a + r.m2sGateRequests, 0),
    refusalsTotal: rows.reduce((a, r) => a + r.m2sGateRefusals, 0),
    acceptedButHarmful: acted.filter((r) => (r.m2sPeakImprovementC ?? 0) < 0).length,
    breachAvoidedWhenBreachExpected: acted.filter((r) => r.m2sBreachAvoided === true).length,
    breachStillOccurredDespiteAction: acted.filter((r) => r.m2sBreachAvoided === false && r.breachMin !== null).length,
    escalated: rows.filter((r) => r.m2sStatus === "escalated").length,
    medianPeakImprovementC: r2(median(acted.map((r) => r.m2sPeakImprovementC ?? 0))),
    config: GATE,
  };

  const rmse = Object.fromEntries(
    Object.entries(sqErr).map(([k, v]) => [k, { rackB: r2(Math.sqrt(v.se[0] / v.n)), desk2: r2(Math.sqrt(v.se[1] / v.n)), connector: r2(Math.sqrt(v.se[2] / v.n)) }]),
  );
  const tot = Object.values(sqErr).reduce((a, v) => ({ se: a.se.map((s, i) => s + v.se[i]), n: a.n + v.n }), { se: [0, 0, 0], n: 0 });
  const overallRmse = { rackB: r2(Math.sqrt(tot.se[0] / tot.n)), desk2: r2(Math.sqrt(tot.se[1] / tot.n)), connector: r2(Math.sqrt(tot.se[2] / tot.n)) };

  // leave-one-sensor-out: hide a real sensor, predict its reading from the others
  const { X, Y } = buildDataset(TRAIN_SEEDS);
  void Y;
  const loso: Record<string, number> = {};
  for (const [sensor, drop, col] of [["S1", ["s1", "ds1", "d13", "d13_sq", "s1_sq", "s1_x_s2", "d13_x_s3", "d13_x_d23", "ds1_x_d13"], 0], ["S2", ["s2", "ds2", "d23", "d23_sq", "s1_x_s2", "d13_x_d23"], 1]] as const) {
    const keep = FEATURE_NAMES.map((n, i) => (drop.includes(n as never) ? -1 : i)).filter((i) => i >= 0);
    const target = (x: number[]) => x[col];
    const m = fitRidge(X.map((x) => keep.map((i) => x[i])), X.map((x) => [target(x)]), keep.map((i) => FEATURE_NAMES[i]), [sensor], 0.01, "loso");
    let se = 0;
    let n = 0;
    for (const kind of SCENARIO_KINDS)
      for (const seed of CONTROL_SEEDS.slice(0, 5)) {
        const p = prepare(kind, seed);
        for (let k = 22; k < p.readings.n; k += 8) {
          const f = featuresAt(p.readings, k, p.scn.startHour)!;
          if (kind === "stuck_sensor" && sensor === "S1") continue; // a frozen sensor is not a clean target
          se += (predictRidge(m, keep.map((i) => f[i]))[0] - f[col]) ** 2;
          n++;
        }
      }
    loso[sensor] = Number(Math.sqrt(se / n).toFixed(2));
  }

  // ---- robustness: perturb the twin's physics so it is no longer a perfect copy of the simulator ----
  const robustness: unknown[] = [];
  if (process.env.ROBUSTNESS !== "0") {
    const subset = [...SCENARIO_KINDS.filter((k) => k !== "control").flatMap((kind) => [0, 1, 2].map((i) => ({ kind, seed: BASE + i }))), ...[0, 1, 2].map((i) => ({ kind: "control" as ScenarioKind, seed: BASE + i }))];
    for (const rel of [0, 0.1, 0.2]) {
      setTwinMismatch(rel, 3);
      const res = [];
      for (const j of subset) res.push(await executeRun({ ...j, agent: new ScriptedPolicy(), ridge }));
      setTwinMismatch(0);
      const br = res.filter((r) => r.scenario.kind !== "control" && r.outcome.doNothing.firstBreachMin !== null);
      const leads = br.map((r) => (r.alertMin === null ? null : r.outcome.doNothing.firstBreachMin! - r.alertMin));
      const early = leads.filter((l): l is number => l !== null && l > 0);
      const actedRuns = res.filter((r) => r.action);
      const gateEvents = res.flatMap((r) => r.events.filter((e) => e.kind === "gate"));
      robustness.push({
        twinParameterMismatch: rel,
        scenarios: res.length,
        breachScenarios: br.length,
        detectedBeforeBreach: early.length,
        medianLeadMin: r2(median(early)),
        controlsWithFalseAlarm: res.filter((r) => r.scenario.kind === "control" && r.alertMin !== null).length,
        controls: res.filter((r) => r.scenario.kind === "control").length,
        breachAvoided: actedRuns.filter((r) => r.outcome.doNothing.limitExceeded && r.outcome.withAction && !r.outcome.withAction.limitExceeded).length,
        acceptedButHarmful: actedRuns.filter((r) => (r.outcome.peakMarginImprovementC ?? 0) < 0).length,
        gateRefusalRate: Number((gateEvents.filter((e) => e.data.allowed === false).length / Math.max(1, gateEvents.length)).toFixed(2)),
      });
      process.stdout.write("r");
    }
    process.stdout.write("\n");
  }

  const llm = existsSync("data/eval/llm-results.json") ? JSON.parse(readFileSync("data/eval/llm-results.json", "utf8")) : null;

  const out = {
    generatedAt: new Date().toISOString(),
    simulated: true,
    setup: {
      heldOutSeeds: `${BASE}-${BASE + 6} (faulted, 7 per kind) and ${BASE}-${BASE + 7} (controls, 8); disjoint from estimator training seeds and from the seeds used to develop the policy`,
      trainSeeds: `${TRAIN_SEEDS[0]}-${TRAIN_SEEDS.at(-1)}`,
      scenarios: rows.length,
      faultedScenarios: faulted.length,
      scenariosThatBreach: breaching.length,
      controlScenarios: controls.length,
      alertMarginC: ALERT_MARGIN,
      notes: [
        "M0 sees only the 3 temperature sensors. M1 and M2s also use the 2 electrical meters (UPS power, strip voltage drop).",
        "M2s is a rule-based policy over the same tools and gate as the LLM agent: it measures the tools+gate, not a language model.",
        "Lead time = minutes between the first alert and the first true limit breach (positive = early). Limits are simulated thresholds.",
        "False alarms are counted on 8-hour no-fault controls only.",
        "The twin uses the same equations as the simulator (see the robustness table for what happens when it does not), and its hypothesis families match the simulated fault types.",
      ],
    },
    methods: {
      M0_threshold_alarm: summarize("m0AlertMin", "m0FalseAlarms"),
      M1_regression_estimator: summarize("m1AlertMin", "m1FalseAlarms"),
      M2s_tools_and_gate_scripted: summarize("m2sAlertMin", "m2sFalseAlarms"),
    },
    byKind,
    gate,
    estimator: { heldOutRmseC: overallRmse, byKindRmseC: rmse, leaveOneSensorOutRmseC: loso, residualSigmaTrainC: Object.fromEntries(ridge.targets.map((t, i) => [t, r2(ridge.residualSigma[i])])) },
    robustness,
    llm,
    rows,
  };
  writeFileSync("data/eval/results.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ robustness, methods: out.methods, gate: { ...gate, config: undefined }, estimator: out.estimator.heldOutRmseC, loso }, null, 1));
  console.log("wrote data/eval/results.json");
}
main();
