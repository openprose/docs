import { NextRequest, NextResponse } from 'next/server';
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation';
import { docsContentRoute, docsRoute } from '@/lib/shared';

const { rewrite: rewriteDocs } = rewritePath(
  `${docsRoute}{/*path}`,
  `${docsContentRoute}{/*path}/content.md`,
);
const { rewrite: rewriteSuffix } = rewritePath(
  `${docsRoute}{/*path}.mdx`,
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

  const result = rewriteSuffix(request.nextUrl.pathname);
  if (result) {
    return NextResponse.rewrite(new URL(result, request.nextUrl));
  }

  if (isMarkdownPreferred(request)) {
    const result = rewriteDocs(request.nextUrl.pathname);

    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl));
    }
  }

  return NextResponse.next();
}
