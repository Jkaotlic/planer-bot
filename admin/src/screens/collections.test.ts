import { describe, expect, it } from "vitest";
import {
  canCreate,
  cardSubject,
  moneyLine,
  recipientsPhrase,
  recipientsSubject,
  roundStatus,
  sendButtonLabel,
  statusOf,
  whenLabel,
} from "./CollectionsScreen";
import type { Collection, CollectionPreview, CollectionRow, UpcomingBirthday } from "../api/client";

/**
 * Суммы сравниваются с явным ` `: `formatMoney` разделяет разряды
 * неразрывным пробелом, и литерал, набранный обычным пробелом, выглядит
 * идентично, а тест валит.
 */

function collection(patch: Partial<Collection> = {}): Collection {
  return {
    id: 1, kind: "custom", employeeId: null, year: null, celebratedOn: null,
    title: "Кофемашина", eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
    closedAt: null, scheduledSendOn: null, scheduleNotifiedAt: null, autoSendOn: null, autoSentAt: null,
    sentAt: null, sentCount: 0, sendCount: 0, createdAt: "2026-08-01T10:00:00Z",
    ...patch,
  };
}

function row(patch: Partial<CollectionRow> = {}): CollectionRow {
  const base = patch.collection ?? collection();
  return {
    collection: base,
    personName: null,
    title: base.title ?? "Сбор",
    status: "pending",
    active: true,
    ...patch,
  };
}

function preview(patch: Partial<CollectionPreview> = {}): CollectionPreview {
  return {
    id: 1, kind: "custom", title: "Кофемашина", personName: null, employeeId: null,
    collectUrl: "https://sber.ru/x", message: "текст сбора",
    recipients: [
      { employeeId: 2, displayName: "Первый Коллега" },
      { employeeId: 3, displayName: "Второй Коллега" },
    ],
    blocker: null, sendCount: 0, lastSentAt: null,
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
    expect(statusOf(row({ status: "pending" }))).toEqual({ label: "Нет ссылки на сбор", tone: "pending" });
  });

  it("goes to «готово» once a link is in, without sending anything", () => {
    expect(statusOf(row({ status: "ready", collection: collection({ collectUrl: "https://sber.ru/x" }) })))
      .toEqual({ label: "Готово к отправке", tone: "ready" });
  });

  it("reports how many were reached once it has gone out", () => {
    // sentCount (до скольких дошло) и sendCount (сколько было рассылок) —
    // разные числа, и в фикстуре они разные намеренно: чип показывает первое.
    const sent = collection({ collectUrl: "https://sber.ru/x", sentCount: 5, sendCount: 2 });
    expect(statusOf(row({ status: "sent", collection: sent }))).toEqual({ label: "Разослано · 5", tone: "sent" });
  });

  it("закрытый читается закрытым, а не «разослано»", () => {
    const closed = collection({ collectUrl: "https://x", sentCount: 5, sendCount: 1, closedAt: "2026-08-20T10:00:00Z" });
    expect(statusOf(row({ status: "sent", collection: closed, active: false })))
      .toEqual({ label: "Закрыт", tone: "pending" });
  });
});

describe("roundStatus", () => {
  const today = "2026-08-01";

  it("несохранённого раунда ещё нет — и это «нет ссылки», а не пустой чип", () => {
    expect(roundStatus(null, today)).toEqual({ label: "Нет ссылки на сбор", tone: "pending" });
  });

  it("считает статус и активность сам, из полей раунда", () => {
    const round = collection({ kind: "birthday", employeeId: 2, celebratedOn: "2026-08-05", title: null });
    expect(roundStatus(round, today)).toEqual({ label: "Нет ссылки на сбор", tone: "pending" });
    expect(roundStatus({ ...round, collectUrl: "https://x" }, today)).toEqual({ label: "Готово к отправке", tone: "ready" });
    expect(roundStatus({ ...round, collectUrl: "https://x", sendCount: 1, sentCount: 4 }, today))
      .toEqual({ label: "Разослано · 4", tone: "sent" });
  });

  it("раунд, у которого праздник уже прошёл, закрыт — иначе прошлогодний читался бы как живой", () => {
    const round = collection({
      kind: "birthday", employeeId: 2, celebratedOn: "2026-07-30", title: null,
      collectUrl: "https://x", sendCount: 1, sentCount: 5,
    });
    expect(roundStatus(round, today)).toEqual({ label: "Закрыт", tone: "pending" });
  });
});

