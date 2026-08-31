import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { ensureBirthdayRound, roundsToAutoSend } from "../birthdays/birthday-service";
import { runBirthdayNoticeTick } from "../birthdays/birthday-notice";
import { getCollection, updateCollection } from "./collection-service";
import { attachLink, extractUrl, linkReadyMessage, notifyLinkReady } from "./link-capture";
import type { Db } from "../db/client";

function person(db: Db, name: string, tg: number | null, birthDate: string | null, isAdmin = false): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  if (birthDate) setBirthDate(db, employee.id, birthDate);
  if (isAdmin) setEmployeeAdmin(db, employee.id, true);
  return employee.id;
}

function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string) => {
        sent.push({ to, text });
      }),
    },
  };
  return { bot: bot as unknown as Bot, sent };
}

describe("extractUrl", () => {
  it("достаёт ссылку из сообщения со словами вокруг", () => {
    expect(extractUrl("вот держи https://example.com/sbor/abc спасибо")).toBe("https://example.com/sbor/abc");
  });

  it("берёт голую ссылку", () => {
    expect(extractUrl("https://example.com/s")).toBe("https://example.com/s");
  });

  it("не считает ссылкой обычный текст и не считает схему без http", () => {
    expect(extractUrl("сделал сбор, скину позже")).toBeNull();
    expect(extractUrl("javascript:alert(1)")).toBeNull();
    expect(extractUrl("example.com/sbor")).toBeNull();
  });

  it("отрезает хвостовую пунктуацию, которой ссылка кончиться не может", () => {
    expect(extractUrl("держи https://example.com/s.")).toBe("https://example.com/s");
    expect(extractUrl("(https://example.com/s)")).toBe("https://example.com/s");
  });
});

describe("attachLink", () => {
  it("ставит ссылку, вооружает автоотправку и снимает отметку о попытке", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const igor = person(db, "Игорь", 2, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;

    const updated = attachLink(db, {
      round, url: "https://example.com/sbor", asOf: "2026-09-01", actorEmployeeId: igor,
    });

    expect(updated.collectUrl).toBe("https://example.com/sbor");
    expect(updated.autoSendOn).toBe("2026-09-04");
    expect(updated.autoSentAt).toBeNull();
  });

  it("выключенную автоотправку вооружает заново", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const igor = person(db, "Игорь", 2, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    // Раунд заводится вооружённым, поэтому «привязка вооружает» видно только на
    // выключенном: иначе тест прошёл бы и без единой строки вооружения.
    const off = updateCollection(db, round.id, { autoSendOn: null });
    expect(off.ok && off.collection.autoSendOn).toBeNull();

    const updated = attachLink(db, {
      round: getCollection(db, round.id)!, url: "https://example.com/sbor",
      asOf: "2026-09-01", actorEmployeeId: igor,
    });

    expect(updated.autoSendOn).toBe("2026-09-04");
  });

  it("ссылка, принесённая позже дня −3, рассылается сегодня", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const igor = person(db, "Игорь", 2, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-06")!;

    const updated = attachLink(db, {
      round, url: "https://example.com/sbor", asOf: "2026-09-06", actorEmployeeId: igor,
    });

    expect(updated.autoSendOn).toBe("2026-09-06");
  });
});

describe("linkReadyMessage", () => {
  it("говорит остальным админам, что делать ничего не надо", () => {
    const text = linkReadyMessage("Игорь", "Марк", "2026-09-04", "2026-09-01");
    expect(text).toContain("Игорь");
    expect(text).toContain("Марк");
    expect(text).toContain("4 сентября");
    expect(text).toContain("делать ничего не надо");
  });
});

describe("notifyLinkReady", () => {
  it("будит остальных админов, но не вставившего и не именинника", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    // Именинник — сам админ: письмо про сбор в его честь выдало бы сюрприз.
    const mark = person(db, "Марк", 1, "09-07", true);
    const igor = person(db, "Игорь", 2, null, true);
    person(db, "Аня", 3, null, true);
    person(db, "Коллега", 4, null);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    const armed = attachLink(db, {
      round, url: "https://example.com/sbor", asOf: "2026-09-01", actorEmployeeId: igor,
    });

    const delivered = await notifyLinkReady(db, bot, armed, igor, "2026-09-01");

    expect(delivered).toBe(1);
    expect(sent.map((m) => m.to)).toEqual([3]);
    expect(sent[0]!.text).toContain("Игорь");
    expect(sent[0]!.text).toContain("Марк");
  });
});

describe("сквозной случай: не ушёл без ссылки — ушёл после вставки", () => {
  it("вставленная ссылка возвращает раунд в автоотправку и он уходит команде", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    const igor = person(db, "Игорь", 3, null, true);
    // Раунд заведён без ссылки — вооружён на 4 сентября, но рассылать нечего.
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    // Тик пометил попытку и громко отказал админу — ровно то письмо, чьё
    // обещание «пришли ссылку сюда — разошлю сразу» этот тест и проверяет.
    expect(sent.some((m) => m.to === 3 && m.text.startsWith("⚠️"))).toBe(true);
    expect(sent.some((m) => m.text.includes("Сбор на подарок"))).toBe(false);
    expect(getCollection(db, round.id)!.autoSentAt).not.toBeNull();
    expect(roundsToAutoSend(db, "2026-09-04")).toHaveLength(0);

    attachLink(db, {
      round: getCollection(db, round.id)!,
      url: "https://example.com/sbor",
      asOf: "2026-09-04",
      actorEmployeeId: igor,
    });

    expect(roundsToAutoSend(db, "2026-09-04").map((r) => r.id)).toEqual([round.id]);

    sent.length = 0;
    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    // Письмо ушло всей команде, кроме именинника: Аня и Игорь — да, Марк — нет.
    expect(sent.filter((m) => m.text.includes("Сбор на подарок")).map((m) => m.to).sort()).toEqual([2, 3]);
    expect(getCollection(db, round.id)!.sendCount).toBe(1);
  });
});
