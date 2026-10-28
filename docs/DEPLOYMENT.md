# Deployment

## Setup and protection

Pull requests keep the required `verify` check, including source, application and
release tests, link and punctuation checks, and public/preview standalone HTTP
checks. They receive no cloud write credentials. Trusted main runs those checks
before building both Linux/amd64 images. Both actual containers must pass the
HTTP surface checks before either image is pushed. The public build uses the
existing production and previous-project analytics inputs; preview disables
production analytics. Docker uses the pinned base and pnpm version and bypasses
the model-backed build hook.

Merging this source stops automatic Fly releases. It changes no running service,
DNS, infrastructure or GitHub configuration. Ordinary AWS delivery stays disabled
unless repository variable `DOCS_AWS_ENABLED` equals `true`. Deliberate bootstrap
and recovery dispatches remain available before enablement on protected main.

Configure these controls before relying on AWS delivery:

- Protect main with required Actions check `verify`. Require human review of
  workflow, release script, build and task configuration changes.
- Restrict `docs-staging` and `docs-production` environments to protected main.
  Require production reviewers, prevent self-approval and disable protection
  bypass where supported. Production registration and recovery use this approval.
- Set repository secret `DOCS_BUILD_ROLE_ARN` and environment-specific secret
  `DOCS_RELEASE_ROLE_ARN` to the approved separate OIDC roles. Build trust must
  match main; release trust must match its exact environment. Set `DOCS_ROLE_ID`
  to each role's IAM unique role ID: repository scope for build, overridden in
  each environment for release. Obtain these privately from IAM metadata.
- Set repository and environment `DOCS_RELEASE_CONFIG` secrets as described below.
  Keep the existing `NEXT_PUBLIC_POSTHOG_KEY`,
  `NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN` and `FLY_API_TOKEN` secrets. This change
  does not change analytics projects or transfer history.
- Keep Actions runner and step debugging disabled. Preflight rejects debug mode
  or a missing role ID before any AWS action. Review hosted logs privately before
  enabling routine delivery; offline fixtures do not prove runner redaction.

`DOCS_RELEASE_CONFIG` contains `{bucket, contracts, probeConnectHost,
alertsTopicArn?}`. Each `contracts[environment]` contains only `{key}`, naming
`contracts/<environment>/current.json`. The build configuration supplies both
keys; each release environment supplies only its own. `probeConnectHost` is the
approved ALB connection hostname. Production also supplies `alertsTopicArn` for
independent failure alerts. Obtain all values from approved infrastructure outputs
through a private operator channel. Never paste infrastructure identities into
public inputs, comments or logs.

The job reads the latest applied current object after environment approval. There
are no approved version/hash references to rotate after an infrastructure change.
Terraform owns the entire task configuration; the render action replaces only the
`docs` image with an ECR digest. No Terraform state access, contract writes,
release receipts or historical run discovery are required. Pause delivery and
drain active and queued releases before changing infrastructure or configuration.
This coordination is required: Terraform and CI do not share an atomic lock.

## Three operations

**Release Docs** runs automatically for main pushes when enabled. It can also be
dispatched on main with `operation: release`. The graph is checks, build, staging,
then protected production approval. Failed staging blocks production. Production
uses the same build tag without rebuilding, while selecting its public image
from the production repository. There is no workflow-wide lock: another candidate
can reach staging while production approval is pending.

Both images use the tag `<40-character-source-sha>-<run-id>-<build-attempt>`. Only
this source-derived tag passes between jobs. Use **Re-run failed jobs** after a
successful build to retain the original tag; a deployment attempt does not select
a new image. **Re-run all jobs** rebuilds under the new build attempt and produces
a new tag. Confirm hosted rerun behavior during initial activation. Reject obsolete
production approvals when a newer candidate supersedes them. There is no ancestry
check or automatic rejection of stale approvals.

`operation: bootstrap` runs checks and builds both images, then registers staging
and production task revisions without updating or probing any service. Production
registration still requires approval. This is registration, not verified delivery.

`operation: recover` takes `environment: staging | production` and `image_tag`.
It bypasses builds and staging dependencies, resolves the retained tag only in the
selected environment's ECR repository, renders it with the latest applied task
configuration and deploys through that environment's protected job. It works when
the current service is unhealthy and does not require a receipt, old run selector
or proof from staging. Recover staging first when useful, then deliberately select
the same retained tag for production. The source used to run recovery is trusted
main; the chosen image may be older.

