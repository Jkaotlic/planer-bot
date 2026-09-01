import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, archiveEmployee } from "../repo/employees";
import {
  upcomingBirthdays,
  ensureBirthdayRound,
  birthdayRoundDraft,
  adminNoticeMessage,
  adminNoticeReadyMessage,
  roundsScheduledFor,
  markAdminNotified,
  markScheduleNotified,
  roundsToAutoSend,
  markAutoSent,
} from "./birthday-service";
import { createCustomCollection, markCollectionSent, updateCollection } from "../collections/collection-service";
import { collections } from "../db/schema";
import type { Db } from "../db/client";

const ASOF = "2026-08-01";

/** A worker with a Telegram link, since only reachable people can be messaged. */
function person(db: Db, name: string, tg: number | null, birthDate: string | null): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  if (birthDate) setBirthDate(db, employee.id, birthDate);
  return employee.id;
}

describe("upcomingBirthdays", () => {
  it("lists people nearest first, and says when it falls", () => {
    const db = makeTestDb();
    person(db, "Через месяц", 1, "09-01");
    person(db, "Послезавтра", 2, "08-03");
    person(db, "Сегодня", 3, "08-01");

    const list = upcomingBirthdays(db, ASOF);
    expect(list.map((b) => b.displayName)).toEqual(["Сегодня", "Послезавтра", "Через месяц"]);
    expect(list[0]).toMatchObject({ daysUntil: 0, celebratedOn: "2026-08-01", birthDateLabel: "1 августа" });
    expect(list[1]).toMatchObject({ daysUntil: 2, celebratedOn: "2026-08-03" });
  });

  it("rolls a birthday that has passed round to next year", () => {
    const db = makeTestDb();
    person(db, "Прошёл", 1, "07-31");
    const [only] = upcomingBirthdays(db, ASOF);
    expect(only).toMatchObject({ daysUntil: 364, celebratedOn: "2027-07-31" });
  });

  it("skips people with no birthday on file, and archived ones", () => {
    const db = makeTestDb();
    person(db, "Без даты", 1, null);
    const gone = person(db, "Уволенный", 2, "08-05");
    archiveEmployee(db, gone, "2026-07-01");
    expect(upcomingBirthdays(db, ASOF)).toEqual([]);
  });

  it("trims to the near future when asked", () => {
    const db = makeTestDb();
    person(db, "Скоро", 1, "08-05");
    person(db, "Нескоро", 2, "12-01");
    expect(upcomingBirthdays(db, ASOF, 7).map((b) => b.displayName)).toEqual(["Скоро"]);
  });

  it("greets somebody born on 29 February in a common year on 1 March", () => {
    const db = makeTestDb();
    person(db, "Високосный", 1, "02-29");
    const [only] = upcomingBirthdays(db, "2027-02-01");
    expect(only!.celebratedOn).toBe("2027-03-01");
  });
});

describe("upcomingBirthdays and the viewer", () => {
  it("drops the viewer from the list and keeps everybody else", () => {
    const db = makeTestDb();
    const viewer = person(db, "Viewer", 1, "08-12");
    person(db, "Other", 2, "08-13");

    const forViewer = upcomingBirthdays(db, "2026-08-10", 30, viewer);
    // Two people have birthdays here — an empty list would pass on a broken filter.
    expect(forViewer.map((b) => b.displayName)).toEqual(["Other"]);
    expect(upcomingBirthdays(db, "2026-08-10", 30).map((b) => b.displayName)).toEqual(["Viewer", "Other"]);
  });
});

