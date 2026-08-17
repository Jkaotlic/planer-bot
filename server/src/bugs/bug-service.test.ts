import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import {
  BUG_PENDING_TTL_MS, BUG_REPORTS_PER_HOUR, BUG_TEXT_MAX,
  openBugPrompt, getBugPending, clearBugPending, shouldCapture,
  submitBugReport, listBugReports, resolveBugReport,
} from "./bug-service";

const T0 = new Date("2026-08-17T10:00:00Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);

describe("окно ожидания багрепорта", () => {
  it("без нажатой кнопки ловить нечего", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    expect(getBugPending(db, marc.id)).toBeNull();
  });

  it("свежее окно ловит обычное сообщение", () => {
    const pending = { promptMessageId: 77, createdAt: T0 };
    expect(shouldCapture(pending, undefined, plus(60_000))).toBe(true);
  });

  it("окно старше 15 минут обычное сообщение не ловит", () => {
    const pending = { promptMessageId: 77, createdAt: T0 };
    expect(shouldCapture(pending, undefined, plus(BUG_PENDING_TTL_MS + 1))).toBe(false);
  });

  // Реплай — однозначное доказательство намерения: человек ответил именно на
  // приглашение. Возраст тут ни при чём, поэтому окно на него не распространяется.
  it("реплай на приглашение ловится и через сутки", () => {
    const pending = { promptMessageId: 77, createdAt: T0 };
    expect(shouldCapture(pending, 77, plus(24 * 3600_000))).toBe(true);
  });

  it("реплай на чужое сообщение — не багрепорт", () => {
    const pending = { promptMessageId: 77, createdAt: T0 };
    expect(shouldCapture(pending, 999, plus(BUG_PENDING_TTL_MS + 1))).toBe(false);
  });

  it("второе нажатие заменяет окно, а не заводит второе", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    openBugPrompt(db, marc.id, 10, T0);
    openBugPrompt(db, marc.id, 20, T0);
    expect(getBugPending(db, marc.id)?.promptMessageId).toBe(20);
  });

  // Не в брифе дословно: `clearBugPending` в исходном списке тестов брифа
  // импортировался, но нигде не вызывался — biome валит такой импорт как
  // мёртвый. Дописано в этом же заходе, а не подавлено линтером: раз функция
  // в интерфейсе задачи, у неё должен быть тест, доказывающий, что она правда
  // снимает окно, а не просто существует.
  it("clearBugPending снимает окно совсем — обычное сообщение больше не ловится", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    openBugPrompt(db, marc.id, 10, T0);
    clearBugPending(db, marc.id);
    expect(getBugPending(db, marc.id)).toBeNull();
  });
});

describe("приём багрепорта", () => {
  it("сохраняет текст и отдаёт запись", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    const res = submitBugReport(db, marc.id, "Кнопка «График» рисует прошлую неделю", T0);
    expect(res.ok).toBe(true);
    expect(listBugReports(db, "open")).toHaveLength(1);
  });

  it("пустой текст не принимается", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    const res = submitBugReport(db, marc.id, "   ", T0);
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("пуст") });
  });

  it("слишком длинный текст отклоняется с внятным ответом", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    const res = submitBugReport(db, marc.id, "я".repeat(BUG_TEXT_MAX + 1), T0);
    expect(res.ok).toBe(false);
  });

  it("шестой за час отклоняется, а через час снова можно", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    for (let i = 0; i < BUG_REPORTS_PER_HOUR; i += 1) {
      expect(submitBugReport(db, marc.id, `баг ${i}`, plus(i * 1000)).ok).toBe(true);
    }
    expect(submitBugReport(db, marc.id, "шестой", plus(6000)).ok).toBe(false);
    expect(submitBugReport(db, marc.id, "через час", plus(3600_001)).ok).toBe(true);
  });

  it("потолок считается по человеку, а не на всех сразу", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "i2" });
    for (let i = 0; i < BUG_REPORTS_PER_HOUR; i += 1) submitBugReport(db, marc.id, `баг ${i}`, plus(i * 1000));
    expect(submitBugReport(db, igor.id, "мой первый", plus(6000)).ok).toBe(true);
  });
});

describe("статус багрепорта", () => {
  it("«Разобрал» и обратно, с отметкой кем", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i2", isAdmin: true });
    const created = submitBugReport(db, marc.id, "что-то сломалось", T0);
    if (!created.ok) throw new Error("не создался");

    const done = resolveBugReport(db, created.report.id, anya.id, true, plus(1000));
    expect(done?.resolvedByEmployeeId).toBe(anya.id);
    expect(listBugReports(db, "open")).toHaveLength(0);
    expect(listBugReports(db, "all")).toHaveLength(1);

    const back = resolveBugReport(db, created.report.id, anya.id, false, plus(2000));
    expect(back?.resolvedAt).toBeNull();
    expect(listBugReports(db, "open")).toHaveLength(1);
  });
});
