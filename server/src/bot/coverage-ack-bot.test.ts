import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import { acknowledgedCoverageDates } from "../repo/settings";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

/** Кнопка «Знаю про дд.мм» под советом о пробелах. */
const config = testConfig();
let updateId = 1;

async function tap(bot: Bot, from: number, data: string) {
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: String(updateId), from: { id: from, is_bot: false, first_name: "T" }, chat_instance: "1", data,
      message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: from, type: "private" }, from: { id: 1, is_bot: true, first_name: "P" }, text: "…" },
    },
  } as never);
}

function stage() {
  const db: Db = makeTestDb();
  const admin = createEmployee(db, { displayName: "Аня", inviteToken: "inv-111" });
  linkTelegramAccount(db, "inv-111", 111);
  setEmployeeAdmin(db, admin.id, true);
  createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
  linkTelegramAccount(db, "inv-333", 333);
  const bot = stubBotInfo(createBot({ db, config }), { id: 1, first_name: "P", username: "p_bot" });
  return { db, bot, api: recordApi(bot) };
}

describe("«Знаю про этот день»", () => {
  it("админ нажал — дата заглушена, ответ называет её", async () => {
    const { db, bot, api } = stage();
    await tap(bot, 111, "coverage:ack:2026-09-07");
    expect(acknowledgedCoverageDates(db, ["2026-09-07"]).has("2026-09-07")).toBe(true);
    expect(api.answers.join(" ")).toContain("07.09");
  });

  it("работник нажать не может — совет админский", async () => {
    const { db, bot } = stage();
    await tap(bot, 333, "coverage:ack:2026-09-07");
    expect(acknowledgedCoverageDates(db, ["2026-09-07"]).size).toBe(0);
  });
});
