import { describe, expect, it } from "vitest";
import { recipientsPhrase, recipientsSubject, whenLabel } from "./AdminCollections";
import type { UpcomingBirthday } from "../../api/client";

function birthday(patch: Partial<UpcomingBirthday> = {}): UpcomingBirthday {
  return {
    employeeId: 2, displayName: "Игорь Петров", birthDate: "08-05",
    birthDateLabel: "5 августа", celebratedOn: "2026-08-05", daysUntil: 4,
    campaign: null,
    ...patch,
  };
}

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

// The console carries its own copy of the three helpers above on purpose — this
// app depends on neither it nor its styles. The identical expectations live in
// admin/src/screens/collections.test.ts; if the two ever disagree, one of the
// two files starts failing.
//
// `statusOf` used to live here too. It moved to `collection-form.test.tsx`
// together with the rest of the collection helpers: it no longer reads a
// birthday round but a row of the shared collections list, and keeping two
// suites over one function is how the two drift apart. The console's chip
// wording is deliberately longer than this one's — «Нет ссылки на сбор» and
// «Готово к отправке» — because on a phone the chip shares its row with the
// name and the date.
//
// `isCurrentRound` is gone with the campaign list it guarded: a row now opens
// its own editor by collection id, so there is no longer a way to route one
// round through another round's editor.
