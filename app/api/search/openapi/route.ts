import { SITE } from "@/lib/site";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "OpenProse Docs Search",
    version: "1.0.0",
    description: "Full-text search over the OpenProse documentation.",
  },
  servers: [{ url: SITE.canonicalBaseUrl }],
  paths: {
    "/api/search": {
      get: {
        summary: "Search docs",
        operationId: "searchDocs",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            description: "Search query",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Matching pages, headings, and text fragments",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  // Mirrors fumadocs-core's SortedResult shape so agents
                  // discovering this spec see the field names the search
                  // endpoint actually returns.
                  items: {
                    type: "object",
                    required: ["id", "url", "type", "content"],
                    properties: {
                      id: { type: "string" },
                      url: { type: "string", format: "uri-reference" },
                      type: {
                        type: "string",
                        enum: ["page", "heading", "text"],
                      },
                      content: { type: "string" },
                      breadcrumbs: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const dynamic = "force-static";

export async function GET() {
  return new Response(JSON.stringify(spec, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
