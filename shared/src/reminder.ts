import { toMinutes, isNightShift, nextDate, prevDate } from "./time";
import { formatDayMonth } from "./collection";
import { isAbsence, type EntryCategory } from "./category";

export type ReminderKind = "early" | "morning" | "day" | "evening" | "night";

/**
 * early: starts before 08:00; morning: 08:00–08:59; night: isNightShift;
 * evening: ends ≥20:00 (not night); else day.
 *
 * The 09:00 boundary is exclusive on purpose. The team's standard shift is
 * «День», 09:00–18:00 — with `<=` it was classified as morning, so every one of
 * them produced a nightly «Завтра у тебя утренняя — 09:00–18:00»: a reminder
 * about the default day, and one that called it by the wrong name. «Утро» starts
 * at 08:00 and is still caught.
 *
 * Восьмичасовая граница отделяет «Утро» (08:00) от «Дежурства с 07:00»: подъём
 * к семи — не то же самое, что к восьми, и письмо у них разное (его решение от
 * 2026-08-26).
 */
export function reminderKind(shift: { start: string; end: string }): ReminderKind {
  if (isNightShift(shift)) return "night";
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  if (start < 8 * 60) return "early";
  if (start < 9 * 60) return "morning";
  if (end >= 20 * 60) return "evening";
  return "day";
}

/**
 * Which shifts are worth a «завтра у тебя смена» the evening before: the ones
 * that change your evening — an early start, a late finish, a night.
 *
 * The plain day shift (09:00–18:00) is deliberately silent. It is the default
 * everybody already expects, and a nightly message about it is the fastest way
 * to teach people to ignore the ones that matter.
 *
 * С 0030 это часть запасного правила, а не главное: у записи с видом смены
 * решает его галочка `sendReminder`, которую правит админ. Само правило —
 * `remindsByDefault` ниже: часы здесь лишь один из двух его доводов.
 */
export function isReminderWorthy(shift: { start: string; end: string }): boolean {
  return reminderKind(shift) !== "day";
}

/**
 * Напоминаем ли про запись, когда за неё некому решить: у неё нет вида смены.
 *
 * «Всё, кроме обычного дня» — его правило от 2026-08-26. Дежурства идут те же
 * 09:00–18:00, что и «День», и по одним часам их не отличить: отличает
 * категория. Дежурство, выезд и работа в выходной рутиной не бывают — про них
 * напоминают всегда, а про обычную дневную смену молчат.
 *
 * Отсутствие исключено явно: у отпуска и больничного времени нет вовсе, но
 * «завтра у тебя смена» им не адресовано ни при каких часах.
 *
 * Этим же правилом 0030 засеяла колонку `send_reminder` у видов смен.
 */
export function remindsByDefault(entry: { start: string; end: string; category: EntryCategory }): boolean {
  if (isAbsence(entry.category)) return false;
  if (entry.category !== "shift") return true;
  return isReminderWorthy(entry);
}

/**
 * Часы, для которых ЭТОТ модуль готов посчитать и подставить «Завтра с
 * тобой»: те, что и так меняют вечер человека. У обычного дневного (`kind
 * === "day"`) строки нет вовсе — решение владельца от 2026-09-25.
 *
 * Дежурство с этим множеством не совпадает: оно бывает и дневным, и ранним, и
 * ночным — то же дежурство в 07:00–16:00 даёт `kind === "early"`, а не
 * "day". Этот модуль знает только часы, не категорию записи, и отличить
 * дежурство от обычной смены не может — это делает вызывающий
 * (`reminder-service.ts`, по `template.category`), передавая сюда пустой
 * список/пустую строку соседей заранее, если запись не «смена».
 */
const COWORKER_REMINDER_KINDS: ReadonlySet<ReminderKind> = new Set(["early", "morning", "evening", "night"]);

export interface DutyRun {
  /** Дежурство уже идёт: вчера его держал тот же человек. */
  continuing: boolean;
  /** Последний день отрезка. Равен `start`, если день одиночный. */
  lastDate: string;
}

/**
 * Отрезок подряд идущих дней одного дежурства у одного человека.
 *
 * Недельность вычитается из графика, а не из `rotationUnit`: очередь можно было
 * не выставить, а «кто держит Поклонку с понедельника по пятницу» видно по самим
 * записям. Пятидневный отрезок кончается пятницей сам собой — субботы и
 * воскресенья в наборе просто нет.
 *
 * Это правило существует, чтобы про недельное дежурство написали ОДИН раз,
 * накануне первого дня (для рабочей недели — в воскресенье вечером), а не пять
 * вечеров подряд. Одиночный день — отрезок длиной в день, и предупреждение
 * приходит вечером перед ним.
 */
