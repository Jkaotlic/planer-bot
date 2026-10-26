import { describe, it, expect } from "vitest";
import { closesAtFromTime, closesLabel, closesLetterLabel, isFutureClose, isOpenAt, isWithinCloseHorizon, pollInviteText, pollResultText, pollTally, pollTallyLines, POLL_CHOICES_HINT } from "./poll";
import { TELEGRAM_TEXT_SAFE_MAX } from "./text-limits";

const now = { date: "2026-09-29", time: "12:00" };

describe("isOpenAt", () => {
  it("без срока открыт, пока не закрыт и не отменён", () => {
    expect(isOpenAt({ closesAt: null, closedAt: null, cancelledAt: null }, now)).toBe(true);
    expect(isOpenAt({ closesAt: null, closedAt: new Date(), cancelledAt: null }, now)).toBe(false);
    expect(isOpenAt({ closesAt: null, closedAt: null, cancelledAt: "2026-09-29T09:00:00Z" }, now)).toBe(false);
  });

  it("срок в ту же минуту уже закрывает — «до 12:00» значит в 12:00 поздно", () => {
    expect(isOpenAt({ closesAt: "2026-09-29T12:01", closedAt: null, cancelledAt: null }, now)).toBe(true);
    expect(isOpenAt({ closesAt: "2026-09-29T12:00", closedAt: null, cancelledAt: null }, now)).toBe(false);
    expect(isOpenAt({ closesAt: "2026-09-28T18:00", closedAt: null, cancelledAt: null }, now)).toBe(false);
  });
});

describe("isFutureClose", () => {
  it("пустой срок всегда в будущем", () => {
    expect(isFutureClose(null, now)).toBe(true);
  });

  it("та же минута и прошлое — уже не в будущем", () => {
    expect(isFutureClose("2026-09-29T12:00", now)).toBe(false);
    expect(isFutureClose("2026-09-29T08:00", now)).toBe(false);
    expect(isFutureClose("2026-09-28T23:59", now)).toBe(false);
  });

  it("минута спустя — ещё в будущем", () => {
    expect(isFutureClose("2026-09-29T12:01", now)).toBe(true);
  });
});

describe("closesAtFromTime", () => {
  const noon = { date: "2026-10-26", time: "12:00" };

  it("время позже текущего — сегодня", () => {
    expect(closesAtFromTime("13:00", noon)).toBe("2026-10-26T13:00");
  });

  it("время раньше текущего — завтра, а не опрос, закрытый в момент рождения", () => {
    expect(closesAtFromTime("08:00", noon)).toBe("2026-10-27T08:00");
  });

  it("та же минута — завтра: «до 12:00» в 12:00 уже поздно, как у isOpenAt", () => {
    expect(closesAtFromTime("12:00", noon)).toBe("2026-10-27T12:00");
  });

  it("23:30 в 23:45 — завтра, через границу месяца; 08:00 в 00:10 — сегодня", () => {
    expect(closesAtFromTime("23:30", { date: "2026-10-31", time: "23:45" })).toBe("2026-11-01T23:30");
    expect(closesAtFromTime("08:00", { date: "2026-10-27", time: "00:10" })).toBe("2026-10-27T08:00");
  });

  it("без времени — без срока", () => {
    expect(closesAtFromTime(null, noon)).toBeNull();
  });
});

describe("closesLabel", () => {
  it("сегодня — только время, завтра — «завтра», дальше — дата", () => {
    expect(closesLabel("2026-09-29T12:30", "2026-09-29")).toBe("до 12:30");
    expect(closesLabel("2026-09-30T09:00", "2026-09-29")).toBe("до завтра, 09:00");
    expect(closesLabel("2026-10-01T09:00", "2026-09-29")).toBe("до 1 октября, 09:00");
    expect(closesLabel(null, "2026-09-29")).toBeNull();
  });

  it("«завтра» считается через границу месяца", () => {
    expect(closesLabel("2026-11-01T23:30", "2026-10-31")).toBe("до завтра, 23:30");
  });
});

describe("closesLetterLabel — срок в письме бота", () => {
  // Письмо читают позже, чем отправили: «до завтра» из письма, ушедшего в 23:50,
  // утром значило бы послезавтра. Поэтому не сегодня — только абсолютным днём.
  it("в день отправки — только время; иначе — день недели и дата, без «завтра»", () => {
    expect(closesLetterLabel("2026-10-26T18:00", "2026-10-26")).toBe("до 18:00");
    expect(closesLetterLabel("2026-10-27T08:00", "2026-10-26")).toBe("до Вт 27 октября, 08:00");
    expect(closesLetterLabel("2026-11-01T23:30", "2026-10-31")).toBe("до Вс 1 ноября, 23:30");
    expect(closesLetterLabel(null, "2026-10-26")).toBeNull();
  });
});

