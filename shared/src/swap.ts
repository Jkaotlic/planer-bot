import type { SwapStatus, SwapEvent, Shift } from "./types";
import type { EntryCategory } from "./category";
import { shiftsOverlap, shiftInterval } from "./overlap";
import { absMinutes } from "./time";

const TRANSITIONS: Record<SwapStatus, Partial<Record<SwapEvent, SwapStatus>>> = {
  pending: { accept: "accepted", decline: "declined", cancel: "cancelled", expire: "expired" },
  accepted: {},
  declined: {},
  cancelled: {},
  expired: {},
};

export function nextSwapStatus(current: SwapStatus, event: SwapEvent): SwapStatus {
  const next = TRANSITIONS[current][event];
  if (!next) {
    throw new Error(`Invalid swap transition: "${current}" + "${event}"`);
  }
  return next;
}

/**
 * Рантайм-массив, а не только объявление типа — по той же причине, что и
 * `AUDIT_TYPES` в `audit.ts`: тест на полноту таблицы русских подписей может
 * реально перебрать все значения, а не сверять два списка, набранных руками в
 * разных файлах. Причина, показанная человеку сырым кодом, — дефект, который в
 * этом проекте уже ловили.
 */
export const SWAP_REJECT_REASONS = [
  // Запреты, не зависящие от самих смен — см. `swapBlockReason`.
  "swaps-locked",
  "from-excluded",
  "to-excluded",
  "different-day",
  "from-shift-not-owned",
  "to-shift-not-owned",
  "from-shift-in-past",
  "to-shift-in-past",
  "double-booking-from",
  "double-booking-to",
  "identical-shift",
] as const;

export type SwapRejectReason = (typeof SWAP_REJECT_REASONS)[number];

/**
 * Почему обмен запрещён вне зависимости от того, какие смены выбраны, — или null.
 *
 * Отдельно от `validateSwap`, потому что мини-аппу это нужно ДО того, как вторая
 * смена вообще выбрана: погасить кнопку «Обменять» и вычистить список кандидатов.
 * Одна функция — один порядок приоритета на всех трёх поверхностях (сервер,
 * кнопка, список), иначе экран и сервер начнут называть разные причины.
 *
 * Порядок: сначала общий лок, потом своё исключение, потом чужое. Человеку
 * называют причину, которая от его действий не зависит.
 */
export function swapBlockReason(input: {
  swapsLocked: boolean;
  fromExcluded: boolean;
  toExcluded: boolean;
}): "swaps-locked" | "from-excluded" | "to-excluded" | null {
  if (input.swapsLocked) return "swaps-locked";
  if (input.fromExcluded) return "from-excluded";
  if (input.toExcluded) return "to-excluded";
  return null;
}

/**
 * Отличает три причины `swapBlockReason` от остальных `SWAP_REJECT_REASONS`.
 *
 * Нужна `acceptSwap`: те три причины — временное состояние, выставленное
 * админом, а не факт про сами смены. Заявка, отказанная по ним, обязана
 * остаться `pending` — «второй замок на той же двери» не должен навсегда
 * гасить заявку и врать инициатору, что смена куда-то делась. Вынесена сюда
 * единой функцией, а не тройным литералом на месте вызова, чтобы набор не
 * разъехался с самим `swapBlockReason`, если в него когда-нибудь добавят
 * четвёртую причину.
 */
export function isAdminBlockReason(
  reason: SwapRejectReason,
): reason is "swaps-locked" | "from-excluded" | "to-excluded" {
  return reason === "swaps-locked" || reason === "from-excluded" || reason === "to-excluded";
}

export type SwapValidation = { ok: true } | { ok: false; reason: SwapRejectReason };

/**
 * The subset of a shift needed to tell whether two shifts are "the same kind"
 * (see `isIdenticalShift`). Deliberately structural rather than tied to
 * `Shift`, so both the server's DB row and the miniapp's lighter client-side
 * shape can be passed in without a conversion step.
 */
