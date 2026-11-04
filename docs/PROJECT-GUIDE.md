# Blindspot: detailed project guide

## 1. The problem we are investigating

A room can have many heat-producing devices but only a few sensors. A temperature sensor near Rack A does not directly observe Rack B's inlet, the second desk row or a small electrical connector. A connector can heat while room air remains unremarkable. A frozen sensor can also look reassuring precisely because it has stopped reporting change.

A simple threshold alarm asks whether a visible temperature has exceeded a number. Blindspot asks a different question: **what hidden condition could explain this combination of observations, what evidence should we inspect next, and which response is justified?**

The project is a reproducible experiment in decision support. The agent calls the real Muse API, but the room is a software physical model. It has not been tested on physical sensors or equipment. News incidents provide motivation, not evidence that the product would have prevented them.

## 2. The room and what the agent sees

The environment tracks Rack A, Rack B, desk rows 1 and 2, return air and a UPS/power-strip connector. Equipment generates heat; cooling removes heat; thermal coupling transfers heat between modeled zones. A seeded random generator varies parameters and sensor noise while preserving reproducibility.

Only five channels are visible:

- S1 measures Rack A inlet temperature.
- S2 measures desk row 1 air temperature.
- S3 measures cooling return air.
- M1 measures total UPS power.
- M2 measures Rack B strip voltage drop.

Rack B, desk row 2 and connector temperatures are hidden. The simulator knows these temperatures, but the agent does not receive them. They are used later to evaluate whether the agent's warning or action helped.

Each sample represents 30 seconds. A seed identifies a reproducible instance of a scenario, not a success rating or a model setting. The same kind and seed reproduce the underlying case, though real language-model choices can still differ.

Fault families cover AC capacity loss, a blocked vent, extra equipment load, increasing connector resistance, a stuck sensor, unattended cooling loss and a healthy control. Controls matter: a monitoring system that calls everything a fault can obtain high detection while wasting human attention.

## 3. How an investigation starts

Calling an LLM on every reading would be slow, costly and unnecessary. `TriggerMonitor` runs deterministic rules on the sensor stream. It calibrates initial offsets using healthy history and suppresses very early triggers. Its rules look for sustained disagreement with a nominal model, electrical contact signatures, suspiciously flat temperature readings and high estimates of hidden temperatures.

A trigger is an invitation to investigate, not proof of a fault. Muse must inspect the evidence rather than repeat the trigger as a conclusion.

The monitor schedules later investigations using cooldowns and changes in observed data. A different trigger cannot bypass the global cooldown. Unchanged frozen-sensor evidence should not repeatedly dispatch the same inspection. Changed readings or unresolved risk can justify a new investigation. At most six investigations run within the configured limits.

## 4. What Muse actually does

The agent loop is ordinary TypeScript around Chat Completions tool calls. It sends a system instruction, the available tools and the current evidence context to `muse-spark-1.3` through the Meta API. The OpenAI SDK supplies the HTTP client interface; it does not mean the underlying model is OpenAI.

Muse chooses which tools to call and with which validated arguments. It can issue independent evidence requests together. Tool results return as data, then Muse reasons about the next step. The implementation allows up to ten turns per invocation and withdraws tools on the final turn so the model summarizes rather than starting an unfinished action.

The desired behavior is to inspect reliability, form competing explanations, test a small number of responses, and propose a justified action. The prompt does not hand the model a scenario-specific script. Compact prior context includes earlier investigations and actions so a later invocation does not begin from nothing.

Wonder is configured escalation after repeated gate refusals. It is not called on every run. Token accounting includes reasoning tokens as output usage. Failed or empty responses, retry exhaustion and budget exhaustion are operational failures, not evidence of a safe room.

## 5. The evidence tools

`list_sensors` explains available channels. `get_reading` and `get_history` return observations up to the incident's current time. `sensor_metadata` supplies reliability information such as noise and flat-reading suspicion. A low or constant temperature is weak reassurance if the channel is untrustworthy.

