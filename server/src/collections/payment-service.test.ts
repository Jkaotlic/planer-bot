import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import type { Db } from "../db/client";
import { collectionPayments } from "../db/schema";
import {
  createCustomCollection,
  deleteCollection,
  setCollectionClosed,
} from "./collection-service";
import { listPayments, setPaid, unpaidRecipients } from "./payment-service";

function person(db: Db, name: string, tg: number | null): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  return employee.id;
}

function coffeeRound(db: Db) {
  return createCustomCollection(db, {
    title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
    amountPerPerson: 500, totalGoal: null, collectUrl: "https://example.test/c/1",
    messageText: null, scheduledSendOn: null,
  });
}

describe("таблица collection_payments", () => {
  it("одна отметка на пару «сбор + человек»: повтор не создаёт вторую строку", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const round = coffeeRound(db);

    db.insert(collectionPayments)
      .values({ collectionId: round.id, employeeId: anya, markedBy: anya })
      .run();

    expect(() =>
      db.insert(collectionPayments)
        .values({ collectionId: round.id, employeeId: anya, markedBy: anya })
        .run(),
    ).toThrow(/UNIQUE/i);
  });
});

describe("отметки о сдаче", () => {
  it("своя галочка ставится и снимается", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const round = coffeeRound(db);

    expect(setPaid(db, round, anya, anya, true)).toEqual({ ok: true });
    expect(listPayments(db, round).paidCount).toBe(1);

    expect(setPaid(db, round, anya, anya, false)).toEqual({ ok: true });
    expect(listPayments(db, round).paidCount).toBe(0);
  });

  it("повторная отметка не падает и не удваивает счёт", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const round = coffeeRound(db);

    setPaid(db, round, anya, anya, true);
    expect(setPaid(db, round, anya, anya, true)).toEqual({ ok: true });
    expect(listPayments(db, round).paidCount).toBe(1);
  });

  it("снятие несуществующей отметки не падает", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const round = coffeeRound(db);
    expect(setPaid(db, round, anya, anya, false)).toEqual({ ok: true });
  });

  it("виновника торжества нельзя отметить: он в сборе не участвует", () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь", 101);
    const round = createCustomCollection(db, {
      title: "Свадьба", employeeId: igor, eventDate: null, deadline: null,
      amountPerPerson: 1000, totalGoal: null, collectUrl: "https://example.test/c/2",
      messageText: null, scheduledSendOn: null,
    });

    const result = setPaid(db, round, igor, igor, true);
    expect(result.ok).toBe(false);
    expect(listPayments(db, round).total).toBe(0);
  });

  it("закрытый сбор отметок не принимает", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const round = coffeeRound(db);
    const closed = setCollectionClosed(db, round.id, true, new Date())!;

    const result = setPaid(db, closed, anya, anya, true);
    expect(result).toEqual({ ok: false, error: "Сбор закрыт — отметки больше не меняются." });
    expect(listPayments(db, closed).paidCount).toBe(0);
  });

  // Дедлайн прошёл, но админ сбор не закрыл: деньги доходят на день позже, и
  // заставлять переоткрывать сбор ради одной галочки — наказание за честность.
  it("просроченный, но не закрытый сбор отметку принимает", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const round = createCustomCollection(db, {
      title: "Кофемашина", employeeId: null, eventDate: null, deadline: "2020-01-01",
      amountPerPerson: 500, totalGoal: null, collectUrl: "https://example.test/c/1",
      messageText: null, scheduledSendOn: null,
    });
    expect(setPaid(db, round, anya, anya, true)).toEqual({ ok: true });
  });

  it("«ждём» — поимённо те, кто не отметился", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    person(db, "Игорь", 101);
    person(db, "Марк", 102);
    const round = coffeeRound(db);
    setPaid(db, round, anya, anya, true);

    expect(unpaidRecipients(db, round).map((e) => e.displayName)).toEqual(["Игорь", "Марк"]);
  });

  it("человек без Telegram не входит ни в счёт, ни в «ждём»", () => {
    const db = makeTestDb();
    person(db, "Аня", 100);
    person(db, "Лена", null);
    const round = coffeeRound(db);

    expect(listPayments(db, round).total).toBe(1);
    expect(unpaidRecipients(db, round).map((e) => e.displayName)).toEqual(["Аня"]);
  });

  it("удаление сбора уносит его отметки", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const round = coffeeRound(db);
    setPaid(db, round, anya, anya, true);

    expect(deleteCollection(db, round.id)).toEqual({ ok: true });
    expect(db.select().from(collectionPayments).all()).toEqual([]);
  });
});
