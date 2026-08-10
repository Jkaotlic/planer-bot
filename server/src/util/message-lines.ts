import { categoryLabel, type EntryCategory } from "@planer/shared";
import type { Db } from "../db/client";
import { getShift } from "../repo/shifts";
import { getTemplate } from "../repo/templates";
import { getEmployeeById } from "../repo/employees";

/** «Пт 7 авг» — день, как его пишут все остальные сообщения бота. */
function dayLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .formatToParts(new Date(`${iso}T00:00:00Z`));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${get("day")} ${get("month").replace(/\.$/, "")}`;
}

/**
 * «Пт 7 авг · 15:00–23:00 · Вечер» — строка про одну запись графика.
 *
 * Подпись записи стоит выше категории ровно там же, где и в сетке: клетка
 * подписана `title ?? categoryLabel(category)`, и письмо об изменении должно
 * называть смену теми же словами, что человек увидит, открыв мини-апп. Иначе
 * «тебе изменили Смену» рядом с клеткой «Вечер» — это два разных языка про
 * один и тот же день.
 */
export function entryLineOf(entry: {
  date: string;
  endDate: string | null;
  start: string | null;
  end: string | null;
  category: EntryCategory;
  title: string | null;
}): string {
  const days =
    entry.endDate && entry.endDate !== entry.date
      ? `${dayLabel(entry.date)} – ${dayLabel(entry.endDate)}`
      : dayLabel(entry.date);
  // Отсутствие часов не имеет: «весь день» — это то, что рисует и сама сетка.
  const time = entry.start != null && entry.end != null ? `${entry.start}–${entry.end}` : "весь день";
  return `${days} · ${time} · ${entry.title ?? categoryLabel(entry.category)}`;
}

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
