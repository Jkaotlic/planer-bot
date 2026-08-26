import { toMinutes, isNightShift } from "./time";

export type ReminderKind = "morning" | "day" | "evening" | "night";

/**
 * morning: starts *before* 09:00 (not night); night: isNightShift; evening: ends
 * ≥20:00 (not night); else day.
 *
 * The 09:00 boundary is exclusive on purpose. The team's standard shift is
 * «День», 09:00–18:00 — with `<=` it was classified as morning, so every one of
 * them produced a nightly «Завтра у тебя утренняя — 09:00–18:00»: a reminder
 * about the default day, and one that called it by the wrong name. «Утро» starts
 * at 08:00 and is still caught.
 */
export function reminderKind(shift: { start: string; end: string }): ReminderKind {
  if (isNightShift(shift)) return "night";
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  if (start < 9 * 60) return "morning";
  if (end >= 20 * 60) return "evening";
  return "day";
}

/**
 * Which shifts are worth a «завтра у тебя смена» the evening before: the three
 * that change your evening — an early start, a late finish, a night.
 *
 * The plain day shift (09:00–18:00) is deliberately silent. It is the default
 * everybody already expects, and a nightly message about it is the fastest way
 * to teach people to ignore the ones that matter.
 *
 * С 0030 это ЗАПАСНОЕ правило, а не главное: у записи с видом смены решает его
 * галочка `sendReminder`, которую правит админ. Эвристика осталась для записей
 * без вида смены — импортированных из ростера и проставленных руками, — у
 * которых выключать нечего. Ею же 0030 пересеяла саму колонку, чтобы день
 * выкатки ничего не изменил.
 */
export function isReminderWorthy(shift: { start: string; end: string }): boolean {
  return reminderKind(shift) !== "day";
}

/** wake time = start − prepBufferMin, "HH:MM", clamped ≥ 00:00. */
export function wakeTime(start: string, prepBufferMin: number): string {
  const mins = Math.max(0, toMinutes(start) - prepBufferMin);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** warm Russian message per kind. */
export function buildReminderText(p: { name: string; kind: ReminderKind; timeRange: string; wake?: string }): string {
  const { name, kind, timeRange, wake } = p;
  switch (kind) {
    case "morning":
      return `🌅 Привет, ${name}! Завтра у тебя утренняя — ${timeRange}. Ложись пораньше и поставь будильник на ~${wake}. Хорошей смены ☕`;
    case "night":
      return `🌙 Привет, ${name}! Завтра ночная — ${timeRange}. Отдохни днём и продумай дорогу домой. Ты справишься 💪`;
    case "evening":
      return `👋 Привет, ${name}! Завтра вечерняя смена — ${timeRange}. Хорошего дня и до встречи вечером!`;
    case "day":
    default:
      return `👋 Привет, ${name}! Напоминаем: завтра смена — ${timeRange}. Хорошего дня!`;
  }
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
export const REMINDER_PLACEHOLDERS = ["имя", "время", "подъём"] as const;

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

/** Подставляет значения в свой текст напоминания. Проверку делает вызывающий. */
export function renderReminderText(template: string, vars: ReminderVars): string {
  return template.replace(PLACEHOLDER_RE, (whole, raw: string) => {
    const value = PLACEHOLDER_VALUES[normalisePlaceholder(raw)];
    return value ? value(vars) : whole;
  });
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
 * Пример, на котором админ видит своё письмо до того, как оно уйдёт команде.
 *
 * Имя вымышленное: репозиторий публичный, и настоящих ФИО в нём быть не может
 * (`server/src/db/no-real-names.test.ts`).
 */
export const REMINDER_PREVIEW_VARS: ReminderVars = { name: "Аня", timeRange: "08:00–17:00", wake: "07:00" };

export type ReminderPreview = { ok: true; text: string } | { ok: false; error: string };

/**
 * Что уйдёт человеку, если сохранить этот текст, — или почему не сохранится.
 *
 * Живёт в shared, а не на экране: обе консоли рисуют один и тот же предпросмотр,
 * и правило «какая подстановка существует» уже описано здесь один раз.
 */
export function previewReminderText(template: string): ReminderPreview {
  try {
    validateReminderTemplate(template);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Неверный текст напоминания" };
  }
  return { ok: true, text: renderReminderText(template, REMINDER_PREVIEW_VARS) };
}
