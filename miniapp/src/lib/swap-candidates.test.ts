import { afterEach, describe, expect, it, vi } from "vitest";
import type { Shift } from "../api/client";
import { nowOnTeamDay, swapCandidates } from "./swap-candidates";

const DAY = "2026-09-10";
const NOW = new Date("2026-09-01T10:00:00");

const shift = (over: Partial<Shift> & { id: number }): Shift =>
  ({
    date: DAY,
    endDate: null,
    start: "09:00",
    end: "18:00",
    category: "shift",
    title: "День",
    templateId: 2,
    employeeId: 2,
    employeeName: "Коллега А",
    location: null,
    note: null,
    unrecognisedCode: null,
    ...over,
  }) as Shift;

const mine = shift({
  id: 1,
  employeeId: 1,
  employeeName: undefined,
  start: "15:00",
  end: "23:00",
  templateId: 4,
  title: "Вечер",
});

describe("swapCandidates", () => {
  it("берёт только чужие смены того же дня", () => {
    const other = shift({ id: 2 });
    const otherDay = shift({ id: 3, date: "2026-09-11" });
    const { candidates } = swapCandidates(mine, [mine, other, otherDay], 1, NOW, new Set());
    expect(candidates.map((s) => s.id)).toEqual([2]);
  });

  it("не предлагает вакантную запись — меняться не с кем", () => {
    const vacant = shift({ id: 2, employeeId: null, employeeName: undefined });
    const { candidates } = swapCandidates(mine, [vacant], 1, NOW, new Set());
    expect(candidates).toEqual([]);
  });

  // Дежурство здесь стояло рядом с отпуском до 2026-08-10: тогда «дежурством не
  // меняются» было правилом. Теперь меняются, и дежурство переехало в тест ниже.
  it("не предлагает отпуск и клетку без времени", () => {
    const vacation = shift({ id: 3, category: "vacation", start: null, end: null, employeeId: 3 });
    const unreadable = shift({ id: 4, start: null, end: null, templateId: null, employeeId: 4 });
    const { candidates } = swapCandidates(mine, [vacation, unreadable], 1, NOW, new Set());
    expect(candidates).toEqual([]);
  });

  it("дежурство коллеги предлагает — им тоже можно меняться", () => {
    const duty = shift({ id: 2, category: "duty", title: "Дежурство · Поклонка", templateId: 7, start: "09:00", end: "18:00" });
    const { candidates } = swapCandidates(mine, [duty], 1, NOW, new Set());
    expect(candidates.map((s) => s.id)).toEqual([2]);
  });

  // Дежурство без часов — это нечитаемая клетка импорта: отдавать нечего, и
  // сервер называет это `not_swappable`. Открытая категория этого не отменяет.
  it("дежурство без времени не предлагает", () => {
    const timeless = shift({ id: 2, category: "duty", start: null, end: null, templateId: null });
    const { candidates } = swapCandidates(mine, [timeless], 1, NOW, new Set());
    expect(candidates).toEqual([]);
  });

  it("не предлагает начавшуюся смену", () => {
    const started = shift({ id: 2 });
    const { candidates } = swapCandidates(mine, [started], 1, new Date("2026-09-10T12:00:00"), new Set());
    expect(candidates).toEqual([]);
  });

  it("такую же смену прячет, но считает", () => {
    const same = shift({ id: 2, templateId: 4, start: "15:00", end: "23:00", title: "Вечер" });
    const same2 = shift({ id: 3, employeeId: 3, templateId: 4, start: "15:00", end: "23:00", title: "Вечер" });
    const different = shift({ id: 4, employeeId: 4 });
    const { candidates, sameKindCount } = swapCandidates(mine, [same, same2, different], 1, NOW, new Set());
    expect(candidates.map((s) => s.id)).toEqual([4]);
    expect(sameKindCount).toBe(2);
  });

  it("сортирует по имени — человека ищут глазами, а не по времени", () => {
    const late = shift({ id: 2, employeeId: 2, employeeName: "Яшин Пётр" });
    const early = shift({ id: 3, employeeId: 3, employeeName: "Волков Илья" });
    const { candidates } = swapCandidates(mine, [late, early], 1, NOW, new Set());
    expect(candidates.map((s) => s.employeeName)).toEqual(["Волков Илья", "Яшин Пётр"]);
  });

  /**
   * Исключённый коллега с ТАКОЙ ЖЕ сменой не попадает ни в кандидаты, ни в
   * «столько же работают такую же».
   *
   * Смена нарочно совпадает по виду с моей: если переставить проверку исключения
   * ПОСЛЕ `isIdenticalShift`, он утечёт в `sameKindCount`, и экран скажет «ещё 1
   * работает такую же смену» про человека, с которым меняться нельзя. На коллеге
   * с другой сменой этот тест был бы зелёным при любом порядке.
   */
  it("исключённый коллега с такой же сменой не считается и в «таких же»", () => {
    const twin = shift({ id: 9, employeeId: 7, employeeName: "Игорь Петров", start: "15:00", end: "23:00", templateId: 4, title: "Вечер" });
    const { candidates, sameKindCount } = swapCandidates(mine, [twin], 1, NOW, new Set([7]));
    expect(candidates).toEqual([]);
    expect(sameKindCount).toBe(0);
  });

  it("он же без исключения — считается как «такая же смена»", () => {
    const twin = shift({ id: 9, employeeId: 7, employeeName: "Игорь Петров", start: "15:00", end: "23:00", templateId: 4, title: "Вечер" });
    const { candidates, sameKindCount } = swapCandidates(mine, [twin], 1, NOW, new Set());
    expect(candidates).toEqual([]);
    expect(sameKindCount).toBe(1);
  });

  it("исключённого из обменов коллегу в кандидатах нет", () => {
    const other = shift({ id: 9, employeeId: 7, employeeName: "Игорь Петров", start: "09:00", end: "18:00" });
    const { candidates } = swapCandidates(mine, [other], 1, NOW, new Set([7]));
    expect(candidates).toEqual([]);
  });

  it("тот же коллега без исключения в кандидатах есть", () => {
    const other = shift({ id: 9, employeeId: 7, employeeName: "Игорь Петров", start: "09:00", end: "18:00" });
    const { candidates } = swapCandidates(mine, [other], 1, NOW, new Set());
    expect(candidates.map((s) => s.id)).toEqual([9]);
  });
});

