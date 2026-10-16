import { categoryLabel, isAbsence, type EntryCategory } from "./category";
import { isDayOff, type DayCalendar } from "./calendar";
import { addDaysIso, eachDayIso } from "./week-dates";

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
 *
 * `absence_and_work` — отсутствие и ровно одна рабочая запись под ним. Так
 * выглядит каждый больничный с передачей: своя смена человека остаётся в
 * графике, пока её ищут кому отдать. Отдельным видом, а не «двумя записями»:
 * у замены отсутствия здесь однозначный ответ — переписать смену и вырезать
 * больничный из дня, а без замены честная причина пропуска — отсутствие.
 */
export type DayOccupancy = "work" | "absence" | "absence_and_work" | "ambiguous";

/**
 * Что делать с днём, в котором уже что-то стоит.
 *
 * `fill` — расстановка: занятый день пропускается, вторая смена поверх первой
 * читается только как ошибка. `rewrite` — правка отрезка: рабочая запись
 * переписывается на месте. Отсутствие не трогает ни один из двух сам по себе:
 * снести человеку отпуск без отмены — не побочный эффект смены пресета. Для
 * этого есть отдельный явный флаг `replaceAbsences`.
 */
export type EntryRangeMode = "fill" | "rewrite";

export interface EntryRangePlan {
  /** Дни, которые получат запись. У отсутствия — один: сам `from`. */
  days: string[];
  /** Подмножество `days`, где запись не появится, а заменит существующую. */
  rewritten: string[];
  /**
   * Подмножество `days`, из которых будет вырезано отсутствие. Необязательное
   * для читателей описания: планы, собранные руками до флага, его не несут.
   */
  replacedAbsence?: string[];
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
   * Заменить отпуск, больничный и командировку там, где встанет запись.
   *
   * Только явно: правило владельца «админ меняет любому что и когда захочет»
   * (2026-10-16) — про намерение, а массовая расстановка, молча сносящая
   * отпуска, намерением не является. Режется отсутствие ровно в тех днях, где
   * запись реально встаёт: суббота без «Включая выходные» смены не получит и
   * отпуска не потеряет — иначе человек лишился бы выходного дня отпуска ни за что.
   */
  replaceAbsences?: boolean;
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

export function planEntryRange(input: EntryRangeInput): EntryRangePlan & { replacedAbsence: string[] } {
  const { from, to, category, includeWeekends, mode, occupied, calendar } = input;
  const replace = input.replaceAbsences === true;
  if (to < from) return { days: [], rewritten: [], replacedAbsence: [], skipped: [] };
  if (isAbsence(category)) return { days: [from], rewritten: [], replacedAbsence: [], skipped: [] };

  const days: string[] = [];
  const rewritten: string[] = [];
  const replacedAbsence: string[] = [];
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
      else if (busy === "absence" && replace) {
        // Режим тут не важен: в дне нет работы, которую расстановка берегла бы.
        days.push(date);
        replacedAbsence.push(date);
      } else if (mode === "fill") skipped.push({ date, reason: "busy" });
      else if (busy === "work") {
        days.push(date);
        rewritten.push(date);
      } else if (busy === "absence_and_work") {
        if (replace) {
          days.push(date);
          rewritten.push(date);
          replacedAbsence.push(date);
        } else skipped.push({ date, reason: "absence" });
      } else skipped.push({ date, reason: busy });
    }
  }

  return { days, rewritten, replacedAbsence, skipped };
}

/** Занятость дней одного человека и записи, которые за ней стоят. */
export interface EntryRangeOccupancy<T> {
  occupied: Record<string, DayOccupancy>;
  /** Единственная рабочая запись дня — её перезапись и перепишет. */
  work: Map<string, T>;
  /** Единственное отсутствие дня — из него замена и вырежет день. */
  absence: Map<string, T>;
}

/**
 * Занятость по записям человека — одна на сервер и оба мока.
 *
 * Мок, считающий занятость по-своему, — второй источник правды, расходящийся с
 * продом молча; до замены отсутствий этот цикл и был набран трижды.
 * Отсутствие раскладывается на каждый день своей полосы: отпуск, начавшийся до
 * диапазона, занимает его дни так же, как начавшийся внутри.
 */
export function entryRangeOccupancy<T extends { date: string; endDate?: string | null; category: EntryCategory }>(
  rows: readonly T[],
): EntryRangeOccupancy<T> {
  const works = new Map<string, T[]>();
  const absences = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = isAbsence(row.category) ? absences : works;
    for (const day of eachDayIso(row.date, row.endDate ?? row.date)) {
      const list = bucket.get(day);
      if (list) list.push(row);
      else bucket.set(day, [row]);
    }
  }
  const occupied: Record<string, DayOccupancy> = {};
  const work = new Map<string, T>();
  const absence = new Map<string, T>();
  for (const day of new Set([...works.keys(), ...absences.keys()])) {
    const w = works.get(day) ?? [];
    const a = absences.get(day) ?? [];
    if (w.length > 1 || a.length > 1) {
      occupied[day] = "ambiguous";
      continue;
    }
    if (w[0]) work.set(day, w[0]);
    if (a[0]) absence.set(day, a[0]);
    occupied[day] = a[0] && w[0] ? "absence_and_work" : a[0] ? "absence" : "work";
  }
  return { occupied, work, absence };
}

