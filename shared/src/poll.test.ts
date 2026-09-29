import { describe, it, expect } from "vitest";
import { closesAtFromTime, closesLabel, isFutureClose, isOpenAt, pollInviteText, pollResultText, pollTally } from "./poll";

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

describe("closesAtFromTime / closesLabel", () => {
  it("время дня превращается в командный момент и обратно в подпись", () => {
    expect(closesAtFromTime("12:30", "2026-09-29")).toBe("2026-09-29T12:30");
    expect(closesAtFromTime(null, "2026-09-29")).toBeNull();
    expect(closesLabel("2026-09-29T12:30", "2026-09-29")).toBe("до 12:30");
    expect(closesLabel("2026-09-30T09:00", "2026-09-29")).toBe("до 30 сентября, 09:00");
    expect(closesLabel(null, "2026-09-29")).toBeNull();
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
