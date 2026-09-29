import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { recordApi, silentBot } from "../bot/testbot";
import { createPoll, getPoll } from "../polls/poll-service";
import { runFoodTick } from "./food-tick";

describe("runFoodTick", () => {
  it("закрывает просроченный опрос один раз и рассылает итог один раз", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-a" });
    linkTelegramAccount(db, "inv-a", 100);
    const poll = createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt: "2026-09-29T11:00", recipientIds: [anya.id] });
    const { bot } = silentBot();
    const api = recordApi(bot);
    const now = { date: "2026-09-29", time: "12:00" };
    expect(await runFoodTick(db, bot, now)).toBe(1);
    expect(await runFoodTick(db, bot, now)).toBe(0);
    expect(getPoll(db, poll.id)!.closedAt).not.toBeNull();
    expect(api.sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(1);
  });
});
