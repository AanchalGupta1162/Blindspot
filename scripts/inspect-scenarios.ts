import { makeScenario, buildEnv } from "../lib/sim/scenarios";
import { runTrace } from "../lib/sim/engine";
import { senseTrace } from "../lib/sim/sensors";
import { LIMITS, NODES, SCENARIO_KINDS, SAMPLE_S, ALERT_MARGIN } from "../lib/sim/types";

for (const kind of SCENARIO_KINDS) {
  const rows: string[] = [];
  let breaches = 0;
  const N = 12;
  for (let seed = 1; seed <= N; seed++) {
    const s = makeScenario(kind, seed);
    const tr = runTrace(buildEnv(s), s.durationS);
    const r = senseTrace(s, tr);
    let breach = -1, who = "";
    let tAl = -1;
    for (let k = 0; k < tr.n; k++) {
      if (breach < 0) for (let i = 0; i < 6; i++) if (tr.T[i][k] > LIMITS[NODES[i]]) { breach = k; who = NODES[i]; break; }
      if (tAl < 0 && k > 0 && (r.data[0][k] > 35 - ALERT_MARGIN || r.data[1][k] > 32 - ALERT_MARGIN || r.data[2][k] > 33 - ALERT_MARGIN)) tAl = k;
    }
    if (breach >= 0) breaches++;
    const mx = NODES.map((_, i) => Math.max(...tr.T[i]).toFixed(1)).join("/");
    rows.push(`seed${seed} onset=${(s.onsetS / 60).toFixed(0)}m breach=${breach < 0 ? "-" : ((breach * SAMPLE_S) / 60).toFixed(0) + "m:" + who} baseAlarm=${tAl < 0 ? "-" : ((tAl * SAMPLE_S) / 60).toFixed(0) + "m"} max=${mx}`);
  }
  console.log(`== ${kind}: ${breaches}/${N} breach`);
  console.log(rows.slice(0, 5).join("\n"));
}