## Bootstrap without changing public DNS

1. Apply infrastructure with services disabled to create repositories, current
   configuration objects and OIDC roles. Keep public DNS on Fly. Configure the
   secrets and environments above, leaving ordinary delivery disabled.
2. Dispatch `operation: bootstrap` on main. After both images pass, the jobs
   register their bootstrap revisions. Retrieve the resulting task definition ARNs
   privately from ECS, matching family, image digest and workflow timing. Public
   job outputs and summaries do not expose registration ARNs.
3. Explicitly enable services with those registered revisions in the second
   infrastructure apply. Keep public DNS on Fly.
4. Dispatch recovery for staging using the bootstrap build tag, then production
   with its required approval. These runs use the current configuration and check
   the requested task revision, running image digest, one-task counts and HTTP
   behavior before and after probes. They can register a new revision of the same
   image; no old registration record is a prerequisite.
5. Privately confirm environment protection, OIDC scope, successful and failed-job
   reruns, ECS rollback rejection, routing, notifications and independent failure
   alerts before approving `DOCS_AWS_ENABLED=true`. Preserve the separate DNS
   approval and seven-day observation period with Fly available as fallback.

## Rollout, recovery and limits

Official pinned actions handle credentials, ECR login and image rendering. The
private CLI adapter registers the rendered JSON unchanged, records the requested
revision immediately, updates only the service task definition and invokes
[AWS CLI services-stable](https://docs.aws.amazon.com/cli/latest/reference/ecs/wait/services-stable.html).
That built-in waiter polls every 15 seconds and fails after 40 unsuccessful
checks: about ten minutes plus API request/retry time, within the 30-minute
deployment job. The command has a separate 25-minute process limit. No custom
polling or restoration loop is used. The waiter can succeed after ECS rolls back
to an older revision; subsequent revision and digest checks reject that outcome.
Stability alone never means successful delivery. Native ECS circuit-breaker
rollback remains enabled.

HTTP failure fails the release and requests operator recovery; the application
scripts never restore a prior task or issue another service update.

HTTP checks connect directly to the approved ALB while preserving the origin Host,
TLS server name, certificate verification and IPv4/IPv6 lookup behavior. Identity
and one-task counts are observed before and after HTTP probes. This cannot make
service mutation atomic. Staging jobs share non-canceling `docs-staging`
concurrency; AWS production and Fly recovery share `docs-production`. GitHub may
replace pending jobs even when cancellation is disabled; reject obsolete approvals
and re-dispatch a retained candidate deliberately when needed.

Release summaries go to the configured SNS release topic. A production failure
also attempts the alert topic even if summary delivery fails. Notification failure
is a separate warning and step outcome; it does not overwrite deployment/check
health or create a prerequisite for the next release. Delivery remains best effort:
runner loss, preparation failure or missing topic configuration can prevent it.
Do not rely on notifications alone to detect a failed run.

Operational inputs are masked before AWS actions. Configuration, templates and
check results stay under `RUNNER_TEMP/docs-private`, with owner-only permissions;
none are uploaded. These files are ephemeral on hosted runners. Rendered-file and
registered-revision step outputs remain within the deployment job; the only cross-job output is the
source-derived image tag. Keep debug disabled and inspect infrastructure diagnostics
through private operator tools.

Retain at least 30 days of promoted images and always keep current and previous
releases. This change adds no automatic deletion. The accepted mixed-release asset
limitation remains: clients holding an older page can request assets from a newer
single-task deployment. Treat it as a rollout constraint when diagnosing failures.

Before retiring automatic Fly delivery, privately retain a known-good immutable
`registry.fly.io/openprose-docs@sha256:<digest>` image. **Recover Docs on Fly.io**
remains dispatch-only on protected main with production approval and no rebuild.
Before the DNS switch its public robots check observes Fly. Afterward verify Fly
through an approved direct target before a DNS recovery; the public-host check
alone does not prove Fly health. No workflow here changes DNS.

Run `pnpm test:release` for offline release tests. Source tests, mocked action
exercises and local container checks do not establish live IAM permissions,
environment approval enforcement, hosted logs, ECS rollout, DNS or SNS delivery.
Those require separately approved activation checks.
