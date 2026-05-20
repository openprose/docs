<!-- cspell:words OpenRouter Gemini Mistral Qwen provenance memoization revalidation counterfactual dollarized idempotent idempotency ingress auths Cradle worktree evented dollarize reasking -->

# Reactor-Class Harnesses: A v0.1 Technical Report

Date: 2026-05-20

This report describes the current OpenProse Reactor worktree, not a future
launch claim. The current evidence supports a narrow but useful statement:
under deterministic Cradle scenarios, a Reactor runtime can maintain a
long-lived responsibility with runtime-produced receipts, reusable verdict
proof, forecast-paced rechecks, and explicit surprise attribution. It does not
yet support a public launch claim, hosted production operation, runtime
variable-depth ensemble judging, npm provenance publication, or stranger
quickstart verification.

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
the goal, evidence, cadence, criteria, and fulfillment boundary. Source
compile lowers `*.prose.md` into repository IR when authored intent changes.
Policy compile lowers the contract plus receipt history into a token-free
policy artifact when runtime evidence shows the current policy needs revision.
Those are separate compiles: source-derived language state is not the same
thing as Reactor runtime state.

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

The current implementation has three cooperating surfaces:

- `@openprose/reactor`: the runtime spine, receipt schema, policy artifact
  validation, memoization, forecast, evidence plans, composition,
  projection, adapters, shallow judge, and exit/import support.
- `@openprose/reactor-cradle`: deterministic worlds, doubles, replay,
  baselines, K1/K2 spikes, release-parity fixtures, and measurement harnesses.
- The migrated OpenProse CLI path: local `prose compile`, `prose serve`, and
  `prose status` evidence for bundled examples through Reactor receipts.

The built Reactor rows include receipt v0, kernel backstops, policy artifact
v0, forecast rechecks, evidence-plan validation, memo-hit receipts,
composition pins, model-authored transitive freshness under a kernel floor,
owner/subscriber/public projection, filesystem and memory storage adapters,
record-replay model gateway adapters, local connector and event-sink adapters,
runtime export/import, cold-start policy authorship, policy recompile and
rollback substrate, and a shallow judge that requires adapter-owned usage
metadata for token truth.

The judge scope is intentionally narrow. v0.1 runtime judging is shallow and
uses `calibration_grade: "none"` where appropriate. The K1 work proves that an
offline evaluator can score a live-recorded ensemble cassette with real
provider metadata. It does not mean the runtime is yet running a live ensemble
or selecting variable depth per turn.

The local CLI evidence is release-quality for a local path, not a production
host. Five bundled examples compile real `.prose.md` source, serve triggers
through Reactor, show per-token surprise attribution in status, and write
forwarded fulfillment artifacts. The path preserves crash-window replay,
duplicate-trigger dedupe, and projection-tier leak tests. It still uses local
deterministic adapters and forwarded fulfillment artifacts rather than hosted
production ingress or real external side effects.

Production-equivalent ingress would authenticate external events, normalize
event identities, dedupe and replay event claims, enforce source-specific
budgets, and hand only typed events and evidence to Reactor. v0.1 has local
CLI trigger and serve evidence, not a hosted gateway layer.

Production-equivalent fulfillment would own idempotent dispatch, retries,
budgets, external side effects, durable claims, and operator-visible failure
states. v0.1 writes forwarded fulfillment artifacts through the local CLI
path, not production actuation.

Production-equivalent oracle support would expose explicit truth and evidence
sockets for evaluation and operations without smuggling ambient knowledge into
the runtime. v0.1 uses deterministic Cradle worlds plus one live K1 cassette,
not a production oracle service.

Postgres parity is deferred because the storage adapter v0 is synchronous
while real Postgres IO is async. Signer support remains a Phase F binary
decision: ship one concrete signer adapter or make null-signer the only clean
non-throwing v0.1 state.

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

