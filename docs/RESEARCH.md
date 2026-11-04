# Improving Muse performance — 2026-11-05

## What the current evidence says

The 20-scenario Spark evaluation detected 15/18 breaching cases early and avoided 12/18 expected breaches. Two stuck-sensor cases and unattended_ac seed 3002 were missed. This is a reused regression subset, not a blind estimate of general performance.

The former scripted 41/41 score measured early detection, not successful prevention. Scripted interventions avoided 34/41 breaches. Comparisons also differ in sample composition and action-search budgets: ScriptedPolicy tests six options and requests an inspection for suspect sensors; the LLM prompt permits two to three options and leaves inspection selection to the model. The script has explicit connector and stuck-sensor rules. Both use the same gate, but they do not have identical decision policies or search budgets.

## Findings in the implementation

1. **Premature monitoring exhaustion.** runMonitor caps a run at three investigations. The stuck-sensor recordings spend them repeatedly discussing the same frozen channel. No later investigation remains when an additional physical fault worsens. Revisit scheduling should depend on new evidence, degradation and remaining spend, rather than repeated identical triggers consuming every opportunity.
2. **Fault diagnosis is not forecast calibration.** Connector scenarios use a quadratic resistance ramp; twin hypotheses use linear ramps. A high posterior for the connector family does not imply a reliable severity/time forecast. The latest human-approved run predicts no breach within 60–90 minutes at t=65.5, but untreated truth breaches at 112. Both LLM and script inherit this tool limitation. The ensemble already represents multiple magnitudes, but that is not a calibrated coverage guarantee.
3. **Missing measurement is treated as reassurance.** In stuck-sensor failures Muse correctly excludes S1, then calls the situation benign based on other sensors. Loss of coverage warrants investigation/inspection even if hidden thermal hazard is unproven. The gate already has an inspection-specific path; preserve it and the human approval boundary.
4. **Evaluation conflates distinct outcomes.** Report fault identification, notification timing, valid action request, accepted action, breach delay/avoidance, inspection dependence, cost and controls separately. The simulator assumes a dispatched technician repairs existing faults; that assumption must remain visible.

## Research and proposed applications

- [LLM-Modulo frameworks (ICML 2024 position paper)](https://arxiv.org/abs/2402.01817): combine model proposals with external model-based verifiers. Application: retain the deterministic gate, provide structured missing-evidence/forecast-adequacy feedback, and let Muse revise. This supports the architecture, not proof of performance in this project.
- [ReAct (ICLR 2023)](https://arxiv.org/abs/2210.03629): interleave observations and actions to update plans. Application: give each follow-up a compact incident state, explicitly unresolved evidence and prior interventions, instead of repeating the entire investigation. Existing code already uses a related tool loop, so merely renaming it ReAct would add nothing.
- [Adaptive conformal prediction for safety-critical control (ACC 2024)](https://arxiv.org/abs/2407.03569): quantify prediction uncertainty from observations and incorporate it into control constraints. Application: calibrate forecast errors on a separate seeded calibration set by horizon/fault class, expose empirical intervals and adequacy warnings, and evaluate coverage under drift. Its robotics guarantees do not automatically transfer to Blindspot, particularly dependent time series and distribution shifts.
- [Reflexion (NeurIPS 2023)](https://arxiv.org/abs/2303.11366): use outcome feedback and episodic textual lessons to improve subsequent attempts. Application: derive a small reviewed lesson set from development failures, then freeze it before a fresh held-out evaluation. Do not expose test-seed truth or reuse test outcomes as prompt examples while claiming held-out results. Keep reflection offline to avoid more billed calls during every live run.

## Recommended order and budget

First fix repeated-trigger scheduling and forecast mismatch in deterministic tests; improve observation-loss instructions and compact follow-up state; then compare equal action budgets on paired fresh seeds. Fit uncertainty calibration separately. Use recorded responses and mock clients first. Only then run a small paired Spark batch within an explicit dollar cap, including no-fault and sensor-only controls. Report changes in detection, mitigation, false alarms, costs and inspection dependence. A model upgrade alone cannot repair incorrect tool forecasts.

The initial analysis made no model calls. Implementation and subsequent regression evidence are documented below; research papers do not promise gains for this simulator.

## Implemented follow-up

The research update adds sensor-evidence-aware revisit scheduling (at most six investigations, under the same dollar caps), compact prior-investigation context, continued monitoring after a warning without an action, and explicit lost-coverage guidance. An unchanged inspected frozen sensor no longer repeatedly consumes investigations. New evidence still permits another investigation.

The connector twin now fits both linear and accelerating resistance hypotheses, independently refined. No simulator truth is supplied to the agent. The deterministic gate and human approval boundary remain unchanged.

`npm run calibrate:forecast` fits an empirical upper residual allowance from 28 separate scenarios (seeds 4100–4103), with two untreated 90-minute forecasts at monitoring minutes 60/90 per scenario. On 14 separate scenarios (4200/4201), only 12/14 were covered, below the 90% target. This is an uncertainty warning, not a calibrated breach probability or safety guarantee. It is omitted after interventions because that regime was not calibrated.

`npm run eval:research` runs five selected regression cases within a persistent $1 incremental development-spend ceiling and stores versioned recordings plus `data/eval/research-results.json`. This batch reuses known failures and must not replace the original 20-scenario evaluation or be described as a fresh blind benchmark. Automatic approvals are simulation testing only; dispatched inspection assumes a successful repair in the simulator.

### Measured regression outcome

The five-case research-v3 Spark batch completed for **$0.7765**. The four faulted cases (stuck_sensor 3000/3001, unattended_ac 3002, loose_connection 3000) all detected before breach and avoided their expected simulated breaches. Previously the two stuck-sensor cases and unattended_ac 3002 had no alert. Three updated cases used technician inspection, whose repair effect is assumed by the simulator; unattended_ac used multiple approved interventions. The no-fault control 3000 produced an unnecessary inspection at 109.5 min: **1/1 controls alerted**, versus 0/1 for that control previously. Normal demand variation was fitted as a load fault. Increased sensitivity therefore has a false-positive cost; this small selected regression does not establish better overall generalization. Keep this failure visible in Results and do not replace the historical benchmark with these selected scores.
