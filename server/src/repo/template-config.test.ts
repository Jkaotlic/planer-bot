import { describe, it, expect } from "vitest";
import {
  parseCoverage,
  serializeCoverage,
  assertFillMode,
  assertRotationUnit,
  validateTemplateConfig,
  TemplateConfigError,
} from "./template-config";
import { makeTestDb } from "../db/testdb";
import { listActiveTemplates } from "../repo/templates";

describe("parseCoverage", () => {
  it("reads the verified Monday rule for Утро", () => {
    expect(parseCoverage("3,2,2,2,2,0,0")).toEqual([3, 2, 2, 2, 2, 0, 0]);
  });

  it("tolerates spaces around the numbers", () => {
    expect(parseCoverage(" 1, 0 ,0,0,0,0,0 ")).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });

  it("rejects the wrong number of days", () => {
    expect(() => parseCoverage("1,1,1")).toThrow(/ровно 7/);
    expect(() => parseCoverage("1,1,1,1,1,1,1,1")).toThrow(/ровно 7/);
  });

  it("rejects everything Number() would silently accept", () => {
    for (const bad of ["", "1e3", "0x2", "-1", "1.5", "Infinity", "abc", " "]) {
      expect(() => parseCoverage(`${bad},0,0,0,0,0,0`), `coverage "${bad}" must be rejected`).toThrow(TemplateConfigError);
    }
  });

  it("names the offending weekday so the editor can point at it", () => {
    expect(() => parseCoverage("1,1,-1,1,1,1,1")).toThrow(/день 3/);
  });
});

describe("serializeCoverage", () => {
  it("round-trips through parseCoverage", () => {
    const values = [3, 2, 2, 2, 2, 0, 0];
    expect(parseCoverage(serializeCoverage(values))).toEqual(values);
  });

  it("refuses to write a value it would refuse to read", () => {
    expect(() => serializeCoverage([1, 2, 3])).toThrow(/ровно 7/);
    expect(() => serializeCoverage([1, 1, 1, 1, 1, 1, -1])).toThrow(/день 7/);
    expect(() => serializeCoverage([1, 1, 1, 1, 1, 1, 1.5])).toThrow(/день 7/);
  });
});

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
