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
      className="text-xs px-2 py-0.5 rounded border border-fd-border hover:bg-fd-accent"
      aria-label="Copy program source"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
