import { describe, it, expect } from "vitest";
import { handoverActions, shiftStartMs, type HandoverState } from "./handover";

const T = { fanAfterHours: 3, escalateBeforeHours: 12 };
const HOUR = 60 * 60 * 1000;

/** Момент «сейчас» фиксирован — лестница обязана быть функцией, а не поведением часов. */
const NOW = Date.UTC(2026, 7, 12, 9, 0);

function state(patch: Partial<HandoverState> = {}): HandoverState {
  return {
    status: "offered",
    offeredAt: NOW - HOUR,
    escalatedAt: null,
    shiftStartsAt: NOW + 48 * HOUR,
    ...patch,
  };
}

describe("лестница передачи", () => {
  it("молчание 2:59 не даёт веера, 3:01 даёт", () => {
    expect(handoverActions(state({ offeredAt: NOW - (3 * HOUR - 60_000) }), NOW, T)).toEqual([]);
    expect(handoverActions(state({ offeredAt: NOW - (3 * HOUR + 60_000) }), NOW, T)).toEqual(["fan"]);
  });

  it("до смены остались те же три часа — веер, даже если молчали минуту", () => {
    const s = state({ offeredAt: NOW - 60_000, shiftStartsAt: NOW + 2 * HOUR });
    expect(handoverActions(s, NOW, T)).toContain("fan");
  });

  it("веер уже разослан — второй раз не рассылаем", () => {
    expect(handoverActions(state({ status: "fanned", offeredAt: NOW - 10 * HOUR }), NOW, T)).toEqual([]);
  });

  it("до смены 11:59 — эскалация; с отметкой — молчим", () => {
    const near = { status: "fanned" as const, offeredAt: NOW - 10 * HOUR, shiftStartsAt: NOW + 11 * HOUR };
    expect(handoverActions({ ...near, escalatedAt: null }, NOW, T)).toEqual(["escalate"]);
    expect(handoverActions({ ...near, escalatedAt: NOW - HOUR }, NOW, T)).toEqual([]);
  });

  it("оба действия сразу, и веер идёт первым", () => {
    // Предложено два часа назад, до смены два часа: просрочено и молчание, и
    // окно эскалации. Одно действие за тик отложило бы второе на пять минут —
    // там, где времени и так осталось два часа.
    const s = state({ offeredAt: NOW - 2 * HOUR, shiftStartsAt: NOW + 2 * HOUR });
    expect(handoverActions(s, NOW, T)).toEqual(["fan", "escalate"]);
  });

  it("смена началась — только expire, чем бы всё ни было до того", () => {
    for (const status of ["offered", "fanned"] as const) {
      expect(handoverActions(state({ status, shiftStartsAt: NOW - 60_000 }), NOW, T)).toEqual(["expire"]);
    }
  });

  it("решённой передаче лестница ничего не делает", () => {
    for (const status of ["taken", "cancelled", "expired"] as const) {
      expect(handoverActions(state({ status, shiftStartsAt: NOW - 10 * HOUR }), NOW, T)).toEqual([]);
    }
  });
});

describe("начало смены", () => {
  it("считается по дате И времени, а не по дате", () => {
    const night = shiftStartMs({ date: "2026-08-12", start: "23:00" }, "Europe/Moscow");
    const morning = shiftStartMs({ date: "2026-08-12", start: "09:00" }, "Europe/Moscow");
    expect(night - morning).toBe(14 * HOUR);
  });

  it("у записи без времени начало — полночь того дня", () => {
    const allDay = shiftStartMs({ date: "2026-08-12", start: null }, "Europe/Moscow");
    const morning = shiftStartMs({ date: "2026-08-12", start: "09:00" }, "Europe/Moscow");
    expect(morning - allDay).toBe(9 * HOUR);
  });

  it("часовой пояс команды, а не машины", () => {
    // Москва — UTC+3 круглый год. 09:00 по команде это 06:00 UTC.
    expect(shiftStartMs({ date: "2026-08-12", start: "09:00" }, "Europe/Moscow")).toBe(Date.UTC(2026, 7, 12, 6, 0));
  });

  it("пояс с переходом на летнее время считается по своей дате, а не по одному смещению", () => {
    // Берлин зимой +1, летом +2. Функция, зашившая одно смещение, ошиблась бы
    // на час ровно полгода — и это тот сорт ошибки, который замечают в ноябре.
    const summer = shiftStartMs({ date: "2026-07-15", start: "12:00" }, "Europe/Berlin");
    const winter = shiftStartMs({ date: "2026-12-15", start: "12:00" }, "Europe/Berlin");
    expect(summer).toBe(Date.UTC(2026, 6, 15, 10, 0));
    expect(winter).toBe(Date.UTC(2026, 11, 15, 11, 0));
  });
});
