# Deployment

## Validated release controller

The controller uses Node, the installed AWS CLI, and the installed `tsx` HTTP
checker. Run it only from a trusted main workflow with authenticated GitHub
run/check evidence and protected environment configuration. Candidate JSON cannot
authorize its own producer, source, checks, contract, routing, or destination.

```sh
node scripts/release/cli.mjs validate --input trusted.json
node scripts/release/cli.mjs render --input trusted.json --output task.json
node scripts/release/cli.mjs deploy --input trusted.json --output private-evidence
node scripts/release/cli.mjs rollback --input trusted.json --output private-evidence
node scripts/release/cli.mjs notify --input trusted.json --receipt private-evidence/receipt.json
```

`validate` downloads and validates exact versioned objects; it does not certify
application health. `render` writes a private task definition. `deploy` registers
that definition, changes only the service task pointer, verifies the primary and
running revision/digest/count, then checks the HTTP surface. `rollback` requires
pinned evidence for a previously verified retained image and registers that image
with the **current** contract template. It uses the same validation and checks.
`notify` retries a deployment summary without changing application state.

The trusted input rejects unknown fields. Its required fields are:

| Field | Value |
| --- | --- |
| `bucket` | Private versioned evidence bucket, from protected configuration |
| `contract` | `{key, versionId, sha256}` for `contracts/<environment>/current.json` |
| `manifest` | `{key, versionId, sha256}` for `builds/<producer-run>/<producer-attempt>/manifest.json` |
| `evidence` | `{environment, repositoryUrl, sourceSha, producer, checks}` from authenticated reads |
| `evidence.producer` | `{repository, workflowRef, runId, runAttempt}`; IDs are decimal strings and workflow ref ends in `@refs/heads/main` |
| `evidence.checks` | `{runId, conclusion: "success"}` for independently authenticated source checks |
| `release` | `{runId, runAttempt}` of the **current release workflow**, as decimal strings |
| `probeConnectHost` | ALB DNS name from approved infrastructure output; exactly `*.us-east-1.elb.amazonaws.com`, without URL, port, credentials or IP literal |
| `concurrencyGroup` | `docs-staging` or `docs-production`, matching the workflow's actual environment lock |

Verify repository identity, trusted build workflow identity, main branch, source
SHA, run attempt and successful completion through authenticated GitHub reads.
Verify the source-check workflow/run against that exact SHA separately. Supply
these independently obtained values in `evidence`; do not copy them from an
untrusted manifest. Obtain exact S3 object versions and SHA-256 hashes from
approved outputs and authenticated reads. Hashes refer to the original bytes.
The controller does not perform GitHub authentication itself.

Additional trusted fields, required for the operations indicated:

- `previousReceipt`: exact `{key, versionId, sha256}` for the current service's
  last verified receipt. Required before ordinary promotion. It must identify
  the observed revision and digest with successful checks. Historical contract
  references are accepted as evidence; compatibility is checked before automatic
  recovery from a failed promotion.
- `observedTaskArn`: actual active task-definition ARN from an authenticated
  service read, required by `rollback`. The controller rechecks this pointer
  before updating the service; the starting revision need not be healthy or
  have a verified receipt. Rollback does not consume `previousReceipt`.
- `stagingReceipt`: exact reference under `receipts/staging/<run>/<attempt>.json`.
  Required for production deployment and verification; it must verify the exact
  manifest version/hash, source SHA and staging digest.
- `rollbackReceipt`: exact reference under the target environment's receipt
  prefix, required by `rollback`. It must verify the selected manifest and image.
- `alertsTopicArn`: approved production recovery-alerts topic, required for
  production except registration-only bootstrap. The deployments topic comes
  from the validated contract.
- `timeoutSeconds`: ECS verification deadline, 1–1800, default 600.
- `pollIntervalMs`: polling delay, 1–30000, default 5000.
- `registerOnly: true`: explicit bootstrap registration; creates no service update
  and requires no deployed staging proof. Its private record has
  `schemaVersion: 1, kind: "registration"`, environment, manifest/contract refs,
  source SHA, requested task ARN, checks and timestamp. It has no deployment
  `result` or observed revision, and is rejected as deployment evidence.
