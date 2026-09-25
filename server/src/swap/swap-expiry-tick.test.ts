import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { Bot } from "grammy";
import { recordApi, stubBotInfo } from "../bot/testbot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { getSwapRequest } from "../repo/swaps";
import { listRecentAudit } from "../repo/audit";
import { createSwap, cancelSwap } from "./swap-service";
import { swapRequests } from "../db/schema";
import { runSwapExpiryTick } from "./swap-expiry-tick";
import type { Db } from "../db/client";

/** Bot with botInfo set (skips getMe) and a transformer capturing outgoing sendMessage. */
function testBot() {
  const bot = stubBotInfo(new Bot("12345:tok"), { id: 42, first_name: "P", username: "p_bot" });
  const { sent } = recordApi(bot);
  return { bot, sent };
}

const ANYA_TG = 111;
const IGOR_TG = 222;

/** Pending swap between two linked employees, both shifts on `date`. Created
 *  with a `now` well before the shift so `createSwap`'s own "not in the past"
 *  checks pass — only `runSwapExpiryTick`'s own `now` matters after that. */
function pendingSwap(db: Db, date: string) {
  const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i-anya" });
  linkTelegramAccount(db, "i-anya", ANYA_TG);
  const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "i-igor" });
  linkTelegramAccount(db, "i-igor", IGOR_TG);
  const sa = createShift(db, { date, start: "08:00", end: "17:00", employeeId: anya.id });
  const sb = createShift(db, { date, start: "11:00", end: "20:00", employeeId: igor.id });
  const res = createSwap(db, { fromEmployeeId: anya.id, fromShiftId: sa.id, toShiftId: sb.id }, { date: "2026-01-01", time: "09:00" });
  if (!res.ok) throw new Error(`fixture setup failed: ${res.reason}`);
  return { anya, igor, request: res.request };
}

describe("runSwapExpiryTick", () => {
  it("гасит pending, у которого смена вчера, и пишет автору", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const { request } = pendingSwap(db, "2026-07-13");

    const n = await runSwapExpiryTick(db, bot, { date: "2026-07-14", time: "10:00" });

    expect(n).toBe(1);
    expect(getSwapRequest(db, request.id)!.status).toBe("expired");
    expect(sent.filter((m) => m.chat_id === ANYA_TG)).toHaveLength(1);
    expect(sent.filter((m) => m.chat_id === IGOR_TG)).toHaveLength(0);
    expect(listRecentAudit(db, 20).some((a) => a.type === "swap_expired")).toBe(true);
  });

  it("не трогает заявку на сегодняшнюю смену", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const { request } = pendingSwap(db, "2026-07-14");

    const n = await runSwapExpiryTick(db, bot, { date: "2026-07-14", time: "10:00" });

    expect(n).toBe(0);
    expect(getSwapRequest(db, request.id)!.status).toBe("pending");
    expect(sent).toHaveLength(0);
  });

  it("гасит молча, если смена прошла больше двух дней назад", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const { request } = pendingSwap(db, "2026-07-10");

    const n = await runSwapExpiryTick(db, bot, { date: "2026-07-14", time: "10:00" });

    expect(n).toBe(1);
    expect(getSwapRequest(db, request.id)!.status).toBe("expired");
    expect(sent).toHaveLength(0);
  });

  it("ровно два дня назад — ещё пишет", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    pendingSwap(db, "2026-07-12");

    const n = await runSwapExpiryTick(db, bot, { date: "2026-07-14", time: "10:00" });

    expect(n).toBe(1);
    expect(sent.filter((m) => m.chat_id === ANYA_TG)).toHaveLength(1);
  });

  it("заявку без смены (FK null) не трогает и не падает", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const { request } = pendingSwap(db, "2026-07-13");
    // Симулирует то, что после удаления смены оставляет FK: тик читает заявки
    // через innerJoin на обе смены, так что заявка без одной из них ему просто
    // не должна попасться — и не должна ронять остальной прогон.
    db.update(swapRequests).set({ toShiftId: null }).where(eq(swapRequests.id, request.id)).run();

    const n = await runSwapExpiryTick(db, bot, { date: "2026-07-14", time: "10:00" });
    expect(n).toBe(0);
    expect(getSwapRequest(db, request.id)!.status).toBe("pending");
    expect(sent).toHaveLength(0);
  });

  // Тик читает список pending-заявок один раз, а дальше на каждую await'ит
  // отправку письма — окно, за которое вторую заявку из той же пачки успевают
  // отменить с другого конца (HTTP или кнопка в боте). Безусловная запись
  // статуса переписала бы её обратно в "expired" поверх уже случившейся
  // отмены и наврала бы автору «ответа не было».
  it("не переписывает заявку, которую отменили, пока тик ждал отправку письма по другой", async () => {
    const db = makeTestDb();
    const { request: reqA } = pendingSwap(db, "2026-07-13");

    const mark = createEmployee(db, { displayName: "Марк", inviteToken: "i-mark" });
    linkTelegramAccount(db, "i-mark", 333);
    const semyon = createEmployee(db, { displayName: "Семён", inviteToken: "i-semyon" });
    linkTelegramAccount(db, "i-semyon", 444);
    const sm = createShift(db, { date: "2026-07-13", start: "09:00", end: "18:00", employeeId: mark.id });
    const ss = createShift(db, { date: "2026-07-13", start: "10:00", end: "19:00", employeeId: semyon.id });
    const resB = createSwap(db, { fromEmployeeId: mark.id, fromShiftId: sm.id, toShiftId: ss.id }, { date: "2026-01-01", time: "09:00" });
    if (!resB.ok) throw new Error(`fixture setup failed: ${resB.reason}`);
    const reqB = resB.request;
    expect(reqA.id).toBeLessThan(reqB.id); // порядок обхода тика — по id вставки

    const bot = stubBotInfo(new Bot("12345:tok"), { id: 42, first_name: "P", username: "p_bot" });
    const sent: { chat_id: number | string; text: string }[] = [];
    bot.api.config.use((_prev, method, payload) => {
      if (method === "sendMessage") {
        const p = payload as { chat_id: number | string; text: string };
        sent.push(p);
        // Письмо по A ушло — имитируем, что именно в этот момент Марк сам
        // отменил свою заявку B, ещё не дойдя до которой тик уже прочитал её
        // как pending в самом начале прогона.
        if (p.chat_id === ANYA_TG) cancelSwap(db, reqB.id, mark.id);
      }
      return { ok: true, result: {} } as any;
    });

    const n = await runSwapExpiryTick(db, bot, { date: "2026-07-14", time: "10:00" });

    expect(n).toBe(1); // погашена только A
    expect(getSwapRequest(db, reqA.id)!.status).toBe("expired");
    expect(getSwapRequest(db, reqB.id)!.status).toBe("cancelled"); // не переписано обратно
    expect(sent.filter((m) => m.chat_id === 333)).toHaveLength(0); // Марку письма про просрочку не было
    expect(listRecentAudit(db, 20).filter((a) => a.type === "swap_expired")).toHaveLength(1);
  });

  it("без бота гасит и журналит", async () => {
    const db = makeTestDb();
    const { request } = pendingSwap(db, "2026-07-13");

    const n = await runSwapExpiryTick(db, null, { date: "2026-07-14", time: "10:00" });

    expect(n).toBe(1);
    expect(getSwapRequest(db, request.id)!.status).toBe("expired");
    expect(listRecentAudit(db, 20).some((a) => a.type === "swap_expired")).toBe(true);
  });
});