export function dutyRun(held: ReadonlySet<string>, start: string): DutyRun {
  let lastDate = start;
  while (held.has(nextDate(lastDate))) lastDate = nextDate(lastDate);
  return { continuing: held.has(prevDate(start)), lastDate };
}

/** wake time = start − prepBufferMin, "HH:MM", clamped ≥ 00:00. */
export function wakeTime(start: string, prepBufferMin: number): string {
  const mins = Math.max(0, toMinutes(start) - prepBufferMin);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * warm Russian message per kind.
 *
 * Времени подъёма здесь нет ни у одного вида смены: «поставь будильник на 06:00»
 * — это распоряжение чужим вечером, и оно сугубо личное дело (его решение от
 * 2026-08-26). Подстановка `{подъём}` осталась — кто захочет, впишет её в свой
 * текст сам.
 *
 * `what` — название вида смены, и оно нужно только дневной формулировке. У
 * ранней, утренней, вечерней и ночной слово о смене уже есть в тексте, а вот
 * дневное письмо про дежурство без него слово в слово совпадало бы с письмом
 * про обычную смену — и человек не понял бы, что завтра он дежурный.
 */
export function buildReminderText(p: {
  name: string;
  kind: ReminderKind;
  timeRange: string;
  what?: string;
  until?: string;
  location?: string | null;
  coworkers?: readonly string[];
}): string {
  const { name, kind, timeRange, what, until, coworkers } = p;
  function baseText(): string {
    switch (kind) {
      case "early":
        return `🌄 Привет, ${name}! Завтра ранняя смена — ${timeRange}. Вставать совсем рано, так что ложись сегодня пораньше. Тёплого утра и лёгкой смены ☕`;
      case "morning":
        return `🌅 Привет, ${name}! Завтра у тебя утренняя смена — ${timeRange}. Ложись сегодня пораньше, и пусть утро будет добрым ☕`;
      case "night":
        return `🌙 Привет, ${name}! Завтра ночная смена — ${timeRange}. Отдохни днём, продумай дорогу домой и возьми с собой что-нибудь вкусное. Ты справишься 💪`;
      case "evening":
        return `🌇 Привет, ${name}! Завтра вечерняя смена — ${timeRange}. Утро в твоём распоряжении, высыпайся вволю. До встречи вечером 💛`;
      case "day":
      default:
        if (what && until) {
          // «Завтра дежурство» про пятидневный отрезок — неправда, по которой
          // человек спланирует только понедельник.
          return `👋 Привет, ${name}! С завтрашнего дня и по ${formatDayMonth(until)} у тебя «${what}» — ${timeRange}. Хорошей недели, ты справишься 🍀`;
        }
        if (what) {
          return `👋 Привет, ${name}! Завтра у тебя «${what}» — ${timeRange}. Хорошего дня и лёгкой смены 🍀`;
        }
        return `👋 Привет, ${name}! Напоминаем: завтра смена — ${timeRange}. Хорошего дня и лёгкой смены 🍀`;
    }
  }
  // Место — приписка, а не часть формулировки: у каждого вида смены и так своя
  // фраза, и городить пятое дублирование текста ради одной строки в конце незачем.
  const loc = p.location?.trim();
  let text = loc ? `${baseText()}\n📍 ${loc}` : baseText();
  // «Завтра с тобой» — вторая приписка, после места. Только у часов, у которых
  // и так что-то меняется вечером (см. COWORKER_REMINDER_KINDS) — категорию
  // записи (дежурство или нет) этот модуль не знает вовсе: решает вызывающий,
  // передавая пустой `coworkers`, если строка не нужна независимо от часов.
  if (coworkers && coworkers.length > 0 && COWORKER_REMINDER_KINDS.has(kind)) {
    const line = coworkersLine(coworkers);
    if (line) text += `\n${line}`;
  }
  return text;
}

export class ReminderTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReminderTextError";
  }
}

/**
 * Свой текст напоминания у вида смены: что админ может подставить.
 *
 * Массив, а не разрозненные строки, по той же причине, что и `ADMIN_NOTICE_KINDS`:
 * подсказка на экране, проверка и сама подстановка перечисляют одно и то же, и
 * разойдись они — админ получит отказ на подстановку, которую ему же и предложили.
 */
export const REMINDER_PLACEHOLDERS = ["имя", "время", "подъём", "место", "с кем"] as const;

