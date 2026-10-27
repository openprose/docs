# Standalone release checks

The HTTP checker validates the externally visible docs routes. The browser
experiment checks whether readers remain functional when requests reach two
different standalone builds during a release or rollback.

The browser experiment is an opt-in diagnostic, separate from required CI
checks. Its failing assertions remain visible as evidence of the limitations
described below.

## Run locally

Use Node 22, pnpm 10.34.5 and a running Docker engine with Linux/amd64 support:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm exec playwright test e2e/release-overlap.spec.ts
```

The experiment creates two disposable source copies and adds different content,
client components and CSS to them. It builds two public-mode images with separate
deployment identifiers and disabled analytics, validates each image over HTTP,
and starts a loopback proxy that selects the responding image deterministically.
The original content files are unchanged. Test containers and image tags are
removed afterward; Docker's build cache is retained.

Logs, image identities, request routing, HTTP results and failure traces are kept
in the temporary directory printed by the runner. Set `RELEASE_REPORT_DIR` to a
new directory to choose where evidence is written. `RELEASE_TEST_PORT` changes
the default proxy port, 4177. A full first build can take several minutes.

To check a running local server separately:

```sh
pnpm exec tsx scripts/check-http-surface.ts http://localhost:3000 public docs.openprose.ai
```

Use `preview` for a preview build. The optional final argument tests the legacy
host's redirect by sending its Host header to the supplied origin. The checker
reports individual results as JSON and exits unsuccessfully when any check fails.
It covers HTML, Markdown negotiation and aliases, redirects and query strings,
search results, robots, sitemap, unknown paths and representative methods.

The existing `pnpm smoke:standalone --mode public` and `--mode preview` checks
also inspect the standalone build's cache tree and cold/warm encoded paths.
Those filesystem checks remain necessary alongside the HTTP checks. Build with
`pnpm exec next build` before running them.

## Current result

Local verification on 2026-10-26 used the dependency baseline from
[86a12d2](https://github.com/openprose/docs/commit/86a12d2c61fce6a7635d8c392bbc3493e2827ae7),
Next 16.4.2, Node 22.23.4 in Linux/amd64 containers, and Playwright 1.62.1.

| Browser scenario | Result |
| --- | --- |
| Release A page and assets from A | Pass: page hydrates and responds to interaction |
| Release B page and assets from B | Pass: page hydrates and responds to interaction |
| Open A tab, then all traffic switches to B | Pass: navigation and search remain functional |
| Open B tab, then all traffic switches to A | Pass: navigation and search remain functional |
| A page, required assets routed to B | Fail: one JS chunk and one CSS file return 404; client interaction fails |
| B page, required assets routed to A | Fail: one JS chunk and one CSS file return 404; client interaction fails |

Each image passed all 39 HTTP checks. Both matched browser cases verify that
asset URLs carry the expected deployment identifier. The failed cases still
send that identifier, but the receiving image lacks the requested files.

This reproduces a limitation of storing each build's assets only inside that
build's container. Next.js documents that the `dpl` query parameter does not route
requests to the matching deployment: see
[deploymentId](https://nextjs.org/docs/app/api-reference/config/next-config-js/deploymentId).
The diagnostic does not implement asset retention or version-aware routing.
Its assertions continue to report missing assets when that sequence is forced.

The proxy forces a specific routing sequence. Production failure frequency,
load-balancer draining, task recovery time and resource sizing remain unmeasured.
