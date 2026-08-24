import { weekdayIndex } from "./week-dates";

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


/** Минимум, который расчёту нужен от вида смены. */
export interface CoverageTemplate {
  templateId: number;
  name: string;
  /** Норма по дням недели, Пн..Вс. */
  coverage: readonly number[];
}

/** Минимум, который расчёту нужен от записи графика. */
export interface CoverageEntry {
  date: string;
  endDate?: string | null;
  employeeId: number | null;
  templateId: number | null;
}

/** Вид смены, которого в дне не хватает: сколько нужно и сколько есть. */
export interface MissingKind {
  templateId: number;
  name: string;
  need: number;
  have: number;
}

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

/**
 * Норма словами: «Пн 2 · Вт 2 · Ср 2 · Чт 2 · Пт 2».
 *
 * Дни с нулём не показываются: ноль — это «не считаем», и хвост «Сб 0 · Вс 0»
 * висел бы под каждым видом смены, ничего не сообщая.
 */
export function coverageSummary(coverage: readonly number[]): string {
  const parts = WEEKDAY_LABELS.flatMap((day, index) => ((coverage[index] ?? 0) > 0 ? [`${day} ${coverage[index]}`] : []));
  return parts.length === 0 ? "норма не задана" : parts.join(" · ");
}

/**
 * Чего в дне не хватает против нормы.
 *
 * Вид смены с нулевой нормой в ответе не участвует вовсе: ноль означает «не
 * считаем», а не «не хватает всех». Иначе первый же день после выкатки встретил
 * бы админа списком из девяти строк про виды, нормы которым никто не задавал.
 *
 * Норму закрывает ЧЕЛОВЕК, а не строка в сетке: у записи без `employeeId` некому
 * выйти. Люди считаются множеством — две записи одного вида на одного человека
 * это один вышедший, а не два.
 */
export function missingCoverage(
  entries: readonly CoverageEntry[],
  templates: readonly CoverageTemplate[],
  date: string,
): MissingKind[] {
  const weekday = weekdayIndex(date);
  const out: MissingKind[] = [];
  for (const template of templates) {
    const need = template.coverage[weekday] ?? 0;
    if (need === 0) continue;
    const people = new Set<number>();
    for (const entry of entries) {
      if (entry.templateId !== template.templateId || entry.employeeId == null) continue;
      // Тот же охват, что у чек-листов: многодневная запись покрывает каждый свой
      // день, а не только первый.
      if (entry.date > date || (entry.endDate ?? entry.date) < date) continue;
      people.add(entry.employeeId);
    }
    if (people.size < need) out.push({ templateId: template.templateId, name: template.name, need, have: people.size });
  }
  return out;
}

/**
 * «Не хватает: Утро — 1» — строка над днём.
 *
 * Разница, а не норма: админ читает это, глядя на день, где часть смен уже
 * стоит, и «Утро — 2» при одном поставленном сбивало бы с толку.
 */
export function coverageHint(missing: readonly MissingKind[]): string | null {
  if (missing.length === 0) return null;
  return `Не хватает: ${missing.map((kind) => `${kind.name} — ${kind.need - kind.have}`).join(", ")}`;
}