describe("ensureBirthdayRound", () => {
  it("creates one round per person per year and finds it again", () => {
    const db = makeTestDb();
    const employee = person(db, "Honouree", 1, "08-15");

    const first = ensureBirthdayRound(db, employee, "2026-08-01")!;
    const again = ensureBirthdayRound(db, employee, "2026-08-02")!;
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ kind: "birthday", year: 2026, celebratedOn: "2026-08-15", sendCount: 0 });

    // Next year is a different round — the unique index is (employee, year).
    const next = ensureBirthdayRound(db, employee, "2026-09-01")!;
    expect(next.id).not.toBe(first.id);
    expect(next.year).toBe(2027);
  });

  it("новый раунд сразу знает, в какой день бот разошлёт его сам", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");

    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;

    expect(round.celebratedOn).toBe("2026-09-07");
    expect(round.autoSendOn).toBe("2026-09-04");
    expect(round.autoSentAt).toBeNull();
  });

  it("раунд, заведённый впритык, рассылается сегодня, а не задним числом", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");

    const round = ensureBirthdayRound(db, mark, "2026-09-06")!;

    expect(round.autoSendOn).toBe("2026-09-06");
  });
});

describe("birthdayRoundDraft", () => {
  it("returns an unsaved draft — id 0 — and creates no row, when nothing has been prepared yet", () => {
    const db = makeTestDb();
    const employee = person(db, "Honouree", 1, "08-15");
    const before = db.select().from(collections).all().length;

    const draft = birthdayRoundDraft(db, employee, "2026-08-01")!;
    expect(draft).toMatchObject({ id: 0, kind: "birthday", employeeId: employee, year: 2026, celebratedOn: "2026-08-15" });
    // The point of the whole change: looking at a draft must not write a row.
    expect(db.select().from(collections).all().length).toBe(before);
  });

  it("returns the real saved row once ensureBirthdayRound has made one", () => {
    const db = makeTestDb();
    const employee = person(db, "Honouree", 1, "08-15");
    const saved = ensureBirthdayRound(db, employee, "2026-08-01")!;

    const draft = birthdayRoundDraft(db, employee, "2026-08-01")!;
    expect(draft.id).toBe(saved.id);
    expect(draft.id).toBeGreaterThan(0);
  });

  it("returns null for someone with no birthday on file — there is nothing to draft", () => {
    const db = makeTestDb();
    const employee = person(db, "NoBirthday", 1, null);
    expect(birthdayRoundDraft(db, employee, "2026-08-01")).toBeNull();
  });

  it("предпросмотр показывает тот же день, что запишет сохранение", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");

    const draft = birthdayRoundDraft(db, mark, "2026-09-01")!;

    expect(draft.id).toBe(0);
    expect(draft.autoSendOn).toBe("2026-09-04");
  });
});

describe("wording", () => {
  it("leaves the name in the nominative — we cannot decline it", () => {
    // One display name is stored and nothing that would let us inflect it, so
    // every phrase has to be built around the name as given. «день рождения у
    // Мишин Илья» is the failure this guards, and it would land in 25 chats.
    const notice = adminNoticeMessage("Мишин Илья", "5 августа", 7, "2026-08-05", "2026-08-01");
    expect(notice).toContain("Мишин Илья");
    expect(notice).not.toMatch(/у Мишин Илья/);
  });

  it("tells admins what to do next, not just that a birthday exists", () => {
    const notice = adminNoticeMessage("Мишин Илья", "5 августа", 7, "2026-08-05", "2026-08-01");
    expect(notice).toContain("через 7 дней");
    expect(notice).toContain("Сбербанк Онлайн");
    // Больше не «сам решишь, когда разослать»: с 31.08.2026 бот привязывает
    // присланную ссылку и рассылает сам — это и есть путь, о котором нудж
    // обязан сказать, единственное место, откуда админ о нём узнаёт.
    expect(notice).toMatch(/пришли ссылку сюда/i);
    expect(notice).toContain("Разошлю команде 5 августа, кроме именинника.");
  });

  it("without auto-send armed, tells admins they'll have to send it themselves — no false promise", () => {
    const notice = adminNoticeMessage("Мишин Илья", "5 августа", 7, null, "2026-08-01");
    expect(notice).toContain("Автоотправка выключена");
    expect(notice).not.toMatch(/разошлю/i);
  });

  it("tells admins the collection is already ready, not to create one they already made", () => {
    const notice = adminNoticeReadyMessage("Мишин Илья", "5 августа", 7, "2026-08-05", "2026-08-01");
    expect(notice).toContain("через 7 дней");
    expect(notice).toContain("Мишин Илья");
    expect(notice).not.toContain("Создай сбор");
    expect(notice).not.toContain("Сбербанк Онлайн");
    expect(notice).not.toMatch(/у Мишин Илья/);
    expect(notice).toContain("делать ничего не надо");
  });

  it("ready message without auto-send tells admins to send it themselves, not that the bot will", () => {
    const notice = adminNoticeReadyMessage("Мишин Илья", "5 августа", 7, null, "2026-08-01");
    expect(notice).toContain("разошли его из «Дней рождения»");
    expect(notice).not.toMatch(/делать ничего не надо/);
  });
});