| Scenario | Row | Provenance | Receipts | Model invocations | Fresh tokens | Reused tokens | Source |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| Static `incident-briefing-static-zero` | Reactor | runtime-produced | 4 | 2 | 46 | 46 | Phase C result table |
| Static `incident-briefing-static-zero` | Reactor no memo | deterministic control | 4 | 4 | 72 | 0 | Phase C result table |
| Static `incident-briefing-static-zero` | Naive loop | non-Reactor control | 0 | 4 | 256 | 0 | Phase C result table |
| Event-changing `incident-briefing-periodic-surprise` | Reactor | runtime-produced | 4 | 2 | 74 | 74 | Phase C result table |
| Event-changing `incident-briefing-periodic-surprise` | Reactor no memo | deterministic control | 4 | 4 | 148 | 0 | Phase C result table |
| Event-changing `incident-briefing-periodic-surprise` | Naive loop | non-Reactor control | 0 | 4 | 148 | 0 | Phase C result table |

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

The B5 live K1 cassette is
`../../prose-reactor-build/packages/reactor-cradle/src/spikes/fixtures/k1-live-recorded.json`.
Its SHA-256 digest is
`f64484990635a61a3dcac973a96e97d6433a576ccc297c23742d4a515e2c1868`.
The cassette records an OpenRouter run started at
`2026-05-20T17:55:02.467Z` and completed at
`2026-05-20T17:55:10.106Z`, with a `2.00 USD` cap and `0.00022823 USD`
actual spend. It includes Google/Gemini
`google/gemini-3.1-flash-lite-preview`, Mistral
`mistralai/mistral-small-3.2-24b-instruct`, and Qwen
`qwen/qwen-2.5-72b-instruct` outputs, with real request ids, response ids,
latencies, finish reasons, usage, and spend metadata.
The K1 evaluator accepts that fixture with `output_count = 3`, diversity
floor met across those families/providers, `issue_count = 0`, and
`calibrated_confidence = 1`.

Recorded provider parity is also part of the accepted Phase C evidence. Two
recorded provider/model paths produce byte-identical policy artifact bytes
from the same contract and history, and provider drift fails closed. This is
recorded policy-artifact parity, not live provider support or model quality
parity.

The Phase E CLI evidence is local but important. Five bundled examples compile
from source, start spawned `prose serve`, ingest triggers through Reactor,
write forwarded fulfillment artifacts, and render `prose status` with provider
and model labels plus `surprise_cause=real-input`, fresh token counts, reused
token counts, and receipt-derived pressure. Crash-window restart converges
from durable pressure within one cycle, duplicate triggers in one cycle
produce exactly one dispatch, and public/subscriber projections do not leak
owner-only secret-shaped receipt material.

## 8. Case Study: Incident Briefing Room

The Incident Briefing Room is the clearest example because its world changes
over time. The maintained state is not "write a report." It is "the incident
channel has an accurate current briefing." Its continuity rule says to recheck
on incident messages, status-page changes, and while the incident is active.
Its criteria include impact, timeline, owner, next action, and
customer-facing status. Its fulfillment boundary is to summarize new facts,
ask for missing owner input, and update the briefing.

In the static scenario, the first receipt pays fresh work to inspect evidence
and record the current briefing state. The next evidence-age recheck reuses
the prior verdict because the evidence identity has not changed. A later
plan-age audit pays a small fresh floor to make sure the compiled evidence
plan itself is still adequate. A final evidence-age recheck again reuses
work. That is the quiet-world shape: not free, but much cheaper than reasking
the whole question on every clock tick.

In the event-changing scenario, the world introduces an `incident-opened`
event. The evidence hash changes, so the Reactor spends fresh work and records
the new state. The following evidence-age recheck can reuse that updated
verdict. The user-visible projection can show the current status, why it
changed, the next forecast recheck, and the receipt trail supporting it.

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
settings, local tarball and parity evidence, and release-floor surface, but
public npm publication is not observed in this report. Stranger quickstart
verification is not observed. Postgres parity is deferred under the async
storage seam. The signer adapter decision remains open for Phase F.

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

The release work is concrete: publish `@openprose/reactor` and
`@openprose/reactor-cradle` with provenance, pin the CLI to the public package,
publish this report from measured evidence, and run a stranger quickstart
where the observed token ratio matches the report within tolerance.

Longer term, the policy author can migrate into a first-class OpenProse
`kind: responsibility` once the Prose VM path is proven. That should not add a
second intent surface. The goal remains one durable responsibility, one
inspectable evidence graph, and one receipt trail that lets future agents know
what happened and why.
