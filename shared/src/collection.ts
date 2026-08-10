import { MONTH_NAMES } from "./birthday";

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
  if (month < 1 || month > 12 || day < 1 || day > 31) return iso;
  return `${day} ${MONTH_NAMES[month - 1]}`;
}
