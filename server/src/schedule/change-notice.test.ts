import type { Bot } from "grammy";
import { describe, expect, it } from "vitest";

import { makeTestDb } from "../db/testdb";
import type { Shift } from "../db/schema";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import {
  entryAddedText,
  entryChangedText,
  entryRemovedText,
  notifyEntryChange,
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
