import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getByTelegramId, archiveEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { testConfig } from "../test-config";

function setup(enabled = true) {
  const db = makeTestDb();
  createEmployee(db, { displayName: "Аня", inviteToken: "anya" });
  linkTelegramAccount(db, "anya", 207, "anya", "Аня");
  const me = getByTelegramId(db, 207)!;
  createShift(db, { employeeId: me.id, date: "2026-11-10", start: "07:00", end: "16:00", category: "shift", title: "Утро", note: "Скрытая заметка" });
  const config = testConfig({ myWeekWidgetEnabled: enabled });
  const bot = stubBotInfo(createBot({ db, config }));
  const recorder = recordApi(bot);
  return { db, bot, me, recorder, config };
}
function command(text = "/myweek", chatType = "private", from = 207) {
  return { update_id: 1, message: { message_id: 1, date: 1, chat: { id: chatType === "private" ? from : -123, type: chatType }, from: { id: from, is_bot: false, first_name: "Аня" }, text, entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.length }] : [] } } as unknown as Parameters<Bot["handleUpdate"]>[0];
}
function query(data = "mw:2026-11-09:1:0", patch: Record<string, unknown> = {}) {
  return { update_id: 2, widget_query: { id: "wq1", from: { id: 207, is_bot: false, first_name: "Аня" }, chat: { id: 207, type: "private", first_name: "Аня" }, message_id: 5, chat_instance: "test", type: { type: "data" }, data, ...patch } } as unknown as Parameters<Bot["handleUpdate"]>[0];
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T22:30:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("Моя неделя в боте", () => {
  it.each(["/myweek", "🗓 Моя неделя"])("%s отправляет личный виджет с Mini App и без public_data", async (text) => {
    const { bot, recorder } = setup();
    await bot.handleUpdate(command(text));
    const sent = recorder.calls.find(c => c.method === "sendWidget")!.payload;
    expect(sent.chat_id).toBe(207);
    expect(sent.allow_queries).toBe(true);
    expect(sent.public_data).toBeUndefined();
    expect(sent.is_shared).not.toBe(true);
    expect(JSON.parse(sent.chat_data)).toMatchObject({ m: "2026-11-09", t: "2026-11-10", d: 1, e: { title: "Утро", time: "07:00–16:00" } });
    expect(JSON.stringify(sent)).not.toContain("Скрытая заметка");
    expect(sent.reply_markup.inline_keyboard.flat().some((b: { web_app?: { url: string } }) => b.web_app?.url === "https://example.com/app/")).toBe(true);
    expect(sent.caption).toContain("/myweek");
  });
  it("выключенный флаг сохраняет прежнюю клавиатуру и вход в Mini App", async () => {
    const { bot, recorder } = setup(false);
    await bot.handleUpdate(command("/menu"));
    expect(JSON.stringify(recorder.sent[0]!.reply_markup)).not.toContain("Моя неделя");
    await bot.handleUpdate(command());
    expect(recorder.calls.some(c => c.method === "sendWidget")).toBe(false);
    expect(recorder.sent.at(-1)!.reply_markup!.inline_keyboard[0]![0]).toMatchObject({ web_app: { url: "https://example.com/app/" } });
  });
  it("включённый флаг добавляет доступный вход, сохраняя Мои смены", async () => {
    const { bot, recorder } = setup();
    await bot.handleUpdate(command("/menu"));
    expect(JSON.stringify(recorder.sent[0]!.reply_markup)).toContain("🗓 Моя неделя");
    expect(JSON.stringify(recorder.sent[0]!.reply_markup)).toContain("📋 Мои смены");
  });
  it.each(["group", "supergroup"])("команда в %s не публикует данные", async (kind) => {
    const { bot, recorder } = setup();
    await bot.handleUpdate(command("/myweek", kind));
    expect(recorder.calls).toHaveLength(0);
  });
  it.each([false, true])("незарегистрированный/архивный не получает карточку (%s)", async (archived) => {
    const { bot, recorder, db, me } = setup();
    if (archived) archiveEmployee(db, me.id, "2026-11-10");
    await bot.handleUpdate(command("/myweek", "private", archived ? 207 : 999));
    expect(recorder.calls.some(c => c.method === "sendWidget")).toBe(false);
    expect(recorder.sent[0]!.text).toMatch(/start|архив/);
  });
  it("запрос обновляет именно исходное сообщение и подтверждает результат", async () => {
    const { bot, recorder } = setup();
    await bot.handleUpdate(query());
    const edit = recorder.calls.find(c => c.method === "editMessageWidgetData")!.payload;
    expect(edit).toMatchObject({ chat_id: 207, message_id: 5 });
    expect(JSON.parse(edit.chat_data).e.title).toBe("Утро");
    expect(recorder.calls.find(c => c.method === "answerWidgetQuery")!.payload).toEqual({ widget_query_id: "wq1" });
  });
  it("К сегодня возвращается к командной дате, хотя в UTC ещё понедельник", async () => {
    const { bot, recorder } = setup();
    await bot.handleUpdate(query("mw:today"));
    const data = recorder.calls.find(c => c.method === "editMessageWidgetData")!.payload.chat_data;
    expect(JSON.parse(data)).toMatchObject({ m: "2026-11-09", t: "2026-11-10", d: 1, p: 0 });
  });
  it.each(["2025-11-10", "2027-11-08"])("разрешает граничную неделю %s", async (monday) => {
    const { bot, recorder } = setup();
    await bot.handleUpdate(query(`mw:${monday}:0:0`));
    const data = recorder.calls.find(c => c.method === "editMessageWidgetData")!.payload.chat_data;
    expect(JSON.parse(data).m).toBe(monday);
  });
  it("отказ обновления не подтверждает пользователю успешное обновление", async () => {
    const { bot, recorder } = setup();
    bot.api.config.use((prev, method, payload, signal) => {
      if (String(method) === "editMessageWidgetData") throw new Error("telegram down");
      return prev(method, payload, signal);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await bot.handleUpdate(query());
      expect(JSON.parse(recorder.calls.find(c => c.method === "answerWidgetQuery")!.payload.data).error).toContain("Не удалось");
    } finally { log.mockRestore(); }
  });
  it("повторное обновление неизменённых данных считается успешным", async () => {
    const { bot, recorder } = setup();
    bot.api.config.use((prev, method, payload, signal) => {
      if (String(method) === "editMessageWidgetData") throw new Error("Bad Request: message is not modified");
      return prev(method, payload, signal);
    });
    await bot.handleUpdate(query());
    expect(recorder.calls.find(c => c.method === "answerWidgetQuery")!.payload).toEqual({ widget_query_id: "wq1" });
  });
  it.each([
    "mw:2026-11-10:1:0", "mw:2026-02-30:1:0", "mw:2029-11-05:1:0",
    "mw:2026-11-09:7:0", "mw:2026-11-09:1:-1", "mw:2026-11-09:1:0:999",
    "mw:2026-11-09:1:99999999999999999999999999", "mw:garbage",
  ])("отказывает на недопустимый запрос %s", async (data) => {
    const { bot, recorder } = setup();
    await bot.handleUpdate(query(data));
    expect(recorder.calls.some(c => c.method === "editMessageWidgetData")).toBe(false);
    expect(JSON.parse(recorder.calls.find(c => c.method === "answerWidgetQuery")!.payload.data).error).toBeTruthy();
  });
  it.each([
    { chat: { id: -123, type: "supergroup" } }, { chat: { id: 999, type: "private" } },
    { chat: undefined, message_id: undefined, inline_message_id: "inline" }, { type: { type: "sign_data" } },
  ])("не отдаёт данные за пределами собственной лички: %j", async (patch) => {
    const { bot, recorder } = setup();
    await bot.handleUpdate(query(undefined, patch));
    expect(recorder.calls.some(c => c.method === "editMessageWidgetData")).toBe(false);
    expect(JSON.stringify(recorder.calls)).not.toContain("07:00");
  });
  it("перепроверяет архивный доступ при нажатии старой карточки", async () => {
    const { bot, recorder, db, me } = setup();
    archiveEmployee(db, me.id, "2026-11-10");
    await bot.handleUpdate(query());
    expect(recorder.calls.some(c => c.method === "editMessageWidgetData")).toBe(false);
    expect(JSON.stringify(recorder.calls)).toContain("архив");
  });
  it("выключение останавливает и запросы уже отправленных карточек", async () => {
    const { bot, recorder } = setup(false);
    await bot.handleUpdate(query());
    expect(recorder.calls.some(c => c.method === "editMessageWidgetData")).toBe(false);
    expect(JSON.stringify(recorder.calls)).toContain("отключена");
  });
  it("после отказа sendWidget даёт прежний вход в Mini App", async () => {
    const { bot, recorder } = setup();
    bot.api.config.use((prev, method, payload, signal) => {
      if (String(method) === "sendWidget") throw new Error("unsupported widget");
      return prev(method, payload, signal);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await bot.handleUpdate(command());
      expect(recorder.sent.at(-1)!.reply_markup!.inline_keyboard[0]![0]).toMatchObject({ web_app: { url: "https://example.com/app/" } });
    } finally { log.mockRestore(); }
  });
  it("подписка getUpdates сохраняет обычные типы и принимает widget_query", async () => {
    const { db, config } = setup();
    let body: { allowed_updates: string[] } | undefined;
    const bot = stubBotInfo(createBot({ db, config, client: { fetch: async (_url: unknown, init?: { body?: unknown }) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ ok: true, result: [] }), { headers: { "content-type": "application/json" } });
    } } }));
    await bot.api.getUpdates({ allowed_updates: ["message", "callback_query"] });
    expect(body!.allowed_updates).toEqual(["message", "callback_query", "widget_query"]);
  });
  it.each([undefined, []])("обычная подписка (%j) не теряет стандартные обновления", async (allowed_updates) => {
    const { db, config } = setup(false);
    let body: { allowed_updates: string[] } | undefined;
    const bot = stubBotInfo(createBot({ db, config, client: { fetch: async (_url: unknown, init?: { body?: unknown }) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ ok: true, result: [] }), { headers: { "content-type": "application/json" } });
    } } }));
    await bot.api.getUpdates({ allowed_updates });
    expect(body!.allowed_updates).toEqual(expect.arrayContaining(["message", "callback_query", "poll", "poll_answer", "my_chat_member", "widget_query"]));
    expect(body!.allowed_updates.filter(t => t === "widget_query")).toHaveLength(1);
  });
});
