# Submission notes

## Description

Blindspot is a verifiable monitoring agent for labs and server rooms with few sensors. In a simulated lab it sees three temperatures and two electrical meters, estimates hidden-zone conditions, tests fixes in a physics twin, and proposes an action. A deterministic safety gate can refuse it; a human must approve every accepted action. The monitor can investigate again after an intervention if a breach remains forecast. All decisions are scored against simulator truth. The app and live model calls run locally; judges can follow the README to run recorded replays without a model key.

## Demo story

Use **loose connection, seed 3000** as the headline: the temperature threshold is silent while the electrical signature reveals a hidden connector problem. Show the LLM recording, the tool results, the gate checks, and explicit human approval. Use a separate recorded run with an actual `allowed: false` gate event to demonstrate refusal/revision; do not imply that every headline recording contains a refusal. The evaluation includes real refusals in `blocked_vent` seeds 3000/3002 and `ac_failure` seed 3002.

All `eval-v2-*` runs use auto-simulated approvals and must be introduced as evaluation recordings. The original `unattended_ac-3000-llm` has real terminal approval but only delays breach; do not claim it solved the incident. Workspace recordings require a real operator to click Approve/Reject.

Headline human-approved UI recording: `loose_connection-3000-live-mw2abgue-60zzw`. The user explicitly approved both simulated load reductions through chat, and the browser recorded the decisions under the disposable local QA account. Both decisions are in the event log. The run cost $0.1463, delayed the connector breach from 112 to 157.5 simulated minutes, and reduced degree-minutes above the limit from 2195.13 to 33.50 (98.5%). **The breach still occurred.** This is the story to narrate; do not claim prevention.

## Claims

- Muse Spark evaluation: 20 scenarios, 18 breaching; 15 detected before breach, median warning 48 minutes among early detections, zero alerts on two controls.
- Recorded interventions avoided 12/18 expected breaches. The subset uses auto-simulated approvals. Do not present it as a fresh blind evaluation.
- App demonstration is Muse-only. Scripted recordings and scripted-policy scores are not shown.
- Estimator held-out RMSE: rack B 2.12 °C, desk row 2 0.22 °C, connector 2.39 °C.
- Quote LLM subset numbers only from `data/eval/llm-results.json`, with the actual sample size and auto-simulated approval label. Keep misses and failed mitigations visible. These benchmark seeds were reused; this is not a new blind test.
- No real fire-prevention claims, no aggregate college-fire statistics, and no firsthand-campus-experience claim. The simulator and twin share equations.

## Three-minute video

| Time | Content |
|---|---|
| 0:00–0:20 | Explain the hidden-sensor problem; say the room is simulated. |
| 0:20–0:45 | Show the five measurements and hidden connector. Name Spark 1.3; explain Wonder is optional escalation. |
| 0:45–1:35 | Replay the loose-connection investigation, simulations, gate and human approval. State the recording's real approval mode. |
| 1:35–2:00 | Show a separate actual refusal and revision. |
| 2:00–2:35 | Show Muse-only `/results`, including misses, unsuccessful interventions, controls and automatic evaluation approvals. |
| 2:35–3:00 | Limitations, local run instructions, honest commit history and repository link. |

## Submission checklist

- [x] A human-approved headline recording is selected and its ID is in the video notes.
- [ ] Public repo link works; secrets scan passes; no `.env`, spend ledger or local database is published.
- [ ] Three-minute video link works in a private window.
- [ ] Contributors are listed; one representative submits before the deadline.
- [ ] Ask organizers whether a local, simulation-only product meets the category requirements, if still unresolved.

No hosted product is claimed. Wokwi, MCP and optional voice/image integrations are deferred.

## Demo tabs and result diagrams (2026-11-05)

Added member-only Room, Architecture and Presentation tabs and ordered them before Lab. Browser exercised room sensor selection and blind-spot toggle; architecture node selection; slide next/dot/keyboard controls; Present/Exit presentation; and the Muse results diagrams. Presentation mode has a fixed-screen fallback for browsers that deny native fullscreen. Phone viewport check reports page width 390 at viewport width 390. Sensor layout is illustrative. Incident/global data sources and limitations are recorded in docs/DEMO-SOURCES.md with plain credits on slides. Results aggregates all 20 matching Muse evaluation recordings: 284 turns, 1,578,299 input tokens, 105,946 output tokens including 43,248 reasoning tokens; $2.423. Tool-call counters and scenario charts come from those recordings. Fresh production build/type validation passes; 16 suites / 97 tests pass. No paid model calls.

## Animated demo and research update verification

Final deterministic checks: 18 suites / 111 tests passing; typecheck and production build passing. Browser verified architecture node selection, animation pause, one copy per node, complete desktop map and contained horizontal scrolling on a 390px phone viewport; three-slide photo presentation; real research recording in side-by-side graph/log view; graph selection filters actual gate events and retains earlier approvals during follow-up investigations. Live duplicate/stale-request paths are covered by request-epoch tests. No approval was submitted for a user's live run during this update.

Research-v3 batch: five selected cases, $0.7765 incremental model cost, under the $1 cap. Four fault cases caught early and expected breaches avoided; one no-fault control unnecessarily inspected (1/1 false positive). Three fault cases depend on simulated successful technician repair. This batch uses auto-simulated approvals and known regression seeds, not blind testing. The original 20-case report is preserved. Separate offline forecast calibration covered 12/14 held-out cases, below its 90% target; it is an uncertainty warning, not a safety guarantee.

### Documentation and live-only Lab cleanup (2026-11-05)

114 tests across 18 suites pass; typecheck and final production build pass. Browser verified the full compact architecture map at 1280×720, removed legend/header clutter, and the Lab with only scenario/seed and the real live-agent graph/log controls. No paid calls or human approvals were submitted for this change. README includes a portable screenshot in `docs/images/architecture.png` and a detailed guide in `docs/PROJECT-GUIDE.md`. Production server restarted with the updated build.
