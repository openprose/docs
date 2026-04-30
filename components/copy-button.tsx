"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts; degrade silently.
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="font-mono text-[11px] uppercase tracking-[0.08em] px-2.5 py-1 rounded border border-fd-border text-fd-muted-foreground hover:text-fd-accent-foreground hover:border-fd-accent-foreground transition-colors"
      aria-label="Copy program source"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
