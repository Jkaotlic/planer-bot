import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin, archiveEmployee } from "../repo/employees";
import {
  upcomingBirthdays,
  ensureCampaign,
  updateCampaign,
  previewCampaign,
  teamRecipients,
  adminRecipients,
  defaultMessage,
  adminNoticeMessage,
  markSent,
} from "./birthday-service";
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

describe("who gets what", () => {
  it("never sends the collection to the person it is for", () => {
    const db = makeTestDb();
    const birthday = person(db, "Именинник", 1, "08-05");
    person(db, "Коллега", 2, null);

    expect(teamRecipients(db, birthday).map((e) => e.displayName)).toEqual(["Коллега"]);
  });

  it("leaves out anybody with no Telegram — there is nowhere to send it", () => {
    const db = makeTestDb();
    const birthday = person(db, "Именинник", 1, "08-05");
    person(db, "Без телеграма", null, null);
    expect(teamRecipients(db, birthday)).toEqual([]);
  });

  it("nudges admins, but not an admin whose own birthday it is", () => {
    const db = makeTestDb();
    const birthdayAdmin = person(db, "Админ-именинник", 1, "08-05");
    const otherAdmin = person(db, "Другой админ", 2, null);
    person(db, "Обычный", 3, null);
    setEmployeeAdmin(db, birthdayAdmin, true);
    setEmployeeAdmin(db, otherAdmin, true);

    expect(adminRecipients(db, birthdayAdmin).map((e) => e.displayName)).toEqual(["Другой админ"]);
  });
});

describe("campaign", () => {
  it("creates one round per person per year, and reuses it", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-05");
    const first = ensureCampaign(db, id, ASOF)!;
    const again = ensureCampaign(db, id, ASOF)!;
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ year: 2026, celebratedOn: "2026-08-05", status: "pending" });
  });

  it("becomes «ready» once the link is in, and «pending» again if it is cleared", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-05");
    expect(updateCampaign(db, id, ASOF, { collectUrl: "https://sber/x" })!.status).toBe("ready");
    expect(updateCampaign(db, id, ASOF, { collectUrl: null })!.status).toBe("pending");
  });

  it("keeps the admin's own wording over the default", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-05");
    person(db, "Коллега", 2, null);
    updateCampaign(db, id, ASOF, { collectUrl: "https://sber/x", messageText: "Скидываемся Мишину!" });
    expect(previewCampaign(db, id, ASOF)!.message).toBe("Скидываемся Мишину!");
  });
});

describe("previewCampaign — what the admin sees before anything leaves", () => {
  it("shows the exact text and the exact recipients", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-05");
    person(db, "Первый", 2, null);
    person(db, "Второй", 3, null);
    updateCampaign(db, id, ASOF, { collectUrl: "https://sber/abc" });

    const preview = previewCampaign(db, id, ASOF)!;
    expect(preview.recipients.map((r) => r.displayName)).toEqual(["Первый", "Второй"]);
    expect(preview.message).toContain("5 августа");
    expect(preview.message).toContain("https://sber/abc");
    expect(preview.blocker).toBeNull();
  });

  it("blocks sending until there is a link", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-05");
    person(db, "Коллега", 2, null);
    expect(previewCampaign(db, id, ASOF)!.blocker).toMatch(/ссылк/i);
  });

  it("blocks sending when nobody is reachable", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-05");
    updateCampaign(db, id, ASOF, { collectUrl: "https://sber/x" });
    expect(previewCampaign(db, id, ASOF)!.blocker).toMatch(/некому/i);
  });

  it("blocks a second send, so nobody is congratulated twice", () => {
    const db = makeTestDb();
    const id = person(db, "Именинник", 1, "08-05");
    person(db, "Коллега", 2, null);
    const campaign = updateCampaign(db, id, ASOF, { collectUrl: "https://sber/x" })!;
    markSent(db, campaign.id, 1, new Date("2026-08-01T10:00:00Z"));

    const preview = previewCampaign(db, id, ASOF)!;
    expect(preview.blocker).toMatch(/уже разослано/i);
    expect(preview.alreadySentAt).toBeInstanceOf(Date);
  });
});

describe("wording", () => {
  it("names the person and the day, and carries the link when there is one", () => {
    expect(defaultMessage("Мишин Илья", "5 августа", "https://sber/x"))
      .toBe("🎂 Мишин Илья празднует день рождения 5 августа.\n\nСбор на подарок: https://sber/x");
    expect(defaultMessage("Мишин Илья", "5 августа", null)).not.toContain("Сбор");
  });

  it("leaves the name in the nominative — we cannot decline it", () => {
    // One display name is stored and nothing that would let us inflect it, so
    // every phrase has to be built around the name as given. «день рождения у
    // Мишин Илья» is the failure this guards, and it would land in 25 chats.
    for (const text of [
      defaultMessage("Мишин Илья", "5 августа", "https://sber/x"),
      adminNoticeMessage("Мишин Илья", "5 августа", 7),
    ]) {
      expect(text).toContain("Мишин Илья");
      expect(text).not.toMatch(/у Мишин Илья/);
    }
  });

  it("tells admins what to do next, not just that a birthday exists", () => {
    const notice = adminNoticeMessage("Мишин Илья", "5 августа", 7);
    expect(notice).toContain("через 7 дней");
    expect(notice).toContain("Сбербанк Онлайн");
    expect(notice).toMatch(/сам решишь, когда разослать/i);
  });
});
