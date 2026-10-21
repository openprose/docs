const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const owned = new Set(["https://prose.md", "https://docs.prose.md", "https://run.prose.md"]);

export function writeHandoff(url: URL, anonymousID: string, sessionID: string): URL {
  const result = new URL(url);
  if (!owned.has(result.origin) || result.hash || !uuid.test(anonymousID) || !uuid.test(sessionID)) return result;
  result.hash = new URLSearchParams({ __op_ph_id: anonymousID, __op_ph_session: sessionID }).toString();
  return result;
}

export function readHandoff(url: URL, mayBootstrap: boolean): {
  url: URL;
  bootstrap?: { distinctID: string; sessionID: string };
} {
  const result = new URL(url);
  const fields = new URLSearchParams(result.hash.slice(1));
  const distinctID = fields.get("__op_ph_id");
  const sessionID = fields.get("__op_ph_session");
  if (Array.from(fields).length !== 2 || !distinctID || !sessionID || !uuid.test(distinctID) || !uuid.test(sessionID)) return { url: result };
  result.hash = "";
  return { url: result, ...(mayBootstrap ? { bootstrap: { distinctID, sessionID } } : {}) };
}

function canBootstrap(token: string, legacyToken: string | undefined): boolean {
  let local: Storage | undefined;
  let session: Storage | undefined;
  let probe: string | undefined;
  try {
    if (!navigator.cookieEnabled) return false;
    local = window.localStorage;
    session = window.sessionStorage;
    const cookies = document.cookie.split(";").map((part) => {
      const separator = part.indexOf("=");
      return [part.slice(0, separator).trim(), part.slice(separator + 1)] as const;
    });
    // This is the SDK's default persistence key, confirmed against 1.425.1.
    // Presence (even malformed state) is not a fresh anonymous destination.
    const key = `ph_${token.replace(/\+/g, "PL").replace(/\//g, "SL").replace(/=/g, "EQ")}_posthog`;
    if (local.getItem(key) !== null || session.getItem(key) !== null || cookies.some(([name]) => name === key)) return false;
    for (const project of [token, legacyToken].filter((value): value is string => !!value)) {
      const consentKey = `__ph_opt_in_out_${project}`;
      for (const value of [local.getItem(consentKey), ...cookies.filter(([name]) => name === consentKey).map(([, value]) => value)]) {
        // Unknown consent also withholds bootstrap, without changing normal SDK capture.
        if (value != null && value !== "1") return false;
      }
    }
    // A readable but silently blocked store is not proof of a fresh identity.
    probe = `__op_ph_probe_${crypto.randomUUID()}`;
    for (const storage of [local, session]) {
      storage.setItem(probe, "1");
      if (storage.getItem(probe) !== "1") return false;
    }
    document.cookie = `${probe}=1; Path=/; SameSite=Lax`;
    return document.cookie.split(";").some((part) => part.trim() === `${probe}=1`);
  } catch {
    return false;
  } finally {
    if (probe) {
      try { local?.removeItem(probe); } catch { /* Unavailable storage stays ineligible. */ }
      try { session?.removeItem(probe); } catch { /* Unavailable storage stays ineligible. */ }
      try { document.cookie = `${probe}=; Max-Age=0; Path=/; SameSite=Lax`; } catch { /* No writable cookie. */ }
    }
  }
}

// Call only after mode/origin routing has selected this browser's project.
// Parsing is pure; eligibility is resolved before URL consumption and SDK init.
export function receiveAnalyticsHandoff(token: string, legacyToken: string | undefined) {
  const handoff = readHandoff(new URL(window.location.href), true);
  if (!handoff.bootstrap) return;
  const bootstrap = canBootstrap(token, legacyToken) ? handoff.bootstrap : undefined;
  try {
    window.history.replaceState(window.history.state, "", handoff.url);
  } catch {
    return;
  }
  return bootstrap;
}
