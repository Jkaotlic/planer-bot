import { sql } from "drizzle-orm";
import { sqliteTable, index, integer, text, real, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  SwapStatus,
  EntryCategory,
  TemplateAccent,
  AuditType,
  CollectionKind,
  HandoverStatus,
  AdminNoticeKind,
} from "@planer/shared";

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
  /**
   * Рисовать ли расшифровку букв под картинкой недели.
   *
   * Личная настройка: тому, кто коды уже помнит, плашка занимает четверть
   * экрана телефона, а тому, кто их только учит, без неё картинка бесполезна.
   * По умолчанию включена — так было до того, как настройка появилась.
   */
  weekLegend: integer({ mode: "boolean" }).notNull().default(true),
  /**
   * С какой вкладки открывать мини-апп. `null` — «Смены», как было всегда.
   *
   * Строка, а не enum: SQLite всё равно хранит текст, а список вкладок живёт в
   * `shared/start-tab.ts` — единственном месте, где он и должен быть. Значение
   * проверяется на входе и ещё раз на старте приложения: роль могли сменить уже
   * после того, как выбор сохранился.
   */
  startTab: text(),
  /** An admin took this person out of AUTOMATIC placement: очередь дежурств
   *  («кому следующему»), the weekend call for volunteers, and weekend assignment.
   *  An admin can still place them by hand — this is not archiving. */
  excludedFromAssignment: integer({ mode: "boolean" }).notNull().default(false),
  /** An admin took this person out of swaps, both ways: neither propose nor accept. */
  excludedFromSwaps: integer({ mode: "boolean" }).notNull().default(false),
  /** Человек в графике, но вне командной механики: раздачи, обменов, передачи
   *  смены и сбора выходных. Не «архив» и не «исключён» — он смотрит график и
   *  рассылает объявления. Что именно из этого следует, решает `shared/src/access.ts`,
   *  а не двадцать проверок по коду. */
  isObserver: integer({ mode: "boolean" }).notNull().default(false),
  /** Наблюдатель сам решил вести свой график. Выключено по умолчанию: пока он
   *  этого не захотел, его интерфейс остаётся смотровым. Ставит его он сам,
   *  а не админ, — поэтому поле не в `setEmployeeRestrictions`. */
  selfScheduleEnabled: integer({ mode: "boolean" }).notNull().default(false),
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
  /**
   * Слать ли напоминание накануне тому, у кого завтра смена этого вида.
   *
   * До 0030 колонка лежала мёртвой: кому напоминать, решала эвристика по часам
   * смены. Теперь решает она, а `remindsByDefault` («всё, кроме обычного дня»)
   * осталась запасным правилом для записей без вида смены — импортированных и
   * проставленных руками — и тем, чем 0030 колонку засеяла.
   */
  sendReminder: integer({ mode: "boolean" }).notNull().default(false),
  /**
   * Свой текст напоминания. `null` — стандартная формулировка по типу смены.
   *
   * Пустая строка сюда не пишется: «нет своего текста» и «свой текст пустой» —
   * это одно и то же состояние, и два способа его записать означали бы, что
   * половина команды получает письмо без слов.
   */
  reminderText: text(),
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
},
  /**
   * Самая читаемая таблица проекта и самая растущая (≈ +500 строк в месяц).
   *
   * `(date)` — расписание за неделю и за месяц: обе сетки, командный ответ,
   * отчёты, выгрузка ростера. `(employee_id, date)` — история одного человека:
   * баланс, очередь дежурств, «мои смены». До индексов оба шли полным сканом.
   */
  (t) => [index("shift_date").on(t.date), index("shift_employee_date").on(t.employeeId, t.date)],
);

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
},
  /**
   * По одному на каждую сторону, а не составной: обе выборки — это `OR`
   * («мои обмены» по двум колонкам работника, висящие заявки по двум колонкам
   * смены), и составной индекс на `OR` не работает, а два отдельных SQLite
   * умеет объединить.
   *
   * Заявок в базе единицы, и сама по себе таблица индексов не просила — но
   * «висящие заявки на эту смену» с 2026-08-17 спрашиваются при КАЖДОМ переносе
   * даты записи, то есть на пути правки графика.
   */
  (t) => [
    index("swap_from_employee").on(t.fromEmployeeId),
    index("swap_to_employee").on(t.toEmployeeId),
    index("swap_from_shift").on(t.fromShiftId),
    index("swap_to_shift").on(t.toShiftId),
  ],
);

/**
 * A shift its owner cannot work, on its way to somebody who can.
 *
 * Born from a worker recording their own «больничный», never from an admin's
 * edit: an admin is already looking at the schedule and reassigns faster than
 * any ladder. The ladder exists for «человека у экрана нет».
 */