describe("pollTally", () => {
  const people = [
    { employeeId: 1, displayName: "Аня" },
    { employeeId: 2, displayName: "Игорь" },
    { employeeId: 3, displayName: "Марк" },
    { employeeId: 4, displayName: "Лена" },
  ];

  it("раскладывает по голосам, не ответивших — отдельно", () => {
    const tally = pollTally(people, [
      { employeeId: 1, choice: "for" },
      { employeeId: 2, choice: "against" },
      { employeeId: 3, choice: "for" },
    ]);
    expect(tally).toEqual({ for: ["Аня", "Марк"], against: ["Игорь"], abstain: [], silent: ["Лена"] });
  });

  it("голос человека, которого уже нет в адресатах, не считается — иначе «5 из 4»", () => {
    const tally = pollTally(people.slice(0, 1), [{ employeeId: 9, choice: "for" }]);
    expect(tally).toEqual({ for: [], against: [], abstain: [], silent: ["Аня"] });
  });
});

describe("тексты", () => {
  it("приглашение говорит, кто спрашивает, до какого времени и что выбрал ты", () => {
    const text = pollInviteText({ creatorName: "Аня", question: "Корпоратив в пятницу?", closes: "до 18:00", myChoice: "for" });
    expect(text).toContain("Аня спрашивает");
    expect(text).toContain("Корпоратив в пятницу?");
    expect(text).toContain("до 18:00");
    expect(text).toContain("Твой голос: 👍 За");
  });

  it("без голоса строки «Твой голос» нет", () => {
    expect(pollInviteText({ creatorName: "Аня", question: "?", closes: null, myChoice: null })).not.toContain("Твой голос");
  });

  it("итог перечисляет всех по группам и пропускает пустые", () => {
    const text = pollResultText("Пицца?", { for: ["Аня", "Марк"], against: [], abstain: ["Игорь"], silent: ["Лена"] });
    expect(text).toContain("👍 За — 2: Аня, Марк");
    expect(text).not.toContain("Против");
    expect(text).toContain("🤷 Воздержались — 1: Игорь");
    expect(text).toContain("Не ответили — 1: Лена");
  });
});

describe("pollTallyLines", () => {
  it("строка на непустую группу, в порядке За / Против / Воздержались / Не ответили", () => {
    const lines = pollTallyLines({ for: ["Аня", "Игорь"], against: [], abstain: ["Марк"], silent: ["Лена"] });
    expect(lines).toEqual(["👍 За — 2: Аня, Игорь", "🤷 Воздержались — 1: Марк", "Не ответили — 1: Лена"]);
  });

  it("итог письма — те же строки под заголовком: карточка и бот не разъезжаются", () => {
    const tally = { for: ["Аня"], against: ["Игорь"], abstain: [], silent: [] };
    expect(pollResultText("Обед?", tally)).toBe(["📊 Итоги опроса: Обед?", "", ...pollTallyLines(tally)].join("\n"));
  });

  it("итог на 60 адресатов с именами по 100 знаков — одно письмо в пределе, хвосты групп свёрнуты", () => {
    // Имя в 100 знаков — потолок `EMPLOYEE_NAME_MAX`; 60 таких без свёртки — больше 6000 знаков.
    const names = Array.from({ length: 60 }, (_, i) => `Аня ${String(i).padStart(2, "0")} `.padEnd(100, "я"));
    const tally = { for: names.slice(0, 20), against: names.slice(20, 30), abstain: names.slice(30, 40), silent: names.slice(40) };
    const text = pollResultText("Пицца?", tally);
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_SAFE_MAX);
    // Счёт — всегда за всю группу: свёртка прячет имена, а не голоса.
    expect(text).toContain("👍 За — 20: ");
    expect(text).toContain("👎 Против — 10: ");
    expect(text).toContain("🤷 Воздержались — 10: ");
    expect(text).toContain("Не ответили — 20: ");
    expect(text).toContain(names[0]);
    const shown = names.filter((n) => text.includes(n)).length;
    const hidden = [...text.matchAll(/…и ещё (\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(shown).toBeGreaterThan(0);
    expect(shown + hidden).toBe(60);
    expect(text).toContain("Все имена — в мини-аппе: «📋 Заказы и опросы».");
  });

  it("влезающий итог не свёрнут и без строки про мини-апп", () => {
    const text = pollResultText("Обед?", { for: ["Аня", "Игорь"], against: [], abstain: [], silent: ["Марк"] });
    expect(text).not.toContain("…и ещё");
    expect(text).not.toContain("мини-апп");
  });

  it("карточка получает все имена: свёртка — только у письма", () => {
    const names = Array.from({ length: 60 }, (_, i) => `Аня ${i} `.padEnd(100, "я"));
    const lines = pollTallyLines({ for: names, against: [], abstain: [], silent: [] });
    expect(lines).toEqual([`👍 За — 60: ${names.join(", ")}`]);
  });

  it("подсказка формы перечисляет ровно кнопки голоса", () => {
    expect(POLL_CHOICES_HINT).toBe("Ответы: 👍 За · 👎 Против · 🤷 Воздержался");
  });
});

describe("горизонт срока", () => {
  it("ровно 14 дней — да, 15-й день — нет, без срока — да", () => {
    expect(isWithinCloseHorizon("2026-10-22T23:59", "2026-10-08")).toBe(true);
    expect(isWithinCloseHorizon("2026-10-23T00:00", "2026-10-08")).toBe(false);
    expect(isWithinCloseHorizon(null, "2026-10-08")).toBe(true);
  });
});
