<!-- cspell:words OpenRouter Gemini Mistral Qwen provenance memoization revalidation counterfactual dollarized idempotent idempotency ingress auths Cradle worktree evented dollarize reasking -->

# Reactor-Class Harnesses: A v0.1 Technical Report

Date: 2026-05-20

This report describes the current OpenProse Reactor worktree, not a future
launch claim. The current evidence supports a narrow but useful statement:
under deterministic Cradle scenarios, a Reactor runtime can maintain a
long-lived responsibility with runtime-produced receipts, reusable verdict
proof, forecast-paced rechecks, and explicit surprise attribution. It does not
yet support a public launch claim, hosted production operation, runtime
variable-depth ensemble judging, actual npm publication, or stranger
quickstart verification. Since the first report draft, the local release
surface has also become concrete: a packed-tarball flat-tokens example reads
runtime-produced receipts and reports `46:46`; the deterministic
`incident-briefing-room` CLI quickstart shows owner and public status
attribution with `surprise_cause=real-input`; and the `v*` tag gate is wired
to publish smoked Reactor and Cradle tarballs with provenance, though no npm
publication has been observed.

## 1. Problem

AI sessions are good at bounded bursts of work. They are much weaker at
responsibilities that stay alive after the session ends: "keep the incident
briefing current," "watch release readiness," "refresh compliance evidence,"
or "notice when a customer risk signal changes." In these cases the useful
unit is not a one-shot answer. It is a maintained state of the world, plus a
record of why the system checked, acted, slept, or asked for help.

The OpenProse promise is a lived loop: write durable intent, let bounded
activations inspect changing evidence, interrupt only when judgment or missing
input requires a human, and leave an exit trail that another agent can inspect.
That loop has a cost problem. A naive maintenance loop spends because time
passes. A useful maintenance harness should spend because something material
changed, while still paying an honest floor for forecast-paced plan audits.

The target is therefore not "agents with more memory" in the abstract. The
target is a harness that can maintain declared responsibilities through
durable state, bounded model calls, policy artifacts, receipts, projections,
and replay. Some interruptions are part of the design. If a contract has no
observable referent, or if a judgment has no anchor, the system should stop
and say so rather than hide uncertainty inside fluent prose.

## 2. Category

A Reactor-class harness is an evented reconciliation system for declared
responsibilities. A gateway or local trigger provides an event. A bounded
judge or fulfillment activation reads typed evidence and prior state. The
runtime records a receipt. A Reactor decision projects status and chooses one
of the next moves: act, retry, escalate, schedule another check, or go quiet.

The category differs from a normal agent loop in the question it asks. The
question is not "what should I do next?" It is "which reconciliation action is
justified by this responsibility, this event, these observations, and this
receipt trail?" That shift lets policy, cost, and audit become durable parts
of the system rather than session-local instincts.

OpenProse makes the category concrete with a model-authored policy artifact,
compiled to deterministic runtime state; content-addressed receipts; stable
memo keys; forecast-gated scheduling; projections for owner, subscriber, and
public readers; and exit bundles. Two recursions sit on top of the base loop:
policy changes over time, and responsibilities can compose over a graph by
consuming upstream receipts. In v0.1, the single-responsibility runtime spine
and local evidence are the demonstrated center. Broader graph behavior and
runtime ensemble depth remain designed or partially built.

## 3. Prior Patterns

The closest analogy is React reconciliation: a stable declaration is compared
with observed inputs, partial work is memoized, and a commit boundary controls
when the outside world changes. The analogy is structural, not literal. A
Reactor's "render" includes model judgment over ambiguous evidence, and its
output is not a DOM tree. Its output is a receipt-backed decision about a
responsibility.

Control systems contribute the time dimension: forecast, drift, hysteresis,
backstops, and revalidation floors. Kubernetes controllers, event sourcing,
dataflow systems, CQRS/read models, actor systems, and workflow engines are
also part of the lineage. The difference is that workflow engines usually
execute known steps, while a Reactor must decide which reconciliation step is
justified now when the world is partly ambiguous.

Cron remains the right tool for many deterministic jobs. Batch transforms and
one-shot writing tasks often do not need receipts or durable policy. The
Reactor shape matters when a changing world, uncertain evidence, cost, and
human interruption policy all need to be explicit.

