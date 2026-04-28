import { readProseSource } from "@/lib/read-prose-source";
import { highlightProse } from "@/lib/highlight-prose";
import { CopyButton } from "./copy-button";

export interface ProseProgramProps {
  src: string;
  title?: string;
  highlightLines?: string;
  copy?: boolean;
}

export async function ProseProgram({
  src,
  title,
  highlightLines,
  copy = true,
}: ProseProgramProps) {
  const code = readProseSource(src);
  const html = await highlightProse(code, { highlightLines });

  return (
    <figure className="prose-program my-6 rounded border border-fd-border overflow-hidden">
      {(title || copy) && (
        <figcaption className="flex items-center justify-between px-4 py-2 bg-fd-muted text-sm">
          <span>{title ?? src.split("/").pop()}</span>
          {copy ? <CopyButton text={code} /> : null}
        </figcaption>
      )}
      <div
        className="prose-program-code text-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </figure>
  );
}
