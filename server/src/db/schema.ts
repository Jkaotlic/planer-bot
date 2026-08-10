import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { SwapStatus, EntryCategory, TemplateAccent, AuditType, CollectionKind } from "@planer/shared";

const createdAt = () =>
  integer({ mode: "timestamp" }).notNull().default(sql`(unixepoch())`);

export const employees = sqliteTable("employees", {
  id: integer().primaryKey({ autoIncrement: true }),
  telegramUserId: integer().unique(),
  tgUsername: text(),
  /** Telegram's own `first_name` — what the person calls themselves, refreshed on
   *  every auth. `displayName` comes from the roster file as «Фамилия Имя», which
   *  is right for a work roster and wrong for saying hello. See `addressOf`. */
  tgFirstName: text(),
  /** How this person asked to be addressed. Null → fall back to Telegram's name,
   *  then to the roster's. See `addressOf` in @planer/shared. */
  preferredName: text(),
  displayName: text().notNull(),
  phone: text(),
  isAdmin: integer({ mode: "boolean" }).notNull().default(false),
  isActive: integer({ mode: "boolean" }).notNull().default(true),
  remindersEnabled: integer({ mode: "boolean" }).notNull().default(true),
  /** An admin took this person out of AUTOMATIC placement: «Распределить честно»,
   *  the ★ queue, the weekend call for volunteers, and weekend assignment. An admin
   *  can still place them by hand — this is not archiving. */
  excludedFromAssignment: integer({ mode: "boolean" }).notNull().default(false),
  /** An admin took this person out of swaps, both ways: neither propose nor accept. */
  excludedFromSwaps: integer({ mode: "boolean" }).notNull().default(false),
  prepBufferMin: integer().notNull().default(60),
  inviteToken: text().unique(),
  archivedAt: integer({ mode: "timestamp" }),
  /** This worker's row position in the imported roster file, 0-based. NULL = not in the
   *  roster (e.g. a worker added in the bot later); those sort last on export. */
  rosterOrder: integer(),
  /** «MM-DD» — day and month, no year. See shared/src/birthday.ts for why. */
  birthDate: text(),
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
  /** How many people this preset needs per weekday, Mon..Sun — 7 comma-separated ints.
   *  '0,0,0,0,0,0,0' (the default) means "not a role": never materialised, today's behaviour.
   *  '1,1,1,1,1,0,0' — the five roles that need exactly one person every working day.
   *  '3,2,2,2,2,0,0' — «Утро»: three people on Mondays, two otherwise (measured, exact). */
  coverage: text().notNull().default("0,0,0,0,0,0,0"),
  /** 'count' — materialise coverage[weekday] rows. 'remainder' — take everyone left
   *  unscheduled that day. At most one active preset may be the remainder. */
  fillMode: text().$type<"count" | "remainder">().notNull().default("count"),
  /** 'day' — decided per day. 'week' — one holder claims the whole ISO week. */
  rotationUnit: text().$type<"day" | "week">().notNull().default("day"),
  /** Whose job this is by default. A hard pre-claim with pool fallback, not a tiebreak. */
  primaryEmployeeId: integer().references(() => employees.id),
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
  /**
   * The raw cell text when a roster import could not read it — «Ко» and the like.
   *
   * Kept verbatim rather than dropped, for three reasons: the grid can draw «?»
   * instead of pretending the day is empty, the export writes the original code
   * back so nothing is lost in a round trip, and the cell stays flagged on every
   * re-import until somebody actually fixes the file. Null on every normal entry.
   */
  unrecognisedCode: text(),
  createdAt: createdAt(),
  updatedAt: createdAt().$onUpdate(() => new Date()),
});

export const swapRequests = sqliteTable("swap_requests", {
  id: integer().primaryKey({ autoIncrement: true }),
  fromEmployeeId: integer().notNull().references(() => employees.id),
  /**
   * Nullable so the request outlives the shift it pointed at.
   *
   * Deleting an entry used to `DELETE FROM swap_requests` to satisfy this foreign
   * key, which erased both halves of the record: a pending request vanished with
   * nobody told, and a swap that had actually happened disappeared from both
   * people's archive. The spec instead wants «смена удалена → expired, уведомить
   * обе стороны», and history to stay history — both need the row to survive, so
   * the pointer is what gives way. Null means «that shift no longer exists»; the
   * journal row written at the same moment still carries its date and time.
   */
  fromShiftId: integer().references(() => shifts.id),
  toEmployeeId: integer().notNull().references(() => employees.id),
  toShiftId: integer().references(() => shifts.id),
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
  type: text().$type<AuditType>().notNull(),
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
  // One assignment per person per slot — a slot can need several people, so the
  // uniqueness is on the pair, not on the slot alone.
  (t) => [uniqueIndex("weekend_assignment_slot_employee").on(t.slotId, t.employeeId)],
);

/** Who is allowed on a preset. ZERO rows for a preset means everyone is allowed. */
export const templatePool = sqliteTable(
  "template_pool",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    templateId: integer().notNull().references(() => shiftTemplates.id),
    employeeId: integer().notNull().references(() => employees.id),
  },
  (t) => [uniqueIndex("template_pool_unique").on(t.templateId, t.employeeId)],
);

