import type { ShiftTemplate } from "../db/schema";

/**
 * `coverage`, `fill_mode` and `rotation_unit` are plain TEXT columns — drizzle's
 * `$type<>` is erased at compile time and SQLite has no CHECK on them, so nothing
 * stops a bad value from reaching the row. Today there are no writers; the Stage 3
 * role editor will be the first, and it must run every value through here before
 * the write, not after.
 */

export const FILL_MODES = ["count", "remainder"] as const;
export const ROTATION_UNITS = ["day", "week"] as const;
export type FillMode = (typeof FILL_MODES)[number];
export type RotationUnit = (typeof ROTATION_UNITS)[number];

/** Mon..Sun head-count, one entry per weekday. */
export const COVERAGE_DAYS = 7;

export class TemplateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateConfigError";
  }
}

/**
 * "3,2,2,2,2,0,0" -> [3,2,2,2,2,0,0]. Exactly seven non-negative integers, Mon..Sun.
 * Throws with a Russian message naming what was wrong — this surfaces in the editor.
 */
export function parseCoverage(raw: string): number[] {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length !== COVERAGE_DAYS) {
    throw new TemplateConfigError(`«Покрытие» должно содержать ровно ${COVERAGE_DAYS} чисел (Пн..Вс), а не ${parts.length}`);
  }
  return parts.map((part, index) => {
    // Number() would happily accept "", " ", "1e3", "0x2" and Infinity.
    if (!/^\d+$/.test(part)) {
      throw new TemplateConfigError(`«Покрытие», день ${index + 1}: «${part}» — нужно целое число не меньше нуля`);
    }
    const value = Number(part);
    if (!Number.isSafeInteger(value)) {
      throw new TemplateConfigError(`«Покрытие», день ${index + 1}: «${part}» — слишком большое число`);
    }
    return value;
  });
}

export function serializeCoverage(values: readonly number[]): string {
  if (values.length !== COVERAGE_DAYS) {
    throw new TemplateConfigError(`«Покрытие» должно содержать ровно ${COVERAGE_DAYS} чисел (Пн..Вс), а не ${values.length}`);
  }
  for (const [index, value] of values.entries()) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TemplateConfigError(`«Покрытие», день ${index + 1}: ${value} — нужно целое число не меньше нуля`);
    }
  }
  return values.join(",");
}

export function assertFillMode(value: string): asserts value is FillMode {
  if (!(FILL_MODES as readonly string[]).includes(value)) {
    throw new TemplateConfigError(`Неизвестный режим заполнения «${value}» — допустимы: ${FILL_MODES.join(", ")}`);
  }
}

export function assertRotationUnit(value: string): asserts value is RotationUnit {
  if (!(ROTATION_UNITS as readonly string[]).includes(value)) {
    throw new TemplateConfigError(`Неизвестная единица очередности «${value}» — допустимы: ${ROTATION_UNITS.join(", ")}`);
  }
}

/** Every rule at once, for one preset row. Throws on the first problem. */
export function validateTemplateConfig(input: Pick<ShiftTemplate, "coverage" | "fillMode" | "rotationUnit">): void {
  parseCoverage(input.coverage);
  assertFillMode(input.fillMode);
  assertRotationUnit(input.rotationUnit);
}
