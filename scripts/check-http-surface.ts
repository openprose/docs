import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";

export type CheckResult = { name: string; ok: boolean; details?: string };
type Mode = "public" | "preview";
type Probe = {
  path: string;
  status: number;
  type?: string;
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  label?: string;
  location?: string;
  body?: (body: string, headers: IncomingHttpHeaders) => boolean;
};

// Use Node's HTTP client: fetch can discard an explicit Host header, which
// would test the origin's default host instead of the legacy-host redirect.
function request(url: URL, probe: Probe): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolveResponse, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(url, { method: probe.method ?? "GET", headers: probe.headers, signal: AbortSignal.timeout(10_000) }, (response) => {
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 10 * 1024 * 1024) req.destroy(new Error("Response exceeds 10 MiB"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolveResponse({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const query = "?source=release-check&value=a%2Fb";
const sitemap = "https://docs.prose.md/sitemap.xml";
const markdown = (body: string) => body.trim().length > 0 && !/^\s*<(?:!doctype|html)/i.test(body);
const html = (body: string) => /<html[\s>]/i.test(body) && /<body[\s>]/i.test(body);
const jsonSearch = (body: string) => {
  const value: unknown = JSON.parse(body);
  return Array.isArray(value) && value.every((item) =>
    item && typeof item.id === "string" && typeof item.url === "string" &&
    ["page", "heading", "text"].includes(item.type) && typeof item.content === "string");
};

/** Check externally observable behavior without reading or changing the server's files. */
export async function checkSurface(
  baseUrl: string,
  options: { mode: Mode; legacyHost?: string },
): Promise<CheckResult[]> {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
    throw new Error("Expected an HTTP(S) origin without credentials");
  }
  if (!["public", "preview"].includes(options.mode)) throw new Error("Expected public or preview mode");
  const probes: Probe[] = [
    ...["/", "/setup"].map((path): Probe => ({ path, status: 200, type: "text/html", body: html })),
    ...["/setup.mdx", "/index.mdx", "/.mdx", "/llms.mdx/setup/content.md"].map((path): Probe => ({
      path, status: 200, type: "text/markdown", body: markdown,
    })),
    ...["/", "/setup"].map((path): Probe => ({
      path, status: 200, type: "text/markdown", headers: { Accept: "text/markdown" },
      label: "Accept: text/markdown",
      body: (body, headers) => markdown(body) && /(^|,)\s*accept\s*(,|$)/i.test(headers.vary ?? ""),
    })),
    { path: "/llms.txt", status: 200, type: "text/plain", headers: { Accept: "text/plain" }, body: (body) => body.includes("# OpenProse") && body.includes("](/setup)") },
    { path: "/sitemap.xml", status: 200, type: "application/xml", body: (body) => body.includes("<urlset") && body.includes("</urlset>") && (options.mode === "public"
      ? body.includes("<loc>https://docs.prose.md/setup</loc>")
      : !body.includes("<loc>")) },
    { path: "/robots.txt", status: 200, type: "text/plain", body: (body) => options.mode === "public"
      ? /^User-Agent: Googlebot\r?\nAllow: \/\r?$/m.test(body) && body.includes(`Sitemap: ${sitemap}`) && !/^Disallow: \/\r?$/m.test(body)
      : /^User-Agent: \*\r?\nDisallow: \/\r?$/m.test(body) && !/^Allow: \/\r?$/m.test(body) },
    { path: "/api/search?q=setup", status: 200, type: "application/json", headers: { Accept: "application/json, text/plain, */*" }, body: jsonSearch },
    // The browser search uses `query`; also retain the advertised `q` probe
    // above without treating its empty result as proof of a working index.
    { path: "/api/search?query=setup", status: 200, type: "application/json", headers: { Accept: "application/json, text/plain, */*" }, body: (body) => jsonSearch(body) && JSON.parse(body).length > 0 },
    { path: "/api/search/openapi", status: 200, type: "application/json", headers: { Accept: "application/json, text/plain, */*" }, body: (body) => {
      const value = JSON.parse(body);
      return value?.openapi === "3.1.0" && typeof value.paths?.["/api/search"]?.get === "object";
    } },
    { path: "/og/setup/image.png", status: 200, type: "image/png" },
    ...["/release-check-missing", "/release-check-missing.mdx", "/llms.mdx/release-check-missing/content.md", "/llms.mdx", "/og/release-check-missing/image.png", "/robots%2Etxt"].map((path): Probe => ({ path, status: 404 })),
    ...[
      ["/openprose/contracts", "/contracts"],
      ["/openprose/contracts.mdx", "/contracts.mdx"],
      ["/start/what-is-openprose", "/"],
      ["/openprose", "/"],
    ].map(([path, location]): Probe => ({ path: path + query, location: location + query, status: 308 })),
    { path: "/cli" + query, location: "https://github.com/openprose/prose/tree/main/packages/reactor-cli" + query, status: 307 },
  ];
  if (options.legacyHost) probes.push({
    path: "/setup" + query, headers: { Host: options.legacyHost }, label: "legacy host", status: 301,
    location: "https://docs.prose.md/setup" + query,
  });

  // Next serves prerendered pages for POST, while GET-only dynamic handlers
  // and the robots route reject it. Do not impose a blanket 405 policy.
  for (const path of ["/setup", "/setup.mdx", "/api/search?q=setup", "/robots.txt", "/release-check-missing", "/cli" + query]) {
    const get = probes.find((probe) => probe.path === path)!;
    probes.push({ ...get, method: "HEAD", body: (body) => body.length === 0 });
    probes.push(["/api/search?q=setup", "/robots.txt"].includes(path)
      ? { path, method: "POST", status: 405 }
      : { ...get, method: "POST" });
  }

  const results: CheckResult[] = [];
  for (const probe of probes) {
    const method = probe.method ?? "GET";
    const name = `${method} ${probe.path}${probe.label ? ` (${probe.label})` : ""}`;
    try {
      const response = await request(new URL(probe.path, base), probe);
      const type = response.headers["content-type"]?.split(";")[0].trim().toLowerCase();
      const location = response.headers.location;
      const ok = response.status === probe.status && (!probe.type || type === probe.type) &&
        (!probe.location || (location !== undefined && new URL(location, base).href === new URL(probe.location, base).href)) &&
        (!probe.body || probe.body(response.body, response.headers));
      results.push({ name, ok, ...(ok ? {} : { details: `Expected ${probe.status}${probe.type ? ` ${probe.type}` : ""}${probe.location ? ` → ${probe.location}` : ""} and valid body; received ${response.status} ${type ?? "no content type"}${location ? ` → ${location}` : ""}` }) });
    } catch (error) {
      results.push({ name, ok: false, details: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

async function main() {
  const [base, mode, legacyHost] = process.argv.slice(2);
  if (!base || !["public", "preview"].includes(mode)) {
    console.error("Usage: tsx scripts/check-http-surface.ts <base-url> <public|preview> [legacy-host]");
    process.exitCode = 2;
  } else {
    const results = await checkSurface(base, { mode: mode as Mode, legacyHost });
    console.log(JSON.stringify(results, null, 2));
    process.exitCode = results.every((result) => result.ok) ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
