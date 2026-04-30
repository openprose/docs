import { basename } from "node:path";
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
    <figure className="prose-program my-6 rounded-xl border border-fd-border overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_6px_rgba(0,0,0,0.02)]">
      {(title || copy) && (
        <figcaption className="flex items-center justify-between px-4 py-2.5 bg-fd-muted border-b border-fd-border">
          <span className="font-mono text-xs uppercase tracking-[0.08em] text-fd-muted-foreground">
            {title ?? basename(src)}
          </span>
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
