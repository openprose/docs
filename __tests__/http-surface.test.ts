// @vitest-environment node
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { checkSurface } from "../scripts/check-http-surface";

type Reply = { status: number; type?: string; body?: string; location?: string; vary?: string };
type Override = (request: IncomingMessage) => Reply | undefined;
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

// These literal responses describe the public HTTP contract. Individual tests
// break one response to prove the checker rejects an unhealthy release.
async function fixture(mode: "public" | "preview" = "public", override?: Override) {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url!, "http://fixture.test");
    const path = url.pathname;
    let reply: Reply = { status: 404, type: "text/html", body: "Not found" };
    if (["/", "/setup"].includes(path)) {
      reply = request.headers.accept === "text/markdown"
        ? { status: 200, type: "text/markdown", body: "# Setup\nInstall the CLI.", vary: "RSC, Accept" }
        : { status: 200, type: "text/html; charset=utf-8", body: "<!doctype html><html><body><main>Docs</main></body></html>" };
    } else if (["/setup.mdx", "/index.mdx", "/.mdx", "/llms.mdx/setup/content.md"].includes(path)) {
      reply = { status: 200, type: "text/markdown", body: "# Setup\nInstall the CLI." };
    } else if (path === "/robots.txt") {
      reply = { status: 200, type: "text/plain", body: mode === "public"
        ? "User-Agent: Googlebot\nAllow: /\n\nUser-Agent: *\nAllow: /\n\nSitemap: https://docs.prose.md/sitemap.xml\n"
        : "User-Agent: *\nDisallow: /\n" };
    } else if (path === "/sitemap.xml") {
      reply = { status: 200, type: "application/xml", body: mode === "public"
        ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://docs.prose.md/setup</loc></url></urlset>'
        : '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>' };
    } else if (path === "/llms.txt") {
      reply = { status: 200, type: "text/plain", body: "# OpenProse\n- [Setup](/setup): Install the skill." };
    } else if (path === "/api/search") {
      reply = { status: 200, type: "application/json", body: '[{"id":"setup","url":"/setup","type":"page","content":"Setup"}]' };
    } else if (path === "/api/search/openapi") {
      reply = { status: 200, type: "application/json", body: '{"openapi":"3.1.0","paths":{"/api/search":{"get":{}}}}' };
    } else if (path === "/og/setup/image.png") {
      reply = { status: 200, type: "image/png", body: "image" };
    } else if (request.url === "/openprose/contracts?source=release-check&value=a%2Fb") {
      reply = { status: 308, location: "/contracts?source=release-check&value=a%2Fb" };
    } else if (request.url === "/openprose/contracts.mdx?source=release-check&value=a%2Fb") {
      reply = { status: 308, location: "/contracts.mdx?source=release-check&value=a%2Fb" };
    } else if (request.url === "/start/what-is-openprose?source=release-check&value=a%2Fb" || request.url === "/openprose?source=release-check&value=a%2Fb") {
      reply = { status: 308, location: "/?source=release-check&value=a%2Fb" };
    } else if (request.url === "/cli?source=release-check&value=a%2Fb") {
      reply = { status: 307, location: "https://github.com/openprose/prose/tree/main/packages/reactor-cli?source=release-check&value=a%2Fb" };
    }
    if (request.method === "POST" && ["/robots.txt", "/api/search"].includes(path)) reply = { status: 405 };
    if (request.headers.host === "docs.openprose.ai") {
      reply = request.url === "/setup?source=release-check&value=a%2Fb"
        ? { status: 301, location: "https://docs.prose.md/setup?source=release-check&value=a%2Fb" }
        : { status: 404 };
    }
    reply = override?.(request) ?? reply;
    response.statusCode = reply.status;
    if (reply.type) response.setHeader("Content-Type", reply.type);
    if (reply.location) response.setHeader("Location", reply.location);
    if (reply.vary) response.setHeader("Vary", reply.vary);
    response.end(request.method === "HEAD" ? undefined : reply.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  return `http://127.0.0.1:${address.port}`;
}

