import { Bot } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../db/client";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { createNoticeBuffer } from "./notice-buffer";

const NOW = { date: "2026-08-01", time: "10:00" };
const WINDOW_MS = 20_000;

/** A bot whose `sendMessage` calls land in `sent` instead of hitting the network —
 *  same helper shape as `http/employees.test.ts`, reused rather than reinvented. */
function testBot() {
  const bot = new Bot("12345:tok");
  bot.botInfo = {
    id: 1, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false,
    supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") sent.push(payload as { chat_id: number | string; text: string });
    return { ok: true, result: {} } as never;
  });
  return { bot, sent };
}

function worker(db: Db, displayName: string, tgId: number | null) {
  const person = createEmployee(db, { displayName, inviteToken: `inv-${displayName}` });
  if (tgId != null) linkTelegramAccount(db, `inv-${displayName}`, tgId);
  return person;
}

const shiftOn = (db: Db, employeeId: number, date: string, title: string, start: string, end: string) =>
  createShift(db, { date, start, end, endDate: null, category: "shift", title, employeeId });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("буфер писем о правке графика", () => {
  it("две правки внутри окна дают одно письмо", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const first = shiftOn(db, target.id, "2026-08-11", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: first, now: NOW });
    await vi.advanceTimersByTimeAsync(WINDOW_MS / 2);
    const second = shiftOn(db, target.id, "2026-08-12", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: second, now: NOW });

    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("11 авг");
    expect(sent[0]!.text).toContain("12 авг");
  });

  it("две правки с разрывом больше окна дают два письма", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const first = shiftOn(db, target.id, "2026-08-11", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: first, now: NOW });
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1);
    expect(sent).toHaveLength(1);

    const second = shiftOn(db, target.id, "2026-08-12", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: second, now: NOW });
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1);
    expect(sent).toHaveLength(2);
  });

  it("правка внутри окна сдвигает отправку", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const first = shiftOn(db, target.id, "2026-08-11", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: first, now: NOW });
    // Ждём почти всё окно, потом правим ещё раз — отправка обязана отъехать.
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1_000);
    const second = shiftOn(db, target.id, "2026-08-12", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: second, now: NOW });

    // Прежний срок уже миновал бы — значит таймер действительно сброшен.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(sent).toHaveLength(1);
  });

  it("правки разным людям не смешиваются в одно письмо", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const igor = worker(db, "Игорь", 333);
    const mark = worker(db, "Марк", 444);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const forIgor = shiftOn(db, igor.id, "2026-08-11", "День", "09:00", "18:00");
    const forMark = shiftOn(db, mark.id, "2026-08-11", "Вечер", "11:00", "20:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: forIgor, now: NOW });
    buffer.register({ actorEmployeeId: admin.id, before: null, after: forMark, now: NOW });

    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1);
    expect(sent).toHaveLength(2);
    const igorText = sent.find((message) => message.chat_id === 333)!.text;
    expect(igorText).toContain("День");
    expect(igorText).not.toContain("Вечер");
  });

  it("register отвечает предсказанием, не дожидаясь отправки", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const noTelegram = worker(db, "Марк", null);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const entry = shiftOn(db, noTelegram.id, "2026-08-11", "День", "09:00", "18:00");
    const reach = buffer.register({ actorEmployeeId: admin.id, before: null, after: entry, now: NOW });

    // Ответ есть сразу, отправки ещё не было — в этом весь смысл предсказания.
    expect(reach).toEqual({ delivered: 0, intended: 1 });
    expect(sent).toHaveLength(0);
  });

  it("привязанный телеграм предсказывается как доставка", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const { bot } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const entry = shiftOn(db, target.id, "2026-08-11", "День", "09:00", "18:00");
    const reach = buffer.register({ actorEmployeeId: admin.id, before: null, after: entry, now: NOW });

    expect(reach).toEqual({ delivered: 1, intended: 1 });
  });

  it("автору его же правка не пишется", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const own = shiftOn(db, admin.id, "2026-08-11", "День", "09:00", "18:00");
    const reach = buffer.register({ actorEmployeeId: admin.id, before: null, after: own, now: NOW });

    expect(reach).toEqual({ delivered: 0, intended: 0 });
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1);
    expect(sent).toHaveLength(0);
  });

  it("flushNow отправляет накопленное немедленно", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const entry = shiftOn(db, target.id, "2026-08-11", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: entry, now: NOW });
    expect(sent).toHaveLength(0);

    await buffer.flushNow();
    expect(sent).toHaveLength(1);
    // Таймер снят вместе с отправкой — иначе письмо ушло бы вторым.
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1);
    expect(sent).toHaveLength(1);
  });
});
