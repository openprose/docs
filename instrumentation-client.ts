import posthog from "posthog-js";
import { analyticsKey, hasLegacyAnalyticsOptOut } from "./lib/analytics-config";
import { receiveAnalyticsHandoff } from "./lib/analytics-handoff";

const key = typeof window === "undefined" ? undefined : analyticsKey({
  environment: process.env.NEXT_PUBLIC_POSTHOG_ENVIRONMENT,
  productionKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  stagingKey: process.env.NEXT_PUBLIC_POSTHOG_STAGING_KEY,
  origin: window.location.origin,
});

const legacyToken = process.env.NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN;
const legacyOptOut = key && hasLegacyAnalyticsOptOut(legacyToken);
const bootstrap = key ? receiveAnalyticsHandoff(key, legacyToken) : undefined;

if (key && !legacyOptOut) {
  posthog.init(key, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_exceptions: true, // free-tier Error Tracking
    capture_pageview: "history_change",
    person_profiles: "identified_only",
    persistence: "localStorage+cookie",
    cross_subdomain_cookie: true,
    cookieWinsOnConflict: true,
    ...(bootstrap ? { bootstrap } : {}),
    before_send(event) {
      if (event === null) return null;
      event.properties = { ...event.properties, site_surface: "docs" };
      return event;
    },
  });
}
