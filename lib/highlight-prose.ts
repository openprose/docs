import { codeToHtml } from "shiki";
import { transformerMetaHighlight } from "@shikijs/transformers";

export interface HighlightOptions {
  highlightLines?: string;
}

export async function highlightProse(
  code: string,
  options: HighlightOptions = {},
): Promise<string> {
  const meta = options.highlightLines ? `{${options.highlightLines}}` : "";
  return codeToHtml(code, {
    lang: "markdown",
    themes: { light: "solarized-dark", dark: "solarized-dark" },
    meta: { __raw: meta },
    transformers: [transformerMetaHighlight()],
  });
}