export const handovers = sqliteTable("handovers", {
  id: integer().primaryKey({ autoIncrement: true }),
  /**
   * Nullable for the same reason as `swap_requests.fromShiftId`: the row must
   * outlive the entry it points at. A handover whose shift was deleted is still
   * a thing that happened, and the journal row written beside it carries the
   * date and the time.
   */
  shiftId: integer().references(() => shifts.id),
  fromEmployeeId: integer().notNull().references(() => employees.id),
  /**
   * The «больничный» that spawned this. Nullable — the sick leave can be removed
   * while the handover stays as history; live rows are found by it when the sick
   * leave is cancelled or shortened.
   */
  sickEntryId: integer().references(() => shifts.id),
  status: text().$type<HandoverStatus>().notNull().default("offered"),
  /** Null means «веер» — the offer is open to everyone who is free. */
  offeredToEmployeeId: integer().references(() => employees.id),
  offeredAt: createdAt(),
  /**
   * When the admins were told. NOT a status: escalation does not replace the
   * stage, it is added to it — the fan-out stays open, and somebody can still
   * take the shift an hour before it starts. Without this mark the tick would
   * write to the admins every five minutes.
   */
  escalatedAt: integer({ mode: "timestamp" }),
  takenByEmployeeId: integer().references(() => employees.id),
  resolvedAt: integer({ mode: "timestamp" }),
});

export const handoverDeclines = sqliteTable(
  "handover_declines",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    handoverId: integer().notNull().references(() => handovers.id),
    employeeId: integer().notNull().references(() => employees.id),
    declinedAt: createdAt(),
  },
  // A separate table rather than a field on `handovers`, because the refusals do
  // two jobs: the fan-out must not write to those people again, and the
  // escalation letter names them one by one. A comma-joined text column would
  // have to be parsed back, and the first test about «кому не писать» would read
  // a string instead of rows.
  //
  // Uniqueness is on the pair, not on the person: a sick leave covering two days
  // makes two handovers, and one colleague may be unable to take either.
  (t) => [uniqueIndex("handover_decline_unique").on(t.handoverId, t.employeeId)],
);

export type Handover = typeof handovers.$inferSelect;
export type NewHandover = typeof handovers.$inferInsert;

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
},
  /**
   * Ровно в том порядке, в котором журнал читают: `order by created_at desc, id desc`.
   * Дорого стоило не нахождение строк, а сортировка ВСЕЙ таблицы ради пятидесяти
   * верхних (`USE TEMP B-TREE FOR ORDER BY`), а этот индекс SQLite читает назад.
   * Фильтры (тип, актор, диапазон дат) остаются поверх — они и так сужают выборку.
   */
  (t) => [index("audit_created").on(t.createdAt, t.id)],
);

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
},
  /** Слоты читаются по дате — «свободные смены в выходные» и проверка дубля
   *  при публикации. Слотов пока единицы, но растут они так же, как расписание. */
  (t) => [index("vacant_slot_date").on(t.date)],
);

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
/**
 * Исключения из правила «Сб/Вс — выходные»: праздник в будни и рабочая суббота.
 * Обычные выходные сюда не пишутся — их считает `isDayOff` в shared.
 *
 * `source` — чья строка. Автообновление переписывает только `auto`: день,
 * который админ поставил руками, не должен исчезать оттого, что бот перечитал
 * календарь. См. `repo/calendar-days.ts`.
 */