/** Длиннее одного экрана телефона напоминание перестаёт читаться. */
export const REMINDER_TEXT_MAX = 400;

/** Час позже этого рискует не наступить — см. `validateReminderHour`. */
export const REMINDER_HOUR_LATEST = "23:30";

/** Во сколько напоминания уходили до того, как час стал настройкой. */
export const REMINDER_HOUR_DEFAULT = "20:00";

export interface ReminderVars {
  name: string;
  timeRange: string;
  wake: string;
  location: string;
  /** Готовый текст перечисления без префикса «👥 …»: «Игорь, Марк» или «». */
  coworkers: string;
}

/**
 * `{Подъем}` и `{подъём}` — одна и та же подстановка.
 *
 * Ё на клавиатуре нет у половины пишущих, а заглавная буква в начале фразы
 * появляется сама. Отказ за это означал бы, что админ правит текст, глядя на
 * сообщение об ошибке, которое перечисляет ровно то, что он и написал.
 */
function normalisePlaceholder(raw: string): string {
  return raw.trim().toLowerCase().replace(/ё/g, "е");
}

const PLACEHOLDER_RE = /\{([^{}]*)\}/g;

const PLACEHOLDER_VALUES: Record<string, (vars: ReminderVars) => string> = {
  имя: (vars) => vars.name,
  время: (vars) => vars.timeRange,
  подъем: (vars) => vars.wake,
  место: (vars) => vars.location,
  "с кем": (vars) => vars.coworkers,
};

/**
 * Проверяет свой текст напоминания. Молчит, если всё хорошо; иначе бросает
 * `ReminderTextError` с русским сообщением — оно уходит админу как есть.
 *
 * Неизвестная подстановка — отказ, а не тихая замена на пустоту: иначе про
 * опечатку в `{имя}` узнают, когда письмо уже разошлось по команде.
 */
export function validateReminderTemplate(text: string): void {
  if (text.trim().length === 0) {
    throw new ReminderTextError("Текст напоминания пустой. Очисти поле совсем, чтобы вернуть текст по умолчанию.");
  }
  if (text.length > REMINDER_TEXT_MAX) {
    throw new ReminderTextError(`Текст напоминания длиннее ${REMINDER_TEXT_MAX} символов: сейчас ${text.length}.`);
  }
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    const name = normalisePlaceholder(match[1]);
    if (!(name in PLACEHOLDER_VALUES)) {
      const known = REMINDER_PLACEHOLDERS.map((p) => `{${p}}`).join(", ");
      throw new ReminderTextError(`Неизвестная подстановка «${match[0]}». Есть только: ${known}.`);
    }
  }
}

/**
 * Подставляет значения в свой текст напоминания. Проверку делает вызывающий.
 *
 * `kind` — необязательный: превью своего текста (ShiftKindsScreen) вызывает
 * без него, потому что не знает, каким видом смены этот текст обернётся у
 * конкретной записи. Без `kind` подстановка `{с кем}` работает как обычная —
 * маскирует её в пустую строку только явное `kind === "day"` (см. интерфейс).
 */
export function renderReminderText(template: string, vars: ReminderVars, kind?: ReminderKind): string {
  const mentions = (placeholder: string) =>
    [...template.matchAll(PLACEHOLDER_RE)].some((m) => normalisePlaceholder(m[1]) === placeholder);

  const rendered = template.replace(PLACEHOLDER_RE, (whole, raw: string) => {
    const name = normalisePlaceholder(raw);
    // У дневного вида (`kind === "day"`) соседей не подставляют даже по прямой
    // просьбе в своём тексте. Дежурство в другие часы под это правило не
    // подпадает — этот модуль знает только `kind`, а не категорию записи;
    // «дежурство никогда не получает соседей» решает вызывающий заранее,
    // передавая пустой `vars.coworkers`.
    if (name === "с кем" && kind === "day") return "";
    const value = PLACEHOLDER_VALUES[name];
    return value ? value(vars) : whole;
  });

  const loc = vars.location.trim();
  // Место — то, что накануне нужнее всего, после времени. Админ, написавший свой
  // текст до появления `{место}`, не должен лишать людей адреса по незнанию.
  let result = loc && !mentions("место") ? `${rendered}\n📍 ${loc}` : rendered;

  // «Завтра с тобой» — вторая приписка, после места, и только у видов из
  // COWORKER_REMINDER_KINDS: без `kind` (превью) или у дневного вида её не
  // добавляют самостоятельно, ровно как и не подставляют по `{с кем}` выше.
  const coworkers = vars.coworkers.trim();
  const coworkersAllowed = kind !== undefined && COWORKER_REMINDER_KINDS.has(kind);
  if (coworkersAllowed && coworkers && !mentions("с кем")) {
    result = `${result}\n👥 Завтра с тобой: ${coworkers}`;
  }
  return result;
}

