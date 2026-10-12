export function analyticsMode(value: string | undefined) {
  return value === "production" || value === "staging" ? value : "disabled";
}

export function analyticsKey({ environment, productionKey, stagingKey, origin }: {
  environment: string | undefined;
  productionKey: string | undefined;
  stagingKey: string | undefined;
  origin: string;
}): string | undefined {
  const mode = analyticsMode(environment);
  if (mode === "production" && origin === "https://docs.prose.md") return productionKey || undefined;
  if (mode === "staging") return stagingKey || undefined;
}

// Project tokens scope the SDK's consent storage. Preserve an explicit opt-out
// from the previous project when the deployment supplies that previous token.
export function hasLegacyAnalyticsOptOut(legacyToken: string | undefined): boolean {
  if (!legacyToken || typeof window === "undefined") return false;
  const key = `__ph_opt_in_out_${legacyToken}`;
  try {
    if (window.localStorage.getItem(key) === "0") return true;
  } catch {
    // Unavailable storage does not change the SDK's existing capture policy.
  }
  try {
    return document.cookie.split(";").some((part) => part.trim() === `${key}=0`);
  } catch {
    return false;
  }
}