export const calendarDays = sqliteTable("calendar_days", {
  date: text().primaryKey(),
  kind: text().$type<"holiday" | "workday">().notNull(),
  note: text(),
  source: text().$type<"auto" | "manual">().notNull().default("auto"),
  // Без умолчания `unixepoch()`: SQLite не даёт добавить колонку с
  // неконстантным умолчанием, а расходиться со схемой миграция не должна.
  // Момент ставит писатель — оба живут в `repo/calendar-days.ts`.
  updatedAt: integer({ mode: "timestamp" }).notNull(),
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

/**
 * Какие виды писем админ себе выключил.
 *
 * СТРОКА ЕСТЬ — ВЫКЛЮЧЕНО, СТРОКИ НЕТ — ВКЛЮЧЕНО. Тот же приём, что в
 * `app_settings`: миграция ничего не засеивает, и база, не знавшая этой фичи,
 * ведёт себя ровно как вчера. Обратная запись («включено») означала бы, что до
 * первого захода в настройки админу не приходит ничего.
 *
 * Отдельная таблица, а не колонки в `employees`: шестой вид потребовал бы
 * миграции таблицы, вокруг которой крутится вся система.
 */
export const notificationMutes = sqliteTable(
  "notification_mutes",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    employeeId: integer().notNull().references(() => employees.id),
    kind: text().$type<AdminNoticeKind>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("notification_mute_unique").on(t.employeeId, t.kind)],
);

export type NotificationMute = typeof notificationMutes.$inferSelect;

/**
 * Кому бот задал вопрос «что не так» и ждёт ответа.
 *
 * `employeeId` первичным ключом: окно одно на человека, второе нажатие заменяет
 * первое. Две строки с разными `promptMessageId` означали бы, что непонятно,
 * на какое приглашение смотреть.
 *
 * В базе, а не в памяти процесса: рестарт сервиса здесь и есть деплой, случается
 * регулярно, и молча съеденный багрепорт — худшее, что эта кнопка может сделать.
 * Человек уверен, что сообщил; админ ничего не получил; узнать неоткуда.
 */
export const bugReportPending = sqliteTable("bug_report_pending", {
  employeeId: integer().primaryKey().references(() => employees.id),
  /** На что смотреть, если человек ответит реплаем, а не просто следующим сообщением. */
  promptMessageId: integer().notNull(),
  createdAt: createdAt(),
});

/**
 * Ссылка, присланная админом, пока он выбирает, к какому сбору её привязать.
 *
 * Отдельная таблица, а не `callback_data`: там 64 байта, ссылка на сбор в них
 * не помещается. Одна строка на админа — выбор делается следующим тапом, а не
 * через час; новая присланная ссылка затирает прежнюю, и это и есть «передумал».
 */
export const collectionLinkPending = sqliteTable("collection_link_pending", {
  employeeId: integer().primaryKey().references(() => employees.id),
  url: text().notNull(),
  createdAt: createdAt(),
});

/** Жалоба на бота от живого человека. Своя таблица, а не строка в журнале:
 *  у неё есть жизнь после доставки — «новый» и «разобран». */
export const bugReports = sqliteTable("bug_reports", {
  id: integer().primaryKey({ autoIncrement: true }),
  employeeId: integer().notNull().references(() => employees.id),
  text: text().notNull(),
  createdAt: createdAt(),
  resolvedAt: integer({ mode: "timestamp" }),
  resolvedByEmployeeId: integer().references(() => employees.id),
});

export type BugReport = typeof bugReports.$inferSelect;

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
 * Правило «бот не пишет команде сам» с 31.08.2026 действует не везде:
 * `auto_send_on` ниже — заведённое тогда исключение, и оно ровно одно. Сбор на
 * день рождения, у которого есть ссылка, уходит команде сам за три дня до
 * праздника; вооружает его человек, вставивший ссылку и увидевший день.
 * Кастомный сбор рассылает по-прежнему только нажатая кнопка.
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
    /**
     * День, в который бот разошлёт сбор команде САМ. NULL — не разошлёт.
     *
     * Отдельно от `scheduledSendOn`, у которого смысл «пни админов»: раунды с
     * уже проставленной той датой начали бы молча рассылать сами, а смена
     * смысла живого поля — это не миграция, а сюрприз.
     */
    autoSendOn: text(),
    /** Когда попытка БЫЛА СДЕЛАНА — удачная или нет. Метка «не пробуй снова». */
    autoSentAt: integer({ mode: "timestamp" }),
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


/**
 * Чек-лист как сущность: имя, инструкция и набор пунктов.
 *
 * Именованный, а не единственный на систему: проверки у дежурного с семи и у
 * дежурного с восьми разные, и «скоп смен» задаётся тем, какие виды смен на
 * этот чек-лист ссылаются.
 *
 * Инструкция лежит здесь же, тремя полями, потому что закрывает три разных
 * случая: короткий текст читается прямо в чате, ссылка ведёт в живой документ,
 * который правят без нас, а файл доходит туда, где интернета может не быть.
 * Файл живёт двумя полями. `docPath` — путь на диске рядом с базой: это
 * источник истины с тех пор, как файл можно загрузить из браузера (браузер не
 * умеет положить документ в Telegram так, чтобы бот потом мог его переслать).
 * `docFileId` — КЭШ: первую отправку бот делает с диска, а возвращённый Telegram
 * идентификатор запоминает, и следующие уходят даром. Поэтому замена файла
 * обязана обнулять `docFileId`, иначе дежурным уходил бы прежний документ под
 * новым именем.
 */
export const checklists = sqliteTable("checklists", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  note: text(),
  docUrl: text(),
  docFileId: text(),
  docName: text(),
  docPath: text(),
  createdAt: createdAt(),
});

