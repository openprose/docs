import { describe, it, expect } from "vitest";
import { readProseSource } from "../lib/read-prose-source";

describe("readProseSource", () => {
  it("reads a file relative to repo root", () => {
    const content = readProseSource("vendor/prose-examples/01-hello-world.md");
    expect(content).toContain("hello-world");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws a clear error when the file does not exist", () => {
    expect(() =>
      readProseSource("vendor/prose-examples/does-not-exist.md"),
    ).toThrowError(/ProseProgram src not found/);
  });

  it("throws a clear error when the path escapes the repo root", () => {
    expect(() => readProseSource("../outside-repo.md")).toThrowError(
      /must resolve inside the repo/,
    );
  });

  it("rejects absolute paths", () => {
    expect(() => readProseSource("/etc/passwd")).toThrowError(
      /must be a relative path/,
    );
  });
});
