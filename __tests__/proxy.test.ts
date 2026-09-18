// @vitest-environment node
// The proxy runs on the server. happy-dom's Request drops the Host header,
// which the legacy-host redirect depends on.
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import proxy, { hasEncodedPathname, resolveDocsHostRedirect } from '../proxy';

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

describe('proxy', () => {
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
