"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    posthog.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-prose py-20 text-center">
      <h1 className="text-3xl font-medium mb-4 tracking-tight">
        Something went wrong
      </h1>
      <p className="mb-8 text-fd-muted-foreground leading-relaxed">
        The error has been reported. You can try again, or head back to the
        docs.
      </p>
      <button
        type="button"
        onClick={reset}
        className="font-mono text-xs uppercase tracking-[0.08em] px-4 py-2.5 rounded border border-fd-border text-fd-foreground hover:border-fd-accent-foreground hover:text-fd-accent-foreground transition-colors"
      >
        Try again
      </button>
    </main>
  );
}
