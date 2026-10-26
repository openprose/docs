import { request as proxyRequest } from "node:http";

export function createReleaseProxyHandler(origins, report) {
  let mode = "a";
  return async (request, response) => {
    // Only origin-form paths may reach the managed containers. Never interpret
    // a client request target as an upstream authority.
    if (typeof request.url !== "string" || !/^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*$/.test(request.url) || /%(?![A-Fa-f0-9]{2})/.test(request.url)) {
      response.writeHead(400);
      return response.end("Unsupported request target");
    }
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/__release-check/")) {
      response.setHeader("Content-Type", "application/json");
      if (url.pathname === "/__release-check/health") return response.end('{"ready":true}');
      if (url.pathname === "/__release-check/report") return response.end(JSON.stringify(report));
      if (url.pathname === "/__release-check/control" && request.method === "POST") {
        try {
          let body = "";
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 1_024) throw new Error("Control request too large");
          }
          const next = JSON.parse(body).mode;
          if (!["a", "b", "a-page-b-assets", "b-page-a-assets"].includes(next)) throw new Error("Unknown mode");
          mode = next;
          report.controls.push({ mode, timestamp: new Date().toISOString() });
          return response.end(JSON.stringify({ mode }));
        } catch (error) { response.statusCode = 400; return response.end(JSON.stringify({ error: error.message })); }
      }
      response.statusCode = 404;
      return response.end("{}");
    }
    const isAsset = url.pathname.startsWith("/_next/static/");
    const release = mode === "a-page-b-assets" ? (isAsset ? "b" : "a")
      : mode === "b-page-a-assets" ? (isAsset ? "a" : "b") : mode;
    const event = { method: request.method, path: request.url, release, mode, status: null };
    report.requests.push(event);
    const upstream = proxyRequest({
      hostname: "127.0.0.1",
      port: new URL(origins[release]).port,
      path: request.url,
      method: request.method,
      headers: request.headers,
    }, (result) => {
      event.status = result.statusCode;
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    upstream.on("error", (error) => {
      event.error = error.message;
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  };
}