## 4. OpenProse Design

OpenProse treats the responsibility as the program. The source contract names
the goal, evidence, freshness referents, memo-breaking conditions, plan-audit
horizon, observable criteria, and fulfillment boundary. Criteria that cannot
be observed are expected to produce blocked receipts routed to the author, not
hidden judgment inside prose. Source compile lowers `*.prose.md` into
repository IR when authored intent changes. Policy compile lowers the contract
plus receipt history into a token-free policy artifact when runtime evidence
shows the current policy needs revision.

Those are separate compiles. The `*.prose.md` contract remains the only
authored source of meaning. If a policy artifact or projection disagrees with
the contract, the contract wins; artifacts, receipts, forecasts, and
projections are derived sibling runtime state. Deterministic code validates,
schedules, records, and executes artifacts, but it does not author semantic
judgment. v0.1 demonstrates source compile, cold-start policy artifact
authorship, and local recompile/rollback substrate; recurring production
policy recompile remains future work.

Quiescence has three meanings. First, do not act when the maintained state is
already up to date. Second, do not check now when the forecast says the next
audit is not due. Third, do not check deeply when shallow evidence and
calibration justify a cheaper path. v0.1 demonstrates the first two local
paths and the single shallow judge path. Variable-depth runtime judging is a
designed part of the architecture, but not a v0.1 runtime claim.

Memoization depends on stable identity. The runtime can reuse verdict work
when the contract revision, evidence receipts, dependency receipts, and policy
namespace still justify reuse. The cost claim is therefore not "zero cost on a
static world." The honest claim is: cost scales with surprise plus a
forecast-amortized plan-audit floor.

Receipts are the trust unit. They carry `as_of`, contract and policy identity,
evidence references, verdict, token accounting, surprise cause, forecast
handoff, dependency pins, and projection-safe data. The same receipt trail
supports audit, replay, composition, privacy projection, and exit.

## 5. Implementation

The current implementation has four cooperating surfaces:

- `@openprose/reactor`: the runtime spine, receipt schema, policy artifact
  validation, memoization, forecast, evidence plans, composition,
  projection, adapters, shallow judge, and exit/import support.
- `@openprose/reactor-cradle`: deterministic worlds, doubles, replay,
  baselines, K1/K2 spikes, release-parity fixtures, and measurement harnesses.
- The migrated OpenProse CLI path: local `prose compile`, `prose serve`, and
  `prose status` evidence for bundled examples through Reactor receipts.
- The local release surface: a packed-tarball flat-tokens example, a
  deterministic CLI quickstart, and a `v*` tag workflow that downloads the
  exact smoked Reactor and Cradle tarballs and runs provenance-enabled
  `npm publish` for those tarballs.

| Surface | v0.1 demonstrated | Not claimed |
| --- | --- | --- |
| Runtime spine | receipt v0, kernel backstops, policy artifact validation, memoization, forecast, evidence plans, composition pins, projections, export/import, cold-start authorship, and local recompile/rollback substrate | production gateway, production fulfillment, or production oracle |
| Judgment | shallow runtime judge with adapter-owned usage metadata, plus K1 live-cassette evaluator evidence | runtime ensemble depth, live provider matrix, or production calibration service |
| CLI path | local source compile, serve, status, forwarded fulfillment artifacts, crash-window replay, duplicate-trigger dedupe, and projection-tier leak tests | hosted production operation or real external side effects |
| Storage/adapters | memory, filesystem, record-replay model gateway, local connector, and event-sink adapters | Postgres parity or signer support |
| Release surface | packed-tarball flat-tokens smoke, deterministic `incident-briefing-room` quickstart, and tag-gated provenance publish workflow | public npm availability, stranger run, or production operation |

Cradle is the measurement rig, not a production dependency.
Production-equivalent ingress would authenticate external events, normalize
event identities, dedupe and replay event claims, enforce source-specific
budgets, and hand only typed events and evidence to Reactor.
Production-equivalent fulfillment would own idempotent dispatch, retries,
budgets, external side effects, durable claims, and operator-visible failure
states. Production-equivalent oracle support would expose explicit truth and
evidence sockets for evaluation and operations without smuggling ambient
knowledge into the runtime. v0.1 has local CLI trigger/serve evidence,
forwarded fulfillment artifacts, deterministic Cradle worlds, and one live K1
cassette instead of those production layers.

