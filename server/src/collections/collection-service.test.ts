import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { ensureBirthdayRound, markAutoSent } from "../birthdays/birthday-service";
import type { Db } from "../db/client";
import { collections, type Collection } from "../db/schema";
import {
  adminRecipients,
  claimCollectionSend,
  collectionsForWorker,
  createCustomCollection,
  deleteCollection,
  getCollection,
  listCollections,
  markCollectionSent,
  previewCollection,
  recipientsOf,
  releaseCollectionSend,
  setCollectionClosed,
  updateCollection,
} from "./collection-service";

const TODAY = "2026-08-10";

function person(db: Db, name: string, tg: number | null, birthDate: string | null = null): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  if (birthDate) setBirthDate(db, employee.id, birthDate);
  return employee.id;
}

function blank(patch: Partial<Parameters<typeof createCustomCollection>[1]> = {}) {
  return {
    title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
    scheduledSendOn: null, ...patch,
  };
}

/** A birthday round, which `createCustomCollection` cannot produce by design. */
function birthdayRound(db: Db, employeeId: number, patch: Record<string, unknown> = {}) {
  return db
    .insert(collections)
    .values({
      kind: "birthday", employeeId, year: 2026, celebratedOn: "2026-08-15",
      collectUrl: "https://example.test/b/1", ...patch,
    })
    .returning()
    .all()[0]!;
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

describe("adminRecipients", () => {
  it("reachable admins, minus the honouree — even when the honouree is an admin", () => {
    const db = makeTestDb();
    const honouree = person(db, "HonoureeAdmin", 1);
    const other = person(db, "OtherAdmin", 2);
    person(db, "PlainWorker", 3);
    setEmployeeAdmin(db, honouree, true);
    setEmployeeAdmin(db, other, true);

    // Three people, two of them admins: the plain worker proves admin-ness is
    // filtered, and the honouree-admin proves the surprise rule outranks it.
    expect(adminRecipients(db, honouree).map((e) => e.id)).toEqual([other]);
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

  /**
   * The live incident of 2026-08-12: a collection went out to 27 people with no
   * link in it. The link WAS filled in — so the blocker stayed silent — but the
   * admin's own wording replaced the composed message wholesale, and the
   * «Сбор: …» line went with it. This asserts the wiring, not the rule: the rule
   * has its own tests in `shared/src/collection.test.ts`.
   */
  it("keeps the link when the admin wrote their own wording", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank({
      title: "Кофемашина",
      collectUrl: "https://example.test/c/1",
      messageText: "Скидываемся на кофемашину, кто сколько может",
    }));

    const preview = previewCollection(db, collection);
    expect(preview.message).toContain("Скидываемся на кофемашину");
    expect(preview.message).toContain("https://example.test/c/1");
    expect(preview.blocker).toBeNull();
  });

  it("a custom collection can be sent again — a birthday one cannot", () => {
    const db = makeTestDb();
    const honouree = person(db, "Honouree", 1);
    person(db, "Colleague", 2);

    const custom = createCustomCollection(db, blank({ collectUrl: "https://example.test/c/1" }));
    markCollectionSent(db, custom.id, 1, new Date("2026-08-12T09:00:00Z"));
    const again = previewCollection(db, getCollectionOrThrow(db, custom.id));
    expect(again.blocker).toBeNull();
    expect(again.sendCount).toBe(1);
    // The second round is worded as a reminder, not as the first announcement.
    expect(again.message.split("\n")[0]).toContain("Напоминаю про сбор");

    // The same state on a birthday round is settled forever: a doubled greeting
    // is worse than one nobody re-sent.
    const birthday = birthdayRound(db, honouree);
    markCollectionSent(db, birthday.id, 1, new Date("2026-08-12T09:00:00Z"));
    expect(previewCollection(db, getCollectionOrThrow(db, birthday.id)).blocker)
      .toContain("Уже разослано");
    // Before it went out it was sendable — otherwise this assertion would hold
    // against a birthday round that is blocked for some entirely other reason.
    const fresh = birthdayRound(db, person(db, "Second", 3));
    expect(previewCollection(db, fresh).blocker).toBeNull();
  });

  it("a closed collection is blocked whatever else is true", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank({ collectUrl: "https://example.test/c/1" }));
    setCollectionClosed(db, collection.id, true, new Date("2026-08-11T00:00:00Z"));
    expect(previewCollection(db, getCollectionOrThrow(db, collection.id)).blocker).toContain("закрыт");
  });

  it("closing is reversible", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank({ collectUrl: "https://example.test/c/1" }));

    setCollectionClosed(db, collection.id, true, new Date("2026-08-11T00:00:00Z"));
    expect(previewCollection(db, getCollectionOrThrow(db, collection.id)).blocker).toContain("закрыт");

    setCollectionClosed(db, collection.id, false, new Date("2026-08-12T00:00:00Z"));
    expect(getCollectionOrThrow(db, collection.id).closedAt).toBeNull();
    expect(previewCollection(db, getCollectionOrThrow(db, collection.id)).blocker).toBeNull();
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

  it("resending an unchanged subject after a send is not an edit", () => {
    const db = makeTestDb();
    const honouree = person(db, "Honouree", 1);
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank({
      title: "Свадьба", employeeId: honouree, collectUrl: "https://example.test/c/1",
    }));
    markCollectionSent(db, collection.id, 1, new Date("2026-08-12T09:00:00Z"));

    // Both consoles resubmit every field on every save. Sending back the value
    // that is already stored must not read as an attempt to change it.
    const resend = updateCollection(db, collection.id, {
      title: "Свадьба", employeeId: honouree, collectUrl: "https://example.test/c/2",
    });
    expect(resend.ok).toBe(true);
    // …while an actual change to the same field still is refused.
    expect(updateCollection(db, collection.id, { title: "Проводы" }).ok).toBe(false);
  });

  it("новая ссылка снимает «уже пробовал»: сбор, не ушедший без ссылки, обязан уйти после", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    markAutoSent(db, round.id, new Date());

    const result = updateCollection(db, round.id, { collectUrl: "https://example.com/sbor" });

    expect(result.ok).toBe(true);
    expect((result as { collection: Collection }).collection.autoSentAt).toBeNull();
  });

  it("передвинутый день автоотправки тоже снимает отметку", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    markAutoSent(db, round.id, new Date());

    const result = updateCollection(db, round.id, { autoSendOn: "2026-09-05" });

    expect((result as { collection: Collection }).collection.autoSentAt).toBeNull();
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

  it("never deletes a birthday round — it would just be recreated", () => {
    const db = makeTestDb();
    const honouree = person(db, "Honouree", 1);
    const birthday = birthdayRound(db, honouree, { collectUrl: null });
    // Untouched by any send, so the refusal can only come from its kind.
    expect(birthday.sendCount).toBe(0);
    expect(deleteCollection(db, birthday.id).ok).toBe(false);
    expect(getCollection(db, birthday.id)).not.toBeNull();
  });
});

