import { describe, it, expect } from "vitest";
import {
  audienceLines,
  audiencePreview,
  audienceReady,
  teamAudienceSchema,
  workingOn,
  type AudienceCandidate,
} from "./team-audience";

const day = "2026-09-29";

describe("workingOn — кто сегодня на смене", () => {
  it("берёт смены, дежурства, выходную работу и выезд, но не отпуск", () => {
    const entries = [
      { employeeId: 1, category: "shift" as const, date: day, endDate: null },
      { employeeId: 2, category: "duty" as const, date: day, endDate: null },
      { employeeId: 3, category: "weekend_work" as const, date: day, endDate: null },
      { employeeId: 4, category: "offsite" as const, date: day, endDate: null },
      { employeeId: 5, category: "vacation" as const, date: "2026-09-28", endDate: "2026-10-02" },
    ];
    expect(workingOn(entries, day)).toEqual([1, 2, 3, 4]);
  });

  it("смена человека, который в тот же день на больничном, не считается", () => {
    const entries = [
      { employeeId: 1, category: "shift" as const, date: day, endDate: null },
      { employeeId: 1, category: "sick_leave" as const, date: day, endDate: null },
    ];
    expect(workingOn(entries, day)).toEqual([]);
  });

  it("смена другого дня и свободный слот без человека не попадают; дубли схлопываются", () => {
    const entries = [
      { employeeId: 1, category: "shift" as const, date: "2026-09-30", endDate: null },
      { employeeId: null, category: "shift" as const, date: day, endDate: null },
      { employeeId: 2, category: "shift" as const, date: day, endDate: null },
      { employeeId: 2, category: "duty" as const, date: day, endDate: null },
    ];
    expect(workingOn(entries, day)).toEqual([2]);
  });
});

describe("teamAudienceSchema", () => {
  it("принимает три вида и отвергает пустой ручной список", () => {
    expect(teamAudienceSchema.safeParse({ kind: "team" }).success).toBe(true);
    expect(teamAudienceSchema.safeParse({ kind: "on_shift" }).success).toBe(true);
    expect(teamAudienceSchema.safeParse({ kind: "picked", employeeIds: [1, 2] }).success).toBe(true);
    expect(teamAudienceSchema.safeParse({ kind: "picked", employeeIds: [] }).success).toBe(false);
    expect(teamAudienceSchema.safeParse({ kind: "everyone" }).success).toBe(false);
  });

  it("не пропускает список длиннее 200", () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    expect(teamAudienceSchema.safeParse({ kind: "picked", employeeIds: ids }).success).toBe(false);
  });
});

const TEAM: AudienceCandidate[] = [
  { id: 2, displayName: "Игорь", reachable: true, role: "worker", onShift: true },
  { id: 3, displayName: "Марк", reachable: true, role: "worker", onShift: false },
  { id: 4, displayName: "Дима", reachable: false, role: "worker", onShift: true },
  { id: 5, displayName: "Лена", reachable: true, role: "observer", onShift: false },
  { id: 6, displayName: "Вера", reachable: false, role: "observer", onShift: false },
];

describe("audienceReady", () => {
  it("«Выбрать» без единой галочки — отправлять некому; остальные режимы — можно", () => {
    expect(audienceReady({ kind: "picked", employeeIds: [] })).toBe(false);
    expect(audienceReady({ kind: "picked", employeeIds: [2] })).toBe(true);
    expect(audienceReady({ kind: "team" })).toBe(true);
    expect(audienceReady({ kind: "on_shift" })).toBe(true);
  });
});

describe("audiencePreview — кому уйдёт, кому нет и кому копия", () => {
  it("«на смене» — только те, кто на смене; недостижимый — отдельно", () => {
    const p = audiencePreview(TEAM, { kind: "on_shift" });
    expect(p.reachable).toEqual(["Игорь"]);
    expect(p.unreachable).toEqual(["Дима"]);
  });

  it("наблюдатель вне выбранных и с Telegram — в копиях; без Telegram — нет (его не звали)", () => {
    expect(audiencePreview(TEAM, { kind: "picked", employeeIds: [2] }).observerCopies).toEqual(["Лена"]);
  });

  it("наблюдатель уже среди выбранных — копий нет: он и так получит", () => {
    const p = audiencePreview(TEAM, { kind: "team" });
    expect(p.observerCopies).toEqual([]);
    expect(p.reachable).toEqual(["Игорь", "Марк", "Лена"]);
    expect(p.unreachable).toEqual(["Дима", "Вера"]);
  });
});

describe("audienceLines — те же слова, что в мини-аппе", () => {
  it("кто-то есть, копия наблюдателю, недостижимый", () => {
    const lines = audienceLines(audiencePreview(TEAM, { kind: "picked", employeeIds: [2, 4] }));
    expect(lines).toEqual({
      goes: "Уйдёт: Игорь и тебе",
      observers: "Наблюдателям — копия всегда: Лена",
      unreachable: "Не дойдёт: Дима — не привязан(а) к боту",
    });
  });

  it("никого — «Пока никого, кроме тебя.», лишних строк нет", () => {
    expect(audienceLines({ reachable: [], unreachable: [], observerCopies: [] })).toEqual({
      goes: "Пока никого, кроме тебя.",
      observers: null,
      unreachable: null,
    });
  });
});
