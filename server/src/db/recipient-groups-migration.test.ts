import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { createEmployee } from "../repo/employees";
import { collectionRecipients, collections, recipientGroupMembers, recipientGroups } from "./schema";

describe("миграция 0040 — группы адресатов", () => {
  it("группа, участник, группа у сбора и зафиксированный адресат сохраняются", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const group = db.insert(recipientGroups).values({ name: "ЧИП 5-й этаж", createdBy: anya.id }).returning().get();
    db.insert(recipientGroupMembers).values({ groupId: group.id, employeeId: anya.id }).run();
    expect(() => db.insert(recipientGroupMembers).values({ groupId: group.id, employeeId: anya.id }).run()).toThrow(/UNIQUE|PRIMARY/i);
    const col = db.insert(collections).values({ kind: "custom", title: "Кофе", recipientGroupId: group.id }).returning().get();
    expect(col.recipientGroupId).toBe(group.id);
    db.insert(collectionRecipients).values({ collectionId: col.id, employeeId: anya.id }).run();
    expect(group.archivedAt).toBeNull();
  });
});
