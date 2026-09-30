// @vitest-environment node
// The proxy runs on the server; keep this in the same environment as
// proxy.test.ts so the helper sees exactly what production sees.
import { describe, expect, it } from "vitest";
import { buildPageMetadata } from "../lib/canonical";
import { getPageMarkdownUrl, source } from "../lib/source";
import { resolveMarkdownRewrite } from "../proxy";

// Three layers have to agree on one string: buildPageMetadata advertises
// the alternate, resolveMarkdownRewrite maps it, and the /llms.mdx handler
// prerenders exactly the paths getPageMarkdownUrl produces. A page whose
// slug breaks the shape the proxy expects, or a change to any one layer,
// shows up here without a build.
describe("markdown alternates", () => {
  it("advertise a URL the proxy rewrites to the page's prerendered Markdown", () => {
    const pages = source.getPages();
    expect(pages.length).toBeGreaterThan(0);

    const mismatches: string[] = [];
    for (const page of pages) {
      const alternate = buildPageMetadata(page.url).alternates?.types?.[
        "text/markdown"
      ];
      if (typeof alternate !== "string") {
        mismatches.push(`${page.url}: no text/markdown alternate`);
        continue;
      }
      const rewritten = resolveMarkdownRewrite(alternate, false);
      const expected = getPageMarkdownUrl(page).url;
      if (rewritten !== expected) {
        mismatches.push(
          `${page.url}: ${alternate} -> ${String(rewritten)}, expected ${expected}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("negotiate every page's HTML URL to the same prerendered Markdown", () => {
    // The agent journey: llms.txt lists HTML URLs, and a client asks for
    // them with Accept: text/markdown. The proxy's page-shape gate has to
    // accept every real page URL, or that page silently answers HTML.
    const pages = source.getPages();
    expect(pages.length).toBeGreaterThan(0);

    const mismatches: string[] = [];
    for (const page of pages) {
      const rewritten = resolveMarkdownRewrite(page.url, true);
      const expected = getPageMarkdownUrl(page).url;
      if (rewritten !== expected) {
        mismatches.push(
          `${page.url}: -> ${String(rewritten)}, expected ${expected}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});