- `verifyOnly: true`: `deploy` observes an already activated bootstrap revision,
  confirms its full current template and candidate image, and runs ECS/HTTP
  checks without registration or service update. It creates the first verified
  receipt and requires no `previousReceipt`. It cannot combine with
  `registerOnly` or be used with `rollback`. Verify staging before production.

The ALB target changes DNS lookup only. HTTP Host, TLS server name, certificate
verification and the contract probe URL remain intact, including before public
DNS changes. Never substitute a candidate-provided origin or disable TLS checks.
Staging uses preview checks; production uses public checks.

All deployment, rollback and verification jobs must share the same environment
concurrency group with cancellation disabled. Pause releases during any apply
that changes contracts. The controller re-fetches the current contract's version
and hash immediately before each ECS mutation and after verification. AWS offers
no compare-and-swap for this service update: the workflow lock and coordinated
pause are required to close the remaining check/update race.

A failed promotion always exits nonzero, including after successful recovery.
Automatic recovery applies to promotion and can restore only this attempt's
service revision, without an intervening update, and only if the previously
verified task is compatible with the current template. Recovery requires both
ECS and HTTP checks. Otherwise it
fails and requests operator attention; production failures also use the approved
alerts topic. An incompatible historical task must be recovered through an
explicit rollback using the current template. A failed explicit rollback does
not automatically restore its starting revision.

Private receipts are written once to
`receipts/<environment>/<current-release-run>/<current-release-attempt>.json`
using a conditional S3 write. They retain failure and recovery checks and honest
nullable observation fields. Delivery failures do not rewrite application
health, but fail CI. Keep `private-evidence/receipt.json` as a private artifact
when S3 persistence fails. A fresh verification run can establish a new receipt
after delivery is repaired. Keep task definitions and evidence private; console
output intentionally omits infrastructure identifiers and raw AWS errors.

Select previous receipts through authenticated release-run records or explicit
operator-supplied references and exact S3 reads. The controller neither lists S3
nor maintains a mutable current-release pointer. Bootstrap registration and
subsequent verification use different workflow runs/attempts so their immutable
keys cannot collide.

The reusable interface exports `loadCandidate`, `runRelease`, `notifyReceipt`
and `createAws` from `scripts/release/controller.mjs`, pure contract helpers from
`contract.mjs`, ECS checks from `ecs.mjs`, and custom AWS notification formatting
from `notify.mjs`. `runRelease(command, input, {outputDir})` returns
`{exitCode, receipt, registration, registeredOnly}`; registration-only returns a
null receipt. Dependency injection permits offline AWS response fixtures.

Run controller checks with `node --test scripts/release/*.test.mjs` and the HTTP
fixture tests with `pnpm exec vitest run __tests__/http-surface.test.ts`.

## Workflow setup and enablement

Pull requests retain the required `verify` check, including the informational
production dependency audit, source checks, release tests, and standalone HTTP
smoke checks in public and preview modes. They receive no cloud write credentials.
Trusted main builds call those same checks against their exact source, build both
Linux/amd64 images, run the HTTP surface checks against each actual container,
then publish immutable image digests and a private versioned manifest. The build
uses the pinned Docker base and pnpm version, bypassing the model-backed build
preparation hook. Production retains the current and legacy analytics inputs; preview has
production analytics disabled. The manifest records source/run/attempt identity,
base image, lockfile and configuration fingerprints.

Merging these workflows stops automatic Fly releases. It does not stop or change
the running Fly service, DNS, any AWS service or GitHub configuration. Automated
AWS build/staging jobs remain disabled when the repository variable
`DOCS_AWS_ENABLED` is absent or differs from the exact string `true`. Manual
trusted-main build and bootstrap are deliberately available before enablement.
Do not enable automatic delivery before bootstrap verification is complete.

An administrator must first configure these controls; their presence is not
established by the workflow files:

- Preserve strict main protection with required Actions check `verify`. Require
  reviewed changes to workflow files, release scripts, build configuration and
  deployment contracts before trusting main for cloud access. Existing protection
  alone does not establish a human review requirement.
- Create `docs-staging` and `docs-production` deployment environments, both
  restricted to protected main. Configure production required reviewers as the
  authorized maintainers, prevent self-approval, and disable protection bypass
  where supported. Both promotion and rollback require this approval.
