import { describe, expect, it } from "vitest";
import { readHandoff, writeHandoff } from "../lib/analytics-handoff";

const distinctID = "019a2a0b-1f11-7000-8000-111111111111";
const sessionID = "019a2a0b-1f22-7000-8000-222222222222";
const hash = `#__op_ph_id=${distinctID}&__op_ph_session=${sessionID}`;

describe("anonymous handoff protocol", () => {
  it.each(["https://prose.md", "https://docs.prose.md", "https://run.prose.md"])("decorates only the owned HTTPS destination %s", (origin) => {
    const original = new URL(`${origin}/setup?utm_source=fixture`);
    expect(writeHandoff(original, distinctID, sessionID).href).toBe(`${origin}/setup?utm_source=fixture${hash}`);
    expect(original.hash).toBe("");
  });
  it.each(["https://outside.test/", "http://prose.md/", "https://prose.md.evil.test/", "https://run.prose.md:444/", "https://docs.prose.md/setup#heading"])("leaves ineligible URL %s unchanged", (href) => {
    expect(writeHandoff(new URL(href), distinctID, sessionID).href).toBe(href);
  });
  it.each(["customer-1", "", `${distinctID}oops`])("never transports malformed or customer identity %s", (id) => {
    expect(writeHandoff(new URL("https://prose.md/"), id, sessionID).hash).toBe("");
    expect(writeHandoff(new URL("https://prose.md/"), distinctID, id).hash).toBe("");
  });
  it("consumes just the protocol fragment while preserving campaign parameters", () => {
    const original = new URL(`https://docs.prose.md/setup?utm_source=fixture${hash}`);
    const result = readHandoff(original, true);
    expect(result.url.href).toBe("https://docs.prose.md/setup?utm_source=fixture");
    expect(result.bootstrap).toEqual({ distinctID, sessionID });
    expect(original.hash).toBe(hash);
  });
  it("consumes a valid fragment without overriding an ineligible destination", () => {
    expect(readHandoff(new URL(`https://docs.prose.md/${hash}`), false)).toEqual({ url: new URL("https://docs.prose.md/") });
  });
  it.each(["#heading", `${hash}&extra=1`, `#__op_ph_id=${distinctID}`, `#__op_ph_id=${distinctID}&__op_ph_id=${sessionID}`, `#__op_ph_id=customer-1&__op_ph_session=${sessionID}`])("retains unrelated or malformed fragment %s", (fragment) => {
    const url = new URL(`https://docs.prose.md/setup?x=1${fragment}`);
    expect(readHandoff(url, true)).toEqual({ url });
  });
});
