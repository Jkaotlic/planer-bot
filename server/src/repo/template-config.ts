import { CoverageError, parseCoverage, serializeCoverage, COVERAGE_DAYS } from "@planer/shared";
import type { ShiftTemplate } from "../db/schema";

/**
 * Разбор нормы покрытия переехал в `@planer/shared` (`coverage.ts`) — её читают
 * и фронты, чтобы считать нехватку дня. Здесь остаются проверки колонок, которые
 * нужны только серверу, и реэкспорт разбора для тех, кто уже импортирует его
 * отсюда.
 *
 * `coverage`, `fill_mode` and `rotation_unit` are plain TEXT columns — drizzle's
 * `$type<>` is erased at compile time and SQLite has no CHECK on them, so nothing
 * stops a bad value from reaching the row. Первый писатель появился 2026-08-24 —
 * редактор нормы дня, — и он гонит значение через разбор ДО записи, а не после.
 */

export { CoverageError, parseCoverage, serializeCoverage, COVERAGE_DAYS };

/** Ошибка проверки колонок, которые остались серверными. */
export class TemplateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateConfigError";
  }
}

export const FILL_MODES = ["count", "remainder"] as const;
export const ROTATION_UNITS = ["day", "week"] as const;
export type FillMode = (typeof FILL_MODES)[number];
export type RotationUnit = (typeof ROTATION_UNITS)[number];

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
