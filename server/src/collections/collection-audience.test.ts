import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { archiveEmployee, createEmployee, linkTelegramAccount } from "../repo/employees";
import type { Db } from "../db/client";
import { collectionRecipients, collections } from "../db/schema";
import { eq } from "drizzle-orm";
import { archiveGroup, createGroup, updateGroup } from "../groups/group-service";
import {
  collectionAudience,
  collectionsForWorker,
  createCustomCollection,
  getCollection,
  markCollectionSent,
  previewCollection,
  updateCollection,
} from "./collection-service";
import { listPayments, setPaid } from "./payment-service";

const TODAY = "2026-09-30";

function person(db: Db, name: string, tg: number | null): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  return employee.id;
}

function group(db: Db, name: string, memberIds: number[], by: number): number {
  const made = createGroup(db, { name, memberIds }, by);
  if (!made.ok || !made.group) throw new Error("группа не создалась");
  return made.group.id;
}

function round(db: Db, patch: { employeeId?: number | null; recipientGroupId?: number | null } = {}) {
  return createCustomCollection(db, {
    title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
    amountPerPerson: 500, totalGoal: null, collectUrl: "https://example.test/c/1",
    messageText: null, scheduledSendOn: null, recipientGroupId: null, ...patch,
  });
}

function fresh(db: Db, id: number) {
  const collection = getCollection(db, id);
  if (!collection) throw new Error("сбора нет");
  return collection;
}

const names = (list: { displayName: string }[]) => list.map((e) => e.displayName);

function frozenRows(db: Db, collectionId: number): number[] {
  return db.select({ id: collectionRecipients.employeeId }).from(collectionRecipients)
    .where(eq(collectionRecipients.collectionId, collectionId)).all().map((r) => r.id).sort();
}

