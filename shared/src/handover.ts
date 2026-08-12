export type HandoverStatus = "offered" | "fanned" | "taken" | "cancelled" | "expired";

/** Что тик обязан сделать с передачей прямо сейчас. */
export type HandoverAction = "fan" | "escalate" | "expire";

export interface HandoverThresholds {
  /** Сколько часов ждём молчания адресата, прежде чем звать всех свободных. */
  fanAfterHours: number;
  /** За сколько часов до начала смены зовём админов. */
  escalateBeforeHours: number;
}

export interface HandoverState {
  status: HandoverStatus;
  /** Момент, с которого считается молчание, в миллисекундах эпохи. */
  offeredAt: number;
  /** Когда админам уже написали. `null` — ещё не писали. */
  escalatedAt: number | null;
  shiftStartsAt: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Лестница целиком: статус, два порога и три отметки времени на входе — список
 * действий на выходе.
 *
 * Список, а не одно действие, и это не запас на будущее. Передача, предложенная
 * за два часа до смены и провисевшая два часа, одновременно просрочила молчание
 * и вошла в окно эскалации. Функция с одним ответом отложила бы второе действие
 * до следующего тика, то есть на пять минут — там, где времени осталось два часа.
 *
 * Порядок фиксирован: `fan` перед `escalate`, чтобы письмо админам называло уже
 * разосланный веер, а не собиралось его разослать.
 */
export function handoverActions(state: HandoverState, nowMs: number, t: HandoverThresholds): HandoverAction[] {
  // Решённая передача не оживает ничем: взятая, погашенная и просроченная —
  // конечные состояния, и тик обязан пройти мимо них молча.
  if (state.status !== "offered" && state.status !== "fanned") return [];

  // Смена началась — дальше лестницы нет. Проверяется первым: и веер, и письмо
  // админам о смене, которая уже идёт, — шум про то, чего не изменить.
  if (nowMs >= state.shiftStartsAt) return ["expire"];

  const actions: HandoverAction[] = [];

  // Веер бывает по двум причинам, и вторая не про молчание: если до смены
  // осталось меньше, чем мы вообще готовы ждать ответа, ждать больше нечего.
  const silentTooLong = nowMs - state.offeredAt >= t.fanAfterHours * HOUR_MS;
  const shiftTooClose = state.shiftStartsAt - nowMs <= t.fanAfterHours * HOUR_MS;
  if (state.status === "offered" && (silentTooLong || shiftTooClose)) actions.push("fan");

  if (state.escalatedAt == null && state.shiftStartsAt - nowMs <= t.escalateBeforeHours * HOUR_MS) {
    actions.push("escalate");
  }

  return actions;
}

/**
 * Смещение пояса в миллисекундах для конкретного момента.
 *
 * Именно для момента, а не для пояса: у половины поясов оно меняется дважды в
 * год, и функция, зашившая одно число, ошибалась бы на час ровно полгода — тот
 * сорт ошибки, который замечают в ноябре.
 */
function zonedOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour12: false` даёт 24 вместо 0 на полуночи в части сред — приводим к 0,
  // иначе полночь уехала бы на сутки вперёд.
  const hour = at("hour") % 24;
  const asIfUtc = Date.UTC(at("year"), at("month") - 1, at("day"), hour, at("minute"), at("second"));
  return asIfUtc - utcMs;
}

/**
 * Момент начала смены в миллисекундах.
 *
 * По дате И времени, а не по дате: ночная смена в 23:00 обязана эскалироваться в
 * 11:00 того же дня, а не в полночь. У записи без времени (отсутствие, «весь
 * день») начало — полночь: иначе «весь день» пришлось бы либо считать
 * начавшимся всегда, либо не считать вовсе.
 *
 * Пояс — командный, как и везде в этом проекте: граница дня не должна зависеть
 * от того, где физически находится машина.
 */
export function shiftStartMs(entry: { date: string; start: string | null }, teamTz: string): number {
  const [y, m, d] = entry.date.split("-").map(Number);
  const [hh, mm] = (entry.start ?? "00:00").split(":").map(Number);
  const naive = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  // Смещение берётся по самому наивному моменту, а не по «сейчас»: смена в
  // декабре считается по декабрьскому смещению, даже если тик крутится в июле.
  return naive - zonedOffsetMs(naive, teamTz);
}