- Set repository secret `DOCS_BUILD_ROLE_ARN` to the approved main-only build role.
  Set environment secret `DOCS_RELEASE_ROLE_ARN` separately in each environment
  to its approved environment-only role. Set repository secret `DOCS_ROLE_ID` to
  the build role's IAM unique role ID, and override it in each environment with
  that release role's ID. The owner obtains these privately from IAM role metadata
  during setup; the runner receives no extra IAM read permission. Preflight rejects
  a missing/malformed ID and masks it before the official credentials action can
  log its assumed-role identity. Never publish these identifiers. OIDC trust must match the repository,
  main ref for builds and exact environment names for release roles.
- Set repository and environment secret `DOCS_RELEASE_CONFIG` to approved private
  configuration described below. Release environments must have their own copy;
  the build needs both contract references. Retain the existing
  `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN` and
  `FLY_API_TOKEN` secrets. No new production analytics destination is inferred.
- Leave repository variable `DOCS_AWS_ENABLED` unset until the ordered bootstrap
  below succeeds. Set it to `true` only for the explicitly approved release
  transition. Unset it to pause automatic build/staging and manual normal
  promotion/rollback during maintenance; explicit bootstrap/verification remains
  available to maintainers and still requires environment approval.

`DOCS_RELEASE_CONFIG` is JSON with fields `bucket`, `contracts`,
`probeConnectHost` and `alertsTopicArn`. `contracts` maps `staging` and
`production` to the exact approved `{key, versionId, sha256}` references for
`contracts/<environment>/current.json`. `bucket` names the private versioned
bucket; `probeConnectHost` is the approved ALB DNS connection target; production
requires the approved recovery-alert topic `alertsTopicArn`. Obtain these values
from approved infrastructure outputs through a private operator handoff. Do not
paste infrastructure outputs into workflow inputs, public comments or logs.
Update protected configuration after a contract change while release activity
is paused. A mismatched current contract fails closed. Release roles need only
their existing exact-prefix reads/writes and ECS/ECR/SNS permissions; no Terraform
state access, S3 listing, deletion, mutable pointer or contract write is used.

Release jobs read protected configuration **after** environment approval, then
re-authenticate the successful build's repository, workflow, main source, run and
attempt plus independently completed exact-source `verify` job through the GitHub
API. They pin the original manifest bytes to an S3 version and hash. Production
also requires a successful staging receipt for that exact manifest/source/digest
and the current approved staging contract. A supplied producer ID alone is never
proof. All operational references are derived privately, with no public outputs
or uploaded Actions artifacts; public summaries contain source SHA and run URLs.
Private runner diagnostics and receipts are ephemeral on hosted runners. S3
persistence failure makes the run fail; repair delivery and run fresh verification
to establish new immutable evidence rather than relying on hosted-runner files.

## Bootstrap without changing public DNS

1. Provision contracts, repositories and OIDC roles with services disabled. Keep
   the public origin on Fly. Configure the environments and secrets above.
2. Dispatch **Build retained Docs images** on protected main. It reruns source
   checks and retains both tested images. Record its run ID and successful
   attempt. No service is updated.
3. Dispatch **Bootstrap Docs service** on protected main with environment
   `staging`, operation `register`, and that producer run/attempt. Repeat for
   `production`, obtaining the required production approval. Each run only
   registers an immutable task revision and saves a private registration result;
   it cannot announce a successful deployment. Production registration requires
   no staging deployment receipt, because no service exists yet. Retrieve the
   registration result and exact task revision through the private infrastructure
   operator channel; never paste it into a public workflow summary.
4. The operator explicitly enables each service using its registered bootstrap
   revision in the next infrastructure apply. Keep public DNS on Fly.
5. Dispatch bootstrap operation `verify` in a **new run** for staging. It observes
   the activated revision/template/digest/count and probes the approved HTTPS
   origin by connecting directly to the ALB with Host, TLS name and certificate
   verification preserved. Then verify production with the same retained build,
   using staging's verified receipt. This creates the first verified receipts;
   registration records are never accepted as deployment proof.
