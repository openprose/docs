// @vitest-environment node
// The proxy runs on the server. happy-dom's Request drops the Host header,
// which the legacy-host redirect depends on.
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import proxy, {
  hasEncodedPathname,
  isNegotiablePage,
  resolveDocsHostRedirect,
  resolveMarkdownRewrite,
} from '../proxy';

describe('resolveDocsHostRedirect', () => {
  it('redirects the legacy docs host to docs.prose.md', () => {
    expect(resolveDocsHostRedirect('docs.openprose.ai', '/foo?x=1')).toBe(
      'https://docs.prose.md/foo?x=1',
    );
  });

  it('ignores the canonical docs host', () => {
    expect(resolveDocsHostRedirect('docs.prose.md', '/foo?x=1')).toBeNull();
  });

  it('ignores the Fly preview host', () => {
    expect(
      resolveDocsHostRedirect('openprose-docs.fly.dev', '/foo?x=1'),
    ).toBeNull();
  });
});

describe('hasEncodedPathname', () => {
  it('accepts plain paths', () => {
    expect(hasEncodedPathname('/robots.txt')).toBe(false);
    expect(hasEncodedPathname('/sitemap.xml')).toBe(false);
    expect(hasEncodedPathname('/setup')).toBe(false);
    expect(hasEncodedPathname('/')).toBe(false);
  });

  it('flags percent-encoded aliases of route handlers', () => {
    expect(hasEncodedPathname('/robots%2Etxt')).toBe(true);
    expect(hasEncodedPathname('/sitemap%2Exml')).toBe(true);
  });

  it('flags malformed escape sequences', () => {
    expect(hasEncodedPathname('/%E0%A4%A')).toBe(true);
  });
});

describe('resolveMarkdownRewrite', () => {
  it('maps an advertised <slug>.mdx alternate to its prerendered Markdown', () => {
    expect(resolveMarkdownRewrite('/setup.mdx', false)).toBe(
      '/llms.mdx/setup/content.md',
    );
  });

  it('maps the advertised root alternate /index.mdx to the root Markdown', () => {
    expect(resolveMarkdownRewrite('/index.mdx', false)).toBe(
      '/llms.mdx/content.md',
    );
  });

  it('keeps the legacy /.mdx root alternate working', () => {
    expect(resolveMarkdownRewrite('/.mdx', false)).toBe(
      '/llms.mdx/content.md',
    );
  });

  it('no longer matches the old double-slash form', () => {
    // Next 308s these before the proxy runs, so a match here would only
    // ever have been reachable by accident.
    expect(resolveMarkdownRewrite('//setup.mdx', false)).toBeNull();
  });

  it('leaves a page URL alone without a Markdown Accept', () => {
    expect(resolveMarkdownRewrite('/setup', false)).toBeNull();
  });

  it('leaves /llms.txt alone without a Markdown Accept', () => {
    expect(resolveMarkdownRewrite('/llms.txt', false)).toBeNull();
  });

  describe('with a Markdown Accept', () => {
    it("negotiates a page's HTML URL to its prerendered Markdown", () => {
      expect(resolveMarkdownRewrite('/setup', true)).toBe(
        '/llms.mdx/setup/content.md',
      );
    });

    it('negotiates the root to the root Markdown', () => {
      expect(resolveMarkdownRewrite('/', true)).toBe('/llms.mdx/content.md');
    });

    it('no longer matches the old double-slash form', () => {
      expect(resolveMarkdownRewrite('//setup', true)).toBeNull();
    });

    // The gate: with the docs at the root the negotiated pattern matches
    // every path, and isMarkdownPreferred is true for text/plain too. Each
    // row is a request a Markdown-preferring client makes today that a
    // naive catch-all would have rewritten into a 404.
    it.each([
      '/llms.txt',
      '/llms-full.txt',
      '/robots.txt',
      '/sitemap.xml',
      '/llms.mdx/setup/content.md',
      '/llms.mdx/content.md',
      '/og/setup/image.png',
      '/_next/static/chunk.js',
      '/.well-known/agent-skills/index.json',
      '/api/search',
      '/api/search/openapi',
    ])('leaves the non-page route %s alone', (pathname) => {
      expect(resolveMarkdownRewrite(pathname, true)).toBeNull();
    });
  });
});

describe('isNegotiablePage', () => {
  it.each(['/', '/setup', '/contracts', '/harness-agnostic'])(
    'treats the page URL %s as negotiable',
    (pathname) => {
      expect(isNegotiablePage(pathname)).toBe(true);
    },
  );

  it.each([
    '/setup.mdx',
    '/index.mdx',
    '/llms.txt',
    '/robots.txt',
    '/llms.mdx/setup/content.md',
    '/_next/static/chunk.js',
    '/api',
    '/api/search',
    '/api/search/openapi',
  ])('does not treat %s as negotiable', (pathname) => {
    expect(isNegotiablePage(pathname)).toBe(false);
  });
});