describe("moneyLine", () => {
  it("склеивает то, что заполнено, и молчит, когда не заполнено ничего", () => {
    expect(moneyLine({ amountPerPerson: 1000, totalGoal: 25000 }))
      .toBe("по 1\u00A0000\u00A0₽ · нужно 25\u00A0000\u00A0₽");
    expect(moneyLine({ amountPerPerson: 1000, totalGoal: null })).toBe("по 1\u00A0000\u00A0₽");
    expect(moneyLine({ amountPerPerson: null, totalGoal: 25000 })).toBe("нужно 25\u00A0000\u00A0₽");
    expect(moneyLine({ amountPerPerson: null, totalGoal: null })).toBeNull();
  });
});

describe("cardSubject", () => {
  it("называет виновника через тире, а общий сбор оставляет как есть", () => {
    // Та же форма, что в письме команде: «Свадьба — Пётр Иванов».
    expect(cardSubject({ title: "Свадьба", personName: "Пётр Иванов" })).toBe("Свадьба — Пётр Иванов");
    expect(cardSubject({ title: "Кофемашина", personName: null })).toBe("Кофемашина");
  });
});

describe("canCreate", () => {
  it("повод из пробелов — не повод", () => {
    expect(canCreate("")).toBe(false);
    expect(canCreate("   ")).toBe(false);
    expect(canCreate("Кофемашина")).toBe(true);
  });
});

describe("sendButtonLabel", () => {
  it("первая рассылка называет число получателей", () => {
    expect(sendButtonLabel(preview({ sendCount: 0, lastSentAt: null }))).toBe("Разослать 2 коллегам");
  });

  it("дожим честно говорит, что уже рассылали и когда", () => {
    expect(sendButtonLabel(preview({ sendCount: 1, lastSentAt: "2026-08-12T09:00:00Z" })))
      .toBe("Напомнить ещё раз · рассылалось 12 августа");
  });

  it("дожим без даты последней рассылки не дописывает хвост-обрубок", () => {
    expect(sendButtonLabel(preview({ sendCount: 2, lastSentAt: null }))).toBe("Напомнить ещё раз");
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

  /**
   * В дательном падеже нет различия 2–4 / 5+ (в отличие от `recipientsSubject`
   * выше) — единственная граница «оканчивается на 1, кроме 11». До этого теста
   * функция проверяла ровно `count === 1`, и команда из 21 человека читала
   * «Отправить 21 коллегам?» — не гипотетический случай: в команде 32 человека.
   */
  it("«оканчивается на 1, кроме 11» — граница, а не только count === 1", () => {
    expect(recipientsPhrase(1)).toBe("1 коллеге");
    expect(recipientsPhrase(2)).toBe("2 коллегам");
    expect(recipientsPhrase(5)).toBe("5 коллегам");
    expect(recipientsPhrase(11)).toBe("11 коллегам");
    expect(recipientsPhrase(21)).toBe("21 коллеге");
    expect(recipientsPhrase(32)).toBe("32 коллегам");
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

// The Mini App carries its own copy of these helpers on purpose — it depends on
// neither this console nor its styles. The identical expectations live in
// miniapp/src/screens/admin/collections.test.ts and collection-form.test.tsx;
// if the two ever disagree, one of the files starts failing. The one deliberate
// difference is the chip's wording — this console says «Нет ссылки на сбор» and
// «Готово к отправке», the phone says «Нет ссылки» and «Готово», because there
// the chip shares its row with the name and the date.
