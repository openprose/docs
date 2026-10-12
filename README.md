# @openprose/docs

Documentation site for [OpenProse](https://github.com/openprose/prose). Contract authoring expresses intent by composing requirements: state what an agent must accomplish, which conditions it must satisfy, and where it can choose its approach.

Live at: https://docs.prose.md

## What is this?

This site documents the public `open-prose` skill and its Contract Markdown / ProseScript format. The current documentation was checked against skill 0.18.0 (`runtime_contract: 2`) at [source revision `770cebc9`](https://github.com/openprose/prose/tree/770cebc9e03a7150a73bd454b7a6da307595ff9d). The authoring introduction is maintained at [Contract authoring](content/docs/declare-outcomes.mdx); syntax and runtime behavior remain owned by the public language repository.

The Markdown exports and agent-readable corpus are generated directly from the MDX pages. Vendored examples are retained source specimens. The two `.prose/` files retain legacy manifest and changelog maintenance programs (`kind: program`, `Services`, and `Ensures`). They require a separate format upgrade before use with the current skill and are not part of CI or the Docker build. They were not executed or model-validated for this documentation update.

## Local development

```bash
pnpm install --frozen-lockfile
pnpm dev       # http://localhost:3000
pnpm check     # typecheck + lint + spell
pnpm exec next build # production build, matching CI and Docker
```

## Layout

- `content/docs/**/*.mdx` -- hand-authored documentation
- `vendor/prose-examples/` -- retained example source displayed by documentation pages
- `.prose/` -- retained legacy manifest and changelog maintenance programs; upgrade before execution
- `app/` -- Next.js App Router routes (docs pages, `.md` exports, agent-readable surfaces)
- `lib/` -- helpers (canonical URLs, preview-mode flag, MDX-to-MD conversion)
- `components/` -- React components consumed by MDX pages

`pnpm build` still invokes those legacy programs through an agent in its `prebuild` hook. Use the CI build command above for a deterministic site build without a model call. CI additionally runs unit tests, link and punctuation checks, and standalone HTTP smoke checks in public and preview modes.

## Browser analytics

Browser analytics uses PostHog JS pinned to `1.425.1`. Every captured event has
`site_surface: docs`; automatic history pageviews, exception capture,
`identified_only` person profiles, URL/referrer handling, and the SDK's current
replay, automatic capture and opt-out defaults remain unchanged. Browser events do not
measure agent requests for Markdown exports.

Build inputs select the destination explicitly:

| Mode | Key | Runtime origin |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_ENVIRONMENT=production` | `NEXT_PUBLIC_POSTHOG_KEY` | Only `https://docs.prose.md` |
| `NEXT_PUBLIC_POSTHOG_ENVIRONMENT=staging` | `NEXT_PUBLIC_POSTHOG_STAGING_KEY` | Explicit local/test build |
| Missing or any other value | None | Disabled |

A preview with a production key cannot initialize production capture. Staging
never falls back to the production key. The public key alone does not establish
its project: verify each supplied key's destination through the approved build
configuration before rollout. `NEXT_PUBLIC_POSTHOG_HOST` retains its existing
`https://us.i.posthog.com` fallback. These are build-time inputs; restarting the
container with different values does not rebuild the browser bundle.

The Docker build accepts these inputs. The existing main-branch Fly workflow
sets production mode and consumes the existing `NEXT_PUBLIC_POSTHOG_KEY` secret.
Production preflight in the workflow and Docker build also requires a separately
supplied `NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN` for the previous Docs project.
That additional build input is not configured by this change. Switch the current
key secret to the approved shared project only as part of coordinated
rollout; this source change does not update any secret or transfer old Docs
history from the previous project. An explicit previous-project opt-out (`0`) in local
storage or its cookie prevents new-project initialization; unknown or unavailable
legacy storage leaves the current SDK capture policy in place. The previous token
is checked as supplied, without guessing it from the new token. A push or merge to main triggers deployment and
requires the corresponding release approval. Retain the previous build and
public configuration for rollback through the same workflow.

The single client link observer emits `site:link_click` for the public Docs and
language repositories, their linked source references, and the examples
catalogue. The closed destinations are `github_docs`, `github_prose`, and
`examples`; placement is `header` or `docs_content`, with `link_purpose: explore`,
`page_path`, a per-navigation `page_visit_id`, and `event_version: 1`. It records
native click, keyboard activation and middle-click without changing navigation.
Internal documentation and unrelated links are excluded. Existing automatic capture
is retained as a separate event stream. No product CTA is added where none exists.

The app-local receiver consumes only a fragment containing exactly the UUID
fields `__op_ph_id` and `__op_ph_session` before SDK initialization. It preserves
unrelated query/anchor data. Incoming IDs apply only when current-project cookie,
local and session storage are positively available, writable and empty, with no
current or configured previous-project opt-out or unknown consent state. Any
existing identity or malformed stored state prevents bootstrap. Docs has no auth
context, so persisted identity always takes precedence. No incoming identity
invokes `identify` or `alias`.

Persistence is explicitly `localStorage+cookie` with `cross_subdomain_cookie` and
`cookieWinsOnConflict` enabled. This keeps current shared-cookie identity across
the prose.md surfaces on the qualified SDK version. An already-open tab running
the older SDK remains outside that guarantee until refreshed. Coordinate the
receiver rollout before enabling handoff on sending sites; this source
change does not enable that sender or establish live project continuity.

Use `pnpm check`, `pnpm test`, `pnpm exec fumadocs-mdx` and
`pnpm exec next build` for deterministic verification. The `pnpm build` lifecycle
still runs the unrelated AI build hook described above.

## License

MIT
