# Deployment

## Setup and configuration

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
3. Dispatch **Release Docs** on protected main with environment
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

**Release Docs** automatically stages candidates only after a successful trusted main **push**
producer and when automatic delivery is enabled. Manual build runs never auto-stage,
so bootstrap cannot accidentally start a normal deployment before prior receipts
exist. Its candidate-ready message requires ECS,
digest and semantic HTTP checks to pass. A successful build alone is not ready.

Dispatch **Release Docs** on protected main with operation `promote`, environment
`production`, and the successful build
`producer_run` and `producer_attempt`. The protected production environment asks
for human approval. After approval and lock acquisition, validation is repeated;
no image is rebuilt. A candidate behind or divergent from the currently deployed
verified source is rejected, including an older queued candidate overtaken by a
newer production release. Identical/ahead sources are eligible after all other
checks pass.

The release program discovers recent successful permitted release runs through the
GitHub API (up to 20 from `release-docs.yml`), derives only their permitted exact
receipt keys, and pins each returned version/hash. For forward promotion, the
current receipt must match the actual healthy service revision and image. A
bounded search that finds no matching
proof fails closed. `previous_run` and `staging_run` accept optional exact
`run-id/attempt` references for retained evidence outside that window; they still
require authenticated permitted main release runs and verified receipts.

For deliberate rollback, dispatch **Release Docs** with operation `rollback` on protected
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

## Diagnostics, retention and limits

The release program uses Node, the installed AWS CLI and the installed `tsx`
HTTP checker. Terraform owns every task-template field except the immutable image
substituted by the workflow. Candidate JSON cannot authorize its own producer,
source, checks, contract, routing or destination. Strict validation rejects unknown
record fields. The program checks the current contract immediately before each
mutation and after verification. Pause releases during contract changes; ECS
service updates offer no atomic compare-and-swap.

A failed promotion remains nonzero after successful automatic restoration.
Restoration requires a compatible previously verified task and ownership of the
active service pointer, followed by ECS and HTTP verification. Explicit rollback
never automatically restores its failed starting revision. HTTP checks connect to
the approved ALB while retaining the public Host, TLS server name and certificate
verification. Running task revision, digest and counts are checked before and
after HTTP probes, beyond ECS stability alone.

Receipts use immutable conditional writes under
`receipts/<environment>/<release-run>/<attempt>.json`. Registration-only records
have `kind: "registration"` and cannot serve as deployment receipts. Notification,
alert or receipt-delivery failures are independent nonzero outcomes; they never
rewrite application health. Private files under the runner's `docs-private`
directory retain bounded failure details and delivery-failure records, but hosted
runner files are ephemeral. Repair delivery and run fresh verification to establish
new immutable evidence. No mutable current-release pointer or S3 listing is used.

Run local release checks with `node --test scripts/release/*.test.mjs` and HTTP
fixtures with `pnpm exec vitest run __tests__/http-surface.test.ts`. These offline
checks do not prove configured environment protection, OIDC trust, live rollout,
HTTP routing or notification delivery. Actual retained-image smoke evidence applies
only while image build behavior remains unchanged; hosted release proof requires
an approved live run.
