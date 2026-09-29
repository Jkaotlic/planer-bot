import { auditMonthRange } from "./audit";
import {
  SHIFT_COUNTS_GROUPS, SHIFT_COUNTS_GROUP_TITLES,
  type ShiftCountsGroup, type ShiftCountsKind, type ShiftCountsRow,
} from "./shift-counts";

/** Столбец отчёта: отдельный вид или итог группы. */
export type CountsKey = { kind: string } | { group: ShiftCountsGroup };

export function countsValue(row: ShiftCountsRow, key: CountsKey): number {
  return "kind" in key ? row.byKind[key.kind] ?? 0 : row.byGroup[key.group];
}

const GROUP_ALL: Record<ShiftCountsGroup, string> = { shift: "Все смены", duty: "Все дежурства", other: "Всё прочее" };

export function countsKeyLabel(key: CountsKey): string {
  return "kind" in key ? key.kind : GROUP_ALL[key.group];
}

export function groupKinds(kinds: readonly ShiftCountsKind[]) {
  return SHIFT_COUNTS_GROUPS.map((group) => ({
    group,
    title: SHIFT_COUNTS_GROUP_TITLES[group],
    kinds: kinds.filter((k) => k.group === group),
  })).filter((g) => g.kinds.length > 0);
}

const isEmpty = (row: ShiftCountsRow) => row.byGroup.shift + row.byGroup.duty + row.byGroup.other === 0;
const byName = (a: ShiftCountsRow, b: ShiftCountsRow) => a.displayName.localeCompare(b.displayName, "ru");

/**
 * Сортировка таблицы. Равные — по имени, иначе строки менялись бы местами от
 * перезагрузки. Люди без единой записи отброшены: вопрос «кто перегружен», и
 * строка нулей в нём только шум.
 */
export function sortCountsRows(rows: readonly ShiftCountsRow[], key: CountsKey | "name", dir: "asc" | "desc"): ShiftCountsRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows.filter((r) => !isEmpty(r)).sort((a, b) => {
    if (key === "name") return sign * byName(a, b);
    const diff = countsValue(a, key) - countsValue(b, key);
    return diff !== 0 ? sign * diff : byName(a, b);
  });
}

/**
 * Ступень цвета ячейки, 0…4. Ступени, а не плавная прозрачность: соседние ячейки
 * должны различаться на глаз, а не на три процента.
 */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio >= 1) return 4;
  if (ratio > 0.6) return 3;
  if (ratio > 0.3) return 2;
  return 1;
}

/**
 * Тон — группы, а не вида: у «Дня» цвет почти белый, и его ступени были бы
 * невидимы. Цвет вида остаётся меткой в заголовке. rgba, а не color-mix: бандл
 * обязан открываться на iOS 14.
 */
const GROUP_RGB: Record<ShiftCountsGroup, string> = { shift: "51, 144, 236", duty: "245, 140, 30", other: "118, 123, 135" };
const LEVEL_ALPHA = [0, 0.14, 0.28, 0.46, 0.66];

export function heatBackground(group: ShiftCountsGroup, level: number): string {
  const alpha = LEVEL_ALPHA[level] ?? 0;
  return alpha === 0 ? "transparent" : `rgba(${GROUP_RGB[group]}, ${alpha})`;
}

/** Рейтинг по одному столбцу: только ненулевые, по убыванию, доля — для полоски. */
export function rankByKey(rows: readonly ShiftCountsRow[], key: CountsKey) {
  const ranked = sortCountsRows(rows, key, "desc").filter((r) => countsValue(r, key) > 0);
  const max = ranked.length > 0 ? countsValue(ranked[0]!, key) : 0;
  return ranked.map((row) => {
    const value = countsValue(row, key);
    return { row, value, share: max > 0 ? value / max : 0 };
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Быстрые периоды. `today` — командная дата, приходит снаружи. */
export function countsPeriodPresets(today: string): { label: string; from: string; to: string }[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const qStart = Math.floor((month - 1) / 3) * 3 + 1;
  return [
    { label: "Этот месяц", ...auditMonthRange(today) },
    { label: "Прошлый месяц", ...auditMonthRange(`${prevYear}-${pad(prevMonth)}-01`) },
    {
      label: "Квартал",
      from: `${year}-${pad(qStart)}-01`,
      to: auditMonthRange(`${year}-${pad(qStart + 2)}-01`).to,
    },
  ];
}
