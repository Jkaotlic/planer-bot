import { describe, expect, it } from "vitest";
import { recipientsPhrase, recipientsSubject, statusOf, whenLabel } from "./AdminBirthdays";
import type { BirthdayCampaign, UpcomingBirthday } from "../../api/client";

function campaign(patch: Partial<BirthdayCampaign> = {}): BirthdayCampaign {
  return {
    id: 1, employeeId: 2, year: 2026, celebratedOn: "2026-08-05",
    collectUrl: null, messageText: null, status: "pending",
    adminNotifiedAt: null, sentAt: null, sentCount: 0,
    ...patch,
  };
}

function birthday(patch: Partial<UpcomingBirthday> = {}): UpcomingBirthday {
  return {
    employeeId: 2, displayName: "Игорь Петров", birthDate: "08-05",
    birthDateLabel: "5 августа", celebratedOn: "2026-08-05", daysUntil: 4,
    campaign: null,
    ...patch,
  };
}

describe("statusOf", () => {
  it("says the link is missing before anything else — it is what blocks sending", () => {
    expect(statusOf(birthday())).toEqual({ label: "Нет ссылки", tone: "pending" });
    expect(statusOf(birthday({ campaign: campaign() }))).toEqual({ label: "Нет ссылки", tone: "pending" });
  });

  it("goes to «готово» once a link is in, without sending anything", () => {
    const ready = birthday({ campaign: campaign({ collectUrl: "https://sber.ru/x", status: "ready" }) });
    expect(statusOf(ready)).toEqual({ label: "Готово", tone: "ready" });
  });

  it("reports how many were reached once it has gone out", () => {
    const sent = birthday({ campaign: campaign({ collectUrl: "https://sber.ru/x", status: "sent", sentCount: 5 }) });
    expect(statusOf(sent)).toEqual({ label: "Разослано · 5", tone: "sent" });
  });

  it("keeps «разослано» even if the link was later cleared", () => {
    // Sending is one-way: a campaign that has gone out must never read as
    // «готово к отправке» again, whatever else changes on it.
    const sent = birthday({ campaign: campaign({ collectUrl: null, status: "sent", sentCount: 3 }) });
    expect(statusOf(sent).tone).toBe("sent");
  });
});

describe("whenLabel", () => {
  it("puts the date and the countdown on one line", () => {
    expect(whenLabel(birthday())).toBe("5 августа · через 4 дня");
    expect(whenLabel(birthday({ daysUntil: 0 }))).toBe("5 августа · сегодня");
    expect(whenLabel(birthday({ daysUntil: 1 }))).toBe("5 августа · завтра");
  });
});

describe("recipientsPhrase", () => {
  it("is written in the dative, which is how the button reads", () => {
    expect(recipientsPhrase(1)).toBe("1 коллеге");
    expect(recipientsPhrase(5)).toBe("5 коллегам");
    expect(recipientsPhrase(0)).toBe("0 коллегам");
  });
});

describe("recipientsSubject", () => {
  it("is the nominative, which is what «Получат …» needs", () => {
    expect(recipientsSubject(1)).toBe("1 коллега");
    expect(recipientsSubject(2)).toBe("2 коллеги");
    expect(recipientsSubject(4)).toBe("4 коллеги");
    expect(recipientsSubject(5)).toBe("5 коллег");
    expect(recipientsSubject(0)).toBe("0 коллег");
  });

  it("takes «коллег» for 11–14, which end in 1–4 but decline like 5", () => {
    expect(recipientsSubject(11)).toBe("11 коллег");
    expect(recipientsSubject(12)).toBe("12 коллег");
    expect(recipientsSubject(14)).toBe("14 коллег");
    expect(recipientsSubject(21)).toBe("21 коллега");
    expect(recipientsSubject(22)).toBe("22 коллеги");
    expect(recipientsSubject(26)).toBe("26 коллег");
  });
});

// The console carries its own copy of these four helpers on purpose — this app
// depends on neither it nor its styles. The identical expectations live in
// admin/src/screens/birthdays.test.ts; if the two ever disagree, one of the two
// files starts failing. The one deliberate difference is the chip's wording —
// «Нет ссылки» and «Готово» rather than «Нет ссылки на сбор» and «Готово к
// отправке» — because on a phone the chip shares its row with the name and date.