/**
 * Кто проходит этот чек-лист: какие виды смен на него ссылаются.
 *
 * Отдельная таблица, а не колонка `shift_templates.checklist_id`, потому что
 * связь с обеих сторон множественная: у вида смены бывает несколько списков
 * (общая инструкция этажа и отдельная задача на ту же смену), и один список
 * обслуживает несколько видов — это и есть «скоп смен».
 *
 * Пока связь была колонкой, назначение вида смены второму списку молча
 * отнимало его у первого: 2026-09-01 инструкция 47 этажа перестала приходить
 * дежурным, а экран сказал про неё лишь «не выбран вид смены», не назвав, кто
 * забрал.
 *
 * Пара — первичный ключ: «назначен дважды» и «назначен» — одно и то же, и
 * второй тап по кнопке не должен заводить вторую строку.
 */
export const checklistTemplates = sqliteTable(
  "checklist_templates",
  {
    checklistId: integer().notNull().references(() => checklists.id),
    templateId: integer().notNull().references(() => shiftTemplates.id),
  },
  (t) => [primaryKey({ columns: [t.checklistId, t.templateId] })],
);

/**
 * Пункт чек-листа дежурного.
 *
 * Содержимое — данные, а не код: процедуру пишет команда, а не этот репозиторий.
 * Новый чек-лист приезжает без единого пункта, и пока их ноль, бот про него
 * молчит.
 */
export const checklistItems = sqliteTable("checklist_items", {
  id: integer().primaryKey({ autoIncrement: true }),
  checklistId: integer().references(() => checklists.id),
  title: text().notNull(),
  /**
   * Пояснение к пункту: как именно проверять, на что смотреть.
   *
   * Отдельно от `title`: строка списка должна оставаться строкой, по которой
   * ведут пальцем, а подробности — тем, что раскрывают, когда не помнят.
   */
  note: text(),
  sortOrder: integer().notNull().default(0),
  /**
   * Убранный пункт гасится, а не удаляется: на него ссылаются вчерашние отметки,
   * а «что проверяли в августе» — ровно то, ради чего чек-лист заводят.
   */
  isActive: integer({ mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

/**
 * Отметка: такой-то человек такого-то числа прошёл такой-то пункт.
 *
 * Без сущности «прогон чек-листа»: она не отвечала бы ни на один вопрос, который
 * к чек-листу возникает, зато потребовала бы решать, что с ней делать, когда
 * смену передали другому.
 */
export const checklistMarks = sqliteTable(
  "checklist_marks",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    date: text().notNull(),
    employeeId: integer().notNull().references(() => employees.id),
    itemId: integer().notNull().references(() => checklistItems.id),
    doneAt: createdAt(),
  },
  // Отметка идемпотентна: двойной тап не должен оставлять две записи.
  (t) => [uniqueIndex("checklist_mark_unique").on(t.date, t.employeeId, t.itemId)],
);

/**
 * Отметка: такой-то человек сказал, что скинулся на такой-то сбор.
 *
 * Устроено как `checklist_marks`, и по той же причине: строка есть — отметился,
 * строки нет — не отметился. Колонки `paid` нет: булев флаг, который всегда
 * `true`, это не данные, а способ забыть удалить строку. Снятие галочки строку
 * удаляет.
 *
 * Знаменатель («из скольких») здесь не хранится: он считается из `recipientsOf`,
 * то есть из тех же людей, кому ушла рассылка. Зафиксированный в момент отправки
 * состав пришлось бы чинить при досылке, при выходе нового человека и при
 * деактивации старого — три ветки кода ради того, чтобы старая цифра не дрогнула.
 * Ушёл из команды — денег с него не ждут, и знаменатель обязан упасть.
 *
 * `markedBy` — чья это рука. Обычно своя, но наличкой в руки сдают регулярно, и
 * тогда галочку ставит админ. Экран показывает эту разницу, потому что «я
 * отметился» и «за меня отметили» — разные утверждения.
 */
export const collectionPayments = sqliteTable(
  "collection_payments",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    collectionId: integer().notNull().references(() => collections.id),
    employeeId: integer().notNull().references(() => employees.id),
    markedBy: integer().notNull().references(() => employees.id),
    markedAt: createdAt(),
  },
  // Отметка идемпотентна: двойной тап по медленной сети не должен оставлять
  // две записи и «сдали 8 из 7».
  (t) => [uniqueIndex("collection_payment_unique").on(t.collectionId, t.employeeId)],
);

export type CollectionPayment = typeof collectionPayments.$inferSelect;
export type NewCollectionPayment = typeof collectionPayments.$inferInsert;

export type Checklist = typeof checklists.$inferSelect;
export type NewChecklist = typeof checklists.$inferInsert;
export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type NewChecklistItem = typeof checklistItems.$inferInsert;
export type ChecklistMark = typeof checklistMarks.$inferSelect;
export type NewChecklistMark = typeof checklistMarks.$inferInsert;

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