/** What a worker would rather have. Only ever breaks an exact tie. */
export const templatePreference = sqliteTable(
  "template_preference",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    templateId: integer().notNull().references(() => shiftTemplates.id),
    employeeId: integer().notNull().references(() => employees.id),
    weight: integer().notNull().default(1),
  },
  (t) => [uniqueIndex("template_preference_unique").on(t.templateId, t.employeeId)],
);

/** Public holidays and Russia's transferred working Saturdays. */
export const calendarDays = sqliteTable("calendar_days", {
  date: text().primaryKey(),
  kind: text().$type<"holiday" | "workday">().notNull(),
  note: text(),
});

/**
 * Team-wide toggles. Key-value rather than columns: today there is exactly one
 * key (`swaps_locked`), and a single-column table for it — so that the next
 * toggle needs a fresh migration — is a bad trade.
 *
 * An ABSENT row means the default. The migration seeds nothing, so a database
 * that never saw this feature behaves exactly as it did before.
 */
export const appSettings = sqliteTable("app_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedByEmployeeId: integer().references(() => employees.id),
  updatedAt: integer({ mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
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
/**
 * One collection of money: a birthday round, or one an admin made by hand.
 *
 * A birthday is the special case here rather than a separate thing: it has an
 * `employee_id` and a `year` (the pair is its key) and no `title`. A custom one
 * is the other way round — it has a subject, and an honouree is optional:
 * everybody chips in for the office coffee machine.
 *
 * There is deliberately no `status` column: it follows from `collect_url` and
 * `send_count` (`collectionStatus` in `@planer/shared`). A stored status would
 * be a second source of truth, and with reminders it would start lying outright
 * — a custom collection marked «sent» still has a live send button.
 *
 * The bot still never mails the team on its own: it nudges admins, and every
 * message after that is a button they pressed.
 */
export const collections = sqliteTable(
  "collections",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    kind: text().$type<CollectionKind>().notNull().default("custom"),
    /** The «виновник торжества». NULL for a general collection. */
    employeeId: integer().references(() => employees.id),
    /** Birthday only: the calendar year this round belongs to. */
    year: integer(),
    /** Birthday only: when it is marked, YYYY-MM-DD. */
    celebratedOn: text(),
    /** What a custom collection is for. NULL on a birthday — its title is the name. */
    title: text(),
    /** When the event is: a wedding, a send-off, the office party. */
    eventDate: text(),
    /** «Скиньтесь до» — the collection's edge, which outranks the event date. */
    deadline: text(),
    /** Whole roubles. A whip-round is never counted in kopecks. */
    amountPerPerson: integer(),
    totalGoal: integer(),
    collectUrl: text(),
    /** What the team will be sent. Null means "use the default wording". */
    messageText: text(),
    /** When an admin pressed «Собрали, закрыть». NULL while it is still running. */
    closedAt: integer({ mode: "timestamp" }),
    /** When admins were nudged, so they are nudged once rather than every tick. */
    adminNotifiedAt: integer({ mode: "timestamp" }),
    scheduledSendOn: text(),
    scheduleNotifiedAt: integer({ mode: "timestamp" }),
    /** The LAST send. */
    sentAt: integer({ mode: "timestamp" }),
    /** How many people the LAST send actually reached. */
    sentCount: integer().notNull().default(0),
    /** How many rounds went out at all — the only truth about «разослано». */
    sendCount: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // Partial: «one birthday round per person per year» is a rule about
    // birthdays only. Without the `WHERE`, two custom collections for the same
    // person would not clash anyway (in SQLite `NULL ≠ NULL` inside a unique
    // index), but the rule would stop reading as a rule.
    uniqueIndex("collection_birthday_unique")
      .on(t.employeeId, t.year)
      .where(sql`${t.kind} = 'birthday'`),
  ],
);

export type VacantSlot = typeof vacantSlots.$inferSelect;
export type NewVacantSlot = typeof vacantSlots.$inferInsert;
export type SlotInterest = typeof slotInterest.$inferSelect;
export type NewSlotInterest = typeof slotInterest.$inferInsert;
export type WeekendAssignment = typeof weekendAssignments.$inferSelect;
export type NewWeekendAssignment = typeof weekendAssignments.$inferInsert;
export type TemplatePool = typeof templatePool.$inferSelect;
export type NewTemplatePool = typeof templatePool.$inferInsert;
export type TemplatePreference = typeof templatePreference.$inferSelect;
export type NewTemplatePreference = typeof templatePreference.$inferInsert;
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type CalendarDay = typeof calendarDays.$inferSelect;
export type NewCalendarDay = typeof calendarDays.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
