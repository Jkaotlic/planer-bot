import { createHmac, timingSafeEqual } from "node:crypto";
import { GrammyError, type Bot, type InlineKeyboard } from "grammy";
import { checklistProgress, formatDayMonth } from "@planer/shared";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { canMarkChecklistDate, checklistsFor, markChecklistItem } from "../checklists/mark";
import { activeChecklistItems, listMarksFor } from "../repo/checklist";
import { getChecklist } from "../repo/checklists";
import { getByTelegramId } from "../repo/employees";
import { safeErrorMessage } from "../util/safe-error";
import { teamNow } from "../util/team-time";
import { checklistWidgetHtml } from "./checklist-widget-html";

const PAGE_SIZE = 3;

interface ChecklistContext {
  employeeId: number;
  checklistId: number;
  date: string;
}

interface WidgetApi {
  sendWidget(payload: { chat_id: number; html: string; chat_data: string; allow_queries: true; caption: string; reply_markup: InlineKeyboard }): Promise<unknown>;
  answerWidgetQuery(payload: { widget_query_id: string; data: string }, signal: AbortSignal): Promise<unknown>;
}

interface Query {
  id: string;
  data?: string;
  from: { id: number; is_bot: boolean };
  chat?: { id: number; type: string };
  type: { type: string };
}

function signature(secret: string, scope: ChecklistContext): string {
  return createHmac("sha256", secret)
    .update(`checklist:v1:${scope.employeeId}:${scope.checklistId}:${scope.date}`)
    .digest("base64url").slice(0, 16);
}

function label(value: string, max: number): string {
  // Считаем кодовые точки, чтобы не разрезать эмодзи. Подробности остаются в Mini App.
  const chars = Array.from(value.replace(/[\s\u0000-\u001f]/g, " ").trim());
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}

function snapshot(db: Db, secret: string, scope: ChecklistContext, page: number, itemId?: number) {
  const list = getChecklist(db, scope.checklistId);
  const items = activeChecklistItems(db, scope.checklistId);
  if (!list || items.length === 0) return null;
  const marked = listMarksFor(db, scope.date, scope.employeeId).map(m => m.itemId);
  const pages = Math.ceil(items.length / PAGE_SIZE);
  const itemIndex = itemId === undefined ? -1 : items.findIndex(item => item.id === itemId);
  page = itemIndex < 0 ? Math.min(page, pages - 1) : Math.floor(itemIndex / PAGE_SIZE);
  const state = {
    scope: `cl:${scope.date}:${scope.checklistId.toString(36)}:${signature(secret, scope)}`,
    name: label(list.name, 40),
    date: formatDayMonth(scope.date),
    intro: "",
    ...checklistProgress(items, marked),
    page, pages,
    items: items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      .map(item => [item.id, label(item.title, 45), marked.includes(item.id)] as const),
  };
  // Лимит Telegram относится к JSON в байтах, включая кавычки и экранирование.
  const intro = label(list.note ?? "", 160);
  const chars = Array.from(intro);
  state.intro = intro;
  while (Buffer.byteLength(JSON.stringify(state)) > 1024 && chars.length > 0) {
    chars.pop();
    state.intro = chars.length ? chars.join("") + "…" : "";
  }
  return state;
}

export async function sendChecklistWidget(
  bot: Bot, db: Db, config: Config, chatId: number, scope: ChecklistContext, keyboard: InlineKeyboard, caption: string,
): Promise<boolean> {
  caption = "Чек-лист на момент отправки\n\n" + caption;
  // Старый клиент видит только подпись. Если в неё не входят все инструкции,
  // посылаем обычное сообщение с полным содержанием.
  if (caption.length > 1024 || caption.includes("\0")) return false;
  const state = snapshot(db, config.jwtSecret, scope, 0);
  if (!state) return false;
  try {
    await (bot.api.raw as unknown as WidgetApi).sendWidget({
      chat_id: chatId, html: checklistWidgetHtml, chat_data: JSON.stringify(state),
      allow_queries: true, caption, reply_markup: keyboard,
    });
    return true;
  } catch (error) {
    if (!(error instanceof GrammyError && (error.error_code === 400 || error.error_code === 404))) throw error;
    console.warn("checklist widget: Telegram refused the format:", error.error_code);
    return false;
  }
}

export function installChecklistWidget(bot: Bot, db: Db, config: Config): void {
  bot.use(async (ctx, next) => {
    const q = (ctx.update as unknown as { widget_query?: Query }).widget_query;
    if (!q?.data?.startsWith("cl:")) return next();

    const answer = (data: unknown) => (bot.api.raw as unknown as WidgetApi).answerWidgetQuery({
      widget_query_id: q.id, data: JSON.stringify(data),
    }, AbortSignal.timeout(4_000));
    const result = () => {
      if (!config.checklistWidgetEnabled) return { error: "Отметь пункты в мини-приложении.", disabled: true };
      if (q.type.type !== "data" || q.from.is_bot || q.chat?.type !== "private" || q.chat.id !== q.from.id) {
        return { error: "Открой чек-лист в личке с ботом.", disabled: true };
      }
      const me = getByTelegramId(db, q.from.id);
      const match = /^cl:(\d{4}-\d{2}-\d{2}):([0-9a-z]{1,11}):([A-Za-z0-9_-]{16}):(?:p(\d{1,7})|m(\d{1,16})\.([01]))$/.exec(q.data!);
      if (!me?.isActive || !match) return { error: "Чек-лист недоступен.", disabled: true };
      const date = match[1]!;
      const checklistId = Number.parseInt(match[2]!, 36);
      const scope = { employeeId: me.id, checklistId, date };
      const today = teamNow(config.teamTz).date;
      if (!Number.isSafeInteger(checklistId) ||
          !timingSafeEqual(Buffer.from(match[3]!), Buffer.from(signature(config.jwtSecret, scope))) ||
          !canMarkChecklistDate(date, today) || !checklistsFor(db, date, me.id).includes(checklistId)) {
        return { error: "Этот чек-лист больше недоступен.", disabled: true };
      }
      if (match[5]) {
        const itemId = Number(match[5]);
        if (!Number.isSafeInteger(itemId)) return { error: "Пункт недоступен." };
        const marked = markChecklistItem(db, { ...scope, itemId, done: match[6] === "1" }, today);
        if ("error" in marked) return { error: "Пункт изменился. Обнови список." };
        return snapshot(db, config.jwtSecret, scope, 0, itemId) ?? { error: "Список больше недоступен.", disabled: true };
      }
      return snapshot(db, config.jwtSecret, scope, Number(match[4])) ?? { error: "Список больше недоступен.", disabled: true };
    };

    let data;
    try {
      data = result();
    } catch (error) {
      console.error("checklist widget: action failed:", safeErrorMessage(error));
      data = { error: "Не удалось обновить чек-лист. Попробуй ещё раз." };
    }
    await answer(data);
  });
}
