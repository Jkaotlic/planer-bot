import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import type { Db } from "../db/client";
import { collectionPayments } from "../db/schema";
import { createCustomCollection } from "./collection-service";

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