describe("HTTP release checks", () => {
  it.each([
    ["@127.0.0.1:4321/private", "docs.openprose.ai"],
    ["http://127.0.0.1:4321/private", "docs.openprose.ai"],
    ["//127.0.0.1:4321/private", "docs.openprose.ai"],
    ["/setup?unexpected=destination", "docs.openprose.ai"],
    ["/openprose/contracts?unexpected=destination", "fixture.test"],
    ["/cli?unexpected=destination", "fixture.test"],
  ])("does not redirect unsupported fixture target %s", async (path, host) => {
    const base = await fixture();
    const result = await new Promise<{ status: number; location?: string }>((resolve, reject) => {
      const req = httpRequest(base, { path, headers: { Host: host }, signal: AbortSignal.timeout(2_000) }, (response) => {
        response.resume();
        response.on("end", () => resolve({ status: response.statusCode!, location: response.headers.location }));
        response.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
    expect(result.location).toBeUndefined();
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  it.each(["public", "preview"] as const)("accepts the complete %s surface", async (mode) => {
    const results = await checkSurface(await fixture(mode), { mode, legacyHost: "docs.openprose.ai" });
    expect(results.length).toBeGreaterThan(30);
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(results.some((result) => result.name.startsWith("HEAD /setup"))).toBe(true);
    expect(results.some((result) => result.name.startsWith("POST /api/search"))).toBe(true);
  });

  it.each([
    ["HTML response", "/setup", { status: 200, type: "application/json", body: "{}" }],
    ["Markdown alias", "/setup.mdx", { status: 200, type: "text/html", body: "<html>Oops</html>" }],
    ["real 404", "/release-check-missing", { status: 200, type: "text/html", body: "Not found" }],
    ["JSON parsing", "/api/search?q=setup", { status: 200, type: "application/json", body: "not json" }],
    ["search result schema", "/api/search?q=setup", { status: 200, type: "application/json", body: '[{"content":"lost URL"}]' }],
    ["OpenAPI document", "/api/search/openapi", { status: 200, type: "application/json", body: "{}" }],
  ] as const)("rejects a broken %s", async (_label, path, reply) => {
    const base = await fixture("public", (request) => request.url === path ? reply : undefined);
    const results = await checkSurface(base, { mode: "public" });
    expect(results.some((result) => result.name.startsWith(`GET ${path}`) && !result.ok)).toBe(true);
  });

  it.each([
    ["wrong status", { status: 302, location: "/contracts?source=release-check&value=a%2Fb" }],
    ["lost query", { status: 308, location: "/contracts" }],
    ["wrong destination", { status: 308, location: "/setup?source=release-check&value=a%2Fb" }],
  ] as const)("rejects a permanent redirect with %s", async (_label, reply) => {
    const base = await fixture("public", (request) => request.url?.startsWith("/openprose/contracts?") ? reply : undefined);
    const results = await checkSurface(base, { mode: "public" });
    expect(results.some((result) => result.name.startsWith("GET /openprose/contracts?") && !result.ok)).toBe(true);
  });

  it("rejects a temporary redirect that becomes permanent", async () => {
    const base = await fixture("public", (request) => request.url?.startsWith("/cli?")
      ? { status: 308, location: "https://github.com/openprose/prose/tree/main/packages/reactor-cli?source=release-check&value=a%2Fb" } : undefined);
    expect((await checkSurface(base, { mode: "public" })).some((r) => r.name.startsWith("GET /cli?") && !r.ok)).toBe(true);
  });

  it("rejects a legacy redirect that loses its query", async () => {
    const base = await fixture("public", (request) => request.headers.host === "docs.openprose.ai"
      ? { status: 301, location: "https://docs.prose.md/setup" } : undefined);
    expect((await checkSurface(base, { mode: "public", legacyHost: "docs.openprose.ai" })).some((r) => r.name.includes("legacy") && !r.ok)).toBe(true);
  });

  it.each(["public", "preview"] as const)("rejects %s robots served in the opposite mode", async (mode) => {
    const base = await fixture(mode === "public" ? "preview" : "public");
    expect((await checkSurface(base, { mode })).some((r) => r.name.startsWith("GET /robots.txt") && !r.ok)).toBe(true);
  });

  it("rejects negotiated Markdown without Vary: Accept", async () => {
    const base = await fixture("public", (request) => request.url === "/setup" && request.headers.accept === "text/markdown"
      ? { status: 200, type: "text/markdown", body: "# Setup" } : undefined);
    expect((await checkSurface(base, { mode: "public" })).some((r) => r.name.includes("Accept: text/markdown") && !r.ok)).toBe(true);
  });

  it.each(["public", "preview"] as const)("rejects a sitemap built for the wrong %s mode", async (mode) => {
    const base = await fixture(mode === "public" ? "preview" : "public");
    expect((await checkSurface(base, { mode })).some((r) => r.name === "GET /sitemap.xml" && !r.ok)).toBe(true);
  });

  it("rejects HEAD errors even when GET works", async () => {
    const base = await fixture("public", (request) => request.method === "HEAD" && request.url === "/setup"
      ? { status: 500 } : undefined);
    expect((await checkSurface(base, { mode: "public" })).some((r) => r.name.startsWith("HEAD /setup") && !r.ok)).toBe(true);
  });

  it("rejects POST being accepted by the search API", async () => {
    const base = await fixture("public", (request) => request.method === "POST" && request.url === "/api/search?q=setup"
      ? { status: 200, type: "application/json", body: "[]" } : undefined);
    expect((await checkSurface(base, { mode: "public" })).some((r) => r.name.startsWith("POST /api/search") && !r.ok)).toBe(true);
  });

  it("rejects a search index that returns no result for a known page", async () => {
    const base = await fixture("public", (request) => request.url === "/api/search?query=setup"
      ? { status: 200, type: "application/json", body: "[]" } : undefined);
    expect((await checkSurface(base, { mode: "public" })).some((r) => r.name === "GET /api/search?query=setup" && !r.ok)).toBe(true);
  });

  it("reports connection failures instead of silently skipping checks", async () => {
    const base = await fixture();
    await new Promise<void>((resolve) => servers[0].close(() => resolve()));
    servers.shift();
    const results = await checkSurface(base, { mode: "public" });
    expect(results.length).toBeGreaterThan(30);
    expect(results.every((result) => !result.ok && result.details)).toBe(true);
  });
});
