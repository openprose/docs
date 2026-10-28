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
  Keep environment-scoped release secrets and main-only branch restrictions.
  Required environment reviewers are not part of this setup: the deliberate
  production dispatch is the approval action.
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

The job reads the latest applied current object in its selected environment. There
are no approved version/hash references to rotate after an infrastructure change.
Terraform owns the entire task configuration; the render action replaces only the
`docs` image with an ECR digest. No Terraform state access, contract writes,
release receipts or historical run discovery are required. Pause delivery and
drain active and queued releases before changing infrastructure or configuration.
This coordination is required: Terraform and CI do not share an atomic lock.

## Four operations

**Release Docs** runs automatically for main pushes when enabled. It can also be
dispatched on main with `operation: release`. Both paths run checks, build and
check both image variants, then deploy staging only. They never deploy production.
The `environment` input applies only to recovery; it does not change the release
or promotion destination.

Both images use the tag `<40-character-source-sha>-<run-id>-<build-attempt>`. The
staging repository contains the preview variant; the production repository contains
the public variant. Only this source-derived tag passes between jobs. Use **Re-run
failed jobs** after a successful build to retain the original tag. **Re-run all
jobs** on a release or bootstrap run rebuilds under the new build attempt and
produces a new tag. Confirm hosted rerun behavior during initial activation.

To approve production delivery, select **Release Docs**, choose trusted `main`,
set `operation: promote`, and enter the exact retained `image_tag` from the intended
staging release's build output. Confirm the source SHA, run ID and build attempt;
do not substitute the promotion run's identifiers. The selected tag is shown in
the job summary. Promotion requires `DOCS_AWS_ENABLED=true` and an explicit existing
tag. It never rebuilds either image and always executes release code from trusted
main, regardless of the selected image's source revision.

The dedicated staging verification job resolves that tag in the staging repository
and checks the current ECS service. Its current task revision, selected image digest,
one-task counts and HTTP surface must pass before production can run. Verification
uses reads and HTTP probes only: it does not register a task, update a service or
send a deployment notification. Failed, canceled or skipped verification blocks
production. The production job then resolves the same tag's public variant in the
production repository and deploys with the latest applied production configuration.

There is no workflow-wide lock. Staging can move after verification and before or
during production delivery; the check establishes health at verification time.
It does not provide an atomic staging-to-production guarantee, a receipt or an
ancestry check. Reassess the candidate if staging has since changed.

`operation: bootstrap` runs checks and builds both images, then registers staging
and production task revisions without updating or probing any service. It remains
available when delivery is disabled. Production registration is dispatch-only.
This is registration, not verified delivery.

`operation: recover` takes `environment: staging | production` and `image_tag`.
It is an explicit recovery bypass: it does not build or require staging verification,
and works while ordinary delivery is disabled or the current service is unhealthy.
It resolves the retained tag only in the selected environment's ECR repository,
renders it with the latest applied task configuration and deploys through that
environment's protected job. It requires no receipt or old run selector. Recover
staging first when useful, then deliberately select the same retained tag for
production. Recovery executes trusted main; the chosen image may be older.

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
   through a separate deliberate dispatch. These runs use the current configuration
   and check the requested task revision, running image digest, one-task counts and HTTP
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
replace pending jobs even when cancellation is disabled; re-dispatch a retained
candidate deliberately when needed.

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
remains dispatch-only on protected main with no rebuild. Its deliberate dispatch
is the production approval action.
Before the DNS switch its public robots check observes Fly. Afterward verify Fly
through an approved direct target before a DNS recovery; the public-host check
alone does not prove Fly health. No workflow here changes DNS.

Run `pnpm test:release` for offline release tests. Source tests, mocked action
exercises and local container checks do not establish live IAM permissions,
environment branch restrictions, hosted logs, ECS rollout, DNS or SNS delivery.
Those require separately approved activation checks.
