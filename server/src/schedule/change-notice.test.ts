import type { Bot } from "grammy";
import { describe, expect, it } from "vitest";

import { makeTestDb } from "../db/testdb";
import type { Shift } from "../db/schema";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { entryLineOf } from "../util/message-lines";
import {
  entryAddedText,
  entryChangedText,
  entryRemovedText,
  notifyEntryChange,
  notifyScheduleChange,
  scheduleSummaryText,
  withScheduleDiff,
} from "./change-notice";

describe("тексты одиночной правки", () => {
  it("поставили", () => {
    expect(entryAddedText("Аня", "Пт 7 авг · 15:00–23:00 · Вечер")).toBe(
      "Аня поставил(а) тебе смену: Пт 7 авг · 15:00–23:00 · Вечер.",
    );
  });

  it("сняли", () => {
    expect(entryRemovedText("Аня", "Ср 5 авг · 08:00–17:00 · Утро")).toBe(
      "Аня снял(а) с тебя смену: Ср 5 авг · 08:00–17:00 · Утро.",
    );
  });

  it("изменили — называет и было, и стало", () => {
    expect(
      entryChangedText("Аня", "Ср 5 авг · 08:00–17:00 · Утро", "Пт 7 авг · 15:00–23:00 · Вечер"),
    ).toBe(
      "Аня изменил(а) твою смену: было Ср 5 авг · 08:00–17:00 · Утро → стало Пт 7 авг · 15:00–23:00 · Вечер.",
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

describe("notifyEntryChange", () => {
  const setup = () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Админ", inviteToken: "inv-a" });
    const worker = createEmployee(db, { displayName: "Работник", inviteToken: "inv-w" });
    linkTelegramAccount(db, "inv-w", 555);
    return { db, adminId: admin.id, workerId: worker.id };
  };
  const now = { date: "2026-09-01", time: "10:00" };

  it("о новой записи пишет её владельцу", async () => {
    const { db, adminId, workerId } = setup();
    const { bot, sent } = fakeBot();
    const reach = await notifyEntryChange(db, bot, {
      actorEmployeeId: adminId,
      before: null,
      after: shift({ employeeId: workerId }),
      now,
    });
    expect(reach).toEqual({ delivered: 1, intended: 1 });
    expect(sent[0]!.to).toBe(555);
    expect(sent[0]!.text).toContain("поставил(а) тебе смену");
  });

  it("молчит про день, который уже прошёл", async () => {
    const { db, adminId, workerId } = setup();
    const { bot, sent } = fakeBot();
    const reach = await notifyEntryChange(db, bot, {
      actorEmployeeId: adminId,
      before: null,
      after: shift({ employeeId: workerId, date: "2026-08-20" }),
      now,
    });
    expect(reach).toEqual({ delivered: 0, intended: 0 });
    expect(sent).toEqual([]);
  });

  it("правка внутри прошлого молчит, а перенос из прошлого в будущее — нет", async () => {
    const { db, adminId, workerId } = setup();
    const past = shift({ employeeId: workerId, date: "2026-08-20" });

    const inPast = fakeBot();
    const quiet = await notifyEntryChange(db, inPast.bot, {
      actorEmployeeId: adminId,
      before: past,
      after: shift({ employeeId: workerId, date: "2026-08-21" }),
      now,
    });
    expect(quiet).toEqual({ delivered: 0, intended: 0 });
    expect(inPast.sent).toEqual([]);

    const intoFuture = fakeBot();
    const loud = await notifyEntryChange(db, intoFuture.bot, {
      actorEmployeeId: adminId,
      before: past,
      after: shift({ employeeId: workerId, date: "2026-09-10" }),
      now,
    });
    expect(loud).toEqual({ delivered: 1, intended: 1 });
    expect(intoFuture.sent[0]!.text).toContain("изменил(а) твою смену");
  });

  it("не пишет админу про его собственную запись", async () => {
    const { db, adminId } = setup();
    linkTelegramAccount(db, "inv-a", 111);
    const { bot, sent } = fakeBot();
    const reach = await notifyEntryChange(db, bot, {
      actorEmployeeId: adminId,
      before: null,
      after: shift({ employeeId: adminId }),
      now,
    });
    expect(reach).toEqual({ delivered: 0, intended: 0 });
    expect(sent).toEqual([]);
  });

  it("непривязанный считается в intended, но не в delivered", async () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Админ", inviteToken: "inv-a" });
    const worker = createEmployee(db, { displayName: "Работник", inviteToken: "inv-w" });
    const { bot, sent } = fakeBot();
    const reach = await notifyEntryChange(db, bot, {
      actorEmployeeId: admin.id,
      before: null,
      after: shift({ employeeId: worker.id }),
      now,
    });
    expect(reach).toEqual({ delivered: 0, intended: 1 });
    expect(sent).toEqual([]);
  });

  it("смена владельца — снято прежнему, поставлено новому", async () => {
    const { db, adminId, workerId } = setup();
    const other = createEmployee(db, { displayName: "Второй", inviteToken: "inv-2" });
    linkTelegramAccount(db, "inv-2", 777);
    const { bot, sent } = fakeBot();
    await notifyEntryChange(db, bot, {
      actorEmployeeId: adminId,
      before: shift({ employeeId: workerId }),
      after: shift({ employeeId: other.id }),
      now,
    });
    expect(sent.find((m) => m.to === 555)!.text).toContain("снял(а) с тебя смену");
    expect(sent.find((m) => m.to === 777)!.text).toContain("поставил(а) тебе смену");
  });

  it("бота нет — молча ноль, а не падение", async () => {
    const { db, adminId, workerId } = setup();
    const reach = await notifyEntryChange(db, undefined, {
      actorEmployeeId: adminId,
      before: null,
      after: shift({ employeeId: workerId }),
      now,
    });
    expect(reach).toEqual({ delivered: 0, intended: 0 });
  });
});

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
    expect(scheduleSummaryText("Аня", "fill_week", one)).toBe(entryAddedText("Аня", entryLineOf(a1)));
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
