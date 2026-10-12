import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setURL = (url: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);

const incomingID = "019a2a0b-1f11-7000-8000-111111111111";
const incomingSession = "019a2a0b-1f22-7000-8000-222222222222";
const incomingURL = `https://docs.prose.md/setup?utm_source=fixture#__op_ph_id=${incomingID}&__op_ph_session=${incomingSession}`;

const sdk = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: sdk }));

beforeEach(() => {
  vi.resetModules();
  sdk.init.mockReset();
  setURL("https://docs.prose.md/setup?utm_source=fixture");
  localStorage.clear();
  sessionStorage.clear();
  document.cookie.split(";").forEach((cookie) => {
    document.cookie = `${cookie.split("=")[0].trim()}=; Max-Age=-1; Path=/`;
  });
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENVIRONMENT", "production");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "production-fixture");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_STAGING_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN", "");
});
afterEach(() => vi.restoreAllMocks());

describe("Docs initialization", () => {
  it.each([undefined, "", "preview", "typo"])("does not initialize for mode %s", async (mode) => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENVIRONMENT", mode);
    await import("../instrumentation-client");
    expect(sdk.init).not.toHaveBeenCalled();
  });
  it.each(["https://preview.example.test", "http://localhost:3000", "http://docs.prose.md"])("does not send a production token from %s", async (origin) => {
    setURL(`${origin}/setup`);
    await import("../instrumentation-client");
    expect(sdk.init).not.toHaveBeenCalled();
  });
  it("requires the explicitly supplied staging key", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENVIRONMENT", "staging");
    setURL("http://localhost:3000/setup");
    await import("../instrumentation-client");
    expect(sdk.init).not.toHaveBeenCalled();
  });
  it("uses the staging key for an explicitly configured local test", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENVIRONMENT", "staging");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_STAGING_KEY", "staging-fixture");
    setURL("http://localhost:3000/setup");
    await import("../instrumentation-client");
    expect(sdk.init).toHaveBeenCalledWith("staging-fixture", expect.any(Object));
  });
  it.each(["localStorage", "cookie"])("preserves a previous project's explicit opt-out in %s", async (store) => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN", "legacy-fixture");
    const consentKey = "__ph_opt_in_out_legacy-fixture";
    if (store === "localStorage") localStorage.setItem(consentKey, "0");
    else document.cookie = `${consentKey}=0; Path=/`;
    await import("../instrumentation-client");
    expect(sdk.init).not.toHaveBeenCalled();
  });
  it.each(["1", "", "unknown"])("retains normal collection when legacy consent is %s", async (value) => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN", "legacy-fixture");
    localStorage.setItem("__ph_opt_in_out_legacy-fixture", value);
    await import("../instrumentation-client");
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });
  it("checks legacy cookie opt-out even when local storage is unavailable", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN", "legacy-fixture");
    document.cookie = "__ph_opt_in_out_legacy-fixture=0; Path=/";
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("storage blocked"); });
    await import("../instrumentation-client");
    expect(sdk.init).not.toHaveBeenCalled();
  });
  it("does not impose a new collection restriction for inaccessible legacy storage", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN", "legacy-fixture");
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("storage blocked"); });
    vi.spyOn(document, "cookie", "get").mockImplementation(() => { throw new Error("cookies blocked"); });
    await import("../instrumentation-client");
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });
  it("consumes transport before initialization and applies fresh anonymous bootstrap", async () => {
    setURL(incomingURL);
    const initializedURLs: string[] = [];
    sdk.init.mockImplementation(() => initializedURLs.push(window.location.href));
    await import("../instrumentation-client");
    expect(initializedURLs).toEqual(["https://docs.prose.md/setup?utm_source=fixture"]);
    expect(sdk.init.mock.calls[0][1]).toMatchObject({
      bootstrap: { distinctID: incomingID, sessionID: incomingSession },
      persistence: "localStorage+cookie", cross_subdomain_cookie: true, cookieWinsOnConflict: true,
    });
    await vi.waitFor(() => expect(document.cookie).not.toContain("__op_ph_probe"));
    expect(Object.keys(localStorage)).toEqual([]);
    expect(Object.keys(sessionStorage)).toEqual([]);
  });
  it.each(["anonymous", "identified", "malformed"])("does not replace existing %s local identity", async (state) => {
    localStorage.setItem("ph_production-fixture_posthog", state === "malformed" ? "invalid" : JSON.stringify({ distinct_id: "existing", __user_state: state }));
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
    expect(window.location.hash).toBe("");
  });
  it("does not overwrite existing shared cookie identity", async () => {
    document.cookie = `ph_production-fixture_posthog=${encodeURIComponent(JSON.stringify({ distinct_id: "customer-A", __user_state: "identified" }))}; Path=/`;
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
    expect(window.location.hash).toBe("");
  });
  it("treats existing project session storage as an ineligible prior visit", async () => {
    sessionStorage.setItem("ph_production-fixture_posthog", "{}");
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
  });
  it.each(["getItem", "setItem"] as const)("withholds bootstrap when storage %s is unavailable", async (method) => {
    const storage = window.localStorage;
    vi.spyOn(window, "localStorage", "get").mockReturnValue({
      getItem: storage.getItem.bind(storage),
      setItem: storage.setItem.bind(storage),
      removeItem: storage.removeItem.bind(storage),
      [method]: () => { throw new Error("blocked"); },
    } as unknown as Storage);
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
    expect(window.location.hash).toBe("");
  });
  it("withholds bootstrap when cookies are disabled", async () => {
    vi.spyOn(navigator, "cookieEnabled", "get").mockReturnValue(false);
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
  });
  it("withholds bootstrap when cookie writes are silently dropped", async () => {
    vi.spyOn(document, "cookie", "set").mockImplementation(() => {});
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
  });
  it.each(["0", "unknown"])("withholds bootstrap for current consent %s while retaining SDK opt-out handling", async (consent) => {
    localStorage.setItem("__ph_opt_in_out_production-fixture", consent);
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
    expect(window.location.hash).toBe("");
  });
  it("withholds bootstrap when duplicate cookie consent includes an opt-out", async () => {
    let cookies = "__ph_opt_in_out_production-fixture=0; __ph_opt_in_out_production-fixture=1";
    vi.spyOn(document, "cookie", "get").mockImplementation(() => cookies);
    vi.spyOn(document, "cookie", "set").mockImplementation((value) => { cookies += `; ${value.split(";")[0]}`; });
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
  });
  it("does not bootstrap when configured legacy consent is unknown", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN", "legacy-fixture");
    localStorage.setItem("__ph_opt_in_out_legacy-fixture", "unknown");
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
  });
  it("consumes valid transport but does not initialize for legacy opt-out", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN", "legacy-fixture");
    localStorage.setItem("__ph_opt_in_out_legacy-fixture", "0");
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });
  it.each(["#heading", "#__op_ph_id=bad&__op_ph_session=bad"])("preserves unrelated/malformed fragment %s", async (hash) => {
    setURL(`https://docs.prose.md/setup?utm_source=fixture${hash}`);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
    expect(window.location.hash).toBe(hash);
  });
  it("does not consume an incoming identity on an ineligible production preview", async () => {
    setURL(incomingURL.replace("https://docs.prose.md", "https://preview.example.test"));
    const original = window.location.href;
    await import("../instrumentation-client");
    expect(sdk.init).not.toHaveBeenCalled();
    expect(window.location.href).toBe(original);
  });
  it("uses the SDK token escaping when checking existing persistence", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "a+b/c=");
    localStorage.setItem("ph_aPLbSLcEQ_posthog", "{}");
    setURL(incomingURL);
    await import("../instrumentation-client");
    expect(sdk.init.mock.calls[0][1].bootstrap).toBeUndefined();
  });
  it("retains capture options and stamps every event without rewriting URL properties", async () => {
    await import("../instrumentation-client");
    const config = sdk.init.mock.calls[0][1];
    expect(config).toMatchObject({
      api_host: "https://us.i.posthog.com",
      capture_exceptions: true,
      capture_pageview: "history_change",
      person_profiles: "identified_only",
    });
    const event = { event: "$pageview", properties: { site_surface: "wrong", $current_url: "https://docs.prose.md/setup?utm_source=fixture#heading", $referrer: "https://example.test/from?a=1" } };
    expect(config.before_send(event)).toEqual({ ...event, properties: { ...event.properties, site_surface: "docs" } });
    expect(config.before_send(null)).toBeNull();
  });
});
