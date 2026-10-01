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

## License

MIT
