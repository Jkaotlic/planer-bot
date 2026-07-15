import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { SwapStatus, EntryCategory, TemplateAccent } from "@planer/shared";

const createdAt = () =>
  integer({ mode: "timestamp" }).notNull().default(sql`(unixepoch())`);

export const employees = sqliteTable("employees", {
  id: integer().primaryKey({ autoIncrement: true }),
  telegramUserId: integer().unique(),
  tgUsername: text(),
  displayName: text().notNull(),
  phone: text(),
  isAdmin: integer({ mode: "boolean" }).notNull().default(false),
  isActive: integer({ mode: "boolean" }).notNull().default(true),
  remindersEnabled: integer({ mode: "boolean" }).notNull().default(true),
  prepBufferMin: integer().notNull().default(60),
  inviteToken: text().unique(),
  archivedAt: integer({ mode: "timestamp" }),
  createdAt: createdAt(),
});

export const shiftTemplates = sqliteTable("shift_templates", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  /** Which entry category this preset creates — most are "shift", but a preset
   * can also be a duty (e.g. "Дежурство · Поклонка"). */
  category: text().$type<EntryCategory>().notNull().default("shift"),
  start: text().notNull(),
  end: text().notNull(),
  fridayStart: text(),
  fridayEnd: text(),
  /** Default place for duty/offsite presets (e.g. "Поклонка"); null for plain shifts. */
  location: text(),
  /** Colour slot so each preset is distinguishable in the schedule (see `TemplateAccent`). */
  accent: text().$type<TemplateAccent>().notNull().default("blue"),
  isLate: integer({ mode: "boolean" }).notNull().default(false),
  sendReminder: integer({ mode: "boolean" }).notNull().default(false),
  sortOrder: integer().notNull().default(0),
  isActive: integer({ mode: "boolean" }).notNull().default(true),
});

export const shifts = sqliteTable("shifts", {
  id: integer().primaryKey({ autoIncrement: true }),
  date: text().notNull(),
  start: text(),
  end: text(),
  endDate: text(),
  category: text().$type<EntryCategory>().notNull().default("shift"),
  location: text(),
  templateId: integer().references(() => shiftTemplates.id),
  title: text(),
  employeeId: integer().references(() => employees.id),
  note: text(),
  createdAt: createdAt(),
  updatedAt: createdAt().$onUpdate(() => new Date()),
});

export const swapRequests = sqliteTable("swap_requests", {
  id: integer().primaryKey({ autoIncrement: true }),
  fromEmployeeId: integer().notNull().references(() => employees.id),
  fromShiftId: integer().notNull().references(() => shifts.id),
  toEmployeeId: integer().notNull().references(() => employees.id),
  toShiftId: integer().notNull().references(() => shifts.id),
  status: text().$type<SwapStatus>().notNull().default("pending"),
  message: text(),
  createdAt: createdAt(),
  resolvedAt: integer({ mode: "timestamp" }),
});

export const reminderLog = sqliteTable(
  "reminder_log",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    shiftId: integer().notNull().references(() => shifts.id),
    kind: text().notNull(),
    sentAt: createdAt(),
  },
  (t) => [uniqueIndex("reminder_shift_kind").on(t.shiftId, t.kind)],
);

export const auditLog = sqliteTable("audit_log", {
  id: integer().primaryKey({ autoIncrement: true }),
  type: text().notNull(),
  actorEmployeeId: integer().references(() => employees.id),
  payload: text({ mode: "json" }).notNull(),
  createdAt: createdAt(),
});

export const vacantSlots = sqliteTable("vacant_slots", {
  id: integer().primaryKey({ autoIncrement: true }),
  date: text().notNull(),
  start: text().notNull(),
  end: text().notNull(),
  title: text(),
  location: text(),
  note: text(),
  status: text().$type<"open" | "assigned" | "closed">().notNull().default("open"),
  createdAt: createdAt(),
});

export const slotInterest = sqliteTable(
  "slot_interest",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    slotId: integer().notNull().references(() => vacantSlots.id),
    employeeId: integer().notNull().references(() => employees.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("slot_interest_unique").on(t.slotId, t.employeeId)],
);

export const weekendAssignments = sqliteTable(
  "weekend_assignments",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    slotId: integer().notNull().references(() => vacantSlots.id),
    employeeId: integer().notNull().references(() => employees.id),
    status: text().$type<"offered" | "confirmed" | "declined">().notNull().default("offered"),
    hours: real().notNull(),
    shiftId: integer().references(() => shifts.id),
    createdAt: createdAt(),
    confirmedAt: integer({ mode: "timestamp" }),
  },
  (t) => [uniqueIndex("weekend_assignment_slot").on(t.slotId)],
);

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
export type VacantSlot = typeof vacantSlots.$inferSelect;
export type NewVacantSlot = typeof vacantSlots.$inferInsert;
export type SlotInterest = typeof slotInterest.$inferSelect;
export type NewSlotInterest = typeof slotInterest.$inferInsert;
export type WeekendAssignment = typeof weekendAssignments.$inferSelect;
export type NewWeekendAssignment = typeof weekendAssignments.$inferInsert;
