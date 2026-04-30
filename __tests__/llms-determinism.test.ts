import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { GET as getLlmsTxt } from "../app/llms.txt/route";
import { GET as getLlmsFull } from "../app/llms-full.txt/route";

async function fetchAndHash(
  handler: () => Response | Promise<Response>,
): Promise<string> {
  const res = await handler();
  return createHash("sha256")
    .update(await res.text())
    .digest("hex");
}

describe("llms.txt + llms-full.txt determinism", () => {
  it("llms.txt is byte-identical across two calls", async () => {
    const h1 = await fetchAndHash(() => getLlmsTxt());
    const h2 = await fetchAndHash(() => getLlmsTxt());
    expect(h2).toBe(h1);
  });

  it("llms-full.txt is byte-identical across two calls", async () => {
    const h1 = await fetchAndHash(() => getLlmsFull());
    const h2 = await fetchAndHash(() => getLlmsFull());
    expect(h2).toBe(h1);
  });
});
