import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { categoryLabel, addDaysIso } from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import type { Shift } from "../../db/schema";
import { getEmployeeById, getByCalendarToken, setCalendarToken } from "../../repo/employees";
import { listEmployeeShiftsOverlapping } from "../../repo/shifts";
import { getTemplate } from "../../repo/templates";
import { buildIcs, type IcsEntry } from "../../calendar/ics";
import { teamNow } from "../../util/team-time";
import { rateLimiter } from "../rate-limit";
import { type Env, requireAuth } from "../middleware";

/** Личное окно подписки: недавнее прошлое (не даёт файлу расти бесконечно) и
 *  полгода вперёд (дальше графика обычно и не составляют). */
const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 180;

function calendarUrl(config: Config, token: string): string {
  return `${config.publicUrl}/cal/${token}.ics`;
}

/** Как это назвал бы человек, глядя в сетку: вид смены, свой заголовок, а
 *  если нет ни того ни другого — подпись категории. Тот же порядок, каким
 *  читает эту тройку `week-model.ts` при разборе клетки для фронта. */
function summaryFor(db: Db, shift: Shift): string {
  const template = shift.templateId != null ? getTemplate(db, shift.templateId) : undefined;
  return template?.name ?? shift.title ?? categoryLabel(shift.category);
}

function toIcsEntry(db: Db, shift: Shift): IcsEntry {
  return {
    id: shift.id,
    date: shift.date,
    endDate: shift.endDate,
    start: shift.start,
    end: shift.end,
    summary: summaryFor(db, shift),
    location: shift.location,
    updatedAtMs: shift.updatedAt.getTime(),
  };
}

/** Личная подписка на свои смены в формате ICS: три ручки мини-аппа под
 *  токеном авторизации плюс одна публичная — файл, который открывает
 *  приложение календаря телефона, без единого запроса через бота. */
export function createCalendarRoutes(deps: { db: Db; config: Config }): Hono<Env> {
  const { db, config } = deps;
  const routes = new Hono<Env>();

  routes.get("/api/me/calendar", requireAuth(db, config.jwtSecret), (c) => {
    const me = getEmployeeById(db, c.get("auth").employeeId);
    const url = me?.calendarToken ? calendarUrl(config, me.calendarToken) : null;
    return c.json({ url });
  });

  // Новый токен на каждый POST — так же и для «Подключить», и для «Сменить
  // ссылку»: старая ссылка обязана перестать работать, а не остаться рабочей
  // параллельно новой (ссылку могли переслать).
  routes.post("/api/me/calendar", requireAuth(db, config.jwtSecret), (c) => {
    const token = randomBytes(16).toString("hex");
    setCalendarToken(db, c.get("auth").employeeId, token);
    return c.json({ url: calendarUrl(config, token) });
  });

  routes.delete("/api/me/calendar", requireAuth(db, config.jwtSecret), (c) => {
    setCalendarToken(db, c.get("auth").employeeId, null);
    return c.json({ ok: true });
  });

  /**
   * Публичная ручка — вне `/api`, своей ставкой лимита (60/мин, отдельно от
   * общего лимитера всего приложения), без авторизации: токен сам и есть
   * право доступа. Неизвестный токен и архивный/неактивный владелец отвечают
   * одинаковым 404 — разница в ответе подсказала бы, что токен вообще
   * существовал.
   */
  routes.get("/cal/:file", rateLimiter({ windowMs: 60_000, max: 60 }), (c) => {
    const file = c.req.param("file");
    const token = file.endsWith(".ics") ? file.slice(0, -".ics".length) : file;
    const employee = getByCalendarToken(db, token);
    if (!employee || !employee.isActive) return c.json({ error: "not_found" }, 404);

    const { date: today } = teamNow(config.teamTz);
    const from = addDaysIso(today, -WINDOW_PAST_DAYS);
    const to = addDaysIso(today, WINDOW_FUTURE_DAYS);
    const entries = listEmployeeShiftsOverlapping(db, employee.id, from, to).map((shift) => toIcsEntry(db, shift));

    const ics = buildIcs(entries, { tz: config.teamTz, nowMs: Date.now(), calName: "Мои смены" });
    c.header("Content-Type", "text/calendar; charset=utf-8");
    return c.body(ics);
  });

  return routes;
}
