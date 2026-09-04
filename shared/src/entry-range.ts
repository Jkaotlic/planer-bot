import { isAbsence, type EntryCategory } from "./category";
import { isDayOff, type DayCalendar } from "./calendar";
import { eachDayIso } from "./week-dates";

/**
 * Подходит ли день этой категории.
 *
 * Пока правило одно — «Работа в выходной» по определению отработанный выходной,
 * и на будни она встать не может. Выходной — по календарю: с 2026-09-04 праздник
 * среди недели тоже выходной, а перенесённая рабочая суббота — нет. Отдельной
 * функцией, а не строкой внутри серверной валидации, потому что читателей
 * двое: та же валидация и `planEntryRange`, которому нельзя класть в план день,
 * который сервер потом отвергнет, — он уронил бы всю транзакцию из-за одной клетки.
 */
export function categoryFitsDate(category: EntryCategory, date: string, calendar: DayCalendar): boolean {
  if (category === "weekend_work") return isDayOff(date, calendar);
  return true;
}

/** Почему день диапазона остался без записи. */
export type SkipReason = "weekend" | "busy" | "category" | "absence" | "ambiguous";

export interface EntryRangeSkip {
  date: string;
  reason: SkipReason;
}

/**
 * Что уже стоит у человека в этом дне.
 *
 * `ambiguous` — записей больше одной. Уникального индекса на (работник, день) в
 * таблице нет, и импорт ростера такие дни создаёт; какую из двух переписывать —
 * знать неоткуда, поэтому день честно пропускается вместо догадки.
 */
export type DayOccupancy = "work" | "absence" | "ambiguous";

/**
 * Что делать с днём, в котором уже что-то стоит.
 *
 * `fill` — расстановка: занятый день пропускается, вторая смена поверх первой
 * читается только как ошибка. `rewrite` — правка отрезка: рабочая запись
 * переписывается на месте. Отсутствие не трогает ни один из двух: снести
 * человеку отпуск без отмены — не побочный эффект смены пресета.
 */
export type EntryRangeMode = "fill" | "rewrite";

export interface EntryRangePlan {
  /** Дни, которые получат запись. У отсутствия — один: сам `from`. */
  days: string[];
  /** Подмножество `days`, где запись не появится, а заменит существующую. */
  rewritten: string[];
  skipped: EntryRangeSkip[];
}

export interface EntryRangeInput {
  from: string;
  to: string;
  category: EntryCategory;
  /** Брать ли субботу и воскресенье. К «Работе в выходной» не относится — у неё своё правило. */
  includeWeekends: boolean;
  mode: EntryRangeMode;
  /**
   * Занятость по дням. Дня нет в карте — день свободен.
   *
   * Не список занятых дат: режиму перезаписи мало знать «занят», ему нужно
   * знать чем — смену он заменит, отпуск оставит.
   */
  occupied?: Readonly<Record<string, DayOccupancy | undefined>>;
  /**
   * Календарь исключений: праздники и рабочие субботы. Обязательный, без
   * умолчания: вызов, забывший его, молча жил бы без праздников, и заметили
   * бы это по жалобе. Тесты передают `EMPTY_CALENDAR` явно.
   */
  calendar: DayCalendar;
}

export function planEntryRange(input: EntryRangeInput): EntryRangePlan {
  const { from, to, category, includeWeekends, mode, occupied, calendar } = input;
  if (to < from) return { days: [], rewritten: [], skipped: [] };
  if (isAbsence(category)) return { days: [from], rewritten: [], skipped: [] };

  const days: string[] = [];
  const rewritten: string[] = [];
  const skipped: EntryRangeSkip[] = [];

  for (const date of eachDayIso(from, to)) {
    // Порядок причин — от самой сильной к самой слабой, и он виден человеку:
    // день, который категории не подходит вовсе, не «занят» и не «выходной»,
    // сколько бы флагов ни стояло. Занятость идёт последней, потому что режим
    // перезаписи ослабляет только её: выходной он не берёт так же, как и
    // расстановка.
    if (!categoryFitsDate(category, date, calendar)) skipped.push({ date, reason: "category" });
    else if (!includeWeekends && isDayOff(date, calendar)) skipped.push({ date, reason: "weekend" });
    else {
      const busy = occupied?.[date];
      if (!busy) days.push(date);
      else if (mode === "fill") skipped.push({ date, reason: "busy" });
      else if (busy === "work") {
        days.push(date);
        rewritten.push(date);
      } else skipped.push({ date, reason: busy });
    }
  }

  return { days, rewritten, skipped };
}

