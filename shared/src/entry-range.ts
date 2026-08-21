import { isAbsence, type EntryCategory } from "./category";
import { isWeekend } from "./time";
import { eachDayIso } from "./week-dates";

/**
 * Подходит ли день этой категории.
 *
 * Пока правило одно — «Работа в выходной» по определению отработанный выходной,
 * и на будни она встать не может (календаря праздников нет, так что праздник
 * среди недели выходным не считается). Отдельной функцией, а не строкой внутри
 * серверной валидации, потому что читателей теперь двое: та же валидация и
 * `planEntryRange`, которому нельзя класть в план день, который сервер потом
 * отвергнет, — он уронил бы всю транзакцию из-за одной клетки.
 */
export function categoryFitsDate(category: EntryCategory, date: string): boolean {
  if (category === "weekend_work") return isWeekend(date);
  return true;
}

/** Почему день диапазона остался без записи. */
export type SkipReason = "weekend" | "busy" | "category";

export interface EntryRangeSkip {
  date: string;
  reason: SkipReason;
}

export interface EntryRangePlan {
  /** Дни, которые получат запись. У отсутствия — один: сам `from`. */
  days: string[];
  skipped: EntryRangeSkip[];
}

export interface EntryRangeInput {
  from: string;
  to: string;
  category: EntryCategory;
  /** Брать ли субботу и воскресенье. К «Работе в выходной» не относится — у неё своё правило. */
  includeWeekends: boolean;
  /** Дни, в которые человек уже занят: вторая смена поверх первой — не расстановка, а ошибка. */
  busyDates: readonly string[];
}

/**
 * Какие дни диапазона получат запись, а какие нет и почему.
 *
 * Чистая функция и единственное место, где это правило записано: её зовёт
 * сервер, чтобы создать записи, и обе консоли, чтобы показать «поставится 18
 * дней» до нажатия «Сохранить». Посчитанное на экране и на сервере разными
 * кодами — это два разных правила через полгода, чему в этом репозитории уже
 * есть три примера.
 *
 * Отсутствие (отпуск, больничный, командировка) диапазоном по дням НЕ
 * раскладывается: в базе оно живёт одной записью с `endDate`, и тридцать строк
 * вместо одной сломали бы и полосу в сетке, и журнал. Функция отдаёт один день,
 * а как его записать — знает вызывающий.
 */
export function planEntryRange(input: EntryRangeInput): EntryRangePlan {
  const { from, to, category, includeWeekends, busyDates } = input;
  if (to < from) return { days: [], skipped: [] };
  if (isAbsence(category)) return { days: [from], skipped: [] };

  const busy = new Set(busyDates);
  const days: string[] = [];
  const skipped: EntryRangeSkip[] = [];

  for (const date of eachDayIso(from, to)) {
    // Порядок причин — от самой сильной к самой слабой, и он виден человеку:
    // день, который категории не подходит вовсе, не «занят» и не «выходной»,
    // сколько бы флагов ни стояло.
    if (!categoryFitsDate(category, date)) skipped.push({ date, reason: "category" });
    else if (!includeWeekends && isWeekend(date)) skipped.push({ date, reason: "weekend" });
    else if (busy.has(date)) skipped.push({ date, reason: "busy" });
    else days.push(date);
  }

  return { days, skipped };
}

/** «Поставлено 18 · пропущено 4: 2 выходных, 2 уже заняты» — итог одной строкой. */
export function describeEntryRangePlan(plan: EntryRangePlan): string {
  const head = `${plan.days.length} ${pluralDays(plan.days.length)}`;
  if (plan.skipped.length === 0) return head;
  const byReason = new Map<SkipReason, number>();
  for (const skip of plan.skipped) byReason.set(skip.reason, (byReason.get(skip.reason) ?? 0) + 1);
  const parts: string[] = [];
  const weekend = byReason.get("weekend");
  const busy = byReason.get("busy");
  const wrongCategory = byReason.get("category");
  if (weekend) parts.push(`${weekend} ${weekend === 1 ? "выходной" : "выходных"}`);
  if (busy) parts.push(`${busy} ${busy === 1 ? "уже занят" : "уже заняты"}`);
  if (wrongCategory) parts.push(`${wrongCategory} не по правилу вида`);
  return `${head} · пропущено ${plan.skipped.length}: ${parts.join(", ")}`;
}

/** «1 день / 2 дня / 5 дней» — та же 1/2/5, что у остальных счётчиков. */
function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}
