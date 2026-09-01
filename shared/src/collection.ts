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

/** За сколько дней до праздника сбор уходит команде. */
export const AUTO_SEND_LEAD_DAYS = 3;

/**
 * Час, раньше которого бот про сборы молчит.
 *
 * Тик крутится каждые пять минут и до появления этой константы получал только
 * дату — значит первым тиком после полуночи и работал. Админам это давало нудж
 * в 00:03; команде, которой бот теперь пишет сам, так слать нельзя вовсе.
 *
 * Константой, а не строкой в `app_settings`: менять её никто не просил, а ряд
 * настройки с переключателем в консоли — работа вперёд.
 *
 * Живёт здесь, рядом с `AUTO_SEND_LEAD_DAYS`: это правило рассылки, а не деталь
 * сервера, и то же обещание («разошлю в 10:00») печатает подтверждение из
 * `collections/`. Пока она лежала в `birthdays/`, каталог сборов был обязан
 * тянуть её оттуда — а обратное ребро уже есть, `birthday-notice` импортирует
 * `collection-service`, и следующий такой импорт замкнул бы кольцо.
 */
export const COLLECTION_SEND_HOUR = "10:00";

/**
 * День, в который бот разошлёт сбор сам.
 *
 * `max(праздник − опережение, сегодня)`, а не просто «минус три»: ссылку
 * приносят и накануне, и в этом случае ждать до прошедшей даты значит не
 * разослать никогда. Живёт здесь, а не на сервере, потому что ту же дату
 * считают обе консоли, когда переключатель включают обратно.
 */
export function autoSendDateFor(
  celebratedOn: string,
  today: string,
  leadDays: number = AUTO_SEND_LEAD_DAYS,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(celebratedOn);
  // Непонятная дата не должна превращаться в `NaN` и уехать строкой в базу:
  // «сегодня» — единственный безопасный ответ, он рассылает, а не теряет сбор.
  if (!match) return today;
  const month = Number(match[2]);
  const day = Number(match[3]);
  // `Date.parse` ниже не отвергает «30 февраля» — молча переносит его на
  // 2 марта, и опережение посчиталось бы от дня, которого не существует. Та
  // же ловушка и та же защита, что в `formatDayMonth` пятью строками выше.
  if (month < 1 || month > 12) return today;
  if (day < 1 || day > MONTH_LENGTHS[month - 1]!) return today;
  const stamp = Date.parse(`${celebratedOn}T00:00:00Z`);
  const lead = new Date(stamp - leadDays * 86_400_000).toISOString().slice(0, 10);
  return lead > today ? lead : today;
}

/** «Бот разошлёт команде 4 сентября» — одна подпись на обе консоли. */
export function autoSendLabel(autoSendOn: string | null, today: string): string | null {
  if (!autoSendOn) return null;
  if (autoSendOn <= today) return "Бот разошлёт команде сегодня";
  return `Бот разошлёт команде ${formatDayMonth(autoSendOn)}`;
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
    // Без метки даты — пустой лейбл, а не пробел перед точкой: конструктор
    // способен собрать такой вход и не только на бумаге, поле в типе — null.
    const label = input.birthDateLabel ? formatBirthDate(input.birthDateLabel) : null;
    const lines = [`🎂 ${input.personName ?? "Именинник"} празднует день рождения${label ? ` ${label}` : ""}.`];
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

/**
 * Текст, который РЕАЛЬНО уйдёт команде: свой, если админ его написал, иначе собранный.
 *
 * Ссылка дописывается к своему тексту, а не заменяет его. Повод — живой случай
 * 12 августа 2026: сбор ушёл 27 людям без ссылки. В карточке она была, поэтому
 * блокер «Нет ссылки на сбор» молчал и статус горел «Готово к отправке», — но
 * свой текст подставлялся ВМЕСТО собранного письма, вместе со строкой «Сбор: …»,
 * которую собирает `collectionMessage`. Два поля молча гасили друг друга, и
 * двадцать семь человек получили просьбу скинуться без способа скинуться.
 *
 * Дописываем, а не запрещаем отправку: ссылка в сборе — не украшение, а весь его
 * смысл, и админ, написавший свои слова, не должен выбирать между своими словами
 * и работающим письмом. Слова остаются дословно, ссылка едет отдельной строкой —
 * ровно так же, как в собранном письме.
 *
 * Если админ вставил ссылку в свой текст сам — второй копии не будет.
 *
 * Живёт здесь, а не в сервисе, потому что до этой функции строка
 * `messageText?.trim() || collectionMessage(...)` жила в ТРЁХ копиях: на
 * сервере и в моках обеих консолей. Починка одной копии оставила бы дев-экраны
 * показывать письмо, которого команда не получит.
 */
export function outgoingCollectionMessage(
  input: CollectionMessageInput,
  mode: "first" | "reminder",
  customText: string | null,
): string {
  const custom = customText?.trim();
  if (!custom) return collectionMessage(input, mode);
  if (!input.collectUrl || custom.includes(input.collectUrl)) return custom;
  return `${custom}\n\nСбор: ${input.collectUrl}`;
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
