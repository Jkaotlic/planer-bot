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