`estimate_hidden_zones` applies a trained ridge regression to visible features. Ridge is a regularized linear estimator: it learns a mapping from sensor features to hidden temperatures from training scenarios. It is fast and useful as a cross-check, but it can be wrong when a fault differs from its training patterns. It is not Muse and it is not ground truth.

`diagnose` fits physical fault families to observed history using the nominal twin. Candidate explanations get relative weights. A high weight means a candidate explains the data better than the other modeled candidates; it does not establish a universally calibrated probability of danger. Adequacy checks expose a poor fit, and unreliable channels can be excluded.

Losing a channel can also remove coverage of a hidden zone. Diagnosis now reports this explicitly. “The trusted sensors are below the threshold” and “we still observe the relevant region adequately” are different claims.

## 6. The digital twin and action testing

The twin is a nominal copy of the physical equations with uncertain fault parameters. It predicts possible futures under competing explanations. It does not receive the real future trace. Muse uses `simulate_action` to compare interventions with doing nothing over a bounded horizon.

The connector model now considers both linear and accelerating resistance growth. Previously, an early accelerating fault could look too mild when only a linear ramp was fitted. Each shape is refined separately so the best linear candidate cannot eliminate the accelerating family before it is explored.

The twin and environment share model structure. That makes this a useful controlled experiment but an optimistic approximation of deployment, where unmodeled phenomena, sensor placement and physical parameters would differ more substantially.

An offline forecast-calibration artifact measures forecast residuals on separate scenarios. Its empirical allowance is broad and its independent coverage was 12 of 14 cases, below the intended 90% target. It is restricted to the untreated windows on which it was calibrated; a numerical allowance is not supplied after an intervention. It must not be treated as a guarantee or a reason to alert by itself.

## 7. Available interventions

The catalog intentionally stays small:

| Action | Intended modeled effect |
|---|---|
| `power_cap_rack` | Reduce a rack's heat-producing load within allowed fractions |
| `shed_noncritical_load` | Reduce modeled noncritical equipment load |
| `switch_backup_cooling` | Add cooling for the specified zone |
| `clear_vent` | Model a human clearing a blocked airflow path |
| `dispatch_human_check` | Model technician inspection and repair under the scenario's assumptions |
| `cut_power_circuit` | Disconnect circuit B under stricter last-resort conditions |

Inspection is not a magical real-world fix. Its successful modeled outcome depends on the simulator's repair behavior. A result dominated by inspections needs this qualification when compared with physical automation.

## 8. Why the gate is separate

A language model may misunderstand an observation, choose an invalid parameter or overstate confidence. `request_action` therefore calls deterministic code before the user sees an approval request.

The gate verifies catalog membership, bounded horizon, prior tests of distinct candidates including the requested action, repeated refusal rules, protected critical-load floors, inspection warrant, model adequacy, plausible hazard, improvement across plausible hypotheses, and absence of a new hazard. Some checks are action-specific; inspection is not evaluated identically to a power cut. Cutting power additionally requires imminent predicted breach and last-resort justification.

A refusal is an event containing reasons. Muse can revise its plan; it cannot edit the gate or declare the refusal irrelevant. Repeated refusals can trigger configured escalation or human escalation. A passing gate means the request meets these modeled rules, not that it is certified safe for real equipment.

## 9. What human approval means

A passing request changes the run to `needs_input`. An operator or admin sees the proposed action and can inspect its reason and gate summary. Approve and Reject are explicit decisions. Viewers cannot submit them.

The server validates the workspace, role, run and approval identifier. The client disables duplicate submissions and ignores stale polling replies so a previous response cannot restore an already-processed prompt. A rejected request does not apply an intervention. Each new passing request needs a fresh decision; the app does not infer permanent permission from an earlier approval.

Automated approvals exist for reproducible evaluation. They are labeled separately and are not evidence that a human reviewed those runs.

## 10. Monitoring after an action

One action may reduce harm without eliminating it. After an approved intervention, the monitor waits an observation interval, checks new sensor evidence and can wake Muse again. Forecasts account for previous approved interventions. The next action goes through the same gate and a new approval.

This distinction is visible in the original unattended-cooling recording: a breach happened later and above-limit exposure fell, but the breach was not prevented. Describing that run as “solved” would discard an important result.

