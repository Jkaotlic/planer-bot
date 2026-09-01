import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { ensureBirthdayRound, markAutoSent, roundsToAutoSend } from "../birthdays/birthday-service";
import { runBirthdayNoticeTick } from "../birthdays/birthday-notice";
import { getCollection, markCollectionSent, setCollectionClosed, updateCollection } from "./collection-service";
import { attachLink, extractUrl, linkAcceptedMessage, linkReadyMessage, notifyLinkReady } from "./link-capture";
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

  it("не отдаёт голую схему, которая осталась после отрезания скобки", () => {
    // «(https://)» после среза хвоста — это `https://`, и оно уехало бы в
    // письмо двадцати людям: консольный путь такое отвергает регуляркой.
    expect(extractUrl("(https://)")).toBeNull();
    expect(extractUrl("http://.")).toBeNull();
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

  it("разосланному раунду ссылку меняет, но автоотправку не вооружает", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const igor = person(db, "Игорь", 2, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { autoSendOn: null });
    // Админ разослал руками — повторной рассылки у дня рождения не бывает.
    markCollectionSent(db, round.id, 3, new Date("2026-09-01T07:00:00Z"));

    const updated = attachLink(db, {
      round: getCollection(db, round.id)!, url: "https://example.com/svezhaya",
      asOf: "2026-09-01", actorEmployeeId: igor,
    });

    // Ссылку менять можно и нужно: мини-приложение показывает именно её, а на
    // руках у команды может остаться протухшая.
    expect(updated.collectUrl).toBe("https://example.com/svezhaya");
    expect(updated.autoSendOn).toBeNull();
  });

  it("та же самая ссылка автоотправку не возвращает", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const igor = person(db, "Игорь", 2, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    attachLink(db, { round, url: "https://example.com/sbor", asOf: "2026-09-01", actorEmployeeId: igor });
    // Админ выключил автоотправку руками — присланная повторно ТА ЖЕ ссылка не
    // повод её вернуть. Обе ручки давно так и делают, бот обязан так же.
    updateCollection(db, round.id, { autoSendOn: null });

    const again = attachLink(db, {
      round: getCollection(db, round.id)!, url: "https://example.com/sbor",
      asOf: "2026-09-01", actorEmployeeId: igor,
    });

    expect(again.autoSendOn).toBeNull();
  });

  it("закрытый сбор не вооружает: тик его не увидит никогда", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const igor = person(db, "Игорь", 2, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { autoSendOn: null });
    setCollectionClosed(db, round.id, true, new Date("2026-09-01T07:00:00Z"));

    const updated = attachLink(db, {
      round: getCollection(db, round.id)!, url: "https://example.com/svezhaya",
      asOf: "2026-09-01", actorEmployeeId: igor,
    });

    expect(updated.collectUrl).toBe("https://example.com/svezhaya");
    // `roundsToAutoSend` фильтрует через `isCollectionActive` — вооружённый
    // закрытый раунд не уйдёт никогда, а день на карточке обещал бы обратное.
    expect(updated.autoSendOn).toBeNull();
  });

  it("прошедший день рождения не вооружает", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const igor = person(db, "Игорь", 2, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { autoSendOn: null });

    // Ссылку принесли после праздника — сбор на вчерашний день рождения это
    // уже не сбор, и `isCollectionActive` отсекает его так же, как закрытый.
    const updated = attachLink(db, {
      round: getCollection(db, round.id)!, url: "https://example.com/sbor",
      asOf: "2026-09-10", actorEmployeeId: igor,
    });

    expect(updated.autoSendOn).toBeNull();
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

  it("про разосланный раунд не обещает ни автоотправки, ни рассылки руками", () => {
    const text = linkReadyMessage("Игорь", "Марк", "2026-09-04", "2026-09-01", true);

    expect(text).toContain("Игорь");
    expect(text).toContain("Марк");
    // Обе прежние ветки здесь врали бы: сам он не уйдёт (тик пропускает раунд
    // по `sendCount > 0`), а руками повторная рассылка ДР заблокирована.
    expect(text).not.toContain("разошлёт");
    expect(text).not.toContain("делать ничего не надо");
    expect(text).not.toContain("руками");
    expect(text).toContain("уже ушёл");
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

describe("notifyLinkReady про разосланный раунд", () => {
  it("шлёт админам текст без обещания рассылки", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    const igor = person(db, "Игорь", 2, null, true);
    person(db, "Аня", 3, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    markCollectionSent(db, round.id, 3, new Date("2026-09-01T07:00:00Z"));
    const updated = attachLink(db, {
      round: getCollection(db, round.id)!, url: "https://example.com/svezhaya",
      asOf: "2026-09-01", actorEmployeeId: igor,
    });

    await notifyLinkReady(db, bot, updated, igor, "2026-09-01");

    expect(sent.map((m) => m.to)).toEqual([3]);
    expect(sent[0]!.text).not.toContain("разошлёт");
    expect(sent[0]!.text).not.toContain("делать ничего не надо");
  });
});

describe("notifyLinkReady про сбор, который уже никуда не пойдёт", () => {
  it("про закрытый сбор молчит: обещать нечего, а сообщать не о чем", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    const igor = person(db, "Игорь", 2, null, true);
    person(db, "Аня", 3, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    setCollectionClosed(db, round.id, true, new Date("2026-09-01T07:00:00Z"));
    const updated = attachLink(db, {
      round: getCollection(db, round.id)!, url: "https://example.com/svezhaya",
      asOf: "2026-09-01", actorEmployeeId: igor,
    });

    expect(await notifyLinkReady(db, bot, updated, igor, "2026-09-01")).toBe(0);
    expect(sent).toHaveLength(0);
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

/**
 * Провал доставки, а не отсутствие ссылки: `autoSentAt` уже проставлен, а
 * `sendCount` остался нулём. Письмо админам кончается словами «Пришли ссылку
 * сюда — разошлю сразу», и админ шлёт ТУ ЖЕ ссылку — другой у него нет.
 * `updateCollection` при этом менять нечего: ни ссылка, ни день не изменились,
 * и отметка о попытке осталась бы стоять навсегда.
 */
describe("сквозной случай: ссылка та же, а обещание «разошлю сразу» дано", () => {
  it("повторно присланная ссылка снимает отметку о провалившейся попытке", async () => {
    const db = makeTestDb();
    const sentOk: { to: number; text: string }[] = [];
    let telegramDown = true;
    const bot = {
      api: {
        sendMessage: vi.fn(async (to: number, text: string) => {
          // Лежит только доставка команде: письмо админам про провал должно
          // дойти — это оно и даёт обещание, которое проверяет тест.
          if (telegramDown && text.includes("Сбор на подарок")) throw new Error("Bad Gateway");
          sentOk.push({ to, text });
        }),
      },
    } as unknown as Bot;
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    const igor = person(db, "Игорь", 3, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { collectUrl: "https://example.com/sbor" });

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    // Попытка была и провалилась: раунд помечен, но команде ничего не ушло.
    expect(getCollection(db, round.id)!.autoSentAt).not.toBeNull();
    expect(getCollection(db, round.id)!.sendCount).toBe(0);
    const promise = sentOk.find((m) => m.to === 3 && m.text.startsWith("⚠️"))!;
    expect(promise.text).toContain("разошлю сразу");

    telegramDown = false;
    attachLink(db, {
      round: getCollection(db, round.id)!,
      url: "https://example.com/sbor",
      asOf: "2026-09-04",
      actorEmployeeId: igor,
    });

    // Обещание исполнимо только так: раунд снова в очереди на автоотправку.
    expect(roundsToAutoSend(db, "2026-09-04").map((r) => r.id)).toEqual([round.id]);

    sentOk.length = 0;
    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:05" });

    expect(sentOk.filter((m) => m.text.includes("Сбор на подарок")).map((m) => m.to).sort()).toEqual([2, 3]);
    expect(getCollection(db, round.id)!.sendCount).toBe(1);
  });

  it("выключенную руками автоотправку та же ссылка не воскрешает", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const igor = person(db, "Игорь", 2, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    attachLink(db, { round, url: "https://example.com/sbor", asOf: "2026-09-01", actorEmployeeId: igor });
    // «🚫 Не рассылать сам» — и отметка о попытке, оставшаяся от прошлого тика.
    updateCollection(db, round.id, { autoSendOn: null });
    markAutoSent(db, round.id, new Date("2026-09-04T07:00:00Z"));

    const again = attachLink(db, {
      round: getCollection(db, round.id)!, url: "https://example.com/sbor",
      asOf: "2026-09-04", actorEmployeeId: igor,
    });

    // Снятая отметка без вооружённого дня ничего не меняет, но и снимать её
    // здесь не за что: человек сказал «не рассылай», а не «попробуй ещё раз».
    expect(again.autoSendOn).toBeNull();
    expect(again.autoSentAt).not.toBeNull();
    expect(roundsToAutoSend(db, "2026-09-04")).toHaveLength(0);
  });
});

describe("linkAcceptedMessage", () => {
  // Единственное сообщение фичи, которое даёт обещание: по нему админ решает,
  // вмешиваться или нет. Проверяется отдельно от бота, потому что «Марк» и
  // «Сбор на подарок» в ответе бота приходят из письма команде, а не отсюда.
  const letter = "🎂 Марк празднует день рождения 7 сентября.\n\nСбор на подарок: https://example.com/sbor";

  it("называет день и час, когда рассылка ещё впереди", () => {
    const text = linkAcceptedMessage("Марка", "2026-09-04", "2026-09-01", 7, letter);

    expect(text).toContain("Принял ссылку для сбора на Марка.");
    expect(text).toContain("Разошлю команде 4 сентября в 10:00 — 7 чел., кроме именинника.");
    // Письмо показано целиком и ДО отправки — это и есть предохранитель.
    expect(text).toContain(letter);
  });

  it("про сегодняшний день говорит «сегодня», а не датой", () => {
    const text = linkAcceptedMessage("Марка", "2026-09-01", "2026-09-01", 7, letter);

    expect(text).toContain("Разошлю команде сегодня — 7 чел., кроме именинника.");
    expect(text).not.toContain("1 сентября");
  });

  it("день в прошлом — это тоже «сегодня»: тик подберёт его ближайшим проходом", () => {
    const text = linkAcceptedMessage("Марка", "2026-08-30", "2026-09-01", 7, letter);

    expect(text).toContain("Разошлю команде сегодня");
    expect(text).not.toContain("30 августа");
  });

  it("без вооружённой автоотправки не обещает рассылки", () => {
    const text = linkAcceptedMessage("Марка", null, "2026-09-01", 7, letter);

    expect(text).toContain("Сам рассылать не буду — 7 чел., кроме именинника.");
    expect(text).not.toContain("Разошлю");
  });

  it("получателей столько, сколько передали, а не сколько людей в команде", () => {
    expect(linkAcceptedMessage("Марка", null, "2026-09-01", 12, letter)).toContain("12 чел., кроме именинника");
    expect(linkAcceptedMessage("Марка", null, "2026-09-01", 0, letter)).toContain("0 чел., кроме именинника");
  });
});
