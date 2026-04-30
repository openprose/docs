import { describe, it, expect } from "vitest";
import { GET as getLlmsTxt } from "../app/llms.txt/route";
import { source } from "../lib/source";

describe("llms.txt completeness", () => {
  it("references every page from source.getPages()", async () => {
    const res = await getLlmsTxt();
    const llms = await res.text();

    const missing: string[] = [];
    for (const page of source.getPages()) {
      // Fumadocs emits every page as "[Title](url)" in llms.txt.
      // Anchoring on the closing paren makes this an exact URL match, not a substring
      // match. Without the paren, a page at "/concepts" would always pass as long as
      // any "/concepts/<x>" page is present.
      if (!llms.includes(`(${page.url})`)) {
        missing.push(`${page.url} (${page.path})`);
      }
    }
    if (missing.length > 0) {
      console.error("Missing from llms.txt:\n" + missing.join("\n"));
    }
    expect(missing).toEqual([]);
  });
});