/**
 * Чем режим обернётся для дней, про которые форма ничего не знает.
 *
 * Ни одна из консолей не знает занятость за пределами показанной недели, и
 * догадка «наверное, свободно» врала бы ровно там, где ей поверят. Значит между
 * админом и необратимой правкой стоит только эта фраза — и она одна на обе
 * формы, иначе через полгода они скажут разное про одно и то же.
 */
export function entryRangeHint(mode: EntryRangeMode): string {
  return mode === "rewrite"
    ? "Смены и дежурства в этих днях перепишутся; отпуск, больничный и командировка останутся на месте."
    : "Дни, где у человека уже что-то стоит, пропустятся.";
}

/** «Поставлено 18 · 4 перепишутся · пропущено 4: 2 выходных, 2 уже заняты» — итог одной строкой. */
export function describeEntryRangePlan(plan: EntryRangePlan): string {
  const parts = [`${plan.days.length} ${pluralDays(plan.days.length)}`];
  // Число перезаписей стоит до пропусков и никогда не прячется: это
  // единственная необратимая часть плана, и человек обязан увидеть её ДО
  // нажатия, а не в итоге после.
  if (plan.rewritten.length > 0) parts.push(`${plan.rewritten.length} ${pluralRewrite(plan.rewritten.length)}`);
  if (plan.skipped.length > 0) parts.push(`пропущено ${plan.skipped.length}: ${describeSkips(plan.skipped)}`);
  return parts.join(" · ");
}

/** «2 выходных, 1 уже занят» — по причине на каждую, в порядке их силы. */
function describeSkips(skipped: readonly EntryRangeSkip[]): string {
  const byReason = new Map<SkipReason, number>();
  for (const skip of skipped) byReason.set(skip.reason, (byReason.get(skip.reason) ?? 0) + 1);
  const say = (reason: SkipReason, text: (n: number) => string): string | null => {
    const n = byReason.get(reason);
    return n ? text(n) : null;
  };
  return [
    say("weekend", (n) => `${n} ${n === 1 ? "выходной" : "выходных"}`),
    say("busy", (n) => `${n} ${n === 1 ? "уже занят" : "уже заняты"}`),
    // Отсутствие и двойной день названы по-разному не для красоты: первое
    // значит «иди отмени отпуск», второе — «разбери день руками», и одно слово
    // на двоих оставило бы админа без следующего шага.
    say("absence", (n) => `${n} ${pluralDays(n)} отсутствия`),
    say("ambiguous", (n) => `${n} ${pluralDays(n)} с двумя записями`),
    say("category", (n) => `${n} не по правилу вида`),
  ].filter(Boolean).join(", ");
}

/**
 * Итог расстановки словами: «Поставлено 18 дней · 4 переписано · пропущено 4…».
 *
 * Дни считаются по СРОКУ созданных записей, а не по их числу: отсутствие
 * приезжает одной строкой на всю полосу, и «поставлено 1 день» про недельный
 * отпуск было бы неправдой ровно в том месте, где человек проверяет, что
 * получилось.
 */
export function describeEntryRangeResult(result: {
  created: readonly { date: string; endDate?: string | null }[];
  updated?: readonly { date: string; endDate?: string | null }[];
  skipped: readonly EntryRangeSkip[];
}): string {
  const span = (entries: readonly { date: string; endDate?: string | null }[]) =>
    entries.flatMap((entry) => eachDayIso(entry.date, entry.endDate ?? entry.date));
  const rewritten = span(result.updated ?? []);
  const text = describeEntryRangePlan({
    days: [...span(result.created), ...rewritten],
    rewritten,
    skipped: [...result.skipped],
  });
  // Прошедшее время, а не будущее: тот же счёт, что в предпросмотре, но
  // «перепишутся» после сохранения читалось бы как «ещё не сделано».
  return `Поставлено ${text.replace(/ перепишутся| перепишется/, " переписано")}`;
}

/** «1 перепишется / 2 перепишутся» — глагол идёт за числом, как и всё остальное. */
function pluralRewrite(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? "перепишется" : "перепишутся";
}

/** «1 день / 2 дня / 5 дней» — та же 1/2/5, что у остальных счётчиков. */
function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}
