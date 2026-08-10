import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import type { Db } from "../db/client";
import {
  createCustomCollection,
  deleteCollection,
  getCollection,
  listCollections,
  markCollectionSent,
  previewCollection,
  recipientsOf,
  setCollectionClosed,
  updateCollection,
} from "./collection-service";

const TODAY = "2026-08-10";

function person(db: Db, name: string, tg: number | null): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  return employee.id;
}

function blank(patch: Partial<Parameters<typeof createCustomCollection>[1]> = {}) {
  return {
    title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
    scheduledSendOn: null, ...patch,
  };
}

describe("recipientsOf", () => {
  it("«everyone but the honouree, and only those the bot can reach»", () => {
    const db = makeTestDb();
    const honouree = person(db, "Honouree", 1);
    const reachable = person(db, "Reachable", 2);
    person(db, "NoTelegram", null);

    expect(recipientsOf(db, honouree).map((e) => e.id)).toEqual([reachable]);
    // Without an honouree everybody reachable is in — a general collection.
    expect(recipientsOf(db, null).map((e) => e.id).sort()).toEqual([honouree, reachable].sort());
  });
});

describe("listCollections", () => {
  it("hides the collection the viewer is the honouree of, and keeps the others", () => {
    const db = makeTestDb();
    const viewer = person(db, "Viewer", 1);
    const other = person(db, "Other", 2);
    createCustomCollection(db, blank({ title: "Про смотрящего", employeeId: viewer }));
    createCustomCollection(db, blank({ title: "Про другого", employeeId: other }));
    createCustomCollection(db, blank({ title: "Общий" }));

    const titles = listCollections(db, TODAY, viewer).map((row) => row.title);
    // Two rows must survive: an empty answer would pass on a broken query too.
    // Order here follows compareCollections' ru-locale title tie-break for two
    // undated active collections — "Общий" collates before "Про другого".
    expect(titles).toEqual(["Общий", "Про другого"]);
  });

  it("marks active and closed, and puts the active ones first", () => {
    const db = makeTestDb();
    const viewer = person(db, "Viewer", 1);
    const gone = createCustomCollection(db, blank({ title: "Прошлый", deadline: "2026-08-01" }));
    createCustomCollection(db, blank({ title: "Идёт", deadline: "2026-08-20" }));

    const rows = listCollections(db, TODAY, viewer);
    expect(rows.map((r) => [r.title, r.active])).toEqual([["Идёт", true], ["Прошлый", false]]);
    expect(rows.find((r) => r.collection.id === gone.id)!.active).toBe(false);
  });
});

describe("previewCollection", () => {
  it("shows the exact text and the exact names, minus the honouree", () => {
    const db = makeTestDb();
    const honouree = person(db, "Honouree", 1);
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank({
      title: "Свадьба", employeeId: honouree, eventDate: "2026-08-22",
      amountPerPerson: 1000, collectUrl: "https://example.test/c/1",
    }));

    const preview = previewCollection(db, collection);
    expect(preview.message.split("\n")[0]).toBe("🎁 Свадьба — Honouree, 22 августа");
    expect(preview.recipients.map((r) => r.displayName)).toEqual(["Colleague"]);
    expect(preview.blocker).toBeNull();
  });

  it("blocks without a link, and unblocks once there is one", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank());
    expect(previewCollection(db, collection).blocker).toContain("Нет ссылки");

    const saved = updateCollection(db, collection.id, { collectUrl: "https://example.test/c/1" });
    expect(saved.ok).toBe(true);
    expect(previewCollection(db, saved.ok ? saved.collection : collection).blocker).toBeNull();
  });

  it("a custom collection can be sent again — a birthday one cannot", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const custom = createCustomCollection(db, blank({ collectUrl: "https://example.test/c/1" }));
    markCollectionSent(db, custom.id, 1, new Date("2026-08-12T09:00:00Z"));

    const again = previewCollection(db, getCollectionOrThrow(db, custom.id));
    expect(again.blocker).toBeNull();
    expect(again.sendCount).toBe(1);
    // The second round is worded as a reminder, not as the first announcement.
    expect(again.message.split("\n")[0]).toContain("Напоминаю про сбор");
  });

  it("a closed collection is blocked whatever else is true", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank({ collectUrl: "https://example.test/c/1" }));
    setCollectionClosed(db, collection.id, true, new Date("2026-08-11T00:00:00Z"));
    expect(previewCollection(db, getCollectionOrThrow(db, collection.id)).blocker).toContain("закрыт");
  });
});

describe("updateCollection", () => {
  it("after a send the link may change and the subject may not", () => {
    const db = makeTestDb();
    const honouree = person(db, "Honouree", 1);
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank({ title: "Свадьба", employeeId: honouree, collectUrl: "https://example.test/c/1" }));
    markCollectionSent(db, collection.id, 1, new Date("2026-08-12T09:00:00Z"));

    const link = updateCollection(db, collection.id, { collectUrl: "https://example.test/c/2" });
    expect(link.ok).toBe(true);

    const subject = updateCollection(db, collection.id, { title: "Проводы" });
    expect(subject).toEqual({ ok: false, error: expect.stringContaining("уже разослан") });
  });
});

describe("deleteCollection", () => {
  it("removes an unsent collection and refuses a sent one", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const fresh = createCustomCollection(db, blank({ title: "Ошибка" }));
    const sent = createCustomCollection(db, blank({ title: "Ушедший", collectUrl: "https://example.test/c/1" }));
    markCollectionSent(db, sent.id, 1, new Date("2026-08-12T09:00:00Z"));

    expect(deleteCollection(db, fresh.id)).toEqual({ ok: true });
    expect(deleteCollection(db, sent.id).ok).toBe(false);
    expect(listCollections(db, TODAY, 999).map((r) => r.title)).toEqual(["Ушедший"]);
  });
});

/** Reading a row back is needed often enough to earn a name. */
function getCollectionOrThrow(db: Db, id: number) {
  const row = getCollection(db, id);
  if (!row) throw new Error(`collection ${id} vanished`);
  return row;
}