/**
 * Что остаётся от полосы, если вырезать из неё дни, — подряд идущими кусками.
 *
 * Кусков бывает два и больше: отпуск 12–17, из которого вырезана пятница, — это
 * 12–15 и 17, а не 12–17 с дыркой: полоса в базе дыр не умеет.
 */
export function cutDaysFromSpan(
  span: { date: string; endDate?: string | null },
  removed: Iterable<string>,
): { date: string; endDate: string | null }[] {
  const gone = new Set(removed);
  const runs: { date: string; endDate: string | null }[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  const close = () => {
    if (start != null && prev != null) runs.push({ date: start, endDate: prev === start ? null : prev });
  };
  for (const day of eachDayIso(span.date, span.endDate ?? span.date)) {
    if (gone.has(day)) continue;
    if (prev != null && addDaysIso(prev, 1) === day) {
      prev = day;
      continue;
    }
    close();
    start = day;
    prev = day;
  }
  close();
  return runs;
}

/**
 * Чем режим обернётся для дней, про которые форма ничего не знает.
 *
 * Ни одна из консолей не знает занятость за пределами показанной недели, и
 * догадка «наверное, свободно» врала бы ровно там, где ей поверят. Значит между
 * админом и необратимой правкой стоит только эта фраза — и она одна на обе
 * формы, иначе через полгода они скажут разное про одно и то же.
 */
export function entryRangeHint(mode: EntryRangeMode, replaceAbsences = false): string {
  // С заменой — другая фраза целиком, а не приписка: «останутся на месте» про
  // отпуск соврало бы ровно перед необратимым нажатием.
  const yields = "отпуск, больничный и командировка уступят место новой записи там, где она встанет.";
  if (replaceAbsences) {
    return mode === "rewrite"
      ? `Смены и дежурства в этих днях перепишутся, а ${yields}`
      : `Дни со сменой или дежурством пропустятся, а ${yields}`;
  }
  return mode === "rewrite"
    ? "Смены и дежурства в этих днях перепишутся; отпуск, больничный и командировка останутся на месте."
    : "Дни, где у человека уже что-то стоит, пропустятся.";
}

/**
 * Подсказка правки отсутствия, которому сменили вид на рабочий.
 *
 * Названо по имени, а не «отсутствие»: админ правит конкретный отпуск и должен
 * прочитать про него. «Только там, куда она не встанет» — это и выходные без
 * галочки, и дни за пределами «С/По»: отпуск режется ровно по новой записи.
 */
export function absenceReplaceHint(absence: EntryCategory): string {
  return `${categoryLabel(absence)} в эти дни заменится новой записью и останется только там, куда она не встанет.`;
}

/** «Поставлено 18 · 4 перепишутся · пропущено 4: 2 выходных, 2 уже заняты» — итог одной строкой. */
export function describeEntryRangePlan(plan: EntryRangePlan): string {
  const parts = [`${plan.days.length} ${pluralDays(plan.days.length)}`];
  // Число перезаписей стоит до пропусков и никогда не прячется: это
  // единственная необратимая часть плана, и человек обязан увидеть её ДО
  // нажатия, а не в итоге после.
  if (plan.rewritten.length > 0) parts.push(`${plan.rewritten.length} ${pluralRewrite(plan.rewritten.length)}`);
  // Замена отсутствия так же необратима — отпуск из этих дней уйдёт — и потому
  // стоит рядом с перезаписью, а не среди пропусков.
  const replaced = plan.replacedAbsence?.length ?? 0;
  if (replaced > 0) parts.push(`${replaced} ${pluralDays(replaced)} отсутствия ${replaced % 10 === 1 && replaced % 100 !== 11 ? "заменится" : "заменятся"}`);
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
  /** Дни, из которых вырезано отсутствие. Старый сервер поле не шлёт. */
  replacedAbsence?: readonly string[];
}): string {
  const span = (entries: readonly { date: string; endDate?: string | null }[]) =>
    entries.flatMap((entry) => eachDayIso(entry.date, entry.endDate ?? entry.date));
  const rewritten = span(result.updated ?? []);
  const text = describeEntryRangePlan({
    days: [...span(result.created), ...rewritten],
    rewritten,
    replacedAbsence: [...(result.replacedAbsence ?? [])],
    skipped: [...result.skipped],
  });
  // Прошедшее время, а не будущее: тот же счёт, что в предпросмотре, но
  // «перепишутся» после сохранения читалось бы как «ещё не сделано».
  return `Поставлено ${text
    .replace(/ перепишутся| перепишется/, " переписано")
    .replace(" заменится", " заменён")
    .replace(" заменятся", " заменено")}`;
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