describe("nowOnTeamDay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("берёт день с сервера, а не с телефона", () => {
    // Баг из ledger: телефон спешит на неделю — «сейчас» для swapCandidates
    // считалось его часами, и уже начавшаяся сегодня смена команды выглядела
    // как будущая (или наоборот).
    vi.setSystemTime(new Date("2026-09-17T10:00:00"));
    const now = nowOnTeamDay("2026-09-10");
    expect(now.getFullYear()).toBe(2026);
    expect(now.getMonth()).toBe(8); // сентябрь
    expect(now.getDate()).toBe(10);
  });

  it("время суток — с телефона: сервер отдаёт только дату", () => {
    vi.setSystemTime(new Date("2026-09-17T14:30:45.500"));
    const now = nowOnTeamDay("2026-09-10");
    expect(now.getHours()).toBe(14);
    expect(now.getMinutes()).toBe(30);
    expect(now.getSeconds()).toBe(45);
  });

  it("используется по назначению: с ним уже начавшаяся сегодня смена не предлагается кандидатом, даже если телефон думает, что сегодня — вчера", () => {
    // Телефон отстаёт на день: по его часам смена, начавшаяся сегодня в 09:00
    // по команде, ещё не наступила («вчера, 09:00» в будущем для «вчерашнего
    // сейчас» 10:00 — нет, наоборот: разберём явно ниже).
    vi.setSystemTime(new Date("2026-09-09T23:00:00")); // телефон: 9 сентября, 23:00
    const today = "2026-09-10"; // сервер: уже 10 сентября
    const other = shift({ id: 2 });
    const phoneNow = new Date();
    const withPhoneClock = swapCandidates(mine, [other], 1, phoneNow, new Set());
    const withTeamDay = swapCandidates(mine, [other], 1, nowOnTeamDay(today, phoneNow), new Set());
    // Смена сегодня в 09:00 по телефонным часам (9 сентября, 23:00) выглядит
    // будущей — кандидат прошёл бы. По команднОМУ дню (10 сентября, те же
    // 23:00 часов) смена уже 14 часов как началась и кандидатом быть не должна.
    expect(withPhoneClock.candidates.map((s) => s.id)).toEqual([2]);
    expect(withTeamDay.candidates.map((s) => s.id)).toEqual([]);
  });
});
