import { addDaysIso, mondayOfIso, weekdayIndex } from "@planer/shared";
import { API_CONSTANTS, InlineKeyboard, type Bot, type Context } from "grammy";
import type { Employee } from "../db/schema";
import type { Db } from "../db/client";
import type { Config } from "../config";
import { clearBotBlocked } from "./blocked-tracker";
import { teamNow } from "../util/team-time";
import { safeErrorMessage } from "../util/safe-error";
import { buildMyWeekState, serializeMyWeekState } from "./my-week-model";
import { myWeekHtml } from "./my-week-html";

interface WidgetQuery {
  id: string;
  from: { id: number; is_bot: boolean };
  chat?: { id: number; type: string };
  message_id?: number;
  type: { type: string };
  data: string;
}

/** Узкий мост до появления Bot API 10.4 в типах grammY; транспорт и его
 * таймауты остаются штатными, отдельный fetch с токеном здесь не нужен. */
interface WidgetApi {
  sendWidget(payload: { chat_id: number; html: string; chat_data: string; allow_queries: true; caption: string; reply_markup: InlineKeyboard }): Promise<unknown>;
  editMessageWidgetData(payload: { chat_id: number; message_id: number; chat_data: string }, signal?: AbortSignal): Promise<unknown>;
  answerWidgetQuery(payload: { widget_query_id: string; data?: string }, signal?: AbortSignal): Promise<unknown>;
}

interface Deps {
  db: Db;
  config: Config;
  acting(tgId: number): { ok: true; me: Employee } | { ok: false; text: string };
  openMiniApp(ctx: Context): Promise<void>;
}

function selection(data: string, today: string): { monday: string; day: number; page: number } | null {
  if (data === "mw:today") return { monday: mondayOfIso(today), day: weekdayIndex(today), page: 0 };
  const match = /^mw:(\d{4}-\d{2}-\d{2}):([0-6]):(\d{1,4})$/.exec(data);
  if (!match) return null;
  const monday = match[1]!;
  const parsed = new Date(`${monday}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== monday || mondayOfIso(monday) !== monday) return null;
  const current = mondayOfIso(today);
  if (monday < addDaysIso(current, -364) || monday > addDaysIso(current, 364)) return null;
  return { monday, day: Number(match[2]), page: Number(match[3]) };
}

export function installMyWeekWidget(bot: Bot, deps: Deps): { send(ctx: Context): Promise<void> } {
  const { db, config, acting, openMiniApp } = deps;
  const api = bot.api.raw as unknown as WidgetApi;

  // grammY 1.44 не подписывается на новый тип. Добавляем его и при выключенном
  // флаге: нажатия уже присланных карточек тоже должны получать понятный отказ.
  bot.api.config.use((prev, method, payload, signal) => {
    if (method !== "getUpdates") return prev(method, payload, signal);
    const p = payload as { allowed_updates?: string[] };
    // Пустой список у Telegram означает стандартные типы, а не «не получать ничего».
    const allowed = p.allowed_updates?.length ? p.allowed_updates : API_CONSTANTS.DEFAULT_UPDATE_TYPES;
    return prev(method, { ...payload, allowed_updates: [...new Set([...allowed, "widget_query"])] } as typeof payload, signal);
  });

  bot.use(async (ctx, next) => {
    // ctx.from/chat в этой версии grammY ещё не знают widget_query.
    const q = (ctx.update as unknown as { widget_query?: WidgetQuery }).widget_query;
    if (!q) return next();
    const answer = (error?: string, disabled = false) => api.answerWidgetQuery({
      widget_query_id: q.id,
      ...(error ? { data: JSON.stringify({ error, disabled }) } : {}),
    }, AbortSignal.timeout(4_000));
    if (!config.myWeekWidgetEnabled) { await answer("Моя неделя отключена. Открой «Мои смены».", true); return; }
    if (q.type.type !== "data" || q.from.is_bot || q.chat?.type !== "private" || q.chat.id !== q.from.id || !Number.isSafeInteger(q.message_id) || q.message_id! <= 0) {
      await answer("Эта карточка доступна только в твоей личке с ботом.", true); return;
    }
    const who = acting(q.from.id);
    if (!who.ok) { await answer(`${who.text}.`, true); return; }
    const today = teamNow(config.teamTz).date;
    const selected = selection(q.data, today);
    if (!selected) { await answer("Выбери неделю в пределах года от сегодняшней даты."); return; }
    try {
      clearBotBlocked(db, q.from.id);
      const data = serializeMyWeekState(buildMyWeekState(db, who.me.id, today, selected.monday, selected.day, selected.page));
      await api.editMessageWidgetData({ chat_id: q.chat.id, message_id: q.message_id!, chat_data: data }, AbortSignal.timeout(7_000));
    } catch (error) {
      // Повторный показ той же даты законен; Telegram отказывает на неизменённые
      // данные. Только этот отказ означает успешное обновление без правки.
      if (!(error instanceof Error && /message is not modified/i.test(error.message))) {
        console.error("my-week: update failed:", safeErrorMessage(error));
        await answer("Не удалось обновить неделю. Попробуй ещё раз или открой мини-апп.");
        return;
      }
    }
    await answer();
  });

  return { async send(ctx) {
    if (ctx.chat?.type !== "private" || !ctx.from) return;
    if (!config.myWeekWidgetEnabled) { await openMiniApp(ctx); return; }
    const who = acting(ctx.from.id);
    if (!who.ok) { await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`); return; }
    try {
      const today = teamNow(config.teamTz).date;
      await api.sendWidget({
        chat_id: ctx.chat.id, html: myWeekHtml,
        chat_data: serializeMyWeekState(buildMyWeekState(db, who.me.id, today, mondayOfIso(today), weekdayIndex(today), 0)),
        allow_queries: true,
        // Подпись и inline-кнопка видны даже клиенту без поддержки виджетов.
        caption: "Моя неделя · /myweek — новая карточка. Если карточка не видна, обнови Telegram или открой мини-апп ниже.",
        reply_markup: new InlineKeyboard().webApp("📋 Открыть мини-апп", `${config.publicUrl}/app/`),
      });
    } catch (error) {
      console.error("my-week: send failed:", safeErrorMessage(error));
      await openMiniApp(ctx);
    }
  } };
}
