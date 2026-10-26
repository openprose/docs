// @vitest-environment node
import { createServer, request, type RequestListener } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createReleaseProxyHandler } from "../scripts/release-proxy.mjs";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function listen(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  return `http://127.0.0.1:${address.port}`;
}

function send(base: string, path: string, method = "GET", body = "") {
  return new Promise<{ status: number; body: string; headers: import("node:http").IncomingHttpHeaders }>((resolve, reject) => {
    const req = request(base, { path, method, headers: { "x-forwarding-check": "retained" }, signal: AbortSignal.timeout(2_000) }, (response) => {
      let result = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { result += chunk; });
      response.on("end", () => resolve({ status: response.statusCode!, body: result, headers: response.headers }));
      response.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function fixture() {
  const received: { release: string; path: string; method: string; header: string | string[] | undefined; body: string }[] = [];
  const upstream = (release: string): RequestListener => async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push({ release, path: request.url!, method: request.method!, header: request.headers["x-forwarding-check"], body });
    response.writeHead(201, { "x-release": release });
    response.end(release);
  };
  const origins = { a: await listen(upstream("a")), b: await listen(upstream("b")) };
  const report = { requests: [], controls: [] };
  const base = await listen(createReleaseProxyHandler(origins, report));
  return { base, received, report };
}

describe("release diagnostic proxy", () => {
  it.each(["absolute", "protocol-relative", "backslash authority"])("rejects a %s target without contacting another loopback server", async (kind) => {
    const { base, received } = await fixture();
    let escapedRequests = 0;
    const other = await listen((_request, response) => {
      escapedRequests++;
      response.end("escaped");
    });
    const authority = kind === "absolute" ? other : kind === "protocol-relative" ? other.slice(5) : `/\\${other.slice(7)}`;
    const target = `${authority}/private?value=a%2Fb`;
    const result = await send(base, target);
    expect(escapedRequests).toBe(0);
    expect(result.status).toBe(400);
    expect(received).toEqual([]);
    expect((await send(base, "/__release-check/health")).status).toBe(200);
  });

  it.each(["/bad%", "/bad%2", "/bad%GG", "/path#fragment", "*", "http://[", "//", "@127.0.0.1:4321/private"])("rejects unsupported target %s locally", async (target) => {
    const { base, received } = await fixture();
    expect((await send(base, target)).status).toBe(400);
    expect(received).toEqual([]);
    expect((await send(base, "/__release-check/health")).status).toBe(200);
  });

  it.each([
    ["a", "a", "a"],
    ["b", "b", "b"],
    ["a-page-b-assets", "a", "b"],
    ["b-page-a-assets", "b", "a"],
  ])("preserves forwarding and page/asset selection in %s mode", async (mode, pageRelease, assetRelease) => {
    const { base, received, report } = await fixture();
    expect((await send(base, "/__release-check/control", "POST", JSON.stringify({ mode }))).status).toBe(200);
    const page = await send(base, "/set%75p/a%2Fb?value=a%2Fb&literal=%252F&space=a+b", "POST", "forwarded body");
    const asset = await send(base, "/_next/static/chunk%20name.js?dpl=release%2Fa");
    expect(page).toMatchObject({ status: 201, body: pageRelease, headers: { "x-release": pageRelease } });
    expect(asset).toMatchObject({ status: 201, body: assetRelease, headers: { "x-release": assetRelease } });
    expect(received).toEqual([
      { release: pageRelease, path: "/set%75p/a%2Fb?value=a%2Fb&literal=%252F&space=a+b", method: "POST", header: "retained", body: "forwarded body" },
      { release: assetRelease, path: "/_next/static/chunk%20name.js?dpl=release%2Fa", method: "GET", header: "retained", body: "" },
    ]);
    expect(report.requests).toMatchObject([{ release: pageRelease, mode, status: 201 }, { release: assetRelease, mode, status: 201 }]);
    expect(report.controls).toMatchObject([{ mode }]);
  });
});
