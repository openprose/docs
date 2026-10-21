"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";

type DocsDestination = "github_docs" | "github_prose" | "examples";

// Only public source destinations already linked by the Docs layout and pages.
function destination(url: URL): DocsDestination | undefined {
  if (url.origin !== "https://github.com") return;
  const path = url.pathname.replace(/\/$/, "");
  if (path === "/openprose/docs" || /^\/openprose\/docs\/blob\/main\/content\/docs\//.test(path)) return "github_docs";
  if (/^\/openprose\/prose\/tree\/(main|[0-9a-f]{40})\/skills\/open-prose\/examples(?:\/|$)/.test(path)) return "examples";
  if (path === "/openprose/prose" || path === "/openprose/prose/issues" ||
      /^\/openprose\/prose\/(blob|tree)\/(main|[0-9a-f]{40})\/(skills\/open-prose|spec)(?:\/|$)/.test(path)) return "github_prose";
}

export function AnalyticsLinks() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof crypto.randomUUID !== "function") return;
    const visit = crypto.randomUUID();
    const observe = (event: MouseEvent) => {
      if ((event.type === "click" && event.button !== 0) ||
          (event.type === "auxclick" && event.button !== 1)) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      try {
        if (!posthog.is_capturing()) return;
        const name = destination(new URL(anchor.href));
        if (!name) return;
        posthog.capture("site:link_click", {
          destination_name: name,
          link_purpose: "explore",
          placement: anchor.closest("nav, #nd-sidebar") ? "header" : "docs_content",
          page_path: pathname,
          page_visit_id: visit,
          event_version: 1,
        });
      } catch {
        // Analytics must not interfere with the browser's native navigation.
      }
    };
    document.addEventListener("click", observe);
    document.addEventListener("auxclick", observe);
    return () => {
      document.removeEventListener("click", observe);
      document.removeEventListener("auxclick", observe);
    };
  }, [pathname]);

  return null;
}
