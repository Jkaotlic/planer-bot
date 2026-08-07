import { categoryLabel, type EntryCategory } from "./category";
import { parseISODate, weekdayShort } from "./week-dates";

/**
 * Каждый тип события, который сервер умеет записывать в `audit_log`.
 *
 * Единственный список на весь проект: сервер типизирует им `recordAudit`, оба
 * консоля — таблицу описателей. Добавил тип сюда, но не добавил описание — `tsc`
 * красный. Раньше эту роль исполняли два зеркальных теста и два дубля
 * `TYPE_LABELS`, и консоли всё равно разъезжались.
 */
export type AuditType =
  | "entry_created" | "entry_updated" | "entry_deleted"
  | "swap_proposed" | "swap_accepted" | "swap_declined"
  | "swap_cancelled" | "swap_expired" | "swap_auto_cancelled"
  | "distribution_applied" | "roster_import"
  | "employee_created" | "employee_updated" | "employee_reordered"
  | "employee_archived" | "employee_restored" | "employee_admin_changed"
  | "employee_invite_issued" | "settings_changed"
  | "template_roles_changed" | "template_rotation_changed"
  | "weekend_slot_created" | "weekend_assigned" | "weekend_unassigned"
  | "weekend_interest" | "weekend_offer_confirmed" | "weekend_offer_declined"
  | "birthday_sent" | "birthday_admin_notice" | "birthday_schedule_notice"
  | "birthday_campaign_updated"
  | "reminder_undeliverable" | "reminders_dispatched";

export interface AuditView {
  /** Одиночный символ — опознавательный знак строки в ленте. */
  icon: string;
  /** «Изменена смена» — что произошло, одной фразой. */
  title: string;
  /** Подробности, по строке на факт. Может быть пустым. */
  lines: string[];
}

type Describer = (payload: Record<string, unknown>) => Omit<AuditView, "icon"> & { icon?: string };

const monthDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const moment = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** «5 августа, 14:32» — журнал читают по «когда», поэтому дата ведёт. */
export function formatAuditMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return moment.format(date);
}