6. Only after both verify runs succeed, approve setting `DOCS_AWS_ENABLED=true`.
   Subsequent trusted main builds automatically stage candidates. Public DNS
   changes remain a separate infrastructure operation requiring approval.

All staging actions share non-canceling concurrency group `docs-staging`;
production promotion, rollback, bootstrap and Fly recovery share
`docs-production`. Coordinate contract changes by pausing release activity and
waiting for active/queued jobs to finish before applying infrastructure. GitHub
concurrency may replace pending jobs even with cancellation disabled; re-dispatch
a superseded candidate if still appropriate. The active service's verified source
is the freshness authority, rather than workflow run ordering.

## Promotion and retained recovery

**Stage Docs candidate** runs only after a successful trusted main **push**
producer and when automatic delivery is enabled. Manual build runs never auto-stage,
so bootstrap cannot accidentally start a normal deployment before prior receipts
exist. Its candidate-ready message requires ECS,
digest and semantic HTTP checks to pass. A successful build alone is not ready.

Dispatch **Promote Docs production** on protected main with the successful build
`producer_run` and `producer_attempt`. The protected production environment asks
for human approval. After approval and lock acquisition, validation is repeated;
no image is rebuilt. A candidate behind or divergent from the currently deployed
verified source is rejected, including an older queued candidate overtaken by a
newer production release. Identical/ahead sources are eligible after all other
checks pass.

The integration discovers recent successful permitted release runs through the
GitHub API (up to 20 per applicable workflow), derives only their permitted exact
receipt keys, and pins each returned version/hash. For forward promotion, the
current receipt must match the actual healthy service revision and image. A
bounded search that finds no matching
proof fails closed. `previous_run` and `staging_run` accept optional exact
`run-id/attempt` references for retained evidence outside that window; they still
require authenticated permitted main release runs and verified receipts.

For deliberate rollback, dispatch **Rollback Docs retained image** on protected
main. Choose `production` (the default) or `staging`, supply the retained build
`producer_run`/`producer_attempt`, and set required `rollback_run` to the verified
target release's `run-id/attempt` in the selected environment. The target receipt
may describe a historical contract; the retained image is rendered with the
current approved task template. No image is rebuilt.

Explicit rollback can replace a failed, unverified or in-progress current
revision. It captures the actual service task revision and rechecks that pointer
immediately before updating; a different intervening revision aborts the update.
This check is not an atomic AWS compare-and-swap. Keep other service mutations
serialized through the protected environment's non-canceling concurrency group.
The failed starting revision is never an automatic restoration target during
explicit recovery. A failed recovery remains nonzero and requires operator action.
Normal promotion still requires a verified healthy current source and rejects
stale or divergent candidates; only deliberate rollback bypasses freshness.

Production rollback still requires proof for the exact retained manifest and
staging image under the **current approved staging contract**. If staging runs a
newer image or the staging contract changed, first dispatch rollback with
`environment: staging`, the retained build, and `rollback_run` naming that image's
verified historical **staging** receipt. After the staging recovery passes ECS,
digest and semantic HTTP checks, dispatch production rollback using the same
build, its verified historical **production** `rollback_run`, and `staging_run`
set to the successful staging recovery's exact `run-id/attempt`. Staging rollback
uses `docs-staging` approval and serialization; production uses `docs-production`.
Both require the configured protected environment and current approved contract.

Private receipt check details retain bounded failure stage/reason codes for
validation, rollout, template incompatibility and other failures. Preparation
failures before a receipt exists save bounded diagnostics in the runner's private
local output directory. These files are not published as workflow artifacts;
public logs contain only a sanitized failure message.

Retain immutable images, manifests and receipts for at least 30 days and always
retain current/previous releases. Do not garbage-collect them while referenced.
Before retiring automatic Fly release, privately record a known-good retained
`registry.fly.io/openprose-docs@sha256:<digest>` image. **Recover Docs on Fly.io**
is dispatch-only on protected main, takes production approval, validates that
exact registry/application digest, and deploys it without rebuilding. While DNS
still resolves to Fly, the live robots check observes Fly. After the DNS switch,
verify Fly separately through an approved direct target before any DNS recovery;
the public-host robots check alone is not proof of Fly health. No workflow here
changes DNS.