describe('proxy', () => {
  it('rewrites an advertised .mdx alternate to the Markdown route', () => {
    const res = proxy(new NextRequest('https://docs.prose.md/setup.mdx'));
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://docs.prose.md/llms.mdx/setup/content.md',
    );
    expect(res.headers.get('x-middleware-next')).toBeNull();
  });

  it('rewrites the root alternate /index.mdx to the root Markdown', () => {
    const res = proxy(new NextRequest('https://docs.prose.md/index.mdx'));
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://docs.prose.md/llms.mdx/content.md',
    );
  });

  it('does not mark the .mdx alternate as negotiated', () => {
    // The alternate answers Markdown to every client, so caches need no
    // Accept key for it.
    const res = proxy(new NextRequest('https://docs.prose.md/setup.mdx'));
    expect(res.headers.get('vary')).toBeNull();
  });

  it("negotiates a page's HTML URL when the client prefers Markdown", () => {
    const res = proxy(
      new NextRequest('https://docs.prose.md/setup', {
        headers: { accept: 'text/markdown' },
      }),
    );
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://docs.prose.md/llms.mdx/setup/content.md',
    );
    expect(res.headers.get('vary')).toBe('Accept');
    expect(res.headers.get('x-middleware-next')).toBeNull();
  });

  it("negotiates a page's HTML URL when the client prefers plain text", () => {
    const res = proxy(
      new NextRequest('https://docs.prose.md/setup', {
        headers: { accept: 'text/plain' },
      }),
    );
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://docs.prose.md/llms.mdx/setup/content.md',
    );
    expect(res.headers.get('vary')).toBe('Accept');
  });

  it('negotiates the root when the client prefers Markdown', () => {
    const res = proxy(
      new NextRequest('https://docs.prose.md/', {
        headers: { accept: 'text/markdown' },
      }),
    );
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://docs.prose.md/llms.mdx/content.md',
    );
    expect(res.headers.get('vary')).toBe('Accept');
  });

  it('serves HTML to a browser Accept header', () => {
    const res = proxy(
      new NextRequest('https://docs.prose.md/setup', {
        headers: {
          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      }),
    );
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('leaves the search API alone for a JSON client that also accepts text', () => {
    // `application/json, text/plain, */*` is a common HTTP client default,
    // and text/plain alone satisfies isMarkdownPreferred.
    const res = proxy(
      new NextRequest('https://docs.prose.md/api/search?q=setup', {
        headers: { accept: 'application/json, text/plain, */*' },
      }),
    );
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('vary')).toBeNull();
  });

  it('leaves the search OpenAPI document alone for the same client', () => {
    const res = proxy(
      new NextRequest('https://docs.prose.md/api/search/openapi', {
        headers: { accept: 'application/json, text/plain, */*' },
      }),
    );
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('vary')).toBeNull();
  });

  it('leaves /llms.txt alone when the client prefers plain text', () => {
    const res = proxy(
      new NextRequest('https://docs.prose.md/llms.txt', {
        headers: { accept: 'text/plain' },
      }),
    );
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('leaves a /llms.mdx file alone when the client prefers Markdown', () => {
    // This is the URL the negotiation lands on; re-negotiating it would
    // rewrite into a path the build never generated.
    const res = proxy(
      new NextRequest('https://docs.prose.md/llms.mdx/setup/content.md', {
        headers: { accept: 'text/markdown' },
      }),
    );
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('rejects an encoded .mdx path before rewriting it', () => {
    const res = proxy(new NextRequest('https://docs.prose.md/setup%2Emdx'));
    expect(res.status).toBe(404);
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('returns 404 for a percent-encoded robots path', () => {
    const res = proxy(new NextRequest('https://docs.prose.md/robots%2Etxt'));
    expect(res.status).toBe(404);
    expect(res.headers.get('x-middleware-next')).toBeNull();
  });

  it('returns 404 for a percent-encoded sitemap path', () => {
    const res = proxy(new NextRequest('https://docs.prose.md/sitemap%2Exml'));
    expect(res.status).toBe(404);
  });

  it('rejects encoded paths before the legacy host redirect', () => {
    const headers = { host: 'docs.openprose.ai' };
    const plain = proxy(
      new NextRequest('https://docs.openprose.ai/robots.txt', { headers }),
    );
    expect(plain.status).toBe(301);

    const encoded = proxy(
      new NextRequest('https://docs.openprose.ai/robots%2Etxt', { headers }),
    );
    expect(encoded.status).toBe(404);
  });

  it('passes /robots.txt through untouched', () => {
    const res = proxy(new NextRequest('https://docs.prose.md/robots.txt'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('passes /sitemap.xml through untouched', () => {
    const res = proxy(new NextRequest('https://docs.prose.md/sitemap.xml'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