export interface ShiftKind {
  date: string;
  templateId: number | null;
  category: EntryCategory;
  start: string | null;
  end: string | null;
}

/**
 * A swap that would leave both people holding exactly what they started
 * with: the two shifts fall on the same date AND are the same "kind".
 *
 * "Same kind":
 * - if either shift has a preset (`templateId`), the kind IS the preset —
 *   compare `templateId` alone. Two unrelated presets can coincidentally
 *   share a time (and would wrongly compare equal by time alone), but a
 *   preset is the actual identity of a shift in this project.
 * - only when BOTH shifts are hand-made (no preset) do we fall back to
 *   `category` + `start` + `end`.
 *
 * Deliberately NOT flagged: two different presets on the same day — that
 * changes both people's hours, which is the point.
 *
 * A pair on two different days never reaches this function through
 * `validateSwap`: since 2026-08-03 swaps live inside a single day, and
 * `different-day` is answered several checks earlier.
 */
export function isIdenticalShift(a: ShiftKind, b: ShiftKind): boolean {
  if (a.date !== b.date) return false;
  if (a.templateId != null || b.templateId != null) return a.templateId === b.templateId;
  return a.category === b.category && a.start === b.start && a.end === b.end;
}

export interface SwapContext {
  fromShift: Shift & Pick<ShiftKind, "category">;
  toShift: Shift & Pick<ShiftKind, "category">;
  fromEmployeeId: number;
  toEmployeeId: number;
  /** initiator's other shifts (excluding fromShift) */
  fromOtherShifts: Shift[];
  /** counterparty's other shifts (excluding toShift) */
  toOtherShifts: Shift[];
  /** current team wall-clock time */
  now: { date: string; time: string };
  /** Глобальный рубильник админа: обмены закрыты для всех. */
  swapsLocked: boolean;
  /** Инициатор выведен админом из обменов. */
  fromExcluded: boolean;
  /** Вторая сторона выведена админом из обменов. */
  toExcluded: boolean;
}

export function validateSwap(ctx: SwapContext): SwapValidation {
  const { fromShift, toShift, fromEmployeeId, toEmployeeId, fromOtherShifts, toOtherShifts, now } = ctx;

  if (fromShift.employeeId !== fromEmployeeId) return { ok: false, reason: "from-shift-not-owned" };
  if (toShift.employeeId !== toEmployeeId) return { ok: false, reason: "to-shift-not-owned" };

  // Запреты, не зависящие от самих смен. Стоят раньше «разные дни / в прошлом /
  // та же смена»: выбор другой смены их не снимет, а причина, которую можно
  // «обойти», сбивает человека с толку сильнее, чем прямой запрет.
  const blocked = swapBlockReason(ctx);
  if (blocked) return { ok: false, reason: blocked };

  // Обмен существует только внутри одного дня (его решение, 2026-08-03): отдаёшь
  // четверг — берёшь смену коллеги в этот же четверг. Правило стоит здесь, а не
  // в экране, потому что через этот валидатор проходят оба входа — предложение
  // из мини-аппа и кнопка «Принять» в боте. И стоит до проверок «в прошлом» и
  // «та же самая смена»: человеку надо назвать причину, которая ближе к делу.
  if (fromShift.date !== toShift.date) return { ok: false, reason: "different-day" };

  const nowAbs = absMinutes(now.date, now.time);
  if (shiftInterval(fromShift).start <= nowAbs) return { ok: false, reason: "from-shift-in-past" };
  if (shiftInterval(toShift).start <= nowAbs) return { ok: false, reason: "to-shift-in-past" };

  if (isIdenticalShift(fromShift, toShift)) return { ok: false, reason: "identical-shift" };

  // After the swap: initiator works `toShift`, counterparty works `fromShift`.
  if (fromOtherShifts.some((s) => shiftsOverlap(s, toShift))) return { ok: false, reason: "double-booking-from" };
  if (toOtherShifts.some((s) => shiftsOverlap(s, fromShift))) return { ok: false, reason: "double-booking-to" };

  return { ok: true };
}
