import { NextRequest, NextResponse } from 'next/server';
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation';
import { docsContentRoute, docsRoute } from '@/lib/shared';

// The optional group `{/*path}` supplies its own leading slash, so the prefix
// in front of it must not end in one. With docsRoute = "/" the raw
// concatenation `/{/*path}` only ever matched "/" and double-slash paths,
// which Next collapses with a 308 before the proxy runs.
const docsPrefix = docsRoute.replace(/\/$/, '');

const { rewrite: rewriteDocs } = rewritePath(
  `${docsPrefix}{/*path}`,
  `${docsContentRoute}{/*path}/content.md`,
);
const { rewrite: rewriteSuffix } = rewritePath(
  `${docsPrefix}{/*path}.mdx`,
  `${docsContentRoute}{/*path}/content.md`,
);

export function resolveDocsHostRedirect(
  host: string,
  pathWithSearch: string,
): string | null {
  const hostname = host.split(':')[0];

  if (hostname !== 'docs.openprose.ai') return null;

  return `https://docs.prose.md${pathWithSearch}`;
}

// No docs route has a percent-encoded path: slugs are plain ASCII and search
// terms travel in the query string. Next decodes a dynamic route's params
// before keying its cache, so an encoded alias such as /robots%2Etxt misses
// the static /robots.txt route, reaches the catch-all page, and is looked up
// under the robots route's cache key. Rejecting encoded paths here keeps them
// away from routing and the cache entirely.
export function hasEncodedPathname(pathname: string): boolean {
  try {
    return decodeURIComponent(pathname) !== pathname;
  } catch {
    // A malformed escape sequence cannot be a docs path either.
    return true;
  }
}

// With the docs mounted at the root, the negotiated pattern matches every
// path, and isMarkdownPreferred is true for `Accept: text/plain` as well as
// `text/markdown`. Docs slugs are plain kebab-case words; every other route
// on the site (/robots.txt, /llms.txt, /llms.mdx/**, /og/**, /.well-known/**)
// carries a dot, except the search API, whose clients commonly send
// `Accept: application/json, text/plain, */*` and must never be rewritten.
// A wrong guess here rewrites into a path the build never generated and
// 404s under `fallback: false`, never a wrong body.
export function isNegotiablePage(pathname: string): boolean {
  return (
    !pathname.includes('.') &&
    !pathname.startsWith('/_next') &&
    !pathname.startsWith('/api/') &&
    pathname !== '/api'
  );
}

// Returns the /llms.mdx path that serves a request as Markdown, or null.
// Three ways in: the root aliases (/index.mdx is advertised, /.mdx is what
// crawlers saw before), the `<slug>.mdx` alternate every other page
// advertises, and Accept negotiation on a page's HTML URL.
export function resolveMarkdownRewrite(
  pathname: string,
  prefersMarkdown: boolean,
): string | null {
  // path-to-regexp's wildcard accepts an empty first segment, so `//setup.mdx`
  // would compile to /llms.mdx//setup/content.md. Next collapses repeated
  // slashes with a 308 before the proxy runs, so this is unreachable over
  // HTTP; refuse it here so the helper never emits a path with an empty
  // segment, which no prerendered file has.
  if (pathname.includes('//')) return null;

  // The suffix pattern would send /index.mdx to /llms.mdx/index/content.md,
  // which the build never generates; the root's Markdown has no slug segment.
  if (pathname === '/index.mdx' || pathname === '/.mdx') {
    return `${docsContentRoute}/content.md`;
  }

  const suffixed = rewriteSuffix(pathname);
  if (suffixed) return suffixed;

  if (prefersMarkdown && isNegotiablePage(pathname)) {
    return rewriteDocs(pathname) || null;
  }

  return null;
}

export default function proxy(request: NextRequest) {
  if (hasEncodedPathname(request.nextUrl.pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  const hostRedirect = resolveDocsHostRedirect(
    request.headers.get('host') ?? '',
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  if (hostRedirect) {
    return NextResponse.redirect(hostRedirect, 301);
  }

  const { pathname } = request.nextUrl;
  const prefersMarkdown = isMarkdownPreferred(request);
  const target = resolveMarkdownRewrite(pathname, prefersMarkdown);

  if (target) {
    // A page's HTML URL answers Markdown only because of the Accept header,
    // so caches must key on it. The `.mdx` alternates answer Markdown to
    // every client and are not negotiated. (Every non-negotiated target
    // comes from an `.mdx` path: the root aliases and the suffix pattern.)
    //
    // Only the Markdown side can carry this. Route handler responses keep a
    // Vary set here (Next appends its own list after it), but App Router
    // page responses do not: Next overwrites Vary with its RSC list before
    // rendering, and neither this proxy nor a headers() rule in next.config
    // survives that. So the HTML side of a page ships without `Accept` in
    // Vary, and a shared cache in front of the site must key on Accept for
    // page URLs itself. There is no such cache today.
    const negotiated = prefersMarkdown && isNegotiablePage(pathname);
    return NextResponse.rewrite(
      new URL(target, request.nextUrl),
      negotiated ? { headers: { Vary: 'Accept' } } : undefined,
    );
  }

  return NextResponse.next();
}