Postgres parity is deferred because the storage adapter v0 is synchronous
while real Postgres IO is async. Signer support is honestly deferred: v0.1
normalizes omitted signers to
`{scheme:"none", null_reason:"no-signer-adapter-configured"}`, and non-null
receipt signatures fail closed rather than implying cryptographic support.

## 6. Evaluation Methodology

Phase C measures two controlled scenarios:
`incident-briefing-static-zero` and
`incident-briefing-periodic-surprise`. Each scenario compares three rows:

- Reactor runtime-produced receipts.
- A deterministic no-memo Reactor control over the same scenario schedule and
  token charges.
- A non-Reactor naive loop control that rechecks on the same schedule without
  receipts, memo keys, forecast policy, or reusable verdict proof.

The core metrics are receipt count, model invocation count, fresh tokens,
reused tokens, and surprise attribution. `tokens.fresh` is fresh model work.
`tokens.reused` is accounted reusable work, not new model spend. The no-memo
control isolates the value of memoization and forecast reuse. The naive loop
control approximates a fixed cron/prompt maintenance loop.

The event-changing controls are deterministic counterfactual controls over
the same four-turn schedule. They are not shipped runtime flags or live
production ablations. The measured rows use local deterministic Cradle
providers and recorded token accounting, so this report does not dollarize the
results.

K1 is evaluated separately. One OpenRouter live-recorded ensemble cassette
captures outputs from multiple provider/model families and records request
ids, response ids, latency, finish reason, usage, and spend. It proves the K1
evaluator and metadata path against a live cassette. It does not prove runtime
ensemble judging or a full provider matrix.

## 7. Results

The result table below is copied from the Phase C result table at
`../planning/plans/2026-05-19-reactor-runtime-wave/phases/C-baseline-and-second-adapter/results/cost-thesis-baseline.md`.
During Phase D this report cites local worktree evidence; before publication,
the K1 cassette and result artifacts must be included in, or linked from, a
public release artifact.

| Scenario | Row | Provenance | Receipts | Model invocations | Fresh tokens | Reused tokens | Source |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| Static `incident-briefing-static-zero` | Reactor | runtime-produced | 4 | 2 | 46 | 46 | Phase C result table |
| Static `incident-briefing-static-zero` | Reactor no memo | deterministic control | 4 | 4 | 92 | 0 | Phase C result table |
| Static `incident-briefing-static-zero` | Naive loop | non-Reactor control | 0 | 4 | 256 | 0 | Phase C result table |
| Event-changing `incident-briefing-periodic-surprise` | Reactor | runtime-produced | 4 | 2 | 74 | 74 | Phase C result table |
| Event-changing `incident-briefing-periodic-surprise` | Reactor no memo | deterministic control | 4 | 4 | 148 | 0 | Phase C result table |
| Event-changing `incident-briefing-periodic-surprise` | Naive loop | non-Reactor control | 0 | 4 | 148 | 0 | Phase C result table |

In the static scenario, Reactor uses 2 model invocations and 46 fresh tokens,
compared with 4 invocations and 92 fresh tokens for the no-memo control, and
4 invocations and 256 fresh tokens for the naive loop. In the event-changing
scenario, Reactor uses 2 model invocations and 74 fresh tokens, compared with
4 invocations and 148 fresh tokens for both controls. The event-changing win is
fresh model work plus reusable-verdict proof, not a total accounted-token
claim over the no-memo control.

On the static scenario, Reactor performs fresh model work at bootstrap and at
the plan-age audit, while evidence-age rechecks hit memoized verdicts. The
per-turn audit in the Phase C table records fresh/reused work as `41/0`,
`0/41`, `5/0`, and `0/5`.

On the event-changing scenario, the material surprise is an `incident-opened`
event at `2026-05-18T12:30:00.000Z`, which changes the evidence hash to
`sha256:a890c5e45abb3e746857db1ca9f79905c17f4f769fbe273446fe186e5787aeb8`
in the Phase C result table. The Reactor row spends fresh work on bootstrap
and on that material change, then reuses verdict work on evidence-age
rechecks. The controls re-spend on the same schedule.

