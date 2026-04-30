# @openprose/docs

Documentation site for [OpenProse](https://github.com/openprose/prose), the programming language for AI sessions.

Live at: https://docs.openprose.ai

## What is this?

`openprose/docs` runs three prose programs: it compiles its own agent corpus, enforces its own spec coverage, and builds its own changelog.

## Local development

```bash
pnpm install   # also initializes external/prose submodule
pnpm dev       # http://localhost:3000
pnpm check     # typecheck + lint + spell
pnpm build     # production build
```

## Layout

- `content/docs/**/*.mdx` -- hand-authored documentation
- `external/prose/` -- pinned submodule of `github.com/openprose/prose` (reference content for examples)
- `.prose/` -- three dogfood programs that run during build (`generate-llms`, `changelog-sync`) or from cross-repo CI (`spec-coverage`)
- `app/` -- Next.js App Router routes (docs pages, `.md` exports, agent-readable surfaces)
- `lib/` -- helpers (canonical URLs, preview-mode flag, MDX-to-MD conversion)
- `components/` -- React components consumed by MDX pages

## License

MIT
