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
    <main className="mx-auto max-w-prose py-16 text-center">
      <h1 className="text-2xl font-semibold mb-4">Something went wrong</h1>
      <p className="mb-6 text-fd-muted-foreground">
        The error has been reported. You can try again, or head back to the
        docs.
      </p>
      <button
        type="button"
        onClick={reset}
        className="px-4 py-2 rounded border border-fd-border hover:bg-fd-muted"
      >
        Try again
      </button>
    </main>
  );
}