## 11. Live UI, logs and replay

The Lab contains scenario selection, the live-agent workflow, and an independent sensor timeline with simulation playback, air/connector/electrical graphs, speeds and time scrubbing. The timeline shows the scenario without interventions; it does not depict the live agent’s applied actions. Starting a run calls the server; the event graph and logs update from the same recorded events.

The graph groups evidence collection, model work, diagnosis, action testing, gate, approval, application and completion. Selecting a stage filters its actual events. An animation on an active node is a status indicator, not a second reasoning engine. Earlier gate refusals and approvals remain visible during later investigations.

Polling runs sequentially with cancellation and request epochs. Starting a run or recording a decision invalidates stale responses. Navigation displays immediate pending feedback and avoids bulk authenticated prefetching that could crowd the database connection pool.

Replay provides the fine-grained trace and outcome charts after completion. The architecture animation is different: it is an explanatory walkthrough and makes no API calls.

## 12. Users, roles and database

Better Auth handles account sessions and organizations; an organization is a workspace. Drizzle defines the schema. Neon or ordinary Postgres is used when configured, otherwise PGlite supplies embedded local Postgres.

The database stores users, sessions, accounts, organizations, memberships and invitations, plus completed run JSON and accounting metadata. A completed run belongs to one workspace. Another workspace's run or live session is inaccessible even if its identifier is known.

Admins manage members and roles. Operators run and approve. Viewers read. Server routes enforce these permissions, and the last admin cannot be removed. Adding an existing account by email is implemented; production email invitation delivery and account-recovery hardening remain separate work.

Active run checkpoints and execution leases use local files rather than Postgres. Checkpoints preserve replies and decisions for recovery. If a paid request was interrupted and its billing is uncertain, recovery stops rather than silently making another charged request. Recovery assumes unchanged tool and environment code.

## 13. How results are calculated

Evaluation uses deterministic ground truth, not an LLM judge. It asks when an alert occurred relative to the first modeled limit breach, whether controls received alerts, and how the intervention branch differs from doing nothing on the same case.

Early detection and avoiding a breach are different metrics. An alert can be timely while the chosen action fails to prevent a later breach. Peak temperature, delay and above-limit exposure describe partial improvement. Cost, turns, tool calls and token usage describe how the model achieved the result, not its physical effectiveness.

The original Spark evaluation reused 20 benchmark cases: 18 had expected breaches, 15 were detected early, 12 were avoided, and neither control alerted. This is a small regression evaluation with automated approvals, not a fresh large-scale validation.

The research update deliberately selected four fault cases and one control. All four expected breaches were avoided, but the control received an unnecessary inspection. The small batch therefore shows improved handling of selected failures alongside a false-positive regression. It cannot replace the original benchmark or support a general 100% claim.

Historical rule-based benchmark results measure the deterministic policy over the tools. They are preserved for reproducibility but are not Muse scores. Estimator training seeds, calibration seeds and evaluation seeds serve different purposes; repeatedly tuning on a published evaluation makes later results regression evidence rather than a blind test.

## 14. What the presentation communicates

Slide 1 explains why costly incidents and sparse visibility deserve attention, using attributed photographs and preliminary reporting. Slide 2 shows the room, visible sensors and hidden zones. Slide 3 shows investigation, testing, review and outcomes with the original evaluation scope stated.

The Architecture tab expands this into a compact animated overview. Selectable nodes explain stack, model, function and boundary details without duplicating the diagram. The Room tab connects sensor identifiers to plausible physical placements. These are teaching tools, not evidence of installed hardware.

## 15. What remains

The largest technical uncertainty is generalization beyond this environment. Physical validation, fresh-seed testing, unmodeled faults, calibration under interventions and reducing unnecessary inspections matter more than extra visual polish. Deployment would additionally need production authentication, email delivery, operational persistence and hardware integration. Wokwi remains deferred.

The strongest accurate description is: **Blindspot demonstrates a live Muse agent investigating sparse, imperfect observations, testing responses, accepting deterministic constraints, requesting human decisions and leaving an auditable record.**