/**
 * Во сколько уходят напоминания. Молчит, если час годится.
 *
 * Верхняя граница не косметическая: тик крутится раз в пять минут и не выровнен
 * по часам, так что час вроде 23:45 может не наступить до полуночи. А после
 * полуночи «завтра» — это уже послезавтра, и напоминание не уйдёт вовсе.
 */
export function validateReminderHour(value: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ReminderTextError(`«${value}» — нужно время вида ЧЧ:ММ, например ${REMINDER_HOUR_DEFAULT}.`);
  }
  if (toMinutes(value) > toMinutes(REMINDER_HOUR_LATEST)) {
    throw new ReminderTextError(
      `Позже ${REMINDER_HOUR_LATEST} нельзя: напоминание проверяется раз в пять минут и может не успеть до полуночи.`,
    );
  }
}

/**
 * Перечисление имён без префикса «👥 …» — «Игорь, Марк» или «» при пустом
 * списке. Отдельная функция, а не тело `coworkersLine`, потому что тот же
 * готовый текст нужен серверу для `ReminderVars.coworkers`, когда админ вписал
 * `{с кем}` в свой текст напоминания: подстановка не должна дублировать
 * усечение «первые шесть и ещё N» второй копией этого правила.
 *
 * Хвост «и ещё N» после шестого имени — длинный список нечитаем на экране
 * телефона, и после шести человек он перестаёт нести пользу (то же
 * ограничение, что и в анонсе по именам).
 */
export function coworkersEnumeration(names: readonly string[]): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, 6);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")}, и ещё ${rest}` : shown.join(", ");
}

/**
 * Строка «Завтра с тобой: …» для напоминания — только те, чьи часы
 * пересекаются со сменой. `null` при пустом списке: строки вида «Завтра с
 * тобой: (никого)» не бывает — её просто нет.
 */
export function coworkersLine(names: readonly string[]): string | null {
  const text = coworkersEnumeration(names);
  return text ? `👥 Завтра с тобой: ${text}` : null;
}

/**
 * Пример, на котором админ видит своё письмо до того, как оно уйдёт команде.
 *
 * Имя вымышленное: репозиторий публичный, и настоящих ФИО в нём быть не может
 * (`server/src/db/no-real-names.test.ts`). Место и соседи — тоже пример, а не
 * место/люди конкретной смены: превью не знает, для какой смены его смотрят, и
 * показывает то же самое «Поклонка» и «Игорь, Марк» всем — включая
 * приписанные строки `📍 …` и `👥 …` в конце текста без соответствующих
 * подстановок, ровно как это будет выглядеть у настоящей смены (см.
 * `previewReminderText` — там же зафиксирован представительный `kind`, от
 * которого зависит, показывается ли вторая строка вовсе).
 */
export const REMINDER_PREVIEW_VARS: ReminderVars = {
  name: "Аня",
  timeRange: "08:00–17:00",
  wake: "07:00",
  location: "Поклонка",
  coworkers: "Игорь, Марк",
};

export type ReminderPreview = { ok: true; text: string } | { ok: false; error: string };

/**
 * Что уйдёт человеку, если сохранить этот текст, — или почему не сохранится.
 *
 * Живёт в shared, а не на экране: обе консоли рисуют один и тот же предпросмотр,
 * и правило «какая подстановка существует» уже описано здесь один раз.
 *
 * `kind` зафиксирован как `"morning"` — представительный, не настоящий: этот
 * текст редактируется для вида смены (шаблона), а не для конкретной записи, и
 * превью не знает, каким `kind` она обернётся в проде. Без представительного
 * `kind` строка «Завтра с тобой» никогда не появлялась бы в предпросмотре сама
 * (автодобавление требует `kind` из четырёх — см. `COWORKER_REMINDER_KINDS`),
 * и админ узнавал бы про этот механизм только когда письмо уже ушло. У видов,
 * которые в проде дают `kind === "day"` (обычная дневная смена, многие
 * дежурства), эта строка в реальном письме не появится — здесь она показана
 * как возможность механизма, а не как гарантия для конкретного вида.
 */
export function previewReminderText(template: string): ReminderPreview {
  try {
    validateReminderTemplate(template);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Неверный текст напоминания" };
  }
  return { ok: true, text: renderReminderText(template, REMINDER_PREVIEW_VARS, "morning") };
}
