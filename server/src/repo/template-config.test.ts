import { describe, it, expect } from "vitest";
import {
  assertFillMode,
  assertRotationUnit,
  validateTemplateConfig,
} from "./template-config";
import { makeTestDb } from "../db/testdb";
import { listActiveTemplates } from "../repo/templates";

describe("enum columns", () => {
  it("accepts the documented values and rejects anything else", () => {
    expect(() => assertFillMode("count")).not.toThrow();
    expect(() => assertFillMode("remainder")).not.toThrow();
    expect(() => assertFillMode("Count")).toThrow(/режим заполнения/);
    expect(() => assertRotationUnit("day")).not.toThrow();
    expect(() => assertRotationUnit("week")).not.toThrow();
    expect(() => assertRotationUnit("month")).toThrow(/очередности/);
  });
});

describe("the presets actually in the database", () => {
  it("every seeded preset already satisfies the validator", () => {
    // Guards the other direction too: if a migration ever seeds a malformed row,
    // this fails before the Stage 3 editor is pointed at it.
    for (const template of listActiveTemplates(makeTestDb())) {
      expect(() => validateTemplateConfig(template), `preset "${template.name}" has invalid config`).not.toThrow();
    }
  });
});
