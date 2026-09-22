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
// carries a dot. A wrong guess here rewrites into a path the build never
// generated and 404s under `fallback: false`, never a wrong body.
function looksLikeDocsPage(pathname: string): boolean {
  return !pathname.includes('.') && !pathname.startsWith('/_next');
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

  if (prefersMarkdown && looksLikeDocsPage(pathname)) {
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

  const target = resolveMarkdownRewrite(
    request.nextUrl.pathname,
    isMarkdownPreferred(request),
  );

  if (target) {
    return NextResponse.rewrite(new URL(target, request.nextUrl));
  }

  return NextResponse.next();
}