Supporting evidence:

| Evidence | Observed | Boundary |
| --- | --- | --- |
| B5 live K1 cassette at `../../prose-reactor-build/packages/reactor-cradle/src/spikes/fixtures/k1-live-recorded.json` | SHA-256 `f64484990635a61a3dcac973a96e97d6433a576ccc297c23742d4a515e2c1868`; OpenRouter run with `output_count = 3` across Google/Gemini, Mistral, and Qwen; `0.00022823 USD` spend under the `2.00 USD` cap; for this authored-anchor cassette, the evaluator returned status `calibrated` and `calibrated_confidence = 1` | evaluator and metadata evidence, not a runtime ensemble, production calibration bar, or general accuracy result |
| Recorded provider parity | two recorded provider/model paths produce byte-identical policy artifact bytes from the same contract/history, and provider drift fails closed | recorded policy-artifact parity, not live provider support or model quality parity |
| Phase E CLI acceptance at `../planning/plans/2026-05-19-reactor-runtime-wave/phases/E-cli-migration/SIGNPOST.md` | five bundled examples compile from source, run spawned `prose serve`, ingest triggers through Reactor, write forwarded fulfillment artifacts, and render `prose status` with `surprise_cause=real-input`; crash-window restart and duplicate-trigger dedupe are scripted; projection tiers are leak-tested | local deterministic CLI evidence, not hosted production operation, live-model fulfillment content, npm launch, or stranger quickstart |
| Phase F flat-tokens packed-tarball example | installs from packed Reactor and Cradle tarballs, drives four static-world turns through `createReactor().ingest()`, reads the produced receipts, and prints `tokens.fresh = 46`, `tokens.reused = 46`, `tokens.ratio = "46:46"`, `runtime.receipt_count = 4`, and `runtime.model_invocation_count = 2` | local packed-tarball smoke, not public npm install, stranger run, production economics, or a new runtime claim beyond the Phase C receipt evidence |
| Phase F `incident-briefing-room` quickstart | documents local `prose compile src --harness mock`, manifest activation, deterministic `prose serve`, POST `/incident/events`, `prose status --tier=owner`, and `prose status --tier=public`; the status surface attributes owner and public state with `surprise_cause=real-input` | local deterministic CLI quickstart, not hosted ingress, live-model fulfillment content, public npm launch, or stranger verification |
| Phase F `v*` publish gate | on `refs/tags/v*`, the workflow waits for CI, downloads the exact smoked package tarballs, and runs `npm publish <tarball> --access public --provenance` for both Reactor and Cradle | workflow path only; actual npm publication and registry-visible provenance attestation remain unobserved |

The Phase C result table's `## Reproduce` section records the sharpest local
commands: `pnpm --filter @openprose/reactor-cradle test` and
`pnpm --filter @openprose/reactor test` from `/Users/sl/code/prose-reactor-build`.
The Phase F local release signpost adds the tarball smoke and CLI quickstart
checks that turn the same numbers into a release-surface exercise without
claiming publication.

## 8. Case Study: Incident Briefing Room

The Incident Briefing Room is the clearest example because its world changes
over time. The maintained state is not "write a report." It is "the incident
channel has an accurate current briefing." Its continuity rule says to recheck
on incident messages, status-page changes, and while the incident is active.
Its criteria include impact, timeline, owner, next action, and
customer-facing status. Its fulfillment boundary is to summarize new facts,
ask for missing owner input, and update the briefing.

One deterministic Cradle receipt trail shows the shape:

| Beat | Cause | Evidence note | Fresh/reused | Decision shape | User-visible result |
| --- | --- | --- | ---: | --- | --- |
| `2026-05-18T12:00:00.000Z` | `real-input` | initial incident feed | `37/0` | fresh judge receipt | baseline briefing state recorded |
| `2026-05-18T12:15:00.000Z` | `forecast-recheck` / `evidence-age` | evidence unchanged | `0/37` | memo-hit receipt | no material change; next recheck remains visible |
| `2026-05-18T12:30:00.000Z` | `real-input` | `incident-opened`; evidence hash `sha256:a890c5e45abb3e746857db1ca9f79905c17f4f769fbe273446fe186e5787aeb8` | `37/0` | fresh judge receipt | briefing changes because an incident opened |
| `2026-05-18T12:45:00.000Z` | `forecast-recheck` / `evidence-age` | changed evidence unchanged since prior turn | `0/37` | memo-hit receipt | updated verdict is reused instead of asking again |

