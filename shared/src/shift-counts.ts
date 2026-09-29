import { countsForBalance, UNRECOGNISED_KIND, type EntryCategory, type TemplateAccent } from "./category";

/**
 * «Кто сколько отдежурил» — один подсчёт на сервер и на моки обеих морд.
 *
 * Считается по ВИДУ, а не по часам: вопрос всегда «кто больше ночей», а не «кто
 * больше работал», и телефонное дежурство с вечерней сменой не взаимозаменяемы.
 *
 * Группы нужны, чтобы итог что-то значил: общий «Всего» складывал обычный «День»
 * с ночным дежурством, и по нему нельзя было судить о справедливости (его цель —
 * справедливость, ответ от 2026-09-29).
 */
export type ShiftCountsGroup = "shift" | "duty" | "other";

export const SHIFT_COUNTS_GROUPS: readonly ShiftCountsGroup[] = ["shift", "duty", "other"];

export const SHIFT_COUNTS_GROUP_TITLES: Record<ShiftCountsGroup, string> = {
  shift: "Смены",
  duty: "Дежурства",
  other: "Прочее",
};

export interface ShiftCountsKind {
  name: string;
  group: ShiftCountsGroup;
  /** Цвет вида для метки; `null` — у записи без вида. */
  accent: TemplateAccent | null;
}

export interface ShiftCountsRow {
  employeeId: number;
  displayName: string;
  /** Имя вида → сколько записей. Отсутствующий ключ — ноль. */
  byKind: Record<string, number>;
  byGroup: Record<ShiftCountsGroup, number>;
}

export interface ShiftCountsReport {
  from: string;
  to: string;
  kinds: ShiftCountsKind[];
  rows: ShiftCountsRow[];
}

/** Разовая запись без вида — одной колонкой. */
export const CUSTOM_KIND = "Своё время";

export interface TallyEntry {
  employeeId: number | null;
  category: EntryCategory;
  templateId: number | null;
  title: string | null;
  unrecognisedCode?: string | null;
}

export interface TallyTemplate {
  id: number;
  name: string;
  category: EntryCategory;
  accent: TemplateAccent | null;
}

/**
 * Группа — по категории вида, а без вида — по категории записи. «Своё время»
 * с категорией «смена» уходит в «Прочее» намеренно: это не утро/день/вечер/ночь,
 * и в «Сменах» оно размывало бы сравнение, ради которого группы и заведены.
 */
function groupOf(category: EntryCategory, hasTemplate: boolean): ShiftCountsGroup {
  if (category === "duty") return "duty";
  if (category === "shift" && hasTemplate) return "shift";
  return "other";
}

export function tallyShiftCounts(p: {
  from: string;
  to: string;
  entries: readonly TallyEntry[];
  templates: readonly TallyTemplate[];
  employees: readonly { id: number; displayName: string }[];
}): ShiftCountsReport {
  const templateById = new Map(p.templates.map((t) => [t.id, t] as const));
  const rows = new Map<number, ShiftCountsRow>(
    p.employees.map((person) => [
      person.id,
      { employeeId: person.id, displayName: person.displayName, byKind: {}, byGroup: { shift: 0, duty: 0, other: 0 } },
    ]),
  );
  const seen = new Map<string, ShiftCountsKind>();

  for (const entry of p.entries) {
    // Отсутствие — не работа: отпуск не «вид, которого у него меньше».
    if (!countsForBalance(entry.category) || entry.employeeId == null) continue;
    const row = rows.get(entry.employeeId);
    if (!row) continue; // архивный: история его, но в отчёте его нет

    const template = entry.templateId != null ? templateById.get(entry.templateId) : undefined;
    let kind: ShiftCountsKind;
    if (entry.unrecognisedCode != null) {
      kind = { name: UNRECOGNISED_KIND, group: "other", accent: null };
    } else if (template) {
      kind = { name: template.name, group: groupOf(template.category, true), accent: template.accent };
    } else {
      kind = { name: entry.title ?? CUSTOM_KIND, group: groupOf(entry.category, false), accent: null };
    }
    // Первое появление имени решает его группу: одно имя — одна колонка.
    const known = seen.get(kind.name) ?? kind;
    seen.set(known.name, known);
    row.byKind[known.name] = (row.byKind[known.name] ?? 0) + 1;
    row.byGroup[known.group] += 1;
  }

  // Внутри группы — пресеты в том порядке, что админ видит везде, потом
  // остальное по алфавиту: таблица не должна прыгать от порядка записей.
  const presetOrder = new Map(p.templates.map((t, i) => [t.name, i] as const));
  const kinds = [...seen.values()].sort((a, b) => {
    const byGroup = SHIFT_COUNTS_GROUPS.indexOf(a.group) - SHIFT_COUNTS_GROUPS.indexOf(b.group);
    if (byGroup !== 0) return byGroup;
    const ia = presetOrder.get(a.name);
    const ib = presetOrder.get(b.name);
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1;
    if (ib != null) return 1;
    return a.name.localeCompare(b.name, "ru");
  });

  return { from: p.from, to: p.to, kinds, rows: [...rows.values()] };
}
