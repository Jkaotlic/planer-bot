import { describe, it, expect, vi } from "vitest";

// Сбой посередине архивации: шаг снятия откликов падает. Раньше к этому
// моменту обмен уже был погашен отдельной транзакцией — молча, без письма и
// журнала, а человек оставался в команде. Всё — одной транзакцией.
const failing = vi.hoisted(() => ({ on: false }));
vi.mock("../repo/weekend", async (importOriginal) => {
  const real = await importOriginal<typeof import("../repo/weekend")>();
  return {
    ...real,
    removeAllInterestOf: (...args: Parameters<typeof real.removeAllInterestOf>) => {
      if (failing.on) throw new Error("сбой посередине");
      return real.removeAllInterestOf(...args);
    },
  };
});

import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { swapRequests } from "../db/schema";
import { createEmployee, linkTelegramAccount, getEmployeeById } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { createSwapRequest } from "../repo/swaps";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const inDays = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(d);
};

describe("архивация — всё или ничего", () => {
  it("сбой посередине не гасит обмен молча и не архивирует наполовину", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = (await (await app.request(new Request("http://x/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(111) }) }))).json()).token as string;
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i-a" });
    linkTelegramAccount(db, "i-a", 821);
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "i-i" });
    linkTelegramAccount(db, "i-i", 822);
    const a = createShift(db, { date: inDays(3), start: "08:00", end: "17:00", employeeId: anya.id });
    const b = createShift(db, { date: inDays(3), start: "12:00", end: "21:00", employeeId: igor.id });
    const swap = createSwapRequest(db, { fromEmployeeId: anya.id, fromShiftId: a.id, toEmployeeId: igor.id, toShiftId: b.id });
    failing.on = true;

    const res = await app.request(`/api/admin/employees/${anya.id}/archive`, {
      method: "POST", headers: { Authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: "{}",
    });
    failing.on = false;

    expect(res.status).toBe(500);
    expect(db.select().from(swapRequests).all().find((r) => r.id === swap.id)!.status).toBe("pending");
    expect(getEmployeeById(db, anya.id)!.isActive).toBe(true);
  });
});
