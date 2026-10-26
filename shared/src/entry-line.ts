import { categoryLabel } from "./category";
import type { EntryCategory } from "./category";

/** «Пт 7 авг» — день, как его пишут все остальные сообщения бота. */
export function dayLabel(iso: string): string {
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
