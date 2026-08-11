import { Hono } from "hono";
import {
  dateStr,
  dayNumber,
  type MyShiftsResponse,
  type TeamScheduleResponse,
  type TemplatesResponse,
} from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { listUpcomingForEmployee } from "../../repo/shifts";
import { readTeamSchedule } from "../../repo/team-schedule";
import { listActiveTemplates } from "../../repo/templates";
import { type Env, requireAuth } from "../middleware";

/** Чтение, доступное любому работнику: пресеты, свои смены, график команды. */
export function createReadRoutes(deps: { db: Db; config: Config }): Hono<Env> {
  const { db, config } = deps;
  const routes = new Hono<Env>();

  // Ответ сужен до контракта: раньше сюда уезжал весь ряд таблицы, включая
  // `coverage`, `fillMode`, `rotationUnit`, `primaryEmployeeId` и `isActive`.
  // Ни один фронт их не читает (`rotationUnit` читается, но из
  // /api/admin/templates/:id/queue), а `satisfies` не даст отрастить их обратно.
  routes.get("/api/templates", requireAuth(db, config.jwtSecret), (c) =>
    c.json({
      templates: listActiveTemplates(db).map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        start: t.start,
        end: t.end,
        fridayStart: t.fridayStart,
        fridayEnd: t.fridayEnd,
        location: t.location,
        accent: t.accent,
        isLate: t.isLate,
        sendReminder: t.sendReminder,
        sortOrder: t.sortOrder,
      })),
    } satisfies TemplatesResponse),
  );

  routes.get("/api/my/shifts", requireAuth(db, config.jwtSecret), (c) => {
    // Дата команды, а не телефона: мини-апп больше не присылает `from`, потому
    // что граница дня не должна зависеть от того, где физически человек.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(new Date());
    const from = c.req.query("from") ?? today;
    // Поля перечислены, а не спреднуты рядом: ряд таблицы несёт ещё `note`,
    // `createdAt` и `updatedAt`. `note` — админское свободное поле, и
    // `readTeamSchedule` его уже вырезает по тому же соображению; здесь он
    // уезжал работнику просто потому, что никто не написал список полей.
    // Ни один экран ни одного из трёх не читает.
    return c.json({
      shifts: listUpcomingForEmployee(db, c.get("auth").employeeId, from).map((s) => ({
        id: s.id,
        date: s.date,
        start: s.start,
        end: s.end,
        endDate: s.endDate,
        category: s.category,
        title: s.title,
        location: s.location,
        unrecognisedCode: s.unrecognisedCode,
        templateId: s.templateId,
        employeeId: s.employeeId,
      })),
      today,
    } satisfies MyShiftsResponse);
  });

  routes.get("/api/team/schedule", requireAuth(db, config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ error: "from and to are required" }, 400);
    if (!dateStr.safeParse(from).success || !dateStr.safeParse(to).success) {
      return c.json({ error: "from and to must be valid YYYY-MM-DD dates" }, 400);
    }
    if (from > to) return c.json({ error: "from must not be after to" }, 400);
    if (dayNumber(to) - dayNumber(from) > 30) {
      return c.json({ error: "the range must span at most 31 days" }, 400);
    }
    // Response shape now lives in repo/team-schedule: the server builds the
    // week image for the bot with that same shaper, and the two must not drift apart.
    return c.json(readTeamSchedule(db, from, to) satisfies TeamScheduleResponse);
  });

  return routes;
}