describe("roundsScheduledFor", () => {
  it("skips a birthday round that has gone out, keeps one that hasn't", () => {
    const db = makeTestDb();
    const sentTo = person(db, "Sent", 1, "08-20");
    const waiting = person(db, "Waiting", 2, "08-21");
    const sentRound = ensureBirthdayRound(db, sentTo, "2026-08-01")!;
    const waitingRound = ensureBirthdayRound(db, waiting, "2026-08-01")!;
    updateCollection(db, sentRound.id, { scheduledSendOn: "2026-08-10" });
    updateCollection(db, waitingRound.id, { scheduledSendOn: "2026-08-10" });
    markCollectionSent(db, sentRound.id, 3, new Date("2026-08-09T09:00:00Z"));

    expect(roundsScheduledFor(db, "2026-08-10").map((r) => r.id)).toEqual([waitingRound.id]);
  });

  it("keeps a custom collection that has already gone out — the reminder is «пора дожать»", () => {
    const db = makeTestDb();
    person(db, "Colleague", 3, null);
    const collection = createCustomCollection(db, {
      title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
      amountPerPerson: null, totalGoal: null, collectUrl: "https://example.test/c/1",
      messageText: null, scheduledSendOn: "2026-08-10",
    });
    markCollectionSent(db, collection.id, 2, new Date("2026-08-05T09:00:00Z"));

    expect(roundsScheduledFor(db, "2026-08-10").map((r) => r.id)).toEqual([collection.id]);
  });

  it("drops a custom collection whose deadline is behind us", () => {
    const db = makeTestDb();
    const gone = createCustomCollection(db, {
      title: "Просроченный", employeeId: null, eventDate: null, deadline: "2026-08-05",
      amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
      scheduledSendOn: "2026-08-04",
    });
    const alive = createCustomCollection(db, {
      title: "Идущий", employeeId: null, eventDate: null, deadline: "2026-08-20",
      amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
      scheduledSendOn: "2026-08-04",
    });
    // Both reminder days are in the past — the difference is only the deadline,
    // so a filter that dropped everything would not pass this.
    expect(roundsScheduledFor(db, "2026-08-10").map((r) => r.id)).toEqual([alive.id]);
    expect(gone.id).not.toBe(alive.id);
  });

  // The scenarios below carried the old `campaignsScheduledFor` behaviour and
  // still apply unchanged: only the table and the API to set them up moved.
  it("matches a reminder day that has already passed and was never notified", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-08");
    const round = ensureBirthdayRound(db, id, ASOF)!;
    updateCollection(db, round.id, { collectUrl: "https://sber/x", scheduledSendOn: "2026-07-30" });

    // ASOF ("2026-08-01") is after the picked day ("2026-07-30") but still
    // before the birthday itself ("2026-08-08") — the missed day heals.
    const rows = roundsScheduledFor(db, ASOF);
    expect(rows.map((r) => r.employeeId)).toEqual([id]);
  });

  it("does not match once the celebration itself is behind the given date", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "01-05");
    const round = ensureBirthdayRound(db, id, "2026-01-01")!;
    updateCollection(db, round.id, { collectUrl: "https://sber/x", scheduledSendOn: "2026-01-03" });

    expect(roundsScheduledFor(db, "2026-06-01")).toEqual([]);
  });

  it("matches exactly on the picked day, same as before", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-08");
    const round = ensureBirthdayRound(db, id, ASOF)!;
    updateCollection(db, round.id, { collectUrl: "https://sber/x", scheduledSendOn: ASOF });

    expect(roundsScheduledFor(db, ASOF).map((r) => r.employeeId)).toEqual([id]);
  });

  it("stays quiet on a day before the picked one", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-08");
    const round = ensureBirthdayRound(db, id, ASOF)!;
    updateCollection(db, round.id, { collectUrl: "https://sber/x", scheduledSendOn: "2026-08-04" });
    expect(roundsScheduledFor(db, ASOF)).toEqual([]);
  });

  it("excludes a round already marked notified, even a healed one", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-08");
    const round = ensureBirthdayRound(db, id, ASOF)!;
    updateCollection(db, round.id, { collectUrl: "https://sber/x", scheduledSendOn: "2026-07-30" });
    markScheduleNotified(db, round.id, new Date());
    expect(roundsScheduledFor(db, ASOF)).toEqual([]);
  });

  it("is unaffected by the unrelated week-ahead flag", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-08");
    const round = ensureBirthdayRound(db, id, ASOF)!;
    updateCollection(db, round.id, { collectUrl: "https://sber/x", scheduledSendOn: "2026-07-30" });
    markAdminNotified(db, round.id, new Date());
    expect(roundsScheduledFor(db, ASOF).map((r) => r.employeeId)).toEqual([id]);
  });
});

