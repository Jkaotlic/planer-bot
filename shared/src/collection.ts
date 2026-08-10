import { formatBirthDate, MONTH_LENGTHS, MONTH_NAMES } from "./birthday";

/**
 * Сбор денег: на день рождения или заведённый админом руками.
 *
 * Правила здесь чистые — ни базы, ни сети, ни `Date.now()`. Их читают сервер и
 * обе консоли, поэтому единственный способ не дать им разъехаться — держать их
 * в одном месте, как это уже сделано с `describeAuditEvent`.
 */

/** Заводится системой из даты рождения — или руками админом по любому поводу. */
export type CollectionKind = "birthday" | "custom";

/** Где раунд: нет ссылки → есть ссылка → рассылали хотя бы раз. */
export type CollectionStatus = "pending" | "ready" | "sent";

/**
 * Всё, что нужно правилам, и ничего больше.
 *
 * `closedAt` типизирован широко намеренно: из базы приходит `Date`, из JSON —
 * строка, а правилу важен только сам факт «закрыт».
 */
export interface CollectionShape {
  kind: CollectionKind;
  employeeId: number | null;
  celebratedOn: string | null;
  title: string | null;
  eventDate: string | null;
  deadline: string | null;
  amountPerPerson: number | null;
  totalGoal: number | null;
  collectUrl: string | null;
  closedAt: Date | string | null;
  sendCount: number;
}

/**
 * Статус вычисляется, а не хранится.
 *
 * Хранимая колонка была бы вторым источником правды и с дожимами начала бы
 * врать: у кастомного сбора со статусом «разослано» кнопка «Разослать» жива.
 * Единственная правда о том, ушло ли что-то людям, — `sendCount`.
 */
export function collectionStatus(c: Pick<CollectionShape, "collectUrl" | "sendCount">): CollectionStatus {
  if (c.sendCount > 0) return "sent";
  return c.collectUrl ? "ready" : "pending";
}

/**
 * Идёт ли сбор прямо сейчас.
 *
 * Вычисляется, а не хранится флагом и не гасится фоновым тиком: тик можно
 * пропустить — и сбор повиснет у людей навсегда, а чистая функция ошибиться
 * этим способом не может.
 *
 * Дедлайн главнее даты события: «скиньтесь до» — это и есть край сбора, а
 * праздник может быть позже. У дня рождения дедлайна нет, его край — сам
 * праздник.
 */
export function isCollectionActive(c: CollectionShape, today: string): boolean {
  if (c.closedAt != null) return false;
  if (c.deadline) return c.deadline >= today;
  if (c.eventDate) return c.eventDate >= today;
  if (c.kind === "birthday") return (c.celebratedOn ?? "") >= today;
  return true;
}

/**
 * «25 000 ₽» — разряды неразрывным пробелом, чтобы сумма не разорвалась
 * переносом строки посреди числа.
 *
 * Группы режутся руками, а не через `toLocaleString`: тот отдаёт разный
 * разделитель в разных сборках ICU (U+00A0 против U+202F), и тест на точную
 * строку начинает зависеть от машины.
 */
export function formatMoney(amount: number): string {
  const digits = String(Math.round(amount));
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return `${groups.join(" ")} ₽`;
}

/** «22 августа» из `2026-08-22`. Непонятную строку отдаёт как есть. */
export function formatDayMonth(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Границу дня спрашиваем у месяца, а не у числа 31: «30 февраля» — это не дата,
  // и подписывать ею сбор нельзя. Таблица та же, что у `parseBirthDate`.
  if (month < 1 || month > 12) return iso;
  if (day < 1 || day > MONTH_LENGTHS[month - 1]!) return iso;
  return `${day} ${MONTH_NAMES[month - 1]}`;
}

/** «Свадьба» или «День рождения — Пётр Иванов» — как сбор зовут на экране. */
export function collectionTitle(c: Pick<CollectionShape, "kind" | "title">, personName: string | null): string {
  if (c.kind === "birthday") return personName ? `День рождения — ${personName}` : "День рождения";
  return c.title ?? "Сбор";
}

/** Всё, из чего собирается текст письма команде. */
export interface CollectionMessageInput {
  kind: CollectionKind;
  title: string | null;
  /** Имя виновника в именительном, или null у общего сбора. */
  personName: string | null;
  /** «MM-DD» из карточки работника — только для сбора на день рождения. */
  birthDateLabel: string | null;
  eventDate: string | null;
  deadline: string | null;
  amountPerPerson: number | null;
  totalGoal: number | null;
  collectUrl: string | null;
}

