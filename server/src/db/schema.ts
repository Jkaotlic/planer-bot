import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { SwapStatus } from "@planer/shared";

const createdAt = () =>
  integer({ mode: "timestamp" }).notNull().default(sql`(unixepoch())`);

export const employees = sqliteTable("employees", {
  id: integer().primaryKey({ autoIncrement: true }),
  telegram_user_id: integer().unique(),
  tg_username: text(),
  display_name: text().notNull(),
  phone: text(),
  is_admin: integer({ mode: "boolean" }).notNull().default(false),
  is_active: integer({ mode: "boolean" }).notNull().default(true),
  reminders_enabled: integer({ mode: "boolean" }).notNull().default(true),
  prep_buffer_min: integer().notNull().default(60),
  invite_token: text().unique(),
  created_at: createdAt(),
});

export const shiftTemplates = sqliteTable("shift_templates", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  start: text().notNull(),
  end: text().notNull(),
  friday_start: text(),
  friday_end: text(),
  is_late: integer({ mode: "boolean" }).notNull().default(false),
  send_reminder: integer({ mode: "boolean" }).notNull().default(false),
  sort_order: integer().notNull().default(0),
  is_active: integer({ mode: "boolean" }).notNull().default(true),
});

export const shifts = sqliteTable("shifts", {
  id: integer().primaryKey({ autoIncrement: true }),
  date: text().notNull(),
  start: text().notNull(),
  end: text().notNull(),
  template_id: integer().references(() => shiftTemplates.id),
  title: text(),
  employee_id: integer().references(() => employees.id),
  note: text(),
  created_at: createdAt(),
  updated_at: createdAt(),
});

export const swapRequests = sqliteTable("swap_requests", {
  id: integer().primaryKey({ autoIncrement: true }),
  from_employee_id: integer().notNull().references(() => employees.id),
  from_shift_id: integer().notNull().references(() => shifts.id),
  to_employee_id: integer().notNull().references(() => employees.id),
  to_shift_id: integer().notNull().references(() => shifts.id),
  status: text().$type<SwapStatus>().notNull().default("pending"),
  message: text(),
  created_at: createdAt(),
  resolved_at: integer({ mode: "timestamp" }),
});

export const reminderLog = sqliteTable(
  "reminder_log",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    shift_id: integer().notNull().references(() => shifts.id),
    kind: text().notNull(),
    sent_at: createdAt(),
  },
  (t) => [uniqueIndex("reminder_shift_kind").on(t.shift_id, t.kind)],
);

export const auditLog = sqliteTable("audit_log", {
  id: integer().primaryKey({ autoIncrement: true }),
  type: text().notNull(),
  actor_employee_id: integer().references(() => employees.id),
  payload: text({ mode: "json" }).notNull(),
  created_at: createdAt(),
});

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type ShiftTemplate = typeof shiftTemplates.$inferSelect;
export type NewShiftTemplate = typeof shiftTemplates.$inferInsert;
export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;
export type SwapRequest = typeof swapRequests.$inferSelect;
export type NewSwapRequest = typeof swapRequests.$inferInsert;
export type ReminderLog = typeof reminderLog.$inferSelect;
export type NewReminderLog = typeof reminderLog.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
