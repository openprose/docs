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

export default function proxy(request: NextRequest) {
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
