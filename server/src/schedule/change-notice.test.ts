import type { Bot } from "grammy";
import { describe, expect, it } from "vitest";

import { makeTestDb } from "../db/testdb";
import type { Shift } from "../db/schema";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import {
  entryAddedText,
  entryChangedText,
  entryRemovedText,
  notifyScheduleChange,
  scheduleSummaryText,
  withScheduleDiff,
} from "./change-notice";

const eveningShift = {
  date: "2026-08-07", endDate: null, start: "15:00", end: "23:00",
  category: "shift" as const, title: "Вечер",
};
const morningShift = {
  date: "2026-08-05", endDate: null, start: "08:00", end: "17:00",
  category: "shift" as const, title: "Утро",
};
const dayShift = {
  date: "2026-08-12", endDate: null, start: "09:00", end: "18:00",
  category: "shift" as const, title: "День",
};
const vacation = {
  date: "2026-08-10", endDate: "2026-08-14", start: null, end: null,
  category: "vacation" as const, title: null,
};
const duty = {
  date: "2026-08-12", endDate: null, start: "09:00", end: "18:00",
  category: "duty" as const, title: "Дежурство · Поклонка",
};

describe("тексты одиночной правки", () => {
  it("поставили", () => {
    expect(entryAddedText("Аня", eveningShift)).toBe(
      "Аня поставил(а) тебе смену: Пт 7 авг · 15:00–23:00 · Вечер.",
    );
  });

  it("сняли", () => {
    expect(entryRemovedText("Аня", morningShift)).toBe(
      "Аня снял(а) с тебя смену: Ср 5 авг · 08:00–17:00 · Утро.",
    );
  });

  it("изменили — называет и было, и стало", () => {
    expect(entryChangedText("Аня", morningShift, eveningShift)).toBe(
      "Аня изменил(а) твою смену: было Ср 5 авг · 08:00–17:00 · Утро → стало Пт 7 авг · 15:00–23:00 · Вечер.",
    );
  });
});

describe("письмо называет вид записи", () => {
  it("отпуск — отпуском, а не «сменой»", () => {
    expect(entryRemovedText("Аня", vacation)).toBe(
      "Аня снял(а) с тебя отпуск: Пн 10 авг – Пт 14 авг · весь день · Отпуск.",
    );
  });

  it("дежурство — дежурством", () => {
    expect(entryAddedText("Аня", duty)).toBe(
      "Аня поставил(а) тебе дежурство: Ср 12 авг · 09:00–18:00 · Дежурство · Поклонка.",
    );
  });

  it("правка внутри одной категории говорит «изменил твою смену»", () => {
    const moved = { ...dayShift, start: "11:00", end: "20:00", title: "Вечер" };
    expect(entryChangedText("Аня", dayShift, moved)).toBe(
      "Аня изменил(а) твою смену: было Ср 12 авг · 09:00–18:00 · День → стало Ср 12 авг · 11:00–20:00 · Вечер.",
    );
  });

  it("смена категории говорится прямо: заменил отпуск на смену", () => {
    // Ровно тот случай, с которого началась работа: человек прочитал
    // «изменил твою смену» про свой отпуск и не понял, отменён ли отпуск.
    const replaced = { ...dayShift, date: "2026-08-10" };
    expect(entryChangedText("Аня", vacation, replaced)).toBe(
      "Аня заменил(а) твой отпуск на смену: было Пн 10 авг – Пт 14 авг · весь день · Отпуск → стало Пн 10 авг · 09:00–18:00 · День.",
    );
  });
});

function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const bot = {
    api: {
      sendMessage: async (to: number, text: string) => {
        sent.push({ to, text });
      },
    },
  } as unknown as Bot;
  return { sent, bot };
}

const shift = (over: Partial<Shift> = {}): Shift =>
  ({
    id: 1,
    employeeId: 2,
    date: "2026-09-10",
    endDate: null,
    start: "08:00",
    end: "17:00",
    category: "shift",
    title: "Утро",
    templateId: 1,
    note: null,
    location: null,
    unrecognisedCode: null,
    ...over,
  }) as Shift;

