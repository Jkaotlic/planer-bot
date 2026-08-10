import { describe, expect, it } from "vitest";
import { canCreate, moneyLine, roundStatus, sendButtonLabel, statusOf } from "./AdminCollections";
import type { Collection, CollectionPreview, CollectionRow } from "../../api/client";

/**
 * Чистые хелперы раздела «Сборы».
 *
 * Суммы сравниваются с явным ` `: `formatMoney` разделяет разряды
 * неразрывным пробелом, и литерал, набранный обычным пробелом, выглядит
 * идентично, а тест валит. Этот класс ловили уже трижды — поэтому здесь
 * escape, а не невидимый символ.
 */

function collection(patch: Partial<Collection> = {}): Collection {
  return {
    id: 1, kind: "custom", employeeId: null, year: null, celebratedOn: null,
    title: "Кофемашина", eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
    closedAt: null, scheduledSendOn: null, scheduleNotifiedAt: null,
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

describe("canCreate", () => {
  it("повод из пробелов — не повод", () => {
    expect(canCreate("")).toBe(false);
    expect(canCreate("   ")).toBe(false);
    expect(canCreate("Кофемашина")).toBe(true);
  });
});

describe("moneyLine", () => {
  it("склеивает то, что заполнено, и молчит, когда не заполнено ничего", () => {
    expect(moneyLine({ amountPerPerson: 1000, totalGoal: 25000 }))
      .toBe("по 1 000 ₽ · нужно 25 000 ₽");
    expect(moneyLine({ amountPerPerson: 1000, totalGoal: null })).toBe("по 1 000 ₽");
    expect(moneyLine({ amountPerPerson: null, totalGoal: 25000 })).toBe("нужно 25 000 ₽");
    expect(moneyLine({ amountPerPerson: null, totalGoal: null })).toBeNull();
  });

  it("ноль — это заполненное поле, а не пустое", () => {
    // `if (c.amountPerPerson)` вместо `!= null` съел бы бесплатный сбор молча.
    expect(moneyLine({ amountPerPerson: 0, totalGoal: null })).toBe("по 0 ₽");
  });
});

describe("sendButtonLabel", () => {
  it("первая рассылка называет число получателей", () => {
    expect(sendButtonLabel(preview({ sendCount: 0, lastSentAt: null })))
      .toBe("Разослать 2 коллегам");
  });

  it("дожим честно говорит, что уже рассылали и когда", () => {
    expect(sendButtonLabel(preview({ sendCount: 1, lastSentAt: "2026-08-12T09:00:00Z" })))
      .toBe("Напомнить ещё раз · рассылалось 12 августа");
  });

  it("дожим без даты последней рассылки не дописывает хвост-обрубок", () => {
    expect(sendButtonLabel(preview({ sendCount: 2, lastSentAt: null }))).toBe("Напомнить ещё раз");
  });
});

describe("statusOf", () => {
  it("без ссылки говорит именно про ссылку — она и блокирует рассылку", () => {
    expect(statusOf(row({ status: "pending" }))).toEqual({ label: "Нет ссылки", tone: "pending" });
  });

  it("со ссылкой — «Готово», ничего никому при этом не уходило", () => {
    expect(statusOf(row({ status: "ready", collection: collection({ collectUrl: "https://x" }) })))
      .toEqual({ label: "Готово", tone: "ready" });
  });

  it("после рассылки называет, до скольких коллег дошло", () => {
    // sentCount (сколько человек получили) и sendCount (сколько было рассылок) —
    // разные числа, и в фикстуре они РАЗНЫЕ намеренно: чип обязан показывать
    // первое. Совпадающие значения пропустили бы подмену одного другим.
    const sent = collection({ collectUrl: "https://x", sentCount: 5, sendCount: 2 });
    expect(statusOf(row({ status: "sent", collection: sent }))).toEqual({ label: "Разослано · 5", tone: "sent" });
  });

  it("закрытый сбор читается закрытым, а не «разослано»", () => {
    const sent = collection({ collectUrl: "https://x", sentCount: 5, sendCount: 1, closedAt: "2026-08-20T10:00:00Z" });
    expect(statusOf(row({ status: "sent", collection: sent, active: false })))
      .toEqual({ label: "Закрыт", tone: "pending" });
  });
});

describe("roundStatus", () => {
  const today = "2026-08-01";

  it("несохранённого раунда ещё нет — и это «нет ссылки», а не пустой чип", () => {
    expect(roundStatus(null, today)).toEqual({ label: "Нет ссылки", tone: "pending" });
  });

  it("считает статус и активность сам, из полей раунда", () => {
    const round = collection({ kind: "birthday", employeeId: 2, celebratedOn: "2026-08-05", title: null });
    expect(roundStatus(round, today)).toEqual({ label: "Нет ссылки", tone: "pending" });
    expect(roundStatus({ ...round, collectUrl: "https://x" }, today)).toEqual({ label: "Готово", tone: "ready" });
    expect(roundStatus({ ...round, collectUrl: "https://x", sendCount: 1, sentCount: 4 }, today))
      .toEqual({ label: "Разослано · 4", tone: "sent" });
  });

  it("раунд, у которого праздник уже прошёл, закрыт — иначе прошлогодний читался бы как живой", () => {
    const round = collection({ kind: "birthday", employeeId: 2, celebratedOn: "2026-07-30", title: null, collectUrl: "https://x", sendCount: 1, sentCount: 5 });
    expect(roundStatus(round, today)).toEqual({ label: "Закрыт", tone: "pending" });
  });
});
