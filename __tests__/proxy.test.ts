import { describe, expect, it } from 'vitest';
import { resolveDocsHostRedirect } from '../proxy';

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