describe("сводное письмо", () => {
  const a1 = shift({ id: 101, date: "2026-09-10", start: "08:00", end: "17:00", title: "Утро" });
  const a2 = shift({ id: 102, date: "2026-09-11", start: "09:00", end: "18:00", title: "День" });
  const a3 = shift({ id: 103, date: "2026-09-12", start: "11:00", end: "20:00", title: "Вечер" });
  const r1 = shift({ id: 104, date: "2026-09-13", start: "08:00", end: "17:00", title: "Утро" });
  const c1before = shift({ id: 105, date: "2026-09-14", start: "08:00", end: "17:00", title: "Утро" });
  const c1after = shift({ id: 105, date: "2026-09-15", start: "08:00", end: "17:00", title: "Утро" });
  const c2before = shift({ id: 106, date: "2026-09-16", start: "08:00", end: "17:00", title: "Утро" });
  const c2after = shift({ id: 106, date: "2026-09-16", start: "15:00", end: "23:00", title: "Вечер" });
  const diff = {
    added: [a1, a2, a3],
    removed: [r1],
    changed: [
      { before: c1before, after: c1after },
      { before: c2before, after: c2after },
    ],
  };

  it("считает и перечисляет", () => {
    const text = scheduleSummaryText("Аня", "file", diff);
    expect(text).toContain("Аня обновил(а) твой график (загрузка файла)");
    expect(text).toContain("+3 смены");
    expect(text).toContain("−1");
    expect(text).toContain("изменено 2");
  });

  it("обрезает список на десяти строках", () => {
    const entryAt = (i: number) =>
      shift({ id: 200 + i, date: `2026-09-${String(10 + i).padStart(2, "0")}`, employeeId: 2 });
    const many = { added: Array.from({ length: 14 }, (_, i) => entryAt(i)), removed: [], changed: [] };
    const text = scheduleSummaryText("Аня", "distribute", many);
    expect(text.split("\n• ").length - 1).toBe(10);
    expect(text).toContain("…и ещё 4");
  });

  it("одна запись — не сводка, а обычный одиночный текст", () => {
    const one = { added: [a1], removed: [], changed: [] };
    expect(scheduleSummaryText("Аня", "fill_week", one)).toBe(entryAddedText("Аня", a1));
  });
});

describe("withScheduleDiff", () => {
  it("видит то, что операция реально сделала с базой", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Работник" });
    const { result, diffs } = withScheduleDiff(db, { from: "2026-09-01", to: "2026-09-30" }, () =>
      createShift(db, { date: "2026-09-15", start: "09:00", end: "18:00", category: "shift", employeeId: worker.id }),
    );
    const diff = diffs.get(worker.id);
    expect(diff?.added.map((s) => s.id)).toEqual([result.id]);
    expect(diff?.removed).toEqual([]);
  });
});

describe("notifyScheduleChange", () => {
  const now = { date: "2026-09-01", time: "10:00" };

  it("шлёт ровно одно письмо человеку, сколько бы записей ни поменялось", async () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Админ", inviteToken: "inv-a" });
    const worker = createEmployee(db, { displayName: "Работник", inviteToken: "inv-w" });
    linkTelegramAccount(db, "inv-w", 555);
    const { bot, sent } = fakeBot();
    const twelve = Array.from({ length: 12 }, (_, i) =>
      shift({ id: 400 + i, employeeId: worker.id, date: `2026-09-${String(10 + i).padStart(2, "0")}` }),
    );
    const diffs = new Map([[worker.id, { added: twelve, removed: [], changed: [] }]]);
    const reach = await notifyScheduleChange(db, bot, { actorEmployeeId: admin.id, diffs, cause: "file", now });
    expect(reach).toEqual({ delivered: 1, intended: 1 });
    expect(sent).toHaveLength(1);
  });

  it("не пишет актору про его собственную сводку", async () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Админ", inviteToken: "inv-a" });
    linkTelegramAccount(db, "inv-a", 111);
    const { bot, sent } = fakeBot();
    const diffs = new Map([[admin.id, { added: [shift({ id: 500, employeeId: admin.id })], removed: [], changed: [] }]]);
    const reach = await notifyScheduleChange(db, bot, { actorEmployeeId: admin.id, diffs, cause: "distribute", now });
    expect(reach).toEqual({ delivered: 0, intended: 0 });
    expect(sent).toEqual([]);
  });
});
