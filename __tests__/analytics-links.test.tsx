import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsLinks } from "../components/AnalyticsLinks";

const state = vi.hoisted(() => ({ pathname: "/setup", capturing: true, capture: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("posthog-js", () => ({ default: { is_capturing: () => state.capturing, capture: state.capture } }));
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  state.pathname = "/setup";
  state.capturing = true;
  state.capture.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<AnalyticsLinks />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function activate(href: string, options: MouseEventInit = {}, type = "click", placement = "article") {
  const area = document.createElement(placement);
  const link = document.createElement("a");
  link.href = href;
  link.innerHTML = "<span>Open source</span>";
  area.append(link);
  document.body.append(area);
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...options });
  link.firstElementChild!.dispatchEvent(event);
  return { link, event };
}

describe("curated Docs links", () => {
  it.each([
    ["https://github.com/openprose/docs", "github_docs", "nav", "header"],
    ["https://github.com/openprose/prose", "github_prose", "article", "docs_content"],
    ["https://github.com/openprose/prose/tree/main/skills/open-prose/examples", "examples", "article", "docs_content"],
    ["https://github.com/openprose/prose/blob/main/spec/01-Language.md#part-iii--what-is-next", "github_prose", "article", "docs_content"],
  ])("tracks the existing OSS destination %s", (href, destination, area, placement) => {
    const { link, event } = activate(href, {}, "click", area);
    expect(state.capture).toHaveBeenCalledExactlyOnceWith("site:link_click", {
      destination_name: destination,
      link_purpose: "explore",
      placement,
      page_path: "/setup",
      page_visit_id: expect.any(String),
      event_version: 1,
    });
    expect(event.defaultPrevented).toBe(false);
    expect(link.href).toBe(href);
  });
  it.each([{ detail: 0 }, { ctrlKey: true }, { metaKey: true }])("retains keyboard/modifier navigation %j", (options) => {
    expect(activate("https://github.com/openprose/docs", options).event.defaultPrevented).toBe(false);
    expect(state.capture).toHaveBeenCalledTimes(1);
  });
  it("counts a middle-click once and ignores the right button", () => {
    activate("https://github.com/openprose/docs", { button: 1 }, "auxclick");
    activate("https://github.com/openprose/docs", { button: 2 }, "auxclick");
    expect(state.capture).toHaveBeenCalledTimes(1);
  });
  it.each(["/setup", "https://unrelated.test/", "https://github.com/other/prose", "https://github.com/openprose/docs/pulls", "https://github.com/openprose/prose/fake", "https://run.prose.md/", "https://prose.md/"])("ignores uncurated destination %s", (href) => {
    activate(href);
    expect(state.capture).not.toHaveBeenCalled();
  });
  it("does not emit when capture is disabled or opted out", () => {
    state.capturing = false;
    activate("https://github.com/openprose/docs");
    expect(state.capture).not.toHaveBeenCalled();
  });
  it("keeps a visit across rerenders and starts a new one on navigation without duplicate listeners", async () => {
    activate("https://github.com/openprose/docs");
    const first = state.capture.mock.calls[0][1].page_visit_id;
    await act(async () => root.render(<AnalyticsLinks />));
    activate("https://github.com/openprose/docs");
    expect(state.capture.mock.calls[1][1].page_visit_id).toBe(first);
    state.pathname = "/contracts";
    await act(async () => root.render(<AnalyticsLinks />));
    activate("https://github.com/openprose/docs");
    expect(state.capture).toHaveBeenCalledTimes(3);
    expect(state.capture.mock.calls[2][1]).toMatchObject({ page_path: "/contracts", page_visit_id: expect.not.stringMatching(first) });
  });
  it("leaves the page usable if secure visit IDs are unavailable", async () => {
    await act(async () => root.unmount());
    vi.stubGlobal("crypto", {});
    root = createRoot(container);
    await act(async () => root.render(<AnalyticsLinks />));
    expect(activate("https://github.com/openprose/docs").event.defaultPrevented).toBe(false);
    expect(state.capture).not.toHaveBeenCalled();
  });
  it("does not block navigation if the analytics client fails", () => {
    state.capture.mockImplementation(() => { throw new Error("unavailable"); });
    expect(activate("https://github.com/openprose/docs").event.defaultPrevented).toBe(false);
  });
});
