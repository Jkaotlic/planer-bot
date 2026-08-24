/**
 * Норма покрытия дня: сколько людей нужно на этом виде смены в каждый день недели.
 *
 * Хранится в базе строкой «3,2,2,2,2,0,0» (Пн..Вс) — колонка TEXT, на которой
 * SQLite ничего не стережёт. Поэтому разбор и запись всегда идут через эти
 * функции, а не через прямое `split(",")`.
 *
 * В shared, потому что читателей трое: сервер (пишет), консоль и мини-апп
 * (показывают норму и считают по ней нехватку дня). Посчитанное трижды однажды
 * разъедется.
 */

export class CoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverageError";
  }
}

export const COVERAGE_DAYS = 7;

/**
 * "3,2,2,2,2,0,0" -> [3,2,2,2,2,0,0]. Exactly seven non-negative integers, Mon..Sun.
 * Throws with a Russian message naming what was wrong — this surfaces in the editor.
 */
export function parseCoverage(raw: string): number[] {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length !== COVERAGE_DAYS) {
    throw new CoverageError(`«Покрытие» должно содержать ровно ${COVERAGE_DAYS} чисел (Пн..Вс), а не ${parts.length}`);
  }
  return parts.map((part, index) => {
    // Number() would happily accept "", " ", "1e3", "0x2" and Infinity.
    if (!/^\d+$/.test(part)) {
      throw new CoverageError(`«Покрытие», день ${index + 1}: «${part}» — нужно целое число не меньше нуля`);
    }
    const value = Number(part);
    if (!Number.isSafeInteger(value)) {
      throw new CoverageError(`«Покрытие», день ${index + 1}: «${part}» — слишком большое число`);
    }
    return value;
  });
}

export function serializeCoverage(values: readonly number[]): string {
  if (values.length !== COVERAGE_DAYS) {
    throw new CoverageError(`«Покрытие» должно содержать ровно ${COVERAGE_DAYS} чисел (Пн..Вс), а не ${values.length}`);
  }
  for (const [index, value] of values.entries()) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new CoverageError(`«Покрытие», день ${index + 1}: ${value} — нужно целое число не меньше нуля`);
    }
  }
  return values.join(",");
}

