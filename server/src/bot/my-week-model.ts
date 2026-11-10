import { addDaysIso, buildWeekModel } from "@planer/shared";
import type { Db } from "../db/client";
import { listEmployeeShiftsOverlapping } from "../repo/shifts";
import { templatesByIds } from "../repo/templates";
import { pendingMarks } from "../repo/sick-approvals";

/** Короткие ключи оставляют место кириллице внутри лимита Telegram в 1024 байта. */
export interface MyWeekState {
  v: 1;
  m: string;
  t: string;
  d: number;
  p: number;
  n: number;
  c: ([string, string] | null)[];
  e: { title: string; time: string; location: string; hint: string; color: string };
}

function shorten(text: string, maxBytes: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (Buffer.byteLength(clean) <= maxBytes) return clean;
  let result = "";
  for (const char of clean) {
    if (Buffer.byteLength(result + char + "…") > maxBytes) break;
    result += char;
  }
  return result + "…";
}

export function buildMyWeekState(db: Db, employeeId: number, today: string, monday: string, day: number, page: number): MyWeekState {
  // SQL ограничивает не только даты, но и владельца: чужие записи и заметки
  // вообще не участвуют в данных, которые получит Telegram.
  const shifts = listEmployeeShiftsOverlapping(db, employeeId, monday, addDaysIso(monday, 6))
    .map(s => ({ ...s, ...pendingMarks(s) }));
  const templates = [...templatesByIds(db, shifts.map(s => s.templateId)).values()];
  const row = buildWeekModel(monday, { employees: [{ id: employeeId, displayName: "", rosterOrder: null }], shifts }, templates).rows[0]!;
  const entries = row.cells[day]!.entries;
  const p = Math.min(page, Math.max(0, entries.length - 1));
  const entry = entries[p];
  let e: MyWeekState["e"] = { title: "Нет записей", time: "", location: "", hint: "На этот день смен нет", color: "" };
  if (entry) {
    const { shift } = entry;
    const title = shorten(entry.title, 150);
    const location = shorten(shift.location ?? "", 100);
    const hints: string[] = [];
    if (entry.pending) hints.push("Ждёт ОК админа");
    if (shift.start && shift.end && shift.end <= shift.start) hints.push("До следующего дня");
    if (title !== entry.title.trim() || location !== (shift.location ?? "").trim()) hints.push("Полностью — в мини-аппе");
    e = {
      title,
      time: shift.start && shift.end ? `${shift.start}–${shift.end}` : "Весь день",
      location,
      hint: hints.join(" · "),
      color: entry.palette?.bg ?? "",
    };
  }
  return {
    v: 1, m: monday, t: today, d: day, p, n: entries.length,
    c: row.cells.map(cell => cell.primary ? [cell.primary.palette?.bg ?? "", cell.primary.palette?.code ?? "•"] : null),
    e,
  };
}

export function serializeMyWeekState(state: MyWeekState): string {
  const json = JSON.stringify(state);
  // Не отправляем половину графика при изменении контракта: отказ пойдёт в
  // обычный fallback с кнопкой Mini App, а размер поймает интеграционный тест.
  if (Buffer.byteLength(json) > 1024) throw new Error("Данные недели не помещаются в виджет");
  return json;
}