describe("roundsToAutoSend", () => {
  it("берёт раунд, чей день настал, и не берёт будущий", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    ensureBirthdayRound(db, mark, "2026-09-01");

    expect(roundsToAutoSend(db, "2026-09-03")).toHaveLength(0);
    expect(roundsToAutoSend(db, "2026-09-04")).toHaveLength(1);
  });

  it("подбирает пропущенный день: сервер лежал четвёртого — разошлёт пятого", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    ensureBirthdayRound(db, mark, "2026-09-01");

    expect(roundsToAutoSend(db, "2026-09-05")).toHaveLength(1);
  });

  it("не берёт раунд, по которому попытка уже была", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    markAutoSent(db, round.id, new Date());

    expect(roundsToAutoSend(db, "2026-09-04")).toHaveLength(0);
  });

  it("не берёт раунд, у которого праздник уже прошёл", () => {
    const db = makeTestDb();
    const mark = person(db, "Марк", 1, "09-07");
    ensureBirthdayRound(db, mark, "2026-09-01");

    expect(roundsToAutoSend(db, "2026-09-08")).toHaveLength(0);
  });

  it("не берёт кастомный сбор — у него своя дата напоминания", () => {
    const db = makeTestDb();
    createCustomCollection(db, {
      title: "Свадьба", employeeId: null, eventDate: null, deadline: null,
      amountPerPerson: null, totalGoal: null, collectUrl: "https://example.com/s",
      messageText: null, scheduledSendOn: null,
    });
    // Кастомному сбору `autoSendOn` не ставит никто, но проверяем явно: если
    // однажды поставят руками, рассылать всё равно нельзя. Колонкой напрямую, а
    // не патчем: полем патча `autoSendOn` станет только в задаче 7.
    db.update(collections).set({ autoSendOn: "2026-09-01" }).where(eq(collections.id, 1)).run();

    expect(roundsToAutoSend(db, "2026-09-04")).toHaveLength(0);
  });
});
