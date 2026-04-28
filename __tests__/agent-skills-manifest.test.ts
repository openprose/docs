import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

describe(".well-known/agent-skills/index.json", () => {
  const root = resolve(__dirname, "..");
  let schema: unknown;
  let manifest: { skills: Array<{ url: string }> };

  beforeAll(() => {
    schema = JSON.parse(
      readFileSync(
        resolve(root, "public/.well-known/agent-skills/schema.json"),
        "utf-8",
      ),
    );
    manifest = JSON.parse(
      readFileSync(
        resolve(root, "public/.well-known/agent-skills/index.json"),
        "utf-8",
      ),
    );
  });

  it("validates against the local schema", () => {
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema as object);
    const valid = validate(manifest);
    if (!valid) {
      console.error(validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("contains at least one skill entry", () => {
    expect(manifest.skills.length).toBeGreaterThan(0);
  });

  it("each skill URL points to docs.openprose.ai", () => {
    for (const skill of manifest.skills) {
      expect(skill.url.startsWith("https://docs.openprose.ai/")).toBe(true);
    }
  });
});