describe("collectionAudience", () => {
  it("без группы — вся команда с Telegram, кроме виновника", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    person(db, "Игорь", 2);
    person(db, "Марк", null);
    const c = round(db, { employeeId: anya });

    expect(names(collectionAudience(db, c))).toEqual(["Игорь"]);
  });

  it("с группой — только её активные участники с Telegram, виновник исключён даже в группе", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    const igor = person(db, "Игорь", 2);
    const lena = person(db, "Лена", 3);
    person(db, "Марк", 4); // вне группы — не адресат
    const g = group(db, "ЧИП 5-й этаж", [anya, igor, lena], anya);
    archiveEmployee(db, lena, TODAY);
    const c = round(db, { employeeId: anya, recipientGroupId: g });

    expect(names(collectionAudience(db, c))).toEqual(["Игорь"]);
    expect(names(previewCollection(db, c, TODAY).recipients)).toEqual(["Игорь"]);
    expect(previewCollection(db, c, TODAY).recipientGroupName).toBe("ЧИП 5-й этаж");
  });

  it("после первой рассылки — зафиксированный список: переезд в другую группу его не меняет", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    const igor = person(db, "Игорь", 2);
    const mark = person(db, "Марк", 3);
    const g = group(db, "ЧИП 5-й этаж", [igor], anya);
    const c = round(db, { recipientGroupId: g });

    markCollectionSent(db, c.id, 1, new Date("2026-09-30T09:00:00Z"), [igor]);
    updateGroup(db, g, { memberIds: [mark] });

    expect(names(collectionAudience(db, fresh(db, c.id)))).toEqual(["Игорь"]);
  });

  it("старый разосланный сбор без зафиксированного списка — вся команда, как раньше", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    const igor = person(db, "Игорь", 2);
    const g = group(db, "ЧИП 5-й этаж", [igor], anya);
    // Сбор, разосланный до групп: счётчик есть, строк collection_recipients нет.
    // Группа проставлена руками, чтобы убедиться — старому сбору она не указ.
    const c = round(db, { recipientGroupId: g });
    db.update(collections).set({ sendCount: 1 }).where(eq(collections.id, c.id)).run();

    expect(frozenRows(db, c.id)).toEqual([]);
    expect(names(collectionAudience(db, fresh(db, c.id)))).toEqual(["Аня", "Игорь"]);
    expect(collectionsForWorker(db, TODAY, anya).map((w) => w.id)).toEqual([c.id]);
  });

  it("группа в архиве до рассылки — блокер в превью", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    const g = group(db, "ЧИП 5-й этаж", [anya], anya);
    const c = round(db, { recipientGroupId: g });
    archiveGroup(db, g);

    const preview = previewCollection(db, c, TODAY);
    expect(preview.blocker).toBe("Группа «ЧИП 5-й этаж» удалена — выбери другую.");
    expect(preview.recipients).toEqual([]);
    expect(preview.recipientGroupName).toBe("ЧИП 5-й этаж");
  });

  it("группа, где ни у кого нет Telegram, — свой блокер", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    const mark = person(db, "Марк", null);
    const g = group(db, "ЧИП 32 этаж", [mark], anya);
    const c = round(db, { recipientGroupId: g });

    expect(previewCollection(db, c, TODAY).blocker).toBe("Некому отправлять: в группе никого с Telegram.");
  });

  it("зафиксированный список, где никто больше не достижим, — свой блокер, а не «ни у кого из команды»", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    const igor = person(db, "Игорь", 2);
    const c = round(db);
    markCollectionSent(db, c.id, 1, new Date("2026-09-30T09:00:00Z"), [igor]);
    archiveEmployee(db, igor, TODAY);

    expect(anya).toBeGreaterThan(0);
    expect(previewCollection(db, fresh(db, c.id), TODAY).blocker)
      .toBe("Некому отправлять: из адресатов сбора ни у кого нет Telegram.");
  });

  it("вторая рассылка не переписывает зафиксированный список", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    const igor = person(db, "Игорь", 2);
    const c = round(db);

    markCollectionSent(db, c.id, 1, new Date("2026-09-30T09:00:00Z"), [igor]);
    markCollectionSent(db, c.id, 2, new Date("2026-10-01T09:00:00Z"), [anya, igor]);

    expect(frozenRows(db, c.id)).toEqual([igor]);
    expect(fresh(db, c.id).sendCount).toBe(2);
  });

  it("после рассылки группу сменить нельзя; до рассылки — можно", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    const g1 = group(db, "ЧИП 5-й этаж", [anya], anya);
    const g2 = group(db, "ЧИП 32 этаж", [anya], anya);
    const c = round(db, { recipientGroupId: g1 });

    expect(updateCollection(db, c.id, { recipientGroupId: g2 }).ok).toBe(true);
    markCollectionSent(db, c.id, 1, new Date("2026-09-30T09:00:00Z"), [anya]);
    expect(updateCollection(db, c.id, { recipientGroupId: g1 }))
      .toEqual({ ok: false, error: "Сбор уже разослан — адресатов менять нельзя." });
    // Та же группа повторно — не смена: форма шлёт поле целиком.
    expect(updateCollection(db, c.id, { recipientGroupId: g2 }).ok).toBe(true);
  });
});

describe("видимость и отметки", () => {
  it("зафиксированный сбор видит и отмечает только адресат; посторонний — нет", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    const igor = person(db, "Игорь", 2);
    const mark = person(db, "Марк", 3);
    const g = group(db, "ЧИП 5-й этаж", [igor], anya);
    const c = round(db, { recipientGroupId: g });
    markCollectionSent(db, c.id, 1, new Date("2026-09-30T09:00:00Z"), [igor]);
    const sent = fresh(db, c.id);

    expect(collectionsForWorker(db, TODAY, igor).map((w) => w.id)).toEqual([c.id]);
    expect(collectionsForWorker(db, TODAY, mark)).toEqual([]);
    expect(setPaid(db, sent, mark, mark, true)).toEqual({ ok: false, error: "Этот человек в сборе не участвует." });
    expect(setPaid(db, sent, igor, igor, true)).toEqual({ ok: true });
  });

  it("«сдали N из M» считает по зафиксированному списку", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 1);
    const igor = person(db, "Игорь", 2);
    const mark = person(db, "Марк", 3);
    const g = group(db, "ЧИП 5-й этаж", [igor], anya);
    const c = round(db, { recipientGroupId: g });
    markCollectionSent(db, c.id, 1, new Date("2026-09-30T09:00:00Z"), [igor]);
    // Марк переехал в группу после рассылки — в знаменатель он не попадает.
    updateGroup(db, g, { memberIds: [igor, mark] });
    const sent = fresh(db, c.id);

    expect(listPayments(db, sent).total).toBe(1);
    expect(collectionsForWorker(db, TODAY, igor)[0]?.recipientCount).toBe(1);
  });
});
