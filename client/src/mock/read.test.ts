import { teamScheduleResponseSchema, templatesResponseSchema } from "@planer/shared";
import { describe, expect, it } from "vitest";
import { createReadMock, seedReadMockState } from "./read";

/** ISO-дата со сдвигом в днях от сегодня — сид привязан к текущей неделе. */
function dayFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Мок обязан отвечать той же формой, что сервер. Это не ловит «правдоподобно и
 * неверно» по содержанию, но ловит расхождение формы — а именно оно и разъезжалось.
 */
describe("мок домена read", () => {
  const mock = createReadMock({ delayMs: 0 });

  it("пресеты проходят схему контракта", async () => {
    const templates = await mock.getTemplates();
    // Без этой строки схема прошла бы и по пустому массиву — то есть тест не мог бы упасть.
    expect(templates.length).toBeGreaterThan(0);
    const parsed = templatesResponseSchema.safeParse({ templates });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("график команды проходит схему контракта", async () => {
    const schedule = await mock.getTeamSchedule(dayFromToday(-7), dayFromToday(7));
    expect(schedule.shifts.length).toBeGreaterThan(0);
    expect(schedule.employees.length).toBeGreaterThan(0);
    const parsed = teamScheduleResponseSchema.safeParse(schedule);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("свои смены проходят схему контракта", async () => {
    const mine = await mock.getMyShifts();
    expect(mine.shifts.length).toBeGreaterThan(0);
    expect(mine.shifts.every((s) => s.employeeId === seedReadMockState().meId)).toBe(true);
  });

  it("срезает поля, которых сервер не отдаёт", async () => {
    // Мини-апп хранит в своих записях `employeeName`, который приклеивает сам.
    // Сервер такого поля не отдаёт, и строгая схема его отвергнет — значит мок
    // обязан отдавать чистый DTO, даже когда состояние несёт лишнее.
    const state = seedReadMockState();
    const dirty = { ...state.entries[0]!, employeeName: "Аня", note: "секрет" };
    const dirtyMock = createReadMock({ delayMs: 0, state: { ...state, entries: [dirty] } });
    const schedule = await dirtyMock.getTeamSchedule(dayFromToday(-7), dayFromToday(7));
    expect(schedule.shifts[0]).not.toHaveProperty("employeeName");
    expect(schedule.shifts[0]).not.toHaveProperty("note");
    expect(teamScheduleResponseSchema.safeParse(schedule).error?.issues ?? []).toEqual([]);
  });

  it("с нулевой задержкой не спит", async () => {
    const started = Date.now();
    await mock.getTemplates();
    expect(Date.now() - started).toBeLessThan(50);
  });
});
