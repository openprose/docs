import { getLLMText, getPageMarkdownUrl, source } from "@/lib/source";
import { notFound } from "next/navigation";

export const revalidate = false;

// Every markdown file is generated at build time, one per docs page. Without
// this, any other path the pattern matches (say /llms.mdx/setup/other.md) is
// rendered on demand and stored on disk under the requested name, and Next
// never evicts those files.
export const dynamicParams = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<"/llms.mdx/[[...slug]]">,
) {
  const { slug } = await params;
  const page = source.getPage(slug?.slice(0, -1));
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      "Content-Type": "text/markdown",
    },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageMarkdownUrl(page).segments,
  }));
}
