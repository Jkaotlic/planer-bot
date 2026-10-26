import { dayLabel, entryLineOf } from "@planer/shared";
import type { Db } from "../db/client";
import { getShift } from "../repo/shifts";
import type { Shift } from "../db/schema";
import { getTemplate } from "../repo/templates";
import { getEmployeeById } from "../repo/employees";

// `dayLabel` и `entryLineOf` живут в @planer/shared: dev-моки консоли и
// мини-аппа называют запись той же строкой, что и бот. Реэкспорт — чтобы
// серверные импорты не менялись.
export { dayLabel, entryLineOf };

/**
 * «Пт 10 июл · 09:00–18:00 · Дежурство · Поклонка» — строка про смену из базы,
 * читаемая без джойна назад к `shifts`: для сообщений бота и журнала.
 *
 * Строится тем же `entryLineOf`, что и письмо об изменении графика, а не своим
 * форматированием даты: одна запись графика обязана называться одинаково во всех
 * сообщениях. Раньше здесь не было ни категории, ни пресета, и сообщение с
 * кнопками «Принять/Отклонить» не сообщало, что в обмене дежурство, — а с
 * 2026-08-10 дежурством можно меняться.
 *
 * Общая для HTTP-слоя и кнопок бота, чтобы обмен, закрытый любым из двух путей,
 * дал ровно один текст.
 */
export function shiftLineOf(db: Db, shiftId: number | null): string {
  const shift = shiftId == null ? undefined : getShift(db, shiftId);
  // Заявка живёт дольше смены, на которую показывала (см. `swap_requests.from_shift_id`),
  // так что «записи больше нет» — нормальный случай, а не ошибка.
  if (!shift) return "смену";
  return entryLineOf({ ...shift, title: shift.title ?? templateNameOf(db, shift.templateId) });
}

/** Имя пресета — для записей, которые своей подписи не несут. Та же
 *  подстраховка, что уже стоит в `shiftKind` на сервере и в консоли: часть
 *  старых строк писалась без `title`. */
function templateNameOf(db: Db, templateId: number | null): string | null {
  return templateId == null ? null : (getTemplate(db, templateId)?.name ?? null);
}

/** "Сб 19 июл · 10:00–18:00 · Ярмарка" — short line describing a vacant slot
 *  (or any slot-shaped record) for chat and the audit journal. */
export function slotLineOf(s: { date: string; start: string; end: string; title?: string | null }): string {
  const parts = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .formatToParts(new Date(`${s.date}T00:00:00Z`));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const dateLabel = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${get("day")} ${get("month").replace(/\.$/, "")}`;
  const title = s.title ? ` · ${s.title}` : "";
  return `${dateLabel} · ${s.start}–${s.end}${title}`;
}

/** An employee's display name for chat text, or null if the id doesn't resolve. */
export function nameOf(db: Db, employeeId: number): string | null {
  return getEmployeeById(db, employeeId)?.displayName ?? null;
}

/**
 * The fields worth keeping in the audit feed — enough to answer «что именно
 * поменяли» without copying the whole row into the log. The name, not just
 * `employeeId`: the journal is read by eye, and «работник #24» answers nothing.
 *
 * Lives here rather than inside `createApp` because a SECOND entrance now writes
 * to the same feed — `/api/my/entries`, where a worker records their own sick
 * leave. Two entrances shaping one journal differently is a defect this
 * repository has already paid for once, on swaps.
 */
export function entryAuditPayload(db: Db, s: Shift) {
  return {
    entryId: s.id,
    employeeId: s.employeeId,
    employeeName: s.employeeId != null ? nameOf(db, s.employeeId) : null,
    date: s.date,
    endDate: s.endDate,
    category: s.category,
    title: s.title,
    start: s.start,
    end: s.end,
  };
}

/**
 * Both sides of a swap, by name and by shift line — a journal row (or a chat
 * message built from it) reads on its own, with no join back to employees or
 * shifts.
 *
 * Shared by the mini-app's HTTP routes and the bot's own accept/decline
 * buttons, so a swap resolved either way leaves the same trail — see the
 * "no second payload format" rule in `bot.ts`'s swap callback handler.
 */
export function swapAuditPayload(
  db: Db,
  request: { id: number; fromEmployeeId: number; toEmployeeId: number; fromShiftId: number | null; toShiftId: number | null },
) {
  return {
    requestId: request.id,
    fromEmployeeId: request.fromEmployeeId,
    fromName: nameOf(db, request.fromEmployeeId) ?? "Неизвестно",
    fromShift: shiftLineOf(db, request.fromShiftId),
    toEmployeeId: request.toEmployeeId,
    toName: nameOf(db, request.toEmployeeId) ?? "Неизвестно",
    toShift: shiftLineOf(db, request.toShiftId),
  };
}

export type SwapAuditPayload = ReturnType<typeof swapAuditPayload>;