The quiet-world static run has the same proof shape with one extra plan-age
audit floor: bootstrap fresh, evidence-age memo hit, plan-age audit fresh
floor, and final evidence-age memo hit. That is not free; it is lower fresh
model work than reasking on every scheduled turn.

Phase F uses this same responsibility as the local CLI quickstart. The
observed sequence is intentionally plain: compile the bundled source, activate
the manifest, run deterministic `prose serve`, POST an incident event, then
compare `prose status --tier=owner` and `prose status --tier=public`. The
useful observation is owner/public status attribution with
`surprise_cause=real-input` on a local receipt trail, not a hosted incident
system.

The case study stays deliberately local. The CLI can write forwarded
fulfillment artifacts for bundled examples, but this report does not claim a
production incident system updating real customer communications.

## 9. Limitations

The main runtime layers still deferred from v0.1 are production-equivalent
gateway, fulfillment, and oracle support. The current worktree proves local
trigger/serve behavior, forwarded fulfillment artifacts, and deterministic
Cradle worlds. It does not prove hosted event ingress, real external
actuation, or a production truth socket.

Judgment is also deliberately scoped. Runtime judging is shallow in v0.1.
Variable-depth ensemble judging, live provider matrix runs, calibration
cadence, degraded-calibration ladder steps 2-4b, and the accrued-anchor
calibration exit bar remain future work. K1 is live-recorded evaluator
evidence, not a production calibration service.

Infrastructure launch work remains. The packages have version and provenance
settings, local tarball and parity evidence, a flat-tokens packed-tarball
example that reports `46:46`, and a `v*` tag gate that would publish the exact
smoked Reactor and Cradle tarballs with provenance. Public npm publication is
still not observed in this report. Stranger quickstart verification is not
observed. Postgres parity is deferred under the async storage seam. A concrete
signer adapter is deferred; null-signer remains the only honest v0.1 receipt
signature state.

The domain boundaries matter. Some responsibilities have no cheap complete
hash for "semantically relevant content changed." In those domains the system
can remain safe, but the cost differentiator weakens toward forecast-cadence
cost. Some responsibilities have no correctness anchor. Those stay in bounded
degraded calibration unless and until human labels or observed outcomes can
support stronger calibration. Prompt sensitivity, adversarial or silent drift,
public receipt maturity, and human review quality all need larger evaluation.

The plan-revalidation tax is not a bug. It is the cost of not letting a stale
plan become quietly wrong. The cost thesis is surprise plus a
forecast-amortized audit floor, not surprise alone.

## 10. Future Work

The closest category-completing work is production-equivalent ingress,
fulfillment, and oracle adapters. Those layers would let the same receipt
logic operate against authenticated event sources, idempotent external side
effects, and explicit truth/evidence sockets rather than local deterministic
worlds.

The next judgment work is runtime variable-depth ensemble judging: shallow
checks by default, deeper or more diverse judging when uncertainty or policy
requires it, and a calibration cadence that records why depth changed. That
work includes degraded-calibration ladder steps 2-4b and an accrued-anchor
exit bar for responsibilities that start without labels.

The policy loop should continue toward richer recurring recompile and rollback
behavior against recorded artifacts, wider receipt-graph composition case
studies, stronger transitive freshness semantics, and learned forecast
policies. The storage layer should gain async parity rows, including Postgres,
once the adapter seam supports real async IO.

The release work is concrete: run the `v*` tag publish gate under npm auth or
trusted publishing, verify `@openprose/reactor` and
`@openprose/reactor-cradle` in the public registry with provenance, pin the CLI
to the public package, publish this report from measured evidence, and run a
stranger quickstart where the observed token ratio matches the report within
tolerance.

Longer term, the policy author can migrate into a first-class OpenProse
`kind: responsibility` once the Prose VM path is proven. That should not add a
second intent surface. The goal remains one durable responsibility, one
inspectable evidence graph, and one receipt trail that lets future agents know
what happened and why.