/** Месяц вокруг `today` — период, на котором открывается отчёт «кто сколько». */
export function auditMonthRange(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

// ——— мелкие форматтеры, общие для описателей ———

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** «ср 12 августа». Некорректную дату отдаёт как есть — врать не о чем. */
function dayLabel(iso: unknown): string {
  const s = str(iso);
  if (!s) return "без даты";
  const date = parseISODate(s);
  if (Number.isNaN(date.getTime())) return s;
  return `${weekdayShort(s).toLowerCase()} ${monthDay.format(date)}`;
}

/**
 * Имя работника из payload'а, а если его там нет — номер.
 *
 * Старые записи имени не несут (его начали писать позже), и достраивать его
 * текущим состоянием базы нельзя: человека могли переименовать, и журнал начал
 * бы рассказывать про прошлое сегодняшними словами.
 */
function personLabel(payload: Record<string, unknown>, nameKey = "employeeName", idKey = "employeeId"): string {
  return str(payload[nameKey]) ?? (num(payload[idKey]) != null ? `работник #${num(payload[idKey])}` : "неизвестно кто");
}

/** «День 09:00–18:00» или «Весь день» — как запись выглядит человеку. */
function entryLabel(entry: Record<string, unknown>): string {
  const title = str(entry.title);
  const start = str(entry.start);
  const end = str(entry.end);
  const time = start && end ? `${start}–${end}` : "Весь день";
  return title ? `${title} ${time}` : time;
}

/** «ср 12 августа» или «ср 12 августа — чт 20 августа» для многодневной записи. */
function spanLabel(entry: Record<string, unknown>): string {
  const end = str(entry.endDate);
  return end ? `${dayLabel(entry.date)} — ${dayLabel(end)}` : dayLabel(entry.date);
}

/** «смена» / «отпуск» / … — чтобы заголовок назывался тем, что произошло. */
function categoryWord(entry: Record<string, unknown>): string {
  const category = str(entry.category);
  if (!category || !(category in CATEGORY_GENDER)) return "запись";
  return categoryLabel(category as EntryCategory).toLowerCase();
}

/**
 * Род главного слова каждой категории — для согласования «Добавлена смена», но
 * «Добавлено дежурство».
 *
 * Таблицей, а не по последней букве: «Дежурство» и «Выездное мероприятие»
 * средние, а «Работа в выходной» женского рода при мужском окончании — любая
 * эвристика по хвосту строки ошибается как минимум трижды из семи.
 */
const CATEGORY_GENDER: Record<EntryCategory, "m" | "f" | "n"> = {
  shift: "f", vacation: "m", sick_leave: "m", duty: "n",
  offsite: "n", business_trip: "f", weekend_work: "f",
};

const VERB = {
  created: { m: "Добавлен", f: "Добавлена", n: "Добавлено" },
  updated: { m: "Изменён", f: "Изменена", n: "Изменено" },
  deleted: { m: "Удалён", f: "Удалена", n: "Удалено" },
} as const;

/** «Изменена смена» / «Изменено дежурство» / «Изменён отпуск». */
function entryTitle(verb: keyof typeof VERB, entry: Record<string, unknown>): string {
  const category = str(entry.category);
  const gender = category && category in CATEGORY_GENDER ? CATEGORY_GENDER[category as EntryCategory] : "f";
  return `${VERB[verb][gender]} ${categoryWord(entry)}`;
}

function entryView(entry: Record<string, unknown>): string[] {
  return [`${personLabel(entry)} · ${spanLabel(entry)}`, entryLabel(entry)];
}

function swapLines(p: Record<string, unknown>): string[] {
  return [
    `${personLabel(p, "fromName", "fromEmployeeId")} отдаёт: ${str(p.fromShift) ?? "—"}`,
    `${personLabel(p, "toName", "toEmployeeId")} отдаёт: ${str(p.toShift) ?? "—"}`,
  ];
}

/** Пять выходных событий отличаются только заголовком и значком. */
function weekendView(p: Record<string, unknown>, icon: string, title: string) {
  return { icon, title, lines: [personLabel(p), str(p.slot) ?? `слот #${num(p.slotId) ?? "?"}`] };
}

// ——— таблица описателей ———
// `Partial` снят: с этого момента полноту стережёт компилятор, а не зеркальный
// тест в каждом консоле.
const DESCRIBERS: Record<AuditType, Describer> = {
  entry_created: (p) => ({ icon: "＋", title: entryTitle("created", p), lines: entryView(p) }),
  entry_deleted: (p) => ({ icon: "🗑", title: entryTitle("deleted", p), lines: entryView(p) }),
  entry_updated: (p) => {
    const before = obj(p.before);
    const after = obj(p.after);
    const lines = [`${personLabel(after)} · ${spanLabel(after)}`];
    if (num(before.employeeId) !== num(after.employeeId)) {
      lines.push(`работник: ${personLabel(before)} → ${personLabel(after)}`);
    }
    if (spanLabel(before) !== spanLabel(after)) {
      lines.push(`день: ${spanLabel(before)} → ${spanLabel(after)}`);
    }
    if (entryLabel(before) !== entryLabel(after)) {
      lines.push(`было: ${entryLabel(before)}`, `стало: ${entryLabel(after)}`);
    }
    return { icon: "✎", title: entryTitle("updated", after), lines };
  },

  swap_proposed: (p) => ({ icon: "🔁", title: "Предложен обмен", lines: swapLines(p) }),
  swap_accepted: (p) => ({ icon: "🔁", title: "Обмен состоялся", lines: swapLines(p) }),
  swap_declined: (p) => ({ icon: "🔁", title: "Обмен отклонён", lines: swapLines(p) }),
  swap_cancelled: (p) => ({ icon: "🔁", title: "Обмен отменён", lines: swapLines(p) }),
  swap_expired: (p) => ({ icon: "🔁", title: "Обмен стал неактуален", lines: swapLines(p) }),
  swap_auto_cancelled: (p) => ({ icon: "🔁", title: "Обмен отменён автоматически", lines: swapLines(p) }),

  distribution_applied: (p) => ({
    icon: "⚖",
    title: "Смены распределены честно",
    lines: [`${dayLabel(p.from)} — ${dayLabel(p.to)}`, `${num(p.count) ?? 0} смен расставлено`],
  }),
  roster_import: (p) => ({
    icon: "📥",
    title: "Загружен график из CSV",
    lines: [
      [
        `${num(p.entriesInserted) ?? 0} записей`,
        num(p.employeesCreated) ? `${num(p.employeesCreated)} человек добавлено` : null,
        num(p.employeesRenamed) ? `${num(p.employeesRenamed)} переименовано` : null,
      ].filter(Boolean).join(" · "),
      ...(num(p.unknowns) ? [`${num(p.unknowns)} имён не опознано`] : []),
    ],
  }),

  employee_created: (p) => ({ icon: "👤", title: "Добавлен работник", lines: [personLabel(p, "displayName")] }),
  employee_archived: (p) => ({ icon: "📦", title: "Работник архивирован", lines: [personLabel(p, "displayName")] }),
  employee_restored: (p) => ({
    icon: "📦",
    title: "Работник восстановлен",
    lines: [personLabel(p, "displayName"), ...(str(p.via) ? ["через список админов"] : [])],
  }),
  employee_admin_changed: (p) => ({
    icon: "🔑",
    title: "Изменены права админа",
    lines: [`${personLabel(p, "displayName")} — ${p.isAdmin === true ? "теперь админ" : "больше не админ"}`],
  }),
  employee_reordered: (p) => ({
    icon: "↕",
    title: "Изменён порядок людей",
    lines: [personLabel(p, "displayName"), `${num(p.from) ?? "—"} → ${num(p.to) ?? "—"}`],
  }),
  employee_invite_issued: (p) => ({
    icon: "🔗",
    title: p.regenerated === true ? "Перевыпущена ссылка-приглашение" : "Выдана ссылка-приглашение",
    // Самой ссылки здесь нет и быть не должно: это действующий ключ к учётной записи.
    lines: [personLabel(p, "displayName"), ...(p.regenerated === true ? ["прежняя ссылка больше не работает"] : [])],
  }),
  employee_updated: (p) => {
    const before = obj(p.before);
    const after = obj(p.after);
    const lines: string[] = [];
    if (str(before.displayName) !== str(after.displayName)) {
      lines.push(`имя: ${str(before.displayName) ?? "—"} → ${str(after.displayName) ?? "—"}`);
    }
    if (str(before.birthDate) !== str(after.birthDate)) {
      lines.push(`день рождения: ${str(before.birthDate) ?? "не указан"} → ${str(after.birthDate) ?? "не указан"}`);
    }
    if (str(before.preferredName) !== str(after.preferredName)) {
      lines.push(`обращение: ${str(before.preferredName) ?? "по умолчанию"} → ${str(after.preferredName) ?? "по умолчанию"}`);
    }
    // Старые записи несут только состояние «после» — их и показываем.
    if (lines.length === 0) lines.push(personLabel(p, "displayName"));
    else lines.unshift(str(after.displayName) ?? personLabel(p, "displayName"));
    return { icon: "👤", title: "Изменены данные работника", lines };
  },
  settings_changed: (p) => {
    const lines = [personLabel(p, "displayName")];
    if (typeof p.remindersEnabled === "boolean") {
      lines.push(p.remindersEnabled ? "напоминания включены" : "напоминания выключены");
    }
    if (p.preferredName !== undefined) {
      lines.push(`обращение: ${str(p.preferredName) ?? "по умолчанию"}`);
    }
    return { icon: "⚙", title: "Работник изменил настройки", lines };
  },

  template_roles_changed: (p) => ({
    icon: "🎚",
    title: "Изменено «кто что может»",
    lines: [
      str(p.templateName) ?? `пресет #${num(p.templateId) ?? "?"}`,
      `${num(p.poolSize) ?? 0} допущено · ${num(p.preferred) ?? 0} с приоритетом`,
    ],
  }),
  template_rotation_changed: (p) => ({
    icon: "🎚",
    title: "Изменена очередь",
    lines: [str(p.templateName) ?? `пресет #${num(p.templateId) ?? "?"}`, `шаг: ${str(p.rotationUnit) ?? "—"}`],
  }),

  weekend_slot_created: (p) => ({
    icon: "📣",
    title: "Открыта смена на выходной",
    lines: [str(p.slot) ?? `слот #${num(p.slotId) ?? "?"}`, `предложено ${num(p.delivered) ?? 0} из ${num(p.intended) ?? 0}`],
  }),
  weekend_assigned: (p) => weekendView(p, "🎯", "Выходная смена назначена"),
  weekend_unassigned: (p) => weekendView(p, "↩", "Назначение на выходной снято"),
  weekend_interest: (p) => weekendView(p, "🙋", "Отклик на выходную смену"),
  weekend_offer_confirmed: (p) => weekendView(p, "✅", "Выходная смена подтверждена"),
  weekend_offer_declined: (p) => weekendView(p, "🚫", "От выходной смены отказались"),

  birthday_sent: (p) => ({
    icon: "🎂",
    title: "Разослан сбор на день рождения",
    lines: [personLabel(p, "displayName"), `доставлено ${num(p.delivered) ?? 0} из ${num(p.intended) ?? 0}`],
  }),
  birthday_admin_notice: (p) => ({
    icon: "🎂",
    title: "Напоминание админам о дне рождения",
    lines: [personLabel(p, "displayName"), `через ${num(p.daysUntil) ?? 0} дн. · дошло до ${num(p.delivered) ?? 0}`],
  }),
  birthday_schedule_notice: (p) => ({
    icon: "🎂",
    title: "Напоминание админам о сборе",
    lines: [personLabel(p, "displayName"), `сбор на ${dayLabel(p.scheduledSendOn)} · дошло до ${num(p.delivered) ?? 0}`],
  }),
  birthday_campaign_updated: (p) => {
    const lines = [personLabel(p, "displayName")];
    if (p.scheduledSendOn !== undefined) lines.push(`напомнить: ${str(p.scheduledSendOn) ? dayLabel(p.scheduledSendOn) : "не напоминать"}`);
    if (p.collectUrl !== undefined) lines.push(str(p.collectUrl) ? "ссылка на сбор изменена" : "ссылка на сбор убрана");
    // Сам текст поздравления в журнал не копируется — здесь только факт правки.
    if (p.messageText !== undefined) lines.push(str(p.messageText) ? "текст изменён" : "текст сброшен на стандартный");
    return { icon: "🎂", title: "Изменён сбор на день рождения", lines };
  },

  reminder_undeliverable: (p) => ({
    icon: "🚫",
    title: "Напоминание не дошло — бот заблокирован",
    lines: [personLabel(p, "displayName"), `код ответа ${num(p.errorCode) ?? "—"}`],
  }),
  reminders_dispatched: (p) => ({
    icon: "🔔",
    title: "Разосланы напоминания на завтра",
    lines: [`на ${dayLabel(p.forDate)}`, `${num(p.sent) ?? 0} из ${num(p.considered) ?? 0} человек`],
  }),
};

/**
 * Событие журнала словами.
 *
 * Тип, которого нет в таблице (строка из старой базы, событие из будущей
 * версии), не прячется: заголовком становится сырой тип, а телом —
 * форматированный payload. Потерять запись хуже, чем показать её некрасиво.
 */
export function describeAuditEvent(event: { type: string; payload: unknown }): AuditView {
  const describe = DESCRIBERS[event.type as AuditType];
  if (!describe) {
    return { icon: "•", title: event.type, lines: [JSON.stringify(event.payload ?? null, null, 2)] };
  }
  const view = describe(obj(event.payload));
  return { icon: view.icon ?? "•", title: view.title, lines: view.lines };
}