/**
 * Текст, который уходит команде: первая рассылка или дожим.
 *
 * В письмо попадают только заполненные поля — сбор, у которого не задано
 * ничего, кроме повода, читается одной строкой и не выглядит сломанным.
 *
 * Имя виновника ставится в именительном и отделяется тире. Мы храним одно
 * `display_name` и ничего, чем его склонять, а «сбор на Пётр Иванов» замечают
 * все и сразу — тот же приём уже применён в поздравлениях и в отмене обменов.
 */
export function collectionMessage(input: CollectionMessageInput, mode: "first" | "reminder"): string {
  // Поздравление с днём рождения он уже утвердил и читал живьём — эта работа
  // его не трогает вообще, включая отсутствие хвоста про мини-приложение и
  // отсутствие сумм: в сборе на подарок их никогда и не было.
  if (input.kind === "birthday") {
    const label = input.birthDateLabel ? formatBirthDate(input.birthDateLabel) : "";
    const lines = [`🎂 ${input.personName ?? "Именинник"} празднует день рождения ${label}.`];
    if (input.collectUrl) lines.push("", `Сбор на подарок: ${input.collectUrl}`);
    return lines.join("\n");
  }

  const subject = input.personName ? `${input.title ?? "Сбор"} — ${input.personName}` : (input.title ?? "Сбор");
  const withDate = input.eventDate ? `${subject}, ${formatDayMonth(input.eventDate)}` : subject;
  // Двоеточие, а не тире: на сборе с виновником тире уже занято именем, и
  // «Напоминаю про сбор — Свадьба — Пётр Иванов» читается как обрывок.
  const head = mode === "reminder"
    ? `⏰ Напоминаю про сбор: ${withDate}`
    : `${input.personName ? "🎁" : "💰"} ${withDate}`;

  const lines = [head];

  const money: string[] = [];
  if (input.amountPerPerson != null) money.push(`Скидываемся по ${formatMoney(input.amountPerPerson)}`);
  if (input.totalGoal != null) {
    money.push(money.length > 0 ? `нужно ${formatMoney(input.totalGoal)}` : `Нужно ${formatMoney(input.totalGoal)}`);
  }

  const body: string[] = [];
  if (money.length > 0) body.push(money.join(", "));
  if (input.deadline) body.push(`Скиньтесь до ${formatDayMonth(input.deadline)}.`);
  if (body.length > 0) lines.push("", ...body);

  if (input.collectUrl) lines.push("", `Сбор: ${input.collectUrl}`);
  // Хвост только у кастомных: текст поздравления с днём рождения он уже
  // утвердил, и трогать его эта работа не должна.
  if (input.kind === "custom" && input.collectUrl) {
    lines.push("", "Ссылка всегда есть в мини-приложении, вкладка «Команда».");
  }

  return lines.join("\n");
}

/** Сбор в списке — правилам порядка нужен ещё и момент создания. */
export interface CollectionSortable extends CollectionShape {
  /** ISO-момент, по которому закрытые раскладываются «новые сверху». */
  createdAt: string;
}

/**
 * Порядок в списке сборов, одинаковый в обеих консолях.
 *
 * Задан явно и здесь, а не в каждом экране: два независимых `sort` — это два
 * разных списка через полгода, чему в этом репозитории уже есть три примера.
 */
export function compareCollections(a: CollectionSortable, b: CollectionSortable, today: string): number {
  const activeA = isCollectionActive(a, today);
  const activeB = isCollectionActive(b, today);
  if (activeA !== activeB) return activeA ? -1 : 1;

  if (activeA) {
    const dateA = nearestDate(a);
    const dateB = nearestDate(b);
    // Бездатный сбор идёт в конец активных: у него нет края, по которому он
    // мог бы встать в очередь.
    if (dateA !== dateB) return (dateA ?? "9999-12-31").localeCompare(dateB ?? "9999-12-31");
    return (a.title ?? "").localeCompare(b.title ?? "", "ru");
  }

  return b.createdAt.localeCompare(a.createdAt);
}

function nearestDate(c: CollectionShape): string | null {
  return c.deadline ?? c.eventDate ?? c.celebratedOn ?? null;
}