describe("collectionsForWorker", () => {
  it("shows what was actually sent, is still running, and is not about them", () => {
    const db = makeTestDb();
    const me = person(db, "Me", 1);
    const other = person(db, "Other", 2);

    const mine = createCustomCollection(db, blank({ title: "Про меня", employeeId: me, collectUrl: "https://example.test/1" }));
    const theirs = createCustomCollection(db, blank({ title: "Про другого", employeeId: other, collectUrl: "https://example.test/2" }));
    const draft = createCustomCollection(db, blank({ title: "Не разослан", collectUrl: "https://example.test/3" }));
    const over = createCustomCollection(db, blank({ title: "Просроченный", deadline: "2026-08-01", collectUrl: "https://example.test/4" }));
    for (const c of [mine, theirs, draft, over]) {
      if (c.id !== draft.id) markCollectionSent(db, c.id, 2, new Date("2026-08-05T09:00:00Z"));
    }

    // Exactly one of four survives, and the other three fail for three different
    // reasons — a filter that drops everything would not pass this.
    expect(collectionsForWorker(db, TODAY, me).map((c) => c.title)).toEqual(["Про другого"]);
  });
});

describe("замок рассылки", () => {
  // Уборка — в `finally`, а не последней строкой: она обязана пережить падение
  // ассерта, иначе пропускается ровно в тот момент, когда нужна, — при регрессе замка.
  it("второй захват того же сбора не проходит, пока первый не отпустил", () => {
    try {
      expect(claimCollectionSend(42)).toBe(true);
      expect(claimCollectionSend(42)).toBe(false);
      releaseCollectionSend(42);
      expect(claimCollectionSend(42)).toBe(true);
    } finally {
      releaseCollectionSend(42);
    }
  });

  it("разные сборы друг друга не блокируют", () => {
    try {
      expect(claimCollectionSend(1)).toBe(true);
      expect(claimCollectionSend(2)).toBe(true);
    } finally {
      releaseCollectionSend(1);
      releaseCollectionSend(2);
    }
  });
});

/** Reading a row back is needed often enough to earn a name. */
function getCollectionOrThrow(db: Db, id: number) {
  const row = getCollection(db, id);
  if (!row) throw new Error(`collection ${id} vanished`);
  return row;
}
