# Кастомные сборы средств — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Научить вкладку «Дни рождения» держать сборы, заведённые руками — на человека по любому поводу и общие, — с ручным дожимом, закрытием и разделом, где работник находит ссылку.

**Architecture:** `birthday_campaigns` перестраивается в одну таблицу `collections`, где день рождения становится частным случаем (`kind='birthday'`). Правила, которые читают обе консоли и сервер, живут чистыми функциями в `@planer/shared`. Отправка, предпросмотр и закрытие — по одному роуту на оба вида сбора, адресуются идентификатором сбора.

**Tech Stack:** TypeScript, better-sqlite3 + drizzle-orm, Hono, grammY, React (мини-апп на `@telegram-apps/telegram-ui`, консоль своя), vitest + jsdom.

**Спека:** `docs/superpowers/specs/2026-08-10-custom-collections-design.md` — читать целиком до первой задачи.

## Global Constraints

Каждая задача неявно включает всё, что здесь.

- **Слой 1 — TDD обязателен.** Тест вперёд, прогон, красный, потом код. Красноту доказывать: `git stash push <файл-реализации>` → тест обязан упасть → `git stash pop`. «Написал тест и код вместе» — не TDD.
- **Тест обязан уметь упасть.** Проверять не только «вернулось ожидаемое», но и что в фикстуре есть то, что не должно вернуться. Пустой ответ на фикстуре из одного элемента проходит и при полностью сломанной выборке.
- **Идентификаторы только латиницей.** `git grep -nE "(const|let|function) [а-яА-ЯёЁ]"` обязан оставаться пустым, включая тестовые фикстуры.
- **Комментарии в `server/src/**` — по-английски, и в коде, и в тестах.** Русские доменные термины — в «ёлочках» внутри английской фразы (`two identical «ФИО»`). В `shared/` и в мини-аппе комментарии по-русски — намеренная конвенция.
  **Два исключения, которые не надо «чинить»:** разделители секций в `app.ts` подписаны по-русски (`// --- Дни рождения ---`), и новый блок сборов повторяет этот же вид — иначе оглавление файла станет двуязычным; и в `app.ts` уже лежат старые русские комментарии, не относящиеся к этой работе, — переводить их не входит в задачи, трогать чужие строки ради языка нельзя.
- **Репозиторий публичный.** Никаких настоящих имён, фамилий, хендлов, telegram id. Перед каждым коммитом: `npx vitest run server/src/db/no-real-names.test.ts`.
- **`npm test` после правки мока или фикстуры.** Моки покрыты тестами, которые пинят точный состав данных; `npm run typecheck` этого не видит.
- **Бот пишет команде только по тапу админа.** Ни одна задача не заводит автоматической рассылки работникам.
- **Имя человека всегда в именительном.** В базе лежит только `display_name` и ничего, чем его склонять. Фраза строится через тире: `Свадьба — Пётр Иванов`.
- **Суммы — целые рубли**, разряды разделены неразрывным пробелом ` `. Копеек нет.
- **Сбор, где ты виновник, не показывается тебе нигде** — ни в списках, ни в предпросмотре, ни в журнале.
- **Кнопки гасятся на время запроса** (`disabled={busy}`), подтверждающая на время запроса пишет «Отправляю…». Подпись основной кнопки при этом не меняется.
- **Даты — строки `YYYY-MM-DD`**, сравниваются лексикографически. Никаких `Date` в правилах.
- **`as never` в фикстурах — только там, где значение никуда не читается.** У `never` нет ни одного свойства, поэтому `.map((c) => c.title)` после такого каста разваливается на `tsc --strict`, а его гоняет CI (`npm run typecheck`). Если фикстуру потом читают — кастовать в её настоящий тип. Поймано на Задаче 2.
- **Полную форму сообщения закреплять целиком (`toBe`), а не по кускам (`toContain`).** `toContain` не видит ни лишней пустой строки, ни пропавшей — ровно на этом спека однажды разошлась с кодом. Поймано на Задаче 2.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `shared/src/collection.ts` | Чистые правила сбора: статус, активность, заголовок, текст сообщения, порядок, деньги. Ноль зависимостей от БД. |
| `shared/src/collection.test.ts` | Тесты на них. |
| `server/src/db/schema.ts` | Таблица `collections` вместо `birthday_campaigns`. |
| `server/drizzle/0018_collections.sql` | Перестройка таблицы, перенос единственной живой строки. |
| `server/src/collections/collection-service.ts` | Сбор как сущность: чтение, создание, правка, закрытие, удаление, получатели, предпросмотр. |
| `server/src/collections/collection-service.test.ts` | Тесты на них. |
| `server/src/birthdays/birthday-service.ts` | Только «когда у кого праздник»: ближайшие ДР, заведение раунда, тексты нотисов. |
| `server/src/birthdays/birthday-notice.ts` | Два тика бота — без изменений по смыслу, переезжает на `sendCount`. |
| `server/src/repo/audit.ts` | `queryAudit` учится скрывать от смотрящего события про него самого. |
| `server/src/http/app.ts` | Роуты `/api/admin/birthdays/*`, `/api/admin/collections/*`, `/api/collections`. |
| `server/src/http/collections-route.test.ts` | Тесты новых роутов. |
| `miniapp/src/api/client.ts` · `mock.ts` | Типы и вызовы сборов в мини-аппе. |
| `admin/src/api/client.ts` · `mock.ts` | То же в десктопной консоли. |
| `miniapp/src/screens/admin/AdminCollections.tsx` | Раздел «Сборы» в мини-аппе (переименован из `AdminBirthdays.tsx`). |
| `admin/src/screens/CollectionsScreen.tsx` | Раздел «Сборы» в консоли (переименован из `BirthdaysScreen.tsx`). |
| `miniapp/src/screens/team/TeamCollections.tsx` | Секция «Идёт сбор» сверху во вкладке «Команда». |

---

### Task 1: Правила сбора — статус, активность, деньги, дата

**Files:**
- Create: `shared/src/collection.ts`
- Create: `shared/src/collection.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `MONTH_NAMES` и `MONTH_LENGTHS` из `shared/src/birthday.ts`. `MONTH_LENGTHS` там сейчас module-private — снять с неё замок словом `export`, больше в том файле не менять ничего.
- Produces:
  - `type CollectionKind = "birthday" | "custom"`
  - `type CollectionStatus = "pending" | "ready" | "sent"`
  - `interface CollectionShape` — общий вид сбора, на котором работают все правила
  - `collectionStatus(c: Pick<CollectionShape, "collectUrl" | "sendCount">): CollectionStatus`
  - `isCollectionActive(c: CollectionShape, today: string): boolean`
  - `formatMoney(amount: number): string`
  - `formatDayMonth(iso: string): string`

- [ ] **Step 1: Написать падающий тест**

Создать `shared/src/collection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  collectionStatus,
  formatDayMonth,
  formatMoney,
  isCollectionActive,
  type CollectionShape,
} from "./collection";

/** Общий сбор без единой даты — от него отталкиваются все случаи ниже. */
function shape(patch: Partial<CollectionShape> = {}): CollectionShape {
  return {
    kind: "custom",
    employeeId: null,
    celebratedOn: null,
    title: "Кофемашина",
    eventDate: null,
    deadline: null,
    amountPerPerson: null,
    totalGoal: null,
    collectUrl: null,
    closedAt: null,
    sendCount: 0,
    ...patch,
  };
}

describe("collectionStatus", () => {
  it("без ссылки — pending", () => {
    expect(collectionStatus({ collectUrl: null, sendCount: 0 })).toBe("pending");
  });

  it("со ссылкой, но не разослан — ready", () => {
    expect(collectionStatus({ collectUrl: "https://x", sendCount: 0 })).toBe("ready");
  });

  it("разослан хотя бы раз — sent, и это важнее ссылки", () => {
    expect(collectionStatus({ collectUrl: "https://x", sendCount: 1 })).toBe("sent");
    // Ссылку могли убрать после рассылки — «разослано» от этого не отменяется.
    expect(collectionStatus({ collectUrl: null, sendCount: 2 })).toBe("sent");
  });
});

describe("isCollectionActive", () => {
  it("закрытый руками неактивен, даже если все даты в будущем", () => {
    const closed = shape({ closedAt: "2026-08-09T10:00:00Z", deadline: "2026-12-31" });
    expect(isCollectionActive(closed, "2026-08-10")).toBe(false);
    // Тот же сбор без closedAt активен — иначе тест прошёл бы при любой реализации.
    expect(isCollectionActive({ ...closed, closedAt: null }, "2026-08-10")).toBe(true);
  });

  it("дедлайн главнее даты события", () => {
    const c = shape({ deadline: "2026-08-09", eventDate: "2026-12-31" });
    expect(isCollectionActive(c, "2026-08-10")).toBe(false);
    expect(isCollectionActive({ ...c, deadline: "2026-08-10" }, "2026-08-10")).toBe(true);
  });

  it("без дедлайна судит дата события, и сам день события ещё активен", () => {
    const c = shape({ eventDate: "2026-08-10" });
    expect(isCollectionActive(c, "2026-08-10")).toBe(true);
    expect(isCollectionActive(c, "2026-08-11")).toBe(false);
  });

  it("у дня рождения роль дедлайна играет сам праздник", () => {
    const c = shape({ kind: "birthday", employeeId: 7, title: null, celebratedOn: "2026-08-10" });
    expect(isCollectionActive(c, "2026-08-10")).toBe(true);
    expect(isCollectionActive(c, "2026-08-11")).toBe(false);
  });

  it("сбор без единой даты висит, пока его не закроют", () => {
    expect(isCollectionActive(shape(), "2099-01-01")).toBe(true);
  });
});

describe("formatMoney", () => {
  // Разделитель разрядов ниже — литеральный U+00A0. В исходнике он неотличим от
  // обычного пробела глазами, поэтому рядом стоит отдельный тест, проверяющий сам
  // код-пойнт: без него тест и реализация могут быть неправы одинаково и зелены.
  it("разделяет разряды неразрывным пробелом", () => {
    expect(formatMoney(25000)).toBe("25 000 ₽");
    expect(formatMoney(1000)).toBe("1 000 ₽");
    expect(formatMoney(500)).toBe("500 ₽");
    expect(formatMoney(1234567)).toBe("1 234 567 ₽");
  });

  it("не показывает копеек", () => {
    expect(formatMoney(999.6)).toBe("1 000 ₽");
  });
  it("не пропускает обычный пробел вместо неразрывного", () => {
    // Прямая проверка того самого дефекта: строка не должна содержать 0x20 вовсе.
    expect(formatMoney(25000)).not.toContain(" ");
    expect(formatMoney(25000).codePointAt(2)).toBe(0x00a0);
  });
});

describe("formatDayMonth", () => {
  it("«22 августа» — родительный падеж, без года", () => {
    expect(formatDayMonth("2026-08-22")).toBe("22 августа");
    expect(formatDayMonth("2026-01-01")).toBe("1 января");
  });

  it("непонятную строку отдаёт как есть — врать не о чем", () => {
    expect(formatDayMonth("не дата")).toBe("не дата");
    expect(formatDayMonth("2026-13-01")).toBe("2026-13-01");
  });

  it("несуществующий день месяца — не дата", () => {
    expect(formatDayMonth("2026-02-30")).toBe("2026-02-30");
    expect(formatDayMonth("2026-04-31")).toBe("2026-04-31");
    // А настоящие даты тех же месяцев по-прежнему читаются — иначе тест прошёл бы
    // и на функции, которая отвергает вообще всё.
    expect(formatDayMonth("2026-02-28")).toBe("28 февраля");
    expect(formatDayMonth("2026-04-30")).toBe("30 апреля");
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run shared/src/collection.test.ts`
Expected: FAIL — `Failed to resolve import "./collection"`.

- [ ] **Step 3: Написать реализацию**

Создать `shared/src/collection.ts`:

```ts
import { MONTH_LENGTHS, MONTH_NAMES } from "./birthday";

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
  // и подписывать ею сбор нельзя. Таблица та же, что у `parseBirthDate`, вместе с
  // её намеренными 29 днями февраля — почему так, написано там.
  if (month < 1 || month > 12) return iso;
  if (day < 1 || day > MONTH_LENGTHS[month - 1]!) return iso;
  return `${day} ${MONTH_NAMES[month - 1]}`;
}
```

- [ ] **Step 4: Подключить к barrel и прогнать тесты**

В `shared/src/index.ts` добавить строку после `export * from "./birthday";`:

```ts
export * from "./collection";
```

Run: `npx vitest run shared/src/collection.test.ts`
Expected: PASS, 12 тестов.

- [ ] **Step 5: Доказать, что тест умеет падать**

```bash
git stash push shared/src/collection.ts
npx vitest run shared/src/collection.test.ts   # обязан упасть
git stash pop
```

- [ ] **Step 6: Коммит**

```bash
npx vitest run server/src/db/no-real-names.test.ts
git add shared/src/collection.ts shared/src/collection.test.ts shared/src/index.ts
git commit -m "feat(shared): правила сбора — статус, активность, деньги, дата"
```

---

### Task 2: Правила сбора — заголовок, текст сообщения, порядок

**Files:**
- Modify: `shared/src/collection.ts`
- Modify: `shared/src/collection.test.ts`

**Interfaces:**
- Consumes: `CollectionShape`, `formatMoney`, `formatDayMonth`, `isCollectionActive` из Задачи 1.
- Produces:
  - `collectionTitle(c: Pick<CollectionShape, "kind" | "title">, personName: string | null): string`
  - `collectionMessage(input: CollectionMessageInput, mode: "first" | "reminder"): string`
  - `interface CollectionMessageInput`
  - `compareCollections(a: CollectionSortable, b: CollectionSortable, today: string): number`
  - `interface CollectionSortable extends CollectionShape { createdAt: string }`

**Замечание по тексту, расходящееся со спекой на один символ.** Спека приводит строку дожима как `⏰ Напоминаю про сбор — Кофемашина в офис`. На сборе с виновником это дало бы два тире подряд (`… — Свадьба — Пётр Иванов`), поэтому разделитель здесь — двоеточие: `⏰ Напоминаю про сбор: Кофемашина в офис`. Спеку поправить тем же коммитом.

- [ ] **Step 1: Написать падающий тест**

Дописать в `shared/src/collection.test.ts` (импорт расширить: `collectionMessage`, `collectionTitle`, `compareCollections`):

```ts
describe("collectionTitle", () => {
  it("у кастомного сбора — его повод", () => {
    expect(collectionTitle({ kind: "custom", title: "Кофемашина" }, null)).toBe("Кофемашина");
    expect(collectionTitle({ kind: "custom", title: "Свадьба" }, "Пётр Иванов")).toBe("Свадьба");
  });

  it("у дня рождения — имя в именительном через тире", () => {
    expect(collectionTitle({ kind: "birthday", title: null }, "Пётр Иванов")).toBe("День рождения — Пётр Иванов");
  });

  it("у дня рождения без имени не падает", () => {
    expect(collectionTitle({ kind: "birthday", title: null }, null)).toBe("День рождения");
  });
});

describe("collectionMessage", () => {
  const wedding = {
    kind: "custom" as const,
    title: "Свадьба",
    personName: "Пётр Иванов",
    birthDateLabel: null,
    eventDate: "2026-08-22",
    deadline: "2026-08-15",
    amountPerPerson: 1000,
    totalGoal: 25000,
    collectUrl: "https://example.test/c/1",
  };

  it("собирает первое сообщение из заполненных полей", () => {
    expect(collectionMessage(wedding, "first")).toBe(
      [
        "🎁 Свадьба — Пётр Иванов, 22 августа",
        "",
        "Скидываемся по 1 000 ₽, нужно 25 000 ₽",
        "Скиньтесь до 15 августа.",
        "",
        "Сбор: https://example.test/c/1",
        "",
        "Ссылка всегда есть в мини-приложении, вкладка «Команда».",
      ].join("\n"),
    );
  });

  it("общий сбор без виновника — другой значок и без имени", () => {
    const text = collectionMessage(
      { ...wedding, title: "Кофемашина в офис", personName: null, eventDate: null, deadline: null, totalGoal: null },
      "first",
    );
    expect(text.split("\n")[0]).toBe("💰 Кофемашина в офис");
    expect(text).toContain("Скидываемся по 1 000 ₽");
    expect(text).not.toContain("нужно");
    expect(text).not.toContain("Скиньтесь до");
  });

  it("дожим отличается только первой строкой", () => {
    const first = collectionMessage(wedding, "first").split("\n");
    const again = collectionMessage(wedding, "reminder").split("\n");
    expect(again[0]).toBe("⏰ Напоминаю про сбор: Свадьба — Пётр Иванов, 22 августа");
    expect(again.slice(1)).toEqual(first.slice(1));
  });

  it("одна только цель пишется с большой буквы", () => {
    const text = collectionMessage({ ...wedding, amountPerPerson: null }, "first");
    expect(text).toContain("Нужно 25 000 ₽");
    expect(text).not.toContain("Скидываемся");
  });

  it("пустой сбор — одна строка заголовка и ничего лишнего", () => {
    const text = collectionMessage(
      { kind: "custom", title: "Просто сбор", personName: null, birthDateLabel: null, eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null, collectUrl: null },
      "first",
    );
    expect(text).toBe("💰 Просто сбор");
  });

  it("день рождения сохраняет текст, который он уже утвердил, слово в слово", () => {
    const text = collectionMessage(
      {
        kind: "birthday", title: null, personName: "Пётр Иванов", birthDateLabel: "08-05",
        eventDate: "2026-08-05", deadline: null, amountPerPerson: null, totalGoal: null,
        collectUrl: "https://example.test/c/1",
      },
      "first",
    );
    expect(text).toBe("🎂 Пётр Иванов празднует день рождения 5 августа.\n\nСбор на подарок: https://example.test/c/1");
  });

  it("день рождения без ссылки — одна строка, и суммы в него не лезут", () => {
    const text = collectionMessage(
      {
        kind: "birthday", title: null, personName: "Пётр Иванов", birthDateLabel: "08-05",
        eventDate: null, deadline: "2026-08-04", amountPerPerson: 1000, totalGoal: null, collectUrl: null,
      },
      "first",
    );
    expect(text).toBe("🎂 Пётр Иванов празднует день рождения 5 августа.");
  });
});

describe("compareCollections", () => {
  const today = "2026-08-10";
  const base = {
    kind: "custom" as const, employeeId: null, celebratedOn: null, eventDate: null,
    amountPerPerson: null, totalGoal: null, collectUrl: null, closedAt: null, sendCount: 0,
  };
  // `as CollectionSortable`, а НЕ `as never`: у `never` нет ни одного свойства, и
  // `.map((c) => c.title)` ниже разваливается на `tsc --strict`, который гоняет CI.
  const row = (title: string, patch: Record<string, unknown>) =>
    ({ ...base, title, deadline: null, createdAt: "2026-08-01T00:00:00Z", ...patch }) as CollectionSortable;

  it("активные впереди закрытых, даже если закрытый ближе по дате", () => {
    const closed = row("Закрытый", { deadline: "2026-08-11", closedAt: "2026-08-09T00:00:00Z" });
    const open = row("Открытый", { deadline: "2026-12-31" });
    expect([closed, open].sort((a, b) => compareCollections(a, b, today)).map((c) => c.title))
      .toEqual(["Открытый", "Закрытый"]);
  });

  it("внутри активных — по ближайшей дате, бездатные в конце", () => {
    const far = row("Далёкий", { deadline: "2026-12-01" });
    const near = row("Близкий", { deadline: "2026-08-12" });
    const noDate = row("Бездатный", {});
    expect([noDate, far, near].sort((a, b) => compareCollections(a, b, today)).map((c) => c.title))
      .toEqual(["Близкий", "Далёкий", "Бездатный"]);
  });

  it("внутри закрытых — новые сверху", () => {
    const older = row("Старый", { closedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" });
    const newer = row("Новый", { closedAt: "2026-08-01T00:00:00Z", createdAt: "2026-08-01T00:00:00Z" });
    expect([older, newer].sort((a, b) => compareCollections(a, b, today)).map((c) => c.title))
      .toEqual(["Новый", "Старый"]);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run shared/src/collection.test.ts`
Expected: FAIL — `collectionTitle is not a function` и соседние.

- [ ] **Step 3: Написать реализацию**

Импорт в шапке `shared/src/collection.ts` расширить: `import { formatBirthDate, MONTH_LENGTHS, MONTH_NAMES } from "./birthday";` — ветка дня рождения зовёт `formatBirthDate`, чтобы «29 февраля» осталось «29 февраля» и в невисокосный год, а не превратилось в «1 марта».

Дописать в конец `shared/src/collection.ts`:

```ts
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
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run shared/src/collection.test.ts`
Expected: PASS, 27 тестов (14 от Задачи 1 + 13 новых).

- [ ] **Step 5: Поправить спеку под фактическую строку дожима**

В `docs/superpowers/specs/2026-08-10-custom-collections-design.md`, в разделе «Тексты», заменить

```
⏰ Напоминаю про сбор — Кофемашина в офис
```

на

```
⏰ Напоминаю про сбор: Кофемашина в офис
```

и дописать под блоком: «Двоеточие, а не тире: на сборе с виновником тире уже занято именем.»

- [ ] **Step 6: Доказать, что тест умеет падать, и закоммитить**

```bash
git stash push shared/src/collection.ts
npx vitest run shared/src/collection.test.ts   # обязан упасть
git stash pop
npx vitest run server/src/db/no-real-names.test.ts
git add shared/src/collection.ts shared/src/collection.test.ts docs/superpowers/specs/2026-08-10-custom-collections-design.md
git commit -m "feat(shared): заголовок сбора, текст письма команде, порядок списка"
```

---

### Task 3: Таблица `collections` и миграция живой базы

**Files:**
- Modify: `server/src/db/schema.ts:246-273` (блок `birthdayCampaigns`) и блок экспортов типов
- Create: `server/drizzle/0018_collections.sql`
- Modify: `server/drizzle/meta/_journal.json` (генерируется drizzle-kit'ом — см. Шаг 4)
- Create (временный, не коммитить): `check-collections-migration.mts` в корне репозитория

**Interfaces:**
- Consumes: `CollectionKind` из `@planer/shared` (Задача 1).
- Produces: `collections` (drizzle-таблица), типы `Collection`, `NewCollection`. Имена `birthdayCampaigns`, `BirthdayCampaign`, `NewBirthdayCampaign` **перестают существовать** — всё, что на них ссылалось, чинят Задачи 4–5.

- [ ] **Step 1: Зафиксировать состояние ДО на копии живой базы**

```bash
SCRATCH=/private/tmp/claude-501/-Users-user-planer-bot/*/scratchpad
cp data/planer.db "$(echo $SCRATCH)/pre.db"
sqlite3 "$(echo $SCRATCH)/pre.db" \
  "select id, employee_id, year, celebrated_on, status, sent_at, sent_count from birthday_campaigns;"
```

Ожидается ровно одна строка: `1|1|2026|2026-07-30|sent|<unix>|5`. Записать вывод — на него ссылается Шаг 6.

- [ ] **Step 2: Заменить таблицу в схеме**

В `server/src/db/schema.ts` заменить весь блок `birthdayCampaigns` (докстринг вместе с ним) на:

```ts
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
```

Импорт в шапке файла расширить: `import type { SwapStatus, EntryCategory, TemplateAccent, AuditType, CollectionKind } from "@planer/shared";`

Заменить экспорты типов:

```ts
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
```

(строки `export type BirthdayCampaign = …` и `export type NewBirthdayCampaign = …` удалить).

- [ ] **Step 3: Убедиться, что typecheck красный ровно там, где ожидается**

Run: `npx tsc -p server/tsconfig.json`
Expected: ошибки только в `server/src/birthdays/birthday-service.ts`, `birthday-notice.ts`, `server/src/http/app.ts` и их тестах — это Задачи 4–5. Ошибки в любом другом файле означают, что таблица используется там, где план её не ждал: остановиться и сказать об этом.

- [ ] **Step 4: Сгенерировать миграцию и переписать её руками**

```bash
npm run db:generate -w @planer/server
```

drizzle-kit создаст `server/drizzle/0018_*.sql` и допишет `meta/_journal.json`. Переименовать файл в `0018_collections.sql` (и поправить `tag` в `_journal.json` на `0018_collections`), затем привести содержимое к виду:

```sql
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`employee_id` integer,
	`year` integer,
	`celebrated_on` text,
	`title` text,
	`event_date` text,
	`deadline` text,
	`amount_per_person` integer,
	`total_goal` integer,
	`collect_url` text,
	`message_text` text,
	`closed_at` integer,
	`admin_notified_at` integer,
	`scheduled_send_on` text,
	`schedule_notified_at` integer,
	`sent_at` integer,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`send_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_collections`(
	"id", "kind", "employee_id", "year", "celebrated_on",
	"collect_url", "message_text", "admin_notified_at",
	"scheduled_send_on", "schedule_notified_at",
	"sent_at", "sent_count", "send_count", "created_at"
) SELECT
	"id", 'birthday', "employee_id", "year", "celebrated_on",
	"collect_url", "message_text", "admin_notified_at",
	"scheduled_send_on", "schedule_notified_at",
	"sent_at", "sent_count",
	-- `status='sent'` в старой таблице означал «рассылали ровно один раз»:
	-- повторить было нечем. Отсюда и берётся счётчик рассылок.
	CASE WHEN "sent_at" IS NOT NULL THEN 1 ELSE 0 END,
	"created_at"
FROM `birthday_campaigns`;--> statement-breakpoint
DROP TABLE `birthday_campaigns`;--> statement-breakpoint
ALTER TABLE `__new_collections` RENAME TO `collections`;--> statement-breakpoint
CREATE UNIQUE INDEX `collection_birthday_unique` ON `collections` (`employee_id`,`year`) WHERE `kind` = 'birthday';--> statement-breakpoint
PRAGMA foreign_keys=ON;
```

- [ ] **Step 5: Проверить, что миграция применяется к пустой базе**

Run: `npx vitest run server/src/db/client.test.ts server/src/db/migration-fk.test.ts`
Expected: PASS — миграции прогоняются на чистой in-memory базе.

- [ ] **Step 6: Проверить постусловие на КОПИИ живой базы**

Создать в корне репозитория `check-collections-migration.mts`:

```ts
import { openDb, runMigrations } from "./server/src/db/client";

const path = process.argv[2];
if (!path) throw new Error("usage: tsx check-collections-migration.mts <db>");
const { db, sqlite } = openDb(path);
runMigrations(db, sqlite);
console.log(
  sqlite
    .prepare("select id, kind, employee_id, year, celebrated_on, sent_at, sent_count, send_count from collections")
    .all(),
);
console.log("birthday_campaigns exists:", sqlite
  .prepare("select count(*) as n from sqlite_master where type='table' and name='birthday_campaigns'")
  .get());
```

```bash
npx tsx check-collections-migration.mts "$(echo $SCRATCH)/pre.db"
```

Ожидается: ровно одна строка, `kind: 'birthday'`, `employee_id: 1`, `year: 2026`, `celebrated_on: '2026-07-30'`, `sent_count: 5`, `send_count: 1`, тот же `sent_at`, что записан в Шаге 1; `birthday_campaigns exists: { n: 0 }`.

Живую `data/planer.db` **не трогать** — она мигрирует сама при следующем старте сервера.

- [ ] **Step 7: Удалить временный скрипт и закоммитить**

```bash
rm check-collections-migration.mts
npx vitest run server/src/db/no-real-names.test.ts
git add server/src/db/schema.ts server/drizzle/0018_collections.sql server/drizzle/meta
git commit -m "feat(db): таблица collections вместо birthday_campaigns"
```

Коммит оставляет `server` с красным typecheck — его чинят Задачи 4–5. Это единственное место в плане, где так, и длится оно две задачи.

---

### Task 4: Сбор как сущность — сервис

**Files:**
- Create: `server/src/collections/collection-service.ts`
- Create: `server/src/collections/collection-service.test.ts`

**Interfaces:**
- Consumes: `collections`, `Collection` (Задача 3); `collectionMessage`, `collectionStatus`, `collectionTitle`, `compareCollections`, `isCollectionActive` (Задачи 1–2); `listActive`, `getEmployeeById` из `server/src/repo/employees.ts`.
- Produces:
  - `interface CollectionView { collection: Collection; personName: string | null; title: string; status: CollectionStatus; active: boolean }`
  - `interface CollectionPreview { id, kind, title, personName, employeeId, collectUrl, message, recipients, blocker, sendCount, lastSentAt }`
  - `interface NewCustomCollection` · `interface CollectionPatch`
  - `type UpdateResult = { ok: true; collection: Collection } | { ok: false; error: string }`
  - `getCollection(db, id): Collection | null`
  - `listCollections(db, today, viewerEmployeeId): CollectionView[]`
  - `createCustomCollection(db, input): Collection`
  - `updateCollection(db, id, patch): UpdateResult`
  - `setCollectionClosed(db, id, closed, when): Collection | null`
  - `deleteCollection(db, id): { ok: true } | { ok: false; error: string }`
  - `recipientsOf(db, honoureeId): Employee[]`
  - `adminRecipients(db, honoureeId): Employee[]`
  - `previewCollection(db, collection): CollectionPreview`
  - `markCollectionSent(db, id, delivered, when): void`

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/collections/collection-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import type { Db } from "../db/client";
import {
  createCustomCollection,
  deleteCollection,
  listCollections,
  markCollectionSent,
  previewCollection,
  recipientsOf,
  setCollectionClosed,
  updateCollection,
} from "./collection-service";

const TODAY = "2026-08-10";

function person(db: Db, name: string, tg: number | null): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  return employee.id;
}

function blank(patch: Partial<Parameters<typeof createCustomCollection>[1]> = {}) {
  return {
    title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
    scheduledSendOn: null, ...patch,
  };
}

describe("recipientsOf", () => {
  it("«everyone but the honouree, and only those the bot can reach»", () => {
    const db = makeTestDb();
    const honouree = person(db, "Honouree", 1);
    const reachable = person(db, "Reachable", 2);
    person(db, "NoTelegram", null);

    expect(recipientsOf(db, honouree).map((e) => e.id)).toEqual([reachable]);
    // Without an honouree everybody reachable is in — a general collection.
    expect(recipientsOf(db, null).map((e) => e.id).sort()).toEqual([honouree, reachable].sort());
  });
});

describe("listCollections", () => {
  it("hides the collection the viewer is the honouree of, and keeps the others", () => {
    const db = makeTestDb();
    const viewer = person(db, "Viewer", 1);
    const other = person(db, "Other", 2);
    createCustomCollection(db, blank({ title: "Про смотрящего", employeeId: viewer }));
    createCustomCollection(db, blank({ title: "Про другого", employeeId: other }));
    createCustomCollection(db, blank({ title: "Общий" }));

    const titles = listCollections(db, TODAY, viewer).map((row) => row.title);
    // Two rows must survive: an empty answer would pass on a broken query too.
    expect(titles).toEqual(["Про другого", "Общий"]);
  });

  it("marks active and closed, and puts the active ones first", () => {
    const db = makeTestDb();
    const viewer = person(db, "Viewer", 1);
    const gone = createCustomCollection(db, blank({ title: "Прошлый", deadline: "2026-08-01" }));
    createCustomCollection(db, blank({ title: "Идёт", deadline: "2026-08-20" }));

    const rows = listCollections(db, TODAY, viewer);
    expect(rows.map((r) => [r.title, r.active])).toEqual([["Идёт", true], ["Прошлый", false]]);
    expect(rows.find((r) => r.collection.id === gone.id)!.active).toBe(false);
  });
});

describe("previewCollection", () => {
  it("shows the exact text and the exact names, minus the honouree", () => {
    const db = makeTestDb();
    const honouree = person(db, "Honouree", 1);
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank({
      title: "Свадьба", employeeId: honouree, eventDate: "2026-08-22",
      amountPerPerson: 1000, collectUrl: "https://example.test/c/1",
    }));

    const preview = previewCollection(db, collection);
    expect(preview.message.split("\n")[0]).toBe("🎁 Свадьба — Honouree, 22 августа");
    expect(preview.recipients.map((r) => r.displayName)).toEqual(["Colleague"]);
    expect(preview.blocker).toBeNull();
  });

  it("blocks without a link, and unblocks once there is one", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank());
    expect(previewCollection(db, collection).blocker).toContain("Нет ссылки");

    const saved = updateCollection(db, collection.id, { collectUrl: "https://example.test/c/1" });
    expect(saved.ok).toBe(true);
    expect(previewCollection(db, saved.ok ? saved.collection : collection).blocker).toBeNull();
  });

  it("a custom collection can be sent again — a birthday one cannot", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const custom = createCustomCollection(db, blank({ collectUrl: "https://example.test/c/1" }));
    markCollectionSent(db, custom.id, 1, new Date("2026-08-12T09:00:00Z"));

    const again = previewCollection(db, getCollectionOrThrow(db, custom.id));
    expect(again.blocker).toBeNull();
    expect(again.sendCount).toBe(1);
    // The second round is worded as a reminder, not as the first announcement.
    expect(again.message.split("\n")[0]).toContain("Напоминаю про сбор");
  });

  it("a closed collection is blocked whatever else is true", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank({ collectUrl: "https://example.test/c/1" }));
    setCollectionClosed(db, collection.id, true, new Date("2026-08-11T00:00:00Z"));
    expect(previewCollection(db, getCollectionOrThrow(db, collection.id)).blocker).toContain("закрыт");
  });
});

describe("updateCollection", () => {
  it("after a send the link may change and the subject may not", () => {
    const db = makeTestDb();
    const honouree = person(db, "Honouree", 1);
    person(db, "Colleague", 2);
    const collection = createCustomCollection(db, blank({ title: "Свадьба", employeeId: honouree, collectUrl: "https://example.test/c/1" }));
    markCollectionSent(db, collection.id, 1, new Date("2026-08-12T09:00:00Z"));

    const link = updateCollection(db, collection.id, { collectUrl: "https://example.test/c/2" });
    expect(link.ok).toBe(true);

    const subject = updateCollection(db, collection.id, { title: "Проводы" });
    expect(subject).toEqual({ ok: false, error: expect.stringContaining("уже разослан") });
  });
});

describe("deleteCollection", () => {
  it("removes an unsent collection and refuses a sent one", () => {
    const db = makeTestDb();
    person(db, "Colleague", 2);
    const fresh = createCustomCollection(db, blank({ title: "Ошибка" }));
    const sent = createCustomCollection(db, blank({ title: "Ушедший", collectUrl: "https://example.test/c/1" }));
    markCollectionSent(db, sent.id, 1, new Date("2026-08-12T09:00:00Z"));

    expect(deleteCollection(db, fresh.id)).toEqual({ ok: true });
    expect(deleteCollection(db, sent.id).ok).toBe(false);
    expect(listCollections(db, TODAY, 999).map((r) => r.title)).toEqual(["Ушедший"]);
  });
});

/** Reading a row back is needed often enough to earn a name. */
function getCollectionOrThrow(db: Db, id: number) {
  const row = getCollection(db, id);
  if (!row) throw new Error(`collection ${id} vanished`);
  return row;
}
```

`getCollection` дописать в список импортов из `./collection-service` в шапке файла.

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run server/src/collections/collection-service.test.ts`
Expected: FAIL — `Failed to resolve import "./collection-service"`.

- [ ] **Step 3: Написать реализацию**

Создать `server/src/collections/collection-service.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import {
  collectionMessage,
  collectionStatus,
  collectionTitle,
  compareCollections,
  isCollectionActive,
  type CollectionKind,
  type CollectionStatus,
} from "@planer/shared";
import type { Db } from "../db/client";
import { collections, type Collection, type Employee } from "../db/schema";
import { getEmployeeById, listActive } from "../repo/employees";

/**
 * A collection of money — the birthday kind and the hand-made kind, on one code
 * path. What differs between them is data, not behaviour: a birthday round has
 * a person and a year, a custom one has a subject and an optional honouree.
 *
 * The rule that shapes this module, same as it shaped the birthday feature:
 * **the bot never mails the team on its own.** Everything here computes and
 * records; sending is an admin pressing a button after seeing the preview.
 */

/** A collection with everything a screen needs spelled out. */
export interface CollectionView {
  collection: Collection;
  /** The honouree's name, or null for a general collection. */
  personName: string | null;
  title: string;
  status: CollectionStatus;
  active: boolean;
}

export interface CollectionPreview {
  id: number;
  kind: CollectionKind;
  title: string;
  personName: string | null;
  employeeId: number | null;
  collectUrl: string | null;
  /** Exactly the text that will be sent, defaults filled in. */
  message: string;
  recipients: { employeeId: number; displayName: string }[];
  /** Why sending is blocked, or null when it isn't. */
  blocker: string | null;
  sendCount: number;
  lastSentAt: Date | null;
}

export interface NewCustomCollection {
  title: string;
  employeeId: number | null;
  eventDate: string | null;
  deadline: string | null;
  amountPerPerson: number | null;
  totalGoal: number | null;
  collectUrl: string | null;
  messageText: string | null;
  scheduledSendOn: string | null;
}

/** Every field an admin may edit. Absent key means «leave as is». */
export interface CollectionPatch {
  title?: string;
  employeeId?: number | null;
  eventDate?: string | null;
  deadline?: string | null;
  amountPerPerson?: number | null;
  totalGoal?: number | null;
  collectUrl?: string | null;
  messageText?: string | null;
  scheduledSendOn?: string | null;
}

export type UpdateResult = { ok: true; collection: Collection } | { ok: false; error: string };

export function getCollection(db: Db, id: number): Collection | null {
  return db.select().from(collections).where(eq(collections.id, id)).get() ?? null;
}

/** The honouree's name, or null — for a general collection or a deleted person. */
function personNameOf(db: Db, collection: Collection): string | null {
  if (collection.employeeId == null) return null;
  return getEmployeeById(db, collection.employeeId)?.displayName ?? null;
}

/**
 * Every collection, in the order both consoles show them.
 *
 * `viewerEmployeeId` is not optional: a collection is a surprise, and the one
 * person who must never see it is its honouree — including when they are the
 * admin looking at the screen.
 */
export function listCollections(db: Db, today: string, viewerEmployeeId: number): CollectionView[] {
  return db
    .select()
    .from(collections)
    .all()
    .filter((collection) => collection.employeeId !== viewerEmployeeId)
    .map((collection) => {
      const personName = personNameOf(db, collection);
      return {
        collection,
        personName,
        title: collectionTitle(collection, personName),
        status: collectionStatus(collection),
        active: isCollectionActive(collection, today),
      };
    })
    .sort((a, b) =>
      compareCollections(
        { ...a.collection, createdAt: a.collection.createdAt.toISOString() },
        { ...b.collection, createdAt: b.collection.createdAt.toISOString() },
        today,
      ),
    );
}

export function createCustomCollection(db: Db, input: NewCustomCollection): Collection {
  return db.insert(collections).values({ kind: "custom", ...input }).returning().all()[0]!;
}

/**
 * Saves an edit.
 *
 * After the first send the subject is frozen: the team has already been told
 * what this collection is and who it is for, and changing that after the fact
 * is not an edit but a different message. Everything else stays editable —
 * links get regenerated and weddings get moved.
 */
export function updateCollection(db: Db, id: number, patch: CollectionPatch): UpdateResult {
  const current = getCollection(db, id);
  if (!current) return { ok: false, error: "not_found" };

  const subjectTouched =
    (patch.title !== undefined && patch.title !== current.title) ||
    (patch.employeeId !== undefined && patch.employeeId !== current.employeeId);
  if (current.sendCount > 0 && subjectTouched) {
    return { ok: false, error: "Сбор уже разослан — повод и виновника менять нельзя." };
  }

  // Moving the reminder day re-arms it: an admin who pushes it back means to be
  // told on the new day, not to be told nothing because the old one fired.
  const scheduleNotifiedAt =
    patch.scheduledSendOn !== undefined && patch.scheduledSendOn !== current.scheduledSendOn
      ? null
      : current.scheduleNotifiedAt;

  const collection = db
    .update(collections)
    .set({ ...patch, scheduleNotifiedAt })
    .where(eq(collections.id, id))
    .returning()
    .all()[0]!;
  return { ok: true, collection };
}

/** «Собрали, закрыть» — and back, because an unrecoverable tap is worth nothing. */
export function setCollectionClosed(db: Db, id: number, closed: boolean, when: Date): Collection | null {
  if (!getCollection(db, id)) return null;
  return db
    .update(collections)
    .set({ closedAt: closed ? when : null })
    .where(eq(collections.id, id))
    .returning()
    .all()[0]!;
}

/**
 * Deletes a collection nobody has heard of yet.
 *
 * Once it has been sent there is nothing to delete: people already got the
 * message, and the journal row about it must keep making sense.
 */
export function deleteCollection(db: Db, id: number): { ok: true } | { ok: false; error: string } {
  const current = getCollection(db, id);
  if (!current) return { ok: false, error: "not_found" };
  if (current.kind === "birthday") return { ok: false, error: "Сбор на день рождения не удаляется." };
  if (current.sendCount > 0) return { ok: false, error: "Сбор уже разослан — удалить нельзя." };
  db.delete(collections).where(eq(collections.id, id)).run();
  return { ok: true };
}

/**
 * Who gets the message: everybody active the bot can actually reach, minus the
 * honouree. Excluding them is the point — a collection is a surprise.
 */
export function recipientsOf(db: Db, honoureeId: number | null): Employee[] {
  return listActive(db).filter(
    (employee) => employee.id !== honoureeId && employee.telegramUserId != null,
  );
}

/** Who gets an admin nudge: reachable admins, minus the honouree. */
export function adminRecipients(db: Db, honoureeId: number | null): Employee[] {
  return recipientsOf(db, honoureeId).filter((employee) => employee.isAdmin);
}

/**
 * What would be sent, to whom, right now. The admin sees this before anything
 * leaves — the whole point of the flow is that nothing surprises them.
 */
export function previewCollection(db: Db, collection: Collection): CollectionPreview {
  const personName = personNameOf(db, collection);
  const recipients = recipientsOf(db, collection.employeeId);
  const honouree = collection.employeeId != null ? getEmployeeById(db, collection.employeeId) : null;

  const message =
    collection.messageText?.trim() ||
    collectionMessage(
      {
        kind: collection.kind,
        title: collection.title,
        personName,
        birthDateLabel: honouree?.birthDate ?? null,
        eventDate: collection.eventDate,
        deadline: collection.deadline,
        amountPerPerson: collection.amountPerPerson,
        totalGoal: collection.totalGoal,
        collectUrl: collection.collectUrl,
      },
      collection.sendCount > 0 ? "reminder" : "first",
    );

  let blocker: string | null = null;
  if (collection.closedAt) blocker = "Сбор закрыт — рассылать нечего.";
  else if (collection.kind === "birthday" && collection.sendCount > 0) {
    blocker = "Уже разослано — повторная отправка отключена.";
  } else if (!collection.collectUrl) blocker = "Нет ссылки на сбор — вставь её, прежде чем рассылать.";
  else if (recipients.length === 0) blocker = "Некому отправлять: ни у кого из команды не привязан Telegram.";

  return {
    id: collection.id,
    kind: collection.kind,
    title: collectionTitle(collection, personName),
    personName,
    employeeId: collection.employeeId,
    collectUrl: collection.collectUrl,
    message,
    recipients: recipients.map((r) => ({ employeeId: r.id, displayName: r.displayName })),
    blocker,
    sendCount: collection.sendCount,
    lastSentAt: collection.sentAt,
  };
}

/** Records that a round went out — called only after the messages were sent. */
export function markCollectionSent(db: Db, id: number, delivered: number, when: Date): void {
  db.update(collections)
    .set({ sentAt: when, sentCount: delivered, sendCount: sql`${collections.sendCount} + 1` })
    .where(eq(collections.id, id))
    .run();
}
```

`birthDateLabel` в вызове `collectionMessage` — это «MM-DD» из карточки работника; форматирование в «5 августа» делает сама `collectionMessage` (Задача 2).

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run server/src/collections/collection-service.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Доказать, что тесты умеют падать, и закоммитить**

```bash
git stash push server/src/collections/collection-service.ts
npx vitest run server/src/collections/collection-service.test.ts   # обязан упасть
git stash pop
npx vitest run server/src/db/no-real-names.test.ts
git add server/src/collections
git commit -m "feat(server): сбор как сущность — чтение, правка, закрытие, предпросмотр"
```

---

### Task 5: Дни рождения переезжают на `collections`

**Files:**
- Modify: `server/src/birthdays/birthday-service.ts` (целиком — см. Шаг 3)
- Modify: `server/src/birthdays/birthday-service.test.ts`
- Modify: `server/src/birthdays/birthday-notice.ts:33-91`
- Modify: `server/src/birthdays/birthday-notice.test.ts`

**Interfaces:**
- Consumes: `collections`, `Collection` (Задача 3); `adminRecipients`, `markCollectionSent`, `updateCollection` (Задача 4).
- Produces:
  - `ensureBirthdayRound(db, employeeId, asOf): Collection | null` — заменяет `ensureCampaign`
  - `upcomingBirthdays(db, asOf, withinDays?): UpcomingBirthday[]` — `campaign` в строке теперь `Collection | null`
  - `roundsScheduledFor(db, date): Collection[]` — заменяет `campaignsScheduledFor` и охватывает **оба** вида сбора
  - `scheduleNoticeMessage(title, collectUrl, kind): string` — сигнатура меняется: заголовок приходит готовым
  - `ADMIN_NOTICE_DAYS`, `adminNoticeMessage`, `adminNoticeReadyMessage`, `scheduleNoticeMessage` — без изменений
- Уходят навсегда: `ensureCampaign`, `previewCampaign`, `updateCampaign`, `markSent`, `listAllCampaigns`, `teamRecipients`, `defaultMessage`, `CampaignPreview`, `CampaignListRow`. Их работу делают Задачи 2 и 4.

- [ ] **Step 1: Переписать тест под новые имена и добавить недостающее**

В `server/src/birthdays/birthday-service.test.ts`:
- заменить импорты `ensureCampaign` → `ensureBirthdayRound`, `campaignsScheduledFor` → `roundsScheduledFor`;
- удалить блоки `describe` про `previewCampaign`, `updateCampaign`, `defaultMessage`, `listAllCampaigns` — эту работу теперь покрывают `collection-service.test.ts` и `shared/src/collection.test.ts`;
- дописать тест, которого раньше не было:

```ts
describe("ensureBirthdayRound", () => {
  it("creates one round per person per year and finds it again", () => {
    const db = makeTestDb();
    const employee = person(db, "Honouree", 1, "08-15");

    const first = ensureBirthdayRound(db, employee, "2026-08-01")!;
    const again = ensureBirthdayRound(db, employee, "2026-08-02")!;
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ kind: "birthday", year: 2026, celebratedOn: "2026-08-15", sendCount: 0 });

    // Next year is a different round — the unique index is (employee, year).
    const next = ensureBirthdayRound(db, employee, "2026-09-01")!;
    expect(next.id).not.toBe(first.id);
    expect(next.year).toBe(2027);
  });
});

describe("roundsScheduledFor", () => {
  it("skips a birthday round that has gone out, keeps one that hasn't", () => {
    const db = makeTestDb();
    const sentTo = person(db, "Sent", 1, "08-20");
    const waiting = person(db, "Waiting", 2, "08-21");
    const sentRound = ensureBirthdayRound(db, sentTo, "2026-08-01")!;
    const waitingRound = ensureBirthdayRound(db, waiting, "2026-08-01")!;
    updateCollection(db, sentRound.id, { scheduledSendOn: "2026-08-10" });
    updateCollection(db, waitingRound.id, { scheduledSendOn: "2026-08-10" });
    markCollectionSent(db, sentRound.id, 3, new Date("2026-08-09T09:00:00Z"));

    expect(roundsScheduledFor(db, "2026-08-10").map((r) => r.id)).toEqual([waitingRound.id]);
  });

  it("keeps a custom collection that has already gone out — the reminder is «пора дожать»", () => {
    const db = makeTestDb();
    person(db, "Colleague", 3, null);
    const collection = createCustomCollection(db, {
      title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
      amountPerPerson: null, totalGoal: null, collectUrl: "https://example.test/c/1",
      messageText: null, scheduledSendOn: "2026-08-10",
    });
    markCollectionSent(db, collection.id, 2, new Date("2026-08-05T09:00:00Z"));

    expect(roundsScheduledFor(db, "2026-08-10").map((r) => r.id)).toEqual([collection.id]);
  });

  it("drops a custom collection whose deadline is behind us", () => {
    const db = makeTestDb();
    const gone = createCustomCollection(db, {
      title: "Просроченный", employeeId: null, eventDate: null, deadline: "2026-08-05",
      amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
      scheduledSendOn: "2026-08-04",
    });
    const alive = createCustomCollection(db, {
      title: "Идущий", employeeId: null, eventDate: null, deadline: "2026-08-20",
      amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
      scheduledSendOn: "2026-08-04",
    });
    // Both reminder days are in the past — the difference is only the deadline,
    // so a filter that dropped everything would not pass this.
    expect(roundsScheduledFor(db, "2026-08-10").map((r) => r.id)).toEqual([alive.id]);
    expect(gone.id).not.toBe(alive.id);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run server/src/birthdays/`
Expected: FAIL — `ensureBirthdayRound is not exported`.

- [ ] **Step 3: Переписать сервис**

В `server/src/birthdays/birthday-service.ts`:

- заменить импорт таблицы: `import { collections, employees, type Collection, type Employee } from "../db/schema";`
- в `UpcomingBirthday` поле `campaign: BirthdayCampaign | null` → `campaign: Collection | null`
- `upcomingBirthdays` читает только ДР-строки:

```ts
export function upcomingBirthdays(db: Db, asOf: string, withinDays?: number): UpcomingBirthday[] {
  const rows = db.select().from(collections).where(eq(collections.kind, "birthday")).all();
  const roundFor = new Map(rows.map((row) => [`${row.employeeId}:${row.year}`, row] as const));
  // …остальное тело без изменений, `campaignFor` переименовать в `roundFor`
}
```

- `ensureCampaign` → `ensureBirthdayRound`, вставка получает `kind`:

```ts
/** Finds this year's birthday round, creating it the first time it's needed. */
export function ensureBirthdayRound(db: Db, employeeId: number, asOf: string): Collection | null {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee?.birthDate) return null;
  const occurrence = occurrenceOf(employee.birthDate, asOf);
  if (!occurrence) return null;

  const existing = db
    .select()
    .from(collections)
    .where(and(
      eq(collections.kind, "birthday"),
      eq(collections.employeeId, employeeId),
      eq(collections.year, occurrence.year),
    ))
    .get();
  if (existing) return existing;

  return db
    .insert(collections)
    .values({ kind: "birthday", employeeId, year: occurrence.year, celebratedOn: occurrence.celebratedOn })
    .returning()
    .all()[0]!;
}
```

- `campaignsScheduledFor` → `roundsScheduledFor`, и она перестаёт быть про дни рождения: «напомнить мне» есть и у кастомного сбора, а тик, который его не заметит, — это молча потерянное напоминание.

```ts
/**
 * Rounds whose reminder day is today — or earlier and missed — and which have
 * not been reminded about. Both kinds: «напомнить мне» is a custom collection's
 * feature too, and a tick that skipped them would silently drop the reminder.
 *
 * Unlike the 7-day window of `upcomingBirthdays`, which heals itself after any
 * outage, a scheduled reminder is a single day: `eq(scheduledSendOn, date)`
 * would never match again if the server was down that day. So anything in the
 * past is picked up too — bounded by the collection's own edge, because
 * reminding about a collection that is over is noise, not a service.
 *
 * A birthday round that already went out is skipped: it cannot be sent twice,
 * so there is nothing left to remind anyone of. A custom one is kept — there
 * the reminder means «пора дожать».
 */
export function roundsScheduledFor(db: Db, date: string): Collection[] {
  return db
    .select()
    .from(collections)
    .where(and(lte(collections.scheduledSendOn, date), isNull(collections.scheduleNotifiedAt)))
    .all()
    .filter((round) => {
      // `sendCount` replaces the old `status !== 'sent'`: the count is now the
      // only truth about whether anything reached the team.
      if (round.kind === "birthday" && round.sendCount > 0) return false;
      const edge = round.celebratedOn ?? round.deadline ?? round.eventDate;
      return edge == null || edge >= date;
    });
}
```

- `markAdminNotified` и `markScheduleNotified` — те же, но по таблице `collections`
- **удалить** `teamRecipients`, `adminRecipients`, `defaultMessage`, `previewCampaign`, `updateCampaign`, `markSent`, `listAllCampaigns`, `CampaignPreview`, `CampaignListRow`
- `scheduleNoticeMessage` учится обоим видам сбора:

```ts
/**
 * The reminder an admin asked for. Same nominative rule as everywhere else: we
 * store one display name and nothing that would let us decline it.
 */
export function scheduleNoticeMessage(title: string, collectUrl: string | null, kind: CollectionKind): string {
  const lines = [`⏰ Пора разослать сбор — ${title}.`];
  if (collectUrl) lines.push("", `Ссылка: ${collectUrl}`);
  lines.push("", `Открой «Сборы» в мини-приложении и нажми «${kind === "birthday" ? "Разослать" : "Напомнить"}».`);
  return lines.join("\n");
}
```

`title` сюда приходит уже посчитанным — `collectionTitle(round, personName)`, тот же заголовок, что человек видит на экране. Отдельной сборки строки в этом файле нет намеренно: два места, склеивающие имя сбора, разошлись бы.

В `server/src/birthdays/birthday-notice.ts`:
- импорт `adminRecipients` теперь из `../collections/collection-service`
- `ensureCampaign` → `ensureBirthdayRound`, `campaignsScheduledFor` → `roundsScheduledFor`
- условие `campaign.status === "sent"` → `round.sendCount > 0`
- второй цикл больше не требует, чтобы у сбора был работник с датой рождения: у кастомного сбора его может не быть вовсе. Вместо `getEmployeeById(...)?.birthDate` — заголовок через `collectionTitle`, а получатели через `adminRecipients(db, round.employeeId)` (у общего сбора `employeeId` равен `null`, и тогда пишут всем админам):

```ts
  for (const round of roundsScheduledFor(db, today)) {
    const personName = round.employeeId != null ? (getEmployeeById(db, round.employeeId)?.displayName ?? null) : null;
    const admins = adminRecipients(db, round.employeeId);
    if (admins.length === 0) continue;

    const title = collectionTitle(round, personName);
    const text = scheduleNoticeMessage(title, round.collectUrl, round.kind);
    let delivered = 0;
    for (const admin of admins) {
      if (await notifyUser(bot, admin.telegramUserId!, text)) delivered += 1;
    }

    // Marked either way: a Telegram outage must not become a nag loop. The date
    // is still on the screen.
    markScheduleNotified(db, round.id, new Date());
    recordAudit(db, "birthday_schedule_notice", null, {
      employeeId: round.employeeId,
      displayName: personName,
      title,
      scheduledSendOn: round.scheduledSendOn,
      delivered,
    });
    sent += delivered;
  }
```

Тип события остаётся `birthday_schedule_notice`: переименование обнулило бы уже записанные строки журнала, а описатель у него уже есть и подходит обоим видам.

- переменные `campaign` переименовать в `round` (комментарии в этом файле — английские, как и весь `server/src`)

**Почему файлы остаются в папке `birthdays/`, хотя тик теперь напоминает и про кастомные сборы.** Переносить их в `collections/` значит трогать `server/src/index.ts` и импорты в тестах ради названия папки. Смысл модуля при этом не размывается: он по-прежнему про **напоминания админам**, а не про сборы как таковые — первый его цикл действительно только про дни рождения. Если файл когда-нибудь разрастётся, разделять его надо по «нотисы против сущности», а не по «ДР против кастома».

В `server/src/birthdays/birthday-service.test.ts` импорты расширить: `createCustomCollection`, `markCollectionSent`, `updateCollection` — из `../collections/collection-service`.

В `server/src/birthdays/birthday-notice.test.ts` дописать тест на то, чего раньше не было:

```ts
it("reminds admins about a custom collection too", async () => {
  const db = makeTestDb();
  const { bot, sent } = fakeBot();
  const admin = person(db, "Admin", 9, null);
  setEmployeeAdmin(db, admin, true);
  createCustomCollection(db, {
    title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: "https://example.test/c/1",
    messageText: null, scheduledSendOn: "2026-08-10",
  });

  expect(await runBirthdayNoticeTick(db, bot, "2026-08-10")).toBe(1);
  expect(sent[0]!.text).toContain("Кофемашина");
  // Second tick must stay silent — `scheduleNotifiedAt` fires once.
  expect(await runBirthdayNoticeTick(db, bot, "2026-08-10")).toBe(0);
});
```

- [ ] **Step 4: Прогнать все тесты сервера**

Run: `npx vitest run server/src/birthdays/ server/src/collections/`
Expected: PASS.

Run: `npx tsc -p server/tsconfig.json`
Expected: остаются ошибки **только** в `server/src/http/app.ts` и `server/src/http/birthdays-route.test.ts` — их чинят Задачи 8–9.

- [ ] **Step 5: Коммит**

```bash
npx vitest run server/src/db/no-real-names.test.ts
git add server/src/birthdays
git commit -m "feat(server): дни рождения переезжают на таблицу collections"
```

---

### Task 6: Типы журнала для сборов

**Files:**
- Modify: `shared/src/audit.ts:18-34` (массив `AUDIT_TYPES`) и таблица `DESCRIBERS`
- Modify: `shared/src/audit.test.ts`

**Interfaces:**
- Produces:
  - в `AUDIT_TYPES` добавлены `collection_created`, `collection_updated`, `collection_sent`, `collection_closed`, `collection_deleted`
  - `HONOUREE_AUDIT_TYPES: readonly AuditType[]` — те типы, у которых в payload лежит `employeeId` виновника; на них опирается правило сюрприза в журнале (Задача 7)

Существующие `birthday_*` **не переименовываются**: уже записанные строки журнала должны продолжать читаться.

- [ ] **Step 1: Написать падающий тест**

Дописать в `shared/src/audit.test.ts`:

```ts
describe("события сборов", () => {
  it("«создан сбор» называет повод, а не идентификатор", () => {
    const view = describeAuditEvent({
      type: "collection_created",
      payload: { collectionId: 4, title: "Кофемашина", personName: null },
    });
    expect(view.title).toBe("Заведён сбор");
    expect(view.lines[0]).toBe("Кофемашина");
  });

  it("«разослан сбор» отличает первую рассылку от напоминания", () => {
    const first = describeAuditEvent({
      type: "collection_sent",
      payload: { title: "Кофемашина", round: 1, delivered: 12, intended: 14 },
    });
    expect(first.title).toBe("Разослан сбор");
    expect(first.lines).toContain("доставлено 12 из 14");

    const again = describeAuditEvent({
      type: "collection_sent",
      payload: { title: "Кофемашина", round: 3, delivered: 9, intended: 14 },
    });
    expect(again.title).toBe("Напоминание о сборе");
    expect(again.lines).toContain("рассылка №3");
  });

  it("«закрыт» и «открыт заново» — разные заголовки", () => {
    expect(describeAuditEvent({ type: "collection_closed", payload: { title: "Кофемашина", closed: true } }).title)
      .toBe("Сбор закрыт");
    expect(describeAuditEvent({ type: "collection_closed", payload: { title: "Кофемашина", closed: false } }).title)
      .toBe("Сбор открыт заново");
  });

  it("список типов виновника не пуст и состоит из существующих типов", () => {
    expect(HONOUREE_AUDIT_TYPES.length).toBeGreaterThan(0);
    for (const type of HONOUREE_AUDIT_TYPES) expect(AUDIT_TYPES).toContain(type);
  });
});
```

Импорты в шапке файла расширить: `AUDIT_TYPES`, `HONOUREE_AUDIT_TYPES`.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run shared/src/audit.test.ts`
Expected: FAIL — `HONOUREE_AUDIT_TYPES is not exported`, плюс `collection_created` рисуется запасным описателем.

- [ ] **Step 3: Написать реализацию**

В `shared/src/audit.ts`:

1. В `AUDIT_TYPES` после строки `"birthday_campaign_updated",` добавить:

```ts
  "collection_created", "collection_updated", "collection_sent",
  "collection_closed", "collection_deleted",
```

2. Сразу под объявлением `AuditType` добавить:

```ts
/**
 * События, у которых в payload лежит `employeeId` виновника торжества.
 *
 * На этот список опирается правило «сбор, где ты виновник, не показывается
 * тебе нигде»: журнал вычитает из выдачи строки, где `employeeId` совпал со
 * смотрящим. Список отдельный, а не «все, что начинается с birthday_»:
 * префикс — это соглашение об именах, а не гарантия того, что в payload есть
 * нужное поле.
 */
export const HONOUREE_AUDIT_TYPES: readonly AuditType[] = [
  "birthday_sent", "birthday_admin_notice", "birthday_schedule_notice",
  "birthday_campaign_updated",
  "collection_created", "collection_updated", "collection_sent",
  "collection_closed", "collection_deleted",
];
```

3. В таблицу `DESCRIBERS`, после `birthday_campaign_updated`, добавить пять описателей:

```ts
  collection_created: (p) => ({
    icon: "💰",
    title: "Заведён сбор",
    lines: [str(p.title) ?? "сбор", ...(str(p.personName) ? [`виновник: ${str(p.personName)}`] : [])],
  }),
  collection_updated: (p) => {
    const lines = [str(p.title) ?? "сбор"];
    if (p.collectUrl !== undefined) lines.push(str(p.collectUrl) ? "ссылка на сбор изменена" : "ссылка на сбор убрана");
    if (p.deadline !== undefined) lines.push(`скинуться до: ${str(p.deadline) ? dayLabel(p.deadline) : "без срока"}`);
    if (p.scheduledSendOn !== undefined) {
      lines.push(`напомнить: ${str(p.scheduledSendOn) ? dayLabel(p.scheduledSendOn) : "не напоминать"}`);
    }
    // Сам текст письма в журнал не копируется — здесь только факт правки.
    if (p.messageText !== undefined) lines.push(str(p.messageText) ? "текст изменён" : "текст сброшен на стандартный");
    return { icon: "💰", title: "Изменён сбор", lines };
  },
  collection_sent: (p) => {
    const round = num(p.round) ?? 1;
    return {
      icon: "💰",
      title: round > 1 ? "Напоминание о сборе" : "Разослан сбор",
      lines: [
        str(p.title) ?? "сбор",
        ...(round > 1 ? [`рассылка №${round}`] : []),
        `доставлено ${num(p.delivered) ?? 0} из ${num(p.intended) ?? 0}`,
      ],
    };
  },
  collection_closed: (p) => ({
    icon: "💰",
    title: p.closed === false ? "Сбор открыт заново" : "Сбор закрыт",
    lines: [str(p.title) ?? "сбор"],
  }),
  collection_deleted: (p) => ({
    icon: "🗑",
    title: "Удалён сбор",
    lines: [str(p.title) ?? "сбор"],
  }),
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run shared/src/audit.test.ts`
Expected: PASS. Тест полноты таблицы описателей (он уже есть в файле и перебирает `AUDIT_TYPES` в рантайме) обязан пройти по всем 40 типам.

- [ ] **Step 5: Доказать, что тест умеет падать, и закоммитить**

```bash
git stash push shared/src/audit.ts
npx vitest run shared/src/audit.test.ts   # обязан упасть
git stash pop
npx vitest run server/src/db/no-real-names.test.ts
git add shared/src/audit.ts shared/src/audit.test.ts
git commit -m "feat(shared): пять событий журнала про сборы"
```

---

### Task 7: Правило сюрприза в списке ДР и в журнале

**Files:**
- Modify: `server/src/birthdays/birthday-service.ts` (сигнатура `upcomingBirthdays`)
- Modify: `server/src/repo/audit.ts:40-90`
- Modify: `server/src/birthdays/birthday-service.test.ts`
- Create: `server/src/repo/audit-viewer.test.ts`

**Interfaces:**
- Consumes: `HONOUREE_AUDIT_TYPES` (Задача 6).
- Produces:
  - `upcomingBirthdays(db, asOf, withinDays?, viewerEmployeeId?)` — смотрящий выпадает из списка
  - `AuditQuery` получает необязательное поле `viewerEmployeeId?: number`

**Почему `viewerEmployeeId` необязателен.** `runBirthdayNoticeTick` зовёт `upcomingBirthdays` не от чьего-то лица — бот обязан видеть всех, включая именинника-админа, иначе его коллеги не получат напоминание. Смотрящий появляется только там, где список рисуется человеку.

- [ ] **Step 1: Написать падающий тест**

Дописать в `server/src/birthdays/birthday-service.test.ts`:

```ts
describe("upcomingBirthdays and the viewer", () => {
  it("drops the viewer from the list and keeps everybody else", () => {
    const db = makeTestDb();
    const viewer = person(db, "Viewer", 1, "08-12");
    person(db, "Other", 2, "08-13");

    const forViewer = upcomingBirthdays(db, "2026-08-10", 30, viewer);
    // Two people have birthdays here — an empty list would pass on a broken filter.
    expect(forViewer.map((b) => b.displayName)).toEqual(["Other"]);
    expect(upcomingBirthdays(db, "2026-08-10", 30).map((b) => b.displayName)).toEqual(["Viewer", "Other"]);
  });
});
```

Создать `server/src/repo/audit-viewer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { queryAudit, recordAudit } from "./audit";

describe("queryAudit and the viewer", () => {
  it("hides collection events about the viewer, keeps the rest", () => {
    const db = makeTestDb();
    const viewer = createEmployee(db, { displayName: "Viewer", inviteToken: "inv-v" }).id;
    const other = createEmployee(db, { displayName: "Other", inviteToken: "inv-o" }).id;

    recordAudit(db, "collection_sent", null, { employeeId: viewer, title: "Про смотрящего", delivered: 1, intended: 1 });
    recordAudit(db, "collection_sent", null, { employeeId: other, title: "Про другого", delivered: 1, intended: 1 });
    recordAudit(db, "collection_sent", null, { employeeId: null, title: "Общий", delivered: 1, intended: 1 });
    recordAudit(db, "entry_created", null, { employeeId: viewer, date: "2026-08-10" });

    const page = queryAudit(db, { limit: 50, offset: 0, viewerEmployeeId: viewer });
    const titles = page.rows.map((row) => (row.payload as { title?: string }).title ?? "запись");
    // Three rows must survive — the general one, the one about somebody else, and
    // an unrelated event type about the viewer themselves.
    expect(titles.sort()).toEqual(["Общий", "Про другого", "запись"]);
    // `total` must agree with the rows, or paging lies about how much is left.
    expect(page.total).toBe(3);
  });

  it("without a viewer nothing is hidden", () => {
    const db = makeTestDb();
    const viewer = createEmployee(db, { displayName: "Viewer", inviteToken: "inv-v" }).id;
    recordAudit(db, "collection_sent", null, { employeeId: viewer, title: "Про смотрящего", delivered: 1, intended: 1 });
    expect(queryAudit(db, { limit: 50, offset: 0 }).total).toBe(1);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run server/src/repo/audit-viewer.test.ts server/src/birthdays/`
Expected: FAIL — `viewerEmployeeId` не сужает выдачу, `total` равен 4.

- [ ] **Step 3: Написать реализацию**

В `server/src/birthdays/birthday-service.ts` — четвёртый параметр и один `filter`:

```ts
export function upcomingBirthdays(
  db: Db,
  asOf: string,
  withinDays?: number,
  viewerEmployeeId?: number,
): UpcomingBirthday[] {
  // …
  return listActive(db)
    // A collection is a surprise, and the one person who must never see it is
    // the honouree — including when they are the admin looking at the screen.
    .filter((employee) => employee.id !== viewerEmployeeId)
    .filter((employee) => employee.birthDate && parseBirthDate(employee.birthDate))
    // …остальное без изменений
}
```

В `server/src/repo/audit.ts`:

```ts
import { HONOUREE_AUDIT_TYPES } from "@planer/shared";
// …
export interface AuditQuery {
  // …существующие поля
  /** Кто смотрит. События про его собственный сбор ему не отдаются. */
  viewerEmployeeId?: number;
}
```

и в `queryAudit`, к остальным фильтрам:

```ts
  // The surprise rule, applied in SQL rather than after the fact: filtering the
  // page in JS would leave `total` counting rows the viewer never sees, and the
  // paging would claim there is more than there is.
  if (query.viewerEmployeeId != null) {
    filters.push(sql`not (
      ${auditLog.type} in ${HONOUREE_AUDIT_TYPES}
      and json_extract(${auditLog.payload}, '$.employeeId') = ${query.viewerEmployeeId}
    )`);
  }
```

Импорт `sql` из `drizzle-orm` добавить, если его там ещё нет.

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run server/src/repo/ server/src/birthdays/`
Expected: PASS.

- [ ] **Step 5: Доказать, что тесты умеют падать, и закоммитить**

```bash
git stash push server/src/repo/audit.ts
npx vitest run server/src/repo/audit-viewer.test.ts   # обязан упасть
git stash pop
npx vitest run server/src/db/no-real-names.test.ts
git add server/src/repo/audit.ts server/src/repo/audit-viewer.test.ts server/src/birthdays
git commit -m "feat(server): виновник не видит свой сбор — ни в списке ДР, ни в журнале"
```

---

### Task 8: Роуты дней рождения — предпросмотр без побочек

**Files:**
- Modify: `server/src/birthdays/birthday-service.ts` (добавить `birthdayRoundDraft`)
- Modify: `server/src/http/app.ts:664-798` (весь блок «Дни рождения»)
- Modify: `server/src/http/birthdays-route.test.ts`

**Interfaces:**
- Consumes: `ensureBirthdayRound`, `upcomingBirthdays` (Задачи 5, 7); `previewCollection`, `updateCollection` (Задача 4).
- Produces:
  - `birthdayRoundDraft(db, employeeId, asOf): Collection | null` — существующий раунд или **невставленный** черновик с `id: 0`
  - `GET /api/admin/birthdays` — `{ asOf, birthdays }`, смотрящий из списка выпадает
  - `GET /api/admin/birthdays/:employeeId/preview` — `CollectionPreview`, **ничего не создаёт**
  - `PUT /api/admin/birthdays/:employeeId` — `{ collection }`, создаёт строку при первом сохранении

Роуты `/api/admin/birthdays/campaigns` и `/api/admin/birthdays/:id/send` **удаляются**: их работу берут `/api/admin/collections` и `/api/admin/collections/:id/send` (Задача 9).

- [ ] **Step 1: Написать падающий тест**

В `server/src/http/birthdays-route.test.ts` заменить блоки про `campaigns`/`send` на:

```ts
describe("GET /api/admin/birthdays/:id/preview", () => {
  it("creates nothing — looking is not preparing", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const honouree = person(db, "Honouree", 1, "08-05");
    person(db, "Colleague", 2, null);
    const token = await tokenFor(app, 111);

    const before = db.select().from(collections).all().length;
    const res = await app.request(`/api/admin/birthdays/${honouree}/preview?${ASOF}`, auth(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(0);
    expect(body.blocker).toContain("Нет ссылки");
    // The point of the whole change: the table is untouched.
    expect(db.select().from(collections).all().length).toBe(before);
  });

  it("shows the saved round once there is one", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const honouree = person(db, "Honouree", 1, "08-05");
    person(db, "Colleague", 2, 3);
    const token = await tokenFor(app, 111);

    await app.request(`/api/admin/birthdays/${honouree}?${ASOF}`,
      send(token, { collectUrl: "https://example.test/c/1" }, "PUT"));
    const body = await (await app.request(`/api/admin/birthdays/${honouree}/preview?${ASOF}`, auth(token))).json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.blocker).toBeNull();
    expect(body.message).toContain("https://example.test/c/1");
  });
});

describe("PUT /api/admin/birthdays/:id", () => {
  it("creates the round on the first save and reuses it on the second", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const honouree = person(db, "Honouree", 1, "08-05");
    const token = await tokenFor(app, 111);

    const first = await (await app.request(`/api/admin/birthdays/${honouree}?${ASOF}`,
      send(token, { collectUrl: "https://example.test/c/1" }, "PUT"))).json();
    const second = await (await app.request(`/api/admin/birthdays/${honouree}?${ASOF}`,
      send(token, { collectUrl: "https://example.test/c/2" }, "PUT"))).json();

    expect(second.collection.id).toBe(first.collection.id);
    expect(db.select().from(collections).all().length).toBe(1);
  });

  it("still refuses a link that is not http(s)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const honouree = person(db, "Honouree", 1, "08-05");
    const token = await tokenFor(app, 111);
    const res = await app.request(`/api/admin/birthdays/${honouree}?${ASOF}`,
      send(token, { collectUrl: "javascript:alert(1)" }, "PUT"));
    expect(res.status).toBe(400);
  });
});

describe("the admin whose birthday it is", () => {
  it("does not see their own round in the list", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const self = person(db, "SelfAdmin", 111, "08-12");
    setEmployeeAdmin(db, self, true);
    person(db, "Other", 2, "08-13");

    const body = await (await app.request(`/api/admin/birthdays?${ASOF}`, auth(await tokenFor(app, 111)))).json();
    // Two people have birthdays — an empty list would pass on a broken filter.
    expect(body.birthdays.map((b: { displayName: string }) => b.displayName)).toEqual(["Other"]);
  });
});
```

Импорт `collections` из `../db/schema` добавить в шапку файла.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run server/src/http/birthdays-route.test.ts`
Expected: FAIL — компиляция или 404 на новых роутах.

- [ ] **Step 3: Написать черновик раунда**

В `server/src/birthdays/birthday-service.ts`:

```ts
/**
 * This year's round for that person — or an unsaved draft of it.
 *
 * A GET must not write, and until now looking at a birthday card created a row
 * as a side effect. Preparing is what creates the round, and preparing means
 * saving something: without a link the collection cannot be sent anyway, so a
 * draft is never a state anybody can act on.
 *
 * `id: 0` marks the draft. Callers must not try to send it — `previewCollection`
 * blocks it on the missing link regardless.
 */
export function birthdayRoundDraft(db: Db, employeeId: number, asOf: string): Collection | null {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee?.birthDate) return null;
  const occurrence = occurrenceOf(employee.birthDate, asOf);
  if (!occurrence) return null;

  const existing = db
    .select()
    .from(collections)
    .where(and(
      eq(collections.kind, "birthday"),
      eq(collections.employeeId, employeeId),
      eq(collections.year, occurrence.year),
    ))
    .get();
  if (existing) return existing;

  return {
    id: 0,
    kind: "birthday",
    employeeId,
    year: occurrence.year,
    celebratedOn: occurrence.celebratedOn,
    title: null,
    eventDate: null,
    deadline: null,
    amountPerPerson: null,
    totalGoal: null,
    collectUrl: null,
    messageText: null,
    closedAt: null,
    adminNotifiedAt: null,
    scheduledSendOn: null,
    scheduleNotifiedAt: null,
    sentAt: null,
    sentCount: 0,
    sendCount: 0,
    createdAt: new Date(0),
  };
}
```

- [ ] **Step 4: Переписать блок роутов**

В `server/src/http/app.ts` заменить блок «Дни рождения» на:

```ts
  // --- Дни рождения ---------------------------------------------------------
  // The bot never mails the team on its own. It nudges admins a week ahead; every
  // message after that is an admin pressing a button, having seen exactly what
  // will go out and to whom. A round is created when an admin first SAVES it —
  // looking at the card writes nothing.

  const birthdayAsOf = (c: { req: { query(name: string): string | undefined } }) =>
    c.req.query("asOf") ?? teamNow(config.teamTz).date;

  app.get("/api/admin/birthdays", requireAdmin(db, config.jwtSecret), (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    return c.json({ asOf, birthdays: upcomingBirthdays(db, asOf, undefined, c.get("auth").employeeId) });
  });

  app.get("/api/admin/birthdays/:id/preview", requireAdmin(db, config.jwtSecret), (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    const employeeId = Number(c.req.param("id"));
    // The surprise rule: not «forbidden», but «there is nothing here for you».
    if (employeeId === c.get("auth").employeeId) return c.json({ error: "not_found" }, 404);
    const draft = birthdayRoundDraft(db, employeeId, asOf);
    if (!draft) return c.json({ error: "not_found" }, 404);
    return c.json(previewCollection(db, draft));
  });

  app.put("/api/admin/birthdays/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    const employeeId = Number(c.req.param("id"));
    if (employeeId === c.get("auth").employeeId) return c.json({ error: "not_found" }, 404);

    const parsed = parseCollectionBody(await c.req.json().catch(() => ({})), { requireTitle: false });
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    // A birthday round has no subject to edit — it is named after the person.
    if (parsed.value.title !== undefined || parsed.value.employeeId !== undefined) {
      return c.json({ error: "У сбора на день рождения повод и виновник заданы датой рождения." }, 400);
    }

    const round = ensureBirthdayRound(db, employeeId, asOf);
    if (!round) return c.json({ error: "not_found" }, 404);
    const scheduleError = scheduledSendOnError(parsed.value.scheduledSendOn, round, asOf);
    if (scheduleError) return c.json({ error: scheduleError }, 400);

    const result = updateCollection(db, round.id, parsed.value);
    if (!result.ok) return c.json({ error: result.error }, 409);
    recordAudit(db, "birthday_campaign_updated", c.get("auth").employeeId, {
      employeeId,
      displayName: getEmployeeById(db, employeeId)?.displayName ?? null,
      ...(parsed.value.collectUrl !== undefined ? { collectUrl: parsed.value.collectUrl } : {}),
      ...(parsed.value.messageText !== undefined ? { messageText: parsed.value.messageText ? "изменён" : null } : {}),
      ...(parsed.value.scheduledSendOn !== undefined ? { scheduledSendOn: parsed.value.scheduledSendOn } : {}),
    });
    return c.json({ collection: result.collection });
  });
```

`scheduledSendOnError` — вынесенная как есть проверка окна напоминания из нынешнего кода (`server/src/http/app.ts:717-740`), в `server/src/http/collection-body.ts`:

```ts
/**
 * The reminder window is «from today up to and including the event».
 *
 * Read the round BEFORE validating: a client that resends this field unchanged
 * on every save (both consoles do) must not get stuck the moment the reminder
 * day is behind us but the event isn't — resubmitting a stored value is not an
 * edit.
 */
export function scheduledSendOnError(
  value: string | null | undefined,
  current: { scheduledSendOn: string | null; celebratedOn: string | null; eventDate: string | null; deadline: string | null },
  asOf: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (value !== current.scheduledSendOn && value < asOf) return "Дата напоминания уже прошла";
  const edge = current.celebratedOn ?? current.deadline ?? current.eventDate;
  if (edge && value > edge) return "Напоминать после самого события уже поздно";
  return null;
}
```

- [ ] **Step 5: Прогнать тесты**

Run: `npx vitest run server/src/http/birthdays-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
npx vitest run server/src/db/no-real-names.test.ts
git add server/src/birthdays server/src/http
git commit -m "feat(api): предпросмотр ДР ничего не создаёт, раунд заводит сохранение"
```

---

### Task 9: Роуты сборов

**Files:**
- Create: `server/src/http/collection-body.ts`
- Create: `server/src/http/collection-body.test.ts`
- Create: `server/src/http/collections-route.test.ts`
- Modify: `server/src/http/app.ts` (новый блок роутов после блока дней рождения)

**Interfaces:**
- Consumes: весь `collection-service` (Задача 4), типы журнала (Задача 6).
- Produces:
  - `parseCollectionBody(raw, { requireTitle }): { ok: true; value } | { ok: false; error }`
  - `scheduledSendOnError(...)` (объявлен в Задаче 8, живёт здесь)
  - семь роутов `/api/admin/collections*`

- [ ] **Step 1: Написать падающий тест на разбор тела**

Создать `server/src/http/collection-body.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCollectionBody } from "./collection-body";

describe("parseCollectionBody", () => {
  it("requires a subject when creating and not when editing", () => {
    expect(parseCollectionBody({}, { requireTitle: true })).toEqual({ ok: false, error: expect.stringContaining("Повод") });
    expect(parseCollectionBody({ collectUrl: null }, { requireTitle: false }).ok).toBe(true);
  });

  it("trims the subject and refuses an over-long one", () => {
    const ok = parseCollectionBody({ title: "  Кофемашина  " }, { requireTitle: true });
    expect(ok).toEqual({ ok: true, value: { title: "Кофемашина" } });
    expect(parseCollectionBody({ title: "x".repeat(81) }, { requireTitle: true }).ok).toBe(false);
  });

  it("only lets an http(s) link through — it travels to the whole team", () => {
    expect(parseCollectionBody({ collectUrl: "javascript:alert(1)" }, { requireTitle: false }).ok).toBe(false);
    expect(parseCollectionBody({ collectUrl: "сбер" }, { requireTitle: false }).ok).toBe(false);
    expect(parseCollectionBody({ collectUrl: "https://example.test/c/1" }, { requireTitle: false }).ok).toBe(true);
  });

  it("money is whole roubles inside a sane range", () => {
    expect(parseCollectionBody({ amountPerPerson: 1000 }, { requireTitle: false }).ok).toBe(true);
    expect(parseCollectionBody({ amountPerPerson: 0 }, { requireTitle: false }).ok).toBe(false);
    expect(parseCollectionBody({ amountPerPerson: 10.5 }, { requireTitle: false }).ok).toBe(false);
    expect(parseCollectionBody({ totalGoal: 10_000_001 }, { requireTitle: false }).ok).toBe(false);
    // Explicitly clearing a sum is not the same as a bad sum.
    expect(parseCollectionBody({ totalGoal: null }, { requireTitle: false })).toEqual({ ok: true, value: { totalGoal: null } });
  });

  it("dates must be ISO, and a past one is allowed — it just means «not active»", () => {
    expect(parseCollectionBody({ deadline: "15.08.2026" }, { requireTitle: false }).ok).toBe(false);
    expect(parseCollectionBody({ deadline: "2020-01-01" }, { requireTitle: false }).ok).toBe(true);
  });

  it("keys that were not sent stay absent — an edit touches only what it names", () => {
    const parsed = parseCollectionBody({ collectUrl: "https://example.test/c/1" }, { requireTitle: false });
    expect(parsed.ok && Object.keys(parsed.value)).toEqual(["collectUrl"]);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run server/src/http/collection-body.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Написать разбор тела**

Создать `server/src/http/collection-body.ts` — там же `scheduledSendOnError` из Задачи 8:

```ts
import type { CollectionPatch } from "../collections/collection-service";

/**
 * Turns an untrusted JSON body into a patch, or into the reason it isn't one.
 *
 * A key that was not sent stays absent: an edit must touch only what it names,
 * or saving the link would silently wipe the sum.
 */
export type ParsedCollectionBody =
  | { ok: true; value: CollectionPatch }
  | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MONEY = 10_000_000;

export function parseCollectionBody(raw: unknown, opts: { requireTitle: boolean }): ParsedCollectionBody {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const value: CollectionPatch = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string") return { ok: false, error: "Повод должен быть текстом" };
    const title = body.title.trim();
    if (title.length === 0) return { ok: false, error: "Повод не может быть пустым" };
    if (title.length > 80) return { ok: false, error: "Повод длиннее 80 символов" };
    value.title = title;
  } else if (opts.requireTitle) {
    return { ok: false, error: "Повод обязателен" };
  }

  if (body.employeeId !== undefined) {
    if (body.employeeId !== null && !Number.isInteger(body.employeeId)) {
      return { ok: false, error: "Виновник должен быть работником или null" };
    }
    value.employeeId = body.employeeId as number | null;
  }

  if (body.collectUrl !== undefined) {
    if (body.collectUrl !== null && typeof body.collectUrl !== "string") {
      return { ok: false, error: "collectUrl должен быть ссылкой или null" };
    }
    const url = typeof body.collectUrl === "string" ? body.collectUrl.trim() : null;
    // Only http(s): the link is forwarded to the whole team, so a `javascript:`
    // or a bare word must not be able to travel in a message from the bot.
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      return { ok: false, error: "Ссылка должна начинаться с http:// или https://" };
    }
    value.collectUrl = url || null;
  }

  if (body.messageText !== undefined) {
    if (body.messageText !== null && typeof body.messageText !== "string") {
      return { ok: false, error: "messageText должен быть текстом или null" };
    }
    const text = typeof body.messageText === "string" ? body.messageText.trim() : null;
    if (text && text.length > 3000) return { ok: false, error: "Текст длиннее 3000 символов" };
    value.messageText = text || null;
  }

  for (const key of ["amountPerPerson", "totalGoal"] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null) { value[key] = null; continue; }
    const amount = body[key];
    if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > MAX_MONEY) {
      return { ok: false, error: "Сумма должна быть целым числом рублей от 1 до 10 000 000" };
    }
    value[key] = amount as number;
  }

  for (const key of ["eventDate", "deadline", "scheduledSendOn"] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null) { value[key] = null; continue; }
    if (typeof body[key] !== "string" || !ISO_DATE.test(body[key] as string)) {
      return { ok: false, error: "Дата должна быть в виде ГГГГ-ММ-ДД" };
    }
    // A date in the past is allowed on purpose: it is not an error, it is the
    // state «this collection is no longer active».
    value[key] = body[key] as string;
  }

  return { ok: true, value };
}
```

Плюс `scheduledSendOnError` из Задачи 8 — в этом же файле.

- [ ] **Step 4: Написать падающий тест на роуты**

Создать `server/src/http/collections-route.test.ts`. Шапку (config, `tokenFor`, `auth`, `send`, `fakeBot`, `person`) скопировать из `birthdays-route.test.ts` — она там уже есть и проверена.

```ts
const ASOF = "asOf=2026-08-10";

describe("POST /api/admin/collections", () => {
  it("creates a collection with nothing but a subject", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const res = await app.request(`/api/admin/collections?${ASOF}`, send(token, { title: "Кофемашина" }, "POST"));
    expect(res.status).toBe(200);
    const { collection } = await res.json();
    expect(collection).toMatchObject({ kind: "custom", title: "Кофемашина", employeeId: null, sendCount: 0 });
    expect(listRecentAudit(db, 5)[0]!.type).toBe("collection_created");
  });

  it("refuses an empty subject", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request(`/api/admin/collections?${ASOF}`,
      send(await tokenFor(app, 111), { title: "   " }, "POST"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/collections/:id/send", () => {
  it("sends to everybody but the honouree and can send again", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const honouree = person(db, "Honouree", 5, null);
    person(db, "Colleague", 6, null);
    const token = await tokenFor(app, 111);

    const { collection } = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Свадьба", employeeId: honouree, collectUrl: "https://example.test/c/1" }, "POST"))).json();

    const first = await app.request(`/api/admin/collections/${collection.id}/send?${ASOF}`,
      send(token, { confirm: true }, "POST"));
    expect(first.status).toBe(200);
    expect(sent.map((m) => m.to)).not.toContain(5);
    expect(sent.length).toBeGreaterThan(0);

    const again = await app.request(`/api/admin/collections/${collection.id}/send?${ASOF}`,
      send(token, { confirm: true }, "POST"));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ round: 2 });
    // The second round is worded as a reminder.
    expect(sent.at(-1)!.text).toContain("Напоминаю про сбор");
  });

  it("needs an explicit confirmation", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    person(db, "Colleague", 6, null);
    const { collection } = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Кофемашина", collectUrl: "https://example.test/c/1" }, "POST"))).json();
    const res = await app.request(`/api/admin/collections/${collection.id}/send?${ASOF}`, send(token, {}, "POST"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/collections/:id/close", () => {
  it("closes and re-opens", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const { collection } = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Кофемашина" }, "POST"))).json();

    await app.request(`/api/admin/collections/${collection.id}/close?${ASOF}`, send(token, { closed: true }, "POST"));
    const closed = await (await app.request(`/api/admin/collections?${ASOF}`, auth(token))).json();
    expect(closed.collections[0].active).toBe(false);

    await app.request(`/api/admin/collections/${collection.id}/close?${ASOF}`, send(token, { closed: false }, "POST"));
    const open = await (await app.request(`/api/admin/collections?${ASOF}`, auth(token))).json();
    expect(open.collections[0].active).toBe(true);
  });
});

describe("the surprise rule on every collection route", () => {
  it("hides a collection from its own honouree, list and single alike", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const selfAdmin = person(db, "SelfAdmin", 111, null);
    setEmployeeAdmin(db, selfAdmin, true);
    const other = person(db, "Other", 7, null);
    const token = await tokenFor(app, 111);

    const mine = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Про меня", employeeId: selfAdmin }, "POST"))).json();
    await app.request(`/api/admin/collections?${ASOF}`, send(token, { title: "Про другого", employeeId: other }, "POST"));

    const list = await (await app.request(`/api/admin/collections?${ASOF}`, auth(token))).json();
    // The other collection must survive — an empty list would pass on a broken filter.
    expect(list.collections.map((row: { title: string }) => row.title)).toEqual(["Про другого"]);

    for (const [path, method, body] of [
      [`/api/admin/collections/${mine.collection.id}/preview`, "GET", undefined],
      [`/api/admin/collections/${mine.collection.id}`, "PUT", { collectUrl: "https://example.test/c/1" }],
      [`/api/admin/collections/${mine.collection.id}/send`, "POST", { confirm: true }],
      [`/api/admin/collections/${mine.collection.id}/close`, "POST", { closed: true }],
      [`/api/admin/collections/${mine.collection.id}`, "DELETE", undefined],
    ] as const) {
      const res = await app.request(`http://x${path}?${ASOF}`,
        body === undefined ? { method, ...auth(token) } : send(token, body, method));
      expect([res.status, path, method]).toEqual([404, path, method]);
    }
  });
});

describe("DELETE /api/admin/collections/:id", () => {
  it("removes an unsent collection and refuses a sent one", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    person(db, "Colleague", 6, null);

    const fresh = await (await app.request(`/api/admin/collections?${ASOF}`, send(token, { title: "Ошибка" }, "POST"))).json();
    expect((await app.request(`/api/admin/collections/${fresh.collection.id}?${ASOF}`,
      { method: "DELETE", ...auth(token) })).status).toBe(200);

    const gone = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Ушедший", collectUrl: "https://example.test/c/1" }, "POST"))).json();
    await app.request(`/api/admin/collections/${gone.collection.id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    expect((await app.request(`/api/admin/collections/${gone.collection.id}?${ASOF}`,
      { method: "DELETE", ...auth(token) })).status).toBe(409);
  });
});
```

- [ ] **Step 5: Прогнать и убедиться, что падает**

Run: `npx vitest run server/src/http/collections-route.test.ts`
Expected: FAIL — 404 на всех новых путях.

- [ ] **Step 6: Написать роуты**

В `server/src/http/app.ts`, сразу после блока дней рождения:

```ts
  // --- Сборы ----------------------------------------------------------------
  // One set of routes for both kinds: a birthday round and a hand-made
  // collection differ in data, not in how they are previewed, sent or closed.
  // `:id` here is the COLLECTION's id — unlike the birthday routes above, where
  // it is the employee's.

  /** Reads a collection the viewer is allowed to see, or explains why not. */
  const readableCollection = (db: Db, id: number, viewerId: number) => {
    const collection = getCollection(db, id);
    // The surprise rule: «not found», not «forbidden». A 403 would confirm the
    // collection exists, which is the one bit we are hiding.
    if (!collection || collection.employeeId === viewerId) return null;
    return collection;
  };

  app.get("/api/admin/collections", requireAdmin(db, config.jwtSecret), (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    return c.json({ asOf, collections: listCollections(db, asOf, c.get("auth").employeeId) });
  });

  app.post("/api/admin/collections", requireAdmin(db, config.jwtSecret), async (c) => {
    const parsed = parseCollectionBody(await c.req.json().catch(() => ({})), { requireTitle: true });
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    if (parsed.value.employeeId != null && !getEmployeeById(db, parsed.value.employeeId)) {
      return c.json({ error: "Такого работника нет" }, 400);
    }

    const collection = createCustomCollection(db, {
      title: parsed.value.title!,
      employeeId: parsed.value.employeeId ?? null,
      eventDate: parsed.value.eventDate ?? null,
      deadline: parsed.value.deadline ?? null,
      amountPerPerson: parsed.value.amountPerPerson ?? null,
      totalGoal: parsed.value.totalGoal ?? null,
      collectUrl: parsed.value.collectUrl ?? null,
      messageText: parsed.value.messageText ?? null,
      scheduledSendOn: parsed.value.scheduledSendOn ?? null,
    });
    recordAudit(db, "collection_created", c.get("auth").employeeId, {
      collectionId: collection.id,
      employeeId: collection.employeeId,
      title: collection.title,
      personName: collection.employeeId != null ? (getEmployeeById(db, collection.employeeId)?.displayName ?? null) : null,
    });
    return c.json({ collection });
  });

  app.get("/api/admin/collections/:id/preview", requireAdmin(db, config.jwtSecret), (c) => {
    const collection = readableCollection(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!collection) return c.json({ error: "not_found" }, 404);
    return c.json(previewCollection(db, collection));
  });

  app.put("/api/admin/collections/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    const collection = readableCollection(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!collection) return c.json({ error: "not_found" }, 404);

    const parsed = parseCollectionBody(await c.req.json().catch(() => ({})), { requireTitle: false });
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    if (Object.keys(parsed.value).length === 0) return c.json({ error: "нечего сохранять" }, 400);
    if (parsed.value.employeeId != null && !getEmployeeById(db, parsed.value.employeeId)) {
      return c.json({ error: "Такого работника нет" }, 400);
    }
    const scheduleError = scheduledSendOnError(parsed.value.scheduledSendOn, collection, asOf);
    if (scheduleError) return c.json({ error: scheduleError }, 400);

    const result = updateCollection(db, collection.id, parsed.value);
    if (!result.ok) return c.json({ error: result.error }, 409);
    recordAudit(db, "collection_updated", c.get("auth").employeeId, {
      collectionId: collection.id,
      employeeId: result.collection.employeeId,
      title: result.collection.title,
      ...(parsed.value.collectUrl !== undefined ? { collectUrl: parsed.value.collectUrl } : {}),
      ...(parsed.value.deadline !== undefined ? { deadline: parsed.value.deadline } : {}),
      ...(parsed.value.scheduledSendOn !== undefined ? { scheduledSendOn: parsed.value.scheduledSendOn } : {}),
      ...(parsed.value.messageText !== undefined ? { messageText: parsed.value.messageText ? "изменён" : null } : {}),
    });
    return c.json({ collection: result.collection });
  });

  app.post("/api/admin/collections/:id/send", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { confirm?: unknown };
    if (body.confirm !== true) return c.json({ error: "нужно подтверждение: confirm: true" }, 400);
    const collection = readableCollection(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!collection) return c.json({ error: "not_found" }, 404);

    const preview = previewCollection(db, collection);
    if (preview.blocker) return c.json({ error: preview.blocker }, 409);
    if (!bot) return c.json({ error: "Бот не запущен — рассылка недоступна" }, 503);

    // The claim is synchronous: between this line and the first `await` below
    // nothing else can run (single-threaded Node), so a second simultaneous
    // «Разослать» always finds the collection already taken.
    if (collectionSending.has(collection.id)) return c.json({ error: "Рассылка уже идёт." }, 409);
    collectionSending.add(collection.id);
    try {
      let delivered = 0;
      for (const recipient of recipientsOf(db, collection.employeeId)) {
        if (await notifyUser(bot, recipient.telegramUserId!, preview.message)) delivered += 1;
      }
      // Only count a round that reached somebody: zero delivered is not a round,
      // it is Telegram having refused the lot. Counting it would tell the admin
      // «рассылалось 2 раза» about one real message.
      if (delivered > 0) markCollectionSent(db, collection.id, delivered, new Date());
      recordAudit(db, "collection_sent", c.get("auth").employeeId, {
        collectionId: collection.id,
        employeeId: collection.employeeId,
        title: preview.title,
        round: collection.sendCount + (delivered > 0 ? 1 : 0),
        delivered,
        intended: preview.recipients.length,
      });
      return c.json({ delivered, intended: preview.recipients.length, round: collection.sendCount + (delivered > 0 ? 1 : 0) });
    } finally {
      collectionSending.delete(collection.id);
    }
  });

  app.post("/api/admin/collections/:id/close", requireAdmin(db, config.jwtSecret), async (c) => {
    const collection = readableCollection(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!collection) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { closed?: unknown };
    if (typeof body.closed !== "boolean") return c.json({ error: "closed должен быть true или false" }, 400);

    const updated = setCollectionClosed(db, collection.id, body.closed, new Date());
    if (!updated) return c.json({ error: "not_found" }, 404);
    recordAudit(db, "collection_closed", c.get("auth").employeeId, {
      collectionId: collection.id,
      employeeId: collection.employeeId,
      title: previewCollection(db, updated).title,
      closed: body.closed,
    });
    return c.json({ collection: updated });
  });

  app.delete("/api/admin/collections/:id", requireAdmin(db, config.jwtSecret), (c) => {
    const collection = readableCollection(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!collection) return c.json({ error: "not_found" }, 404);
    const title = previewCollection(db, collection).title;
    const result = deleteCollection(db, collection.id);
    if (!result.ok) return c.json({ error: result.error }, 409);
    recordAudit(db, "collection_deleted", c.get("auth").employeeId, {
      collectionId: collection.id,
      employeeId: collection.employeeId,
      title,
    });
    return c.json({ ok: true });
  });
```

Рядом с существующим `birthdaySending` объявить `const collectionSending = new Set<number>();` и удалить `birthdaySending` — его роут больше не существует.

Журнальный роут получает смотрящего: в `app.get("/api/admin/journal", …)` в вызов `queryAudit` дописать `viewerEmployeeId: c.get("auth").employeeId`.

- [ ] **Step 7: Прогнать тесты**

Run: `npx vitest run server/src/http/`
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
npx vitest run server/src/db/no-real-names.test.ts
git add server/src/http
git commit -m "feat(api): роуты сборов — создать, разослать, дожать, закрыть, удалить"
```

---

### Task 10: Работник видит активные сборы

**Files:**
- Modify: `server/src/collections/collection-service.ts`
- Modify: `server/src/collections/collection-service.test.ts`
- Modify: `server/src/http/app.ts`
- Modify: `server/src/http/collections-route.test.ts`

**Interfaces:**
- Produces:
  - `interface WorkerCollection { id, title, personName, collectUrl, amountPerPerson, totalGoal, deadline, eventDate }`
  - `collectionsForWorker(db, today, employeeId): WorkerCollection[]`
  - `GET /api/collections` → `{ collections: WorkerCollection[] }`, доступен любому авторизованному

- [ ] **Step 1: Написать падающий тест**

В `server/src/collections/collection-service.test.ts`:

```ts
describe("collectionsForWorker", () => {
  it("shows what was actually sent, is still running, and is not about them", () => {
    const db = makeTestDb();
    const me = person(db, "Me", 1);
    const other = person(db, "Other", 2);

    const mine = createCustomCollection(db, blank({ title: "Про меня", employeeId: me, collectUrl: "https://example.test/1" }));
    const theirs = createCustomCollection(db, blank({ title: "Про другого", employeeId: other, collectUrl: "https://example.test/2" }));
    const draft = createCustomCollection(db, blank({ title: "Не разослан", collectUrl: "https://example.test/3" }));
    const over = createCustomCollection(db, blank({ title: "Просроченный", deadline: "2026-08-01", collectUrl: "https://example.test/4" }));
    for (const c of [mine, theirs, draft, over]) {
      if (c.id !== draft.id) markCollectionSent(db, c.id, 2, new Date("2026-08-05T09:00:00Z"));
    }

    // Exactly one of four survives, and the other three fail for three different
    // reasons — a filter that drops everything would not pass this.
    expect(collectionsForWorker(db, TODAY, me).map((c) => c.title)).toEqual(["Про другого"]);
  });
});
```

В `server/src/http/collections-route.test.ts`:

```ts
describe("GET /api/collections", () => {
  it("is open to a plain worker and hides their own collection", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });
    const worker = person(db, "Worker", 222, null);
    person(db, "Colleague", 6, null);
    const adminToken = await tokenFor(app, 111);

    for (const [title, employeeId] of [["Про работника", worker], ["Общий", null]] as const) {
      const { collection } = await (await app.request(`/api/admin/collections?${ASOF}`,
        send(adminToken, { title, employeeId, collectUrl: "https://example.test/c/1" }, "POST"))).json();
      await app.request(`/api/admin/collections/${collection.id}/send?${ASOF}`, send(adminToken, { confirm: true }, "POST"));
    }

    const res = await app.request(`/api/collections?${ASOF}`, auth(await tokenFor(app, 222)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collections.map((c: { title: string }) => c.title)).toEqual(["Общий"]);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run server/src/collections/ server/src/http/collections-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Написать реализацию**

В `server/src/collections/collection-service.ts`:

```ts
/** A collection as a worker sees it: what it is for, how much, and the link. */
export interface WorkerCollection {
  id: number;
  title: string;
  personName: string | null;
  collectUrl: string | null;
  amountPerPerson: number | null;
  totalGoal: number | null;
  deadline: string | null;
  eventDate: string | null;
}

/**
 * What this person should see in the Mini App.
 *
 * Three conditions, each of them load-bearing: it must have actually been sent
 * (before that it is the admin's draft and the surprise must not leak), it must
 * still be running, and it must not be about them.
 */
export function collectionsForWorker(db: Db, today: string, employeeId: number): WorkerCollection[] {
  return listCollections(db, today, employeeId)
    .filter((row) => row.collection.sendCount > 0 && row.active)
    .map((row) => ({
      id: row.collection.id,
      title: row.title,
      personName: row.personName,
      collectUrl: row.collection.collectUrl,
      amountPerPerson: row.collection.amountPerPerson,
      totalGoal: row.collection.totalGoal,
      deadline: row.collection.deadline,
      eventDate: row.collection.eventDate,
    }));
}
```

В `server/src/http/app.ts`, рядом с прочими роутами работника (`/api/weekend/*`):

```ts
  /** Running collections this person has already been told about. Not their own. */
  app.get("/api/collections", requireAuth(config.jwtSecret), (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    return c.json({ collections: collectionsForWorker(db, asOf, c.get("auth").employeeId) });
  });
```

Имя мидлвары взять то же, каким защищены остальные роуты работника в этом файле (`requireAuth(config.jwtSecret)` — свериться с соседним роутом `/api/weekend/slots`).

- [ ] **Step 4: Прогнать тесты и закоммитить**

Run: `npx vitest run server/`
Expected: PASS.

```bash
npx vitest run server/src/db/no-real-names.test.ts
git add server/src
git commit -m "feat(api): работник видит активные сборы, кроме своего"
```

---

### Task 11: Клиенты и моки обеих морд

**Files:**
- Modify: `miniapp/src/api/client.ts:411-459` (типы), `:519-528` (интерфейс), `:930-952` (реализация), `:1053-1057` (DEV-мок)
- Modify: `miniapp/src/api/mock.ts:913-1045`
- Modify: `admin/src/api/client.ts:299-330` и соответствующие блоки
- Modify: `admin/src/api/mock.ts:527-640`
- Modify: `miniapp/src/api/mock.test.ts` · `admin/src/api/mock.test.ts` (если они пинят состав данных сборов)

**Interfaces:**
- Produces (одинаково в обоих клиентах, кроме `getMyCollections` — он только в мини-аппе):

```ts
export interface Collection {
  id: number;
  kind: "birthday" | "custom";
  employeeId: number | null;
  year: number | null;
  celebratedOn: string | null;
  title: string | null;
  eventDate: string | null;
  deadline: string | null;
  amountPerPerson: number | null;
  totalGoal: number | null;
  collectUrl: string | null;
  messageText: string | null;
  closedAt: string | null;
  scheduledSendOn: string | null;
  scheduleNotifiedAt: string | null;
  sentAt: string | null;
  sentCount: number;
  sendCount: number;
  createdAt: string;
}

/** Строка списка сборов: сама запись плюс всё, что сервер уже посчитал. */
export interface CollectionRow {
  collection: Collection;
  personName: string | null;
  title: string;
  status: "pending" | "ready" | "sent";
  active: boolean;
}

export interface CollectionPreview {
  id: number;
  kind: "birthday" | "custom";
  title: string;
  personName: string | null;
  employeeId: number | null;
  collectUrl: string | null;
  message: string;
  recipients: { employeeId: number; displayName: string }[];
  blocker: string | null;
  sendCount: number;
  lastSentAt: string | null;
}

export interface NewCollectionInput {
  title: string;
  employeeId?: number | null;
  eventDate?: string | null;
  deadline?: string | null;
  amountPerPerson?: number | null;
  totalGoal?: number | null;
  collectUrl?: string | null;
  messageText?: string | null;
  scheduledSendOn?: string | null;
}

export type CollectionPatch = Partial<NewCollectionInput>;

/** Активный сбор глазами работника — то, что видно во вкладке «Команда». */
export interface WorkerCollection {
  id: number;
  title: string;
  personName: string | null;
  collectUrl: string | null;
  amountPerPerson: number | null;
  totalGoal: number | null;
  deadline: string | null;
  eventDate: string | null;
}
```

Методы:

```ts
  getBirthdays(): Promise<UpcomingBirthday[]>;
  getBirthdayPreview(employeeId: number): Promise<CollectionPreview>;
  /** Сохраняет раунд ДР; на первом сохранении он и заводится. */
  saveBirthdayRound(employeeId: number, patch: CollectionPatch): Promise<Collection>;
  getCollections(): Promise<CollectionRow[]>;
  createCollection(input: NewCollectionInput): Promise<Collection>;
  getCollectionPreview(id: number): Promise<CollectionPreview>;
  saveCollection(id: number, patch: CollectionPatch): Promise<Collection>;
  /** Рассылает команде. Подтверждение — на вызывающем. */
  sendCollection(id: number): Promise<{ delivered: number; intended: number; round: number }>;
  setCollectionClosed(id: number, closed: boolean): Promise<Collection>;
  deleteCollection(id: number): Promise<void>;
  getMyCollections(): Promise<WorkerCollection[]>;   // только мини-апп
```

Уходят: `BirthdayCampaign`, `CampaignListRow`, `BirthdayPreview`, `saveBirthdayCampaign`, `getBirthdayCampaigns`, `sendBirthday`.

- [ ] **Step 1: Написать падающий тест на мок**

В `miniapp/src/api/mock.test.ts` дописать:

```ts
describe("мок сборов", () => {
  it("отдаёт заведённый сбор в списке и в предпросмотре", async () => {
    const created = await mockCreateCollection({ title: "Кофемашина", amountPerPerson: 1000 });
    const rows = await mockGetCollections();
    expect(rows.map((r) => r.title)).toContain("Кофемашина");

    const preview = await mockGetCollectionPreview(created.id);
    expect(preview.message).toContain("Скидываемся по 1 000 ₽");
    expect(preview.blocker).toContain("Нет ссылки");
  });

  it("после рассылки кастомный сбор можно дожать, а ДР нельзя", async () => {
    const created = await mockCreateCollection({ title: "Кофемашина", collectUrl: "https://example.test/c/1" });
    await mockSendCollection(created.id);
    expect((await mockGetCollectionPreview(created.id)).blocker).toBeNull();
    expect((await mockGetCollectionPreview(created.id)).sendCount).toBe(1);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run miniapp/src/api/mock.test.ts`
Expected: FAIL — функций нет.

- [ ] **Step 3: Переписать клиенты**

В `miniapp/src/api/client.ts` — типы выше, и реализация:

```ts
  async getBirthdays() {
    const { birthdays } = await authorizedGet<{ birthdays: UpcomingBirthday[] }>("/api/admin/birthdays");
    return birthdays;
  },

  getBirthdayPreview(employeeId) {
    return authorizedGet<CollectionPreview>(`/api/admin/birthdays/${employeeId}/preview`);
  },

  async saveBirthdayRound(employeeId, patch) {
    const { collection } = await authorizedPutJson<{ collection: Collection }>(`/api/admin/birthdays/${employeeId}`, patch);
    return collection;
  },

  async getCollections() {
    const { collections } = await authorizedGet<{ collections: CollectionRow[] }>("/api/admin/collections");
    return collections;
  },

  async createCollection(input) {
    const { collection } = await authorizedPostJson<{ collection: Collection }>("/api/admin/collections", input);
    return collection;
  },

  getCollectionPreview(id) {
    return authorizedGet<CollectionPreview>(`/api/admin/collections/${id}/preview`);
  },

  async saveCollection(id, patch) {
    const { collection } = await authorizedPutJson<{ collection: Collection }>(`/api/admin/collections/${id}`, patch);
    return collection;
  },

  sendCollection(id) {
    // `confirm: true` — сервер не примет рассылку без него, и это осознанно:
    // это единственный вызов, который пишет сразу всем коллегам.
    return authorizedPostJson<{ delivered: number; intended: number; round: number }>(
      `/api/admin/collections/${id}/send`, { confirm: true });
  },

  async setCollectionClosed(id, closed) {
    const { collection } = await authorizedPostJson<{ collection: Collection }>(
      `/api/admin/collections/${id}/close`, { closed });
    return collection;
  },

  async deleteCollection(id) {
    await authorizedDelete(`/api/admin/collections/${id}`);
  },

  async getMyCollections() {
    const { collections } = await authorizedGet<{ collections: WorkerCollection[] }>("/api/collections");
    return collections;
  },
```

Если хелпера `authorizedDelete` в файле нет — добавить по образцу `authorizedPostJson`, метод `DELETE`, тело не отправляется.

В `admin/src/api/client.ts` — то же самое, кроме `getMyCollections`: у консоли нет экрана работника.

- [ ] **Step 4: Переписать моки**

В обоих `mock.ts` заменить `CAMPAIGNS`/`campaignFor` на одно хранилище:

```ts
/** Сборы DEV-режима: живут в памяти вкладки, как и весь остальной мок. */
const COLLECTIONS: Collection[] = [];
let nextCollectionId = 1;

function blankCollection(patch: Partial<Collection>): Collection {
  return {
    id: nextCollectionId++, kind: "custom", employeeId: null, year: null, celebratedOn: null,
    title: null, eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
    collectUrl: null, messageText: null, closedAt: null, scheduledSendOn: null,
    scheduleNotifiedAt: null, sentAt: null, sentCount: 0, sendCount: 0,
    createdAt: new Date().toISOString(), ...patch,
  };
}
```

и построить на нём `mockGetCollections`, `mockCreateCollection`, `mockGetCollectionPreview`, `mockSaveCollection`, `mockSendCollection`, `mockSetCollectionClosed`, `mockDeleteCollection`, `mockGetBirthdays`, `mockGetBirthdayPreview`, `mockSaveBirthdayRound`, а в мини-аппе ещё `mockGetMyCollections`.

Предпросмотр и заголовок мок считает **теми же функциями из `@planer/shared`**, что и сервер (`collectionMessage`, `collectionTitle`, `collectionStatus`, `isCollectionActive`) — иначе DEV-режим начнёт показывать не тот текст, который уйдёт в бою.

- [ ] **Step 5: Прогнать всё, что трогает моки**

Run: `npm test`
Expected: PASS. Правка мока без `npm test` уже стоила красного CI 29 июля — `typecheck` этого класса не видит.

- [ ] **Step 6: Коммит**

```bash
npx vitest run server/src/db/no-real-names.test.ts
git add miniapp/src/api admin/src/api
git commit -m "feat(api-клиенты): сборы в обеих мордах и в обоих DEV-моках"
```

---

### Task 12: Раздел «Сборы» в мини-аппе

**Files:**
- Rename: `miniapp/src/screens/admin/AdminBirthdays.tsx` → `miniapp/src/screens/admin/AdminCollections.tsx`
- Rename: `miniapp/src/screens/admin/birthdays.test.ts` → `collections.test.ts`
- Rename: `miniapp/src/screens/admin/AdminBirthdays-reach.test.tsx` → `AdminCollections-reach.test.tsx`
- Create: `miniapp/src/screens/admin/collection-form.test.tsx`
- Modify: `miniapp/src/screens/AdminScreen.tsx:13-19` (ярлык раздела)

**Interfaces:**
- Consumes: клиент из Задачи 11; `collectionStatus`, `formatMoney`, `formatDayMonth` из `@planer/shared`.
- Produces: экспортируемые из `AdminCollections.tsx` чистые хелперы, на которых стоят тесты:
  - `statusOf(row: CollectionRow): { label: string; tone: StatusTone }`
  - `sendButtonLabel(preview: CollectionPreview): string`
  - `moneyLine(c: { amountPerPerson: number | null; totalGoal: number | null }): string | null`
  - `canCreate(title: string): boolean`

- [ ] **Step 1: Написать падающий тест на хелперы**

Создать `miniapp/src/screens/admin/collection-form.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { canCreate, moneyLine, sendButtonLabel, statusOf } from "./AdminCollections";

describe("canCreate", () => {
  it("повод из пробелов — не повод", () => {
    expect(canCreate("")).toBe(false);
    expect(canCreate("   ")).toBe(false);
    expect(canCreate("Кофемашина")).toBe(true);
  });
});

describe("moneyLine", () => {
  it("склеивает то, что заполнено, и молчит, когда не заполнено ничего", () => {
    expect(moneyLine({ amountPerPerson: 1000, totalGoal: 25000 })).toBe("по 1 000 ₽ · нужно 25 000 ₽");
    expect(moneyLine({ amountPerPerson: 1000, totalGoal: null })).toBe("по 1 000 ₽");
    expect(moneyLine({ amountPerPerson: null, totalGoal: 25000 })).toBe("нужно 25 000 ₽");
    expect(moneyLine({ amountPerPerson: null, totalGoal: null })).toBeNull();
  });
});

describe("sendButtonLabel", () => {
  const preview = { recipients: [{ employeeId: 1, displayName: "A" }, { employeeId: 2, displayName: "B" }] };

  it("первая рассылка называет число получателей", () => {
    expect(sendButtonLabel({ ...preview, sendCount: 0, lastSentAt: null } as never))
      .toBe("Разослать 2 коллегам");
  });

  it("дожим честно говорит, что уже рассылали и когда", () => {
    expect(sendButtonLabel({ ...preview, sendCount: 1, lastSentAt: "2026-08-12T09:00:00Z" } as never))
      .toBe("Напомнить ещё раз · рассылалось 12 августа");
  });
});

describe("statusOf", () => {
  it("закрытый сбор читается закрытым, а не «готово»", () => {
    const base = { collection: { collectUrl: "https://x", sendCount: 1, closedAt: null }, active: true };
    expect(statusOf({ ...base, status: "sent" } as never).label).toBe("Разослано · 1");
    expect(statusOf({ ...base, status: "sent", active: false } as never).label).toBe("Закрыт");
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run miniapp/src/screens/admin/collection-form.test.tsx`
Expected: FAIL — модуля `./AdminCollections` нет.

- [ ] **Step 3: Переименовать экран и дописать хелперы**

```bash
git mv miniapp/src/screens/admin/AdminBirthdays.tsx miniapp/src/screens/admin/AdminCollections.tsx
git mv miniapp/src/screens/admin/birthdays.test.ts miniapp/src/screens/admin/collections.test.ts
git mv miniapp/src/screens/admin/AdminBirthdays-reach.test.tsx miniapp/src/screens/admin/AdminCollections-reach.test.tsx
```

В `AdminCollections.tsx`: компонент `AdminBirthdays` → `AdminCollections`, докстринг переписать под «Сборы», и добавить хелперы:

```ts
/** «по 1 000 ₽ · нужно 25 000 ₽» — только то, что заполнено. */
export function moneyLine(c: { amountPerPerson: number | null; totalGoal: number | null }): string | null {
  const parts: string[] = [];
  if (c.amountPerPerson != null) parts.push(`по ${formatMoney(c.amountPerPerson)}`);
  if (c.totalGoal != null) parts.push(`нужно ${formatMoney(c.totalGoal)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Повод из одних пробелов поводом не считается. */
export function canCreate(title: string): boolean {
  return title.trim().length > 0;
}

/**
 * Подпись кнопки отправки.
 *
 * Дожим обязан говорить, что рассылка уже была, и когда: иначе второй тап
 * выглядит как первый, и админ шлёт команде третье письмо, думая, что первое
 * не ушло.
 */
export function sendButtonLabel(preview: CollectionPreview): string {
  if (preview.sendCount === 0) return `Разослать ${recipientsPhrase(preview.recipients.length)}`;
  const when = preview.lastSentAt ? ` · рассылалось ${formatDayMonth(preview.lastSentAt.slice(0, 10))}` : "";
  return `Напомнить ещё раз${when}`;
}

/** Где раунд, в одном слове. Закрытый читается закрытым, а не «готово». */
export function statusOf(row: CollectionRow): { label: string; tone: StatusTone } {
  if (!row.active) return { label: "Закрыт", tone: "pending" };
  if (row.status === "sent") return { label: `Разослано · ${row.collection.sentCount}`, tone: "sent" };
  if (row.status === "ready") return { label: "Готово", tone: "ready" };
  return { label: "Нет ссылки", tone: "pending" };
}
```

- [ ] **Step 4: Собрать экран**

Внутри `AdminCollections` — три секции в одном `List`:

1. `Section header="Ближайшие дни рождения"` — существующие карточки, без изменений по смыслу; редактор карточки зовёт `saveBirthdayRound` и `getBirthdayPreview`, а отправку — общим `sendCollection(preview.id)`. Кнопка отправки погашена, пока `preview.id === 0`: раунд ещё не сохранён.
2. `Section header="Новый сбор"` — сворачиваемая форма:
   - `Input header="Повод"` (обязателен), `Select` «Кому» со значениями «Общий сбор» + активные работники, `input type="date"` × 2 («Дата события», «Скинуться до»), `Input type="number" inputMode="numeric"` × 2 («По сколько с человека», «Нужно всего»), `Input header="Ссылка на сбор" type="url"`, `Textarea header="Свой текст"`;
   - кнопка «Создать» — `disabled={!canCreate(title) || busy}`;
   - после успеха форма схлопывается, оба списка перечитываются (`reloadEverything`, он в файле уже есть).
3. `Section header="Сборы"` — `rows.map` по `getCollections()`. Каждая карточка: заголовок (`row.title`), вторая строка `moneyLine` + дедлайн, статус справа, `CopyableLink` (компонент в файле уже есть), кнопка «Открыть» → разворачивает редактор по `row.collection.id`.

Редактор сбора: те же поля, что в форме создания, плюс кнопки «Собрали, закрыть» / «Открыть заново» и «Удалить» (последняя только при `row.collection.sendCount === 0`). Отправка — существующий двухшаговый `confirming`, подпись берётся из `sendButtonLabel`.

Костыль `isCurrentRound` **удалить вместе с его докстрингом**: строка списка теперь открывается по своему `id`, и разрешать её в «текущий раунд» больше не нужно.

В `miniapp/src/screens/AdminScreen.tsx` заменить строку раздела:

```ts
  { key: "collections", label: "Сборы" },
```

и переименовать значение `AdminSection` `"birthdays"` → `"collections"` во всех местах файла.

- [ ] **Step 5: Прогнать тесты мини-аппа**

Run: `npx vitest run miniapp/`
Expected: PASS. Переименованные тесты поправить под новые имена — если какой-то из них после переименования проходит, не меняясь по сути, это нормально: он и раньше проверял поведение, которое не изменилось.

- [ ] **Step 6: Коммит**

```bash
npx vitest run server/src/db/no-real-names.test.ts
git add miniapp/src
git commit -m "feat(мини-апп): раздел «Сборы» — форма, список, дожим, закрытие"
```

---

### Task 13: Раздел «Сборы» в десктопной консоли

**Files:**
- Rename: `admin/src/screens/BirthdaysScreen.tsx` → `admin/src/screens/CollectionsScreen.tsx`
- Rename: `admin/src/birthdays-reach.test.tsx` → `admin/src/collections-reach.test.tsx`
- Create: `admin/src/collections-screen.test.tsx`
- Modify: `admin/src/App.tsx` (импорт и ярлык раздела)

**Interfaces:**
- Consumes: клиент из Задачи 11; хелперы **не переиспользуются из мини-аппа** — консоль и мини-апп не импортируют друг у друга; общие правила лежат в `@planer/shared` и берутся оттуда (`collectionStatus`, `formatMoney`, `formatDayMonth`).

**Что в консоли появляется впервые.** Сегодня в десктопной консоли нет списка прошлых сборов вообще — `admin/src/api/client.ts` не импортирует `mockGetBirthdayCampaigns`, и экран показывает только ближайшие дни рождения. Список сборов здесь строится с нуля.

- [ ] **Step 1: Написать падающий тест**

Создать `admin/src/collections-screen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollectionsScreen } from "./screens/CollectionsScreen";
import { apiClient } from "./api/client";

describe("CollectionsScreen", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("рисует активные выше закрытых и называет закрытый закрытым", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([
      { collection: { id: 1, sentCount: 0, sendCount: 0, collectUrl: null } as never, personName: null, title: "Идёт", status: "pending", active: true },
      { collection: { id: 2, sentCount: 3, sendCount: 1, collectUrl: "https://x" } as never, personName: null, title: "Закрытый", status: "sent", active: false },
    ]);

    render(<CollectionsScreen />);
    const cards = await screen.findAllByTestId("collection-card");
    // Порядок задан сервером — экран его не пересортировывает.
    expect(cards.map((el) => el.textContent)).toEqual([
      expect.stringContaining("Идёт"),
      expect.stringContaining("Закрытый"),
    ]);
    expect(cards[1]!.textContent).toContain("Закрыт");
  });

  it("«Создать» погашена, пока не введён повод", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);

    render(<CollectionsScreen />);
    await waitFor(() => screen.getByLabelText("Повод"));
    const create = screen.getByRole("button", { name: "Создать" });
    expect(create).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Повод"), "Кофемашина");
    expect(create).not.toBeDisabled();
  });
});
```

Если `@testing-library/react` в `admin` ещё не подключён — свериться с `admin/src/birthdays-reach.test.tsx` и повторить его способ рендера, а не заводить новую зависимость.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run admin/src/collections-screen.test.tsx`
Expected: FAIL — файла экрана нет.

- [ ] **Step 3: Переименовать и собрать экран**

```bash
git mv admin/src/screens/BirthdaysScreen.tsx admin/src/screens/CollectionsScreen.tsx
git mv admin/src/birthdays-reach.test.tsx admin/src/collections-reach.test.tsx
```

Состав — тот же, что в мини-аппе: ближайшие дни рождения, форма «Новый сбор», список сборов. Каждая карточка списка несёт `data-testid="collection-card"`. Поле повода — `<label>Повод</label>` с привязанным `input`, кнопка создания — `Создать`, погашена по тому же правилу (`title.trim().length === 0`).

В `admin/src/App.tsx` заменить импорт и ярлык раздела на «Сборы».

- [ ] **Step 4: Прогнать тесты консоли и закоммитить**

Run: `npx vitest run admin/`
Expected: PASS.

```bash
npx vitest run server/src/db/no-real-names.test.ts
git add admin/src
git commit -m "feat(консоль): раздел «Сборы» вместо «Дни рождения»"
```

---

### Task 14: Работник видит сбор во вкладке «Команда»

**Files:**
- Create: `miniapp/src/screens/team/TeamCollections.tsx`
- Create: `miniapp/src/screens/team/TeamCollections.test.tsx`
- Modify: `miniapp/src/screens/TeamScreen.tsx`

**Interfaces:**
- Consumes: `apiClient.getMyCollections()` (Задача 11); `formatMoney`, `formatDayMonth` из `@planer/shared`.
- Produces: `TeamCollections` — секция, которая **рисует сама себя или ничего**.

- [ ] **Step 1: Написать падающий тест**

Создать `miniapp/src/screens/team/TeamCollections.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TeamCollections } from "./TeamCollections";
import { apiClient } from "../../api/client";

describe("TeamCollections", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("без активных сборов не рисует ничего — ни заголовка, ни пустого состояния", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([]);
    const { container } = render(<TeamCollections />);
    await waitFor(() => expect(apiClient.getMyCollections).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("показывает повод, сумму, срок и ссылку", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([{
      id: 1, title: "Кофемашина", personName: null, collectUrl: "https://example.test/c/1",
      amountPerPerson: 1000, totalGoal: 25000, deadline: "2026-08-15", eventDate: null,
    }]);

    render(<TeamCollections />);
    expect(await screen.findByText("Кофемашина")).toBeTruthy();
    expect(screen.getByText(/по 1 000 ₽/)).toBeTruthy();
    expect(screen.getByText(/до 15 августа/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Открыть сбор" })).toHaveProperty(
      "href", "https://example.test/c/1",
    );
  });

  it("отказ сервера не роняет вкладку «Команда»", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockRejectedValue(new Error("сеть"));
    const { container } = render(<TeamCollections />);
    await waitFor(() => expect(apiClient.getMyCollections).toHaveBeenCalled());
    // Сбор — не главное на этом экране: график должен остаться на месте.
    expect(container.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run miniapp/src/screens/team/TeamCollections.test.tsx`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Написать компонент**

Создать `miniapp/src/screens/team/TeamCollections.tsx`:

```tsx
import { useEffect, useState } from "react";
import { formatDayMonth, formatMoney } from "@planer/shared";
import { apiClient, type WorkerCollection } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";

/**
 * «Идёт сбор» — секция сверху во вкладке «Команда».
 *
 * Ссылка в личке тонет за два дня, а сбор идёт неделю. Здесь она лежит там, где
 * её можно найти, не поднимая переписку.
 *
 * Своего сбора человек тут не видит: сервер его не отдаёт (`GET /api/collections`),
 * и это единственное место, где правило применяется — экран ничего не фильтрует
 * сам, чтобы правило нельзя было забыть повторить.
 *
 * Пустой список — секции нет вовсе. Заголовок «Идёт сбор» над надписью «сборов
 * нет» занимает место каждый день ради события, которое случается раз в месяц.
 * Отказ сервера — тоже ничего: график команды не должен пропадать из-за того,
 * что не загрузился сбор.
 */
export function TeamCollections() {
  const [rows, setRows] = useState<WorkerCollection[]>([]);

  useEffect(() => {
    let alive = true;
    apiClient
      .getMyCollections()
      .then((loaded) => { if (alive) setRows(loaded); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  if (rows.length === 0) return null;

  return (
    <CardStack>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--tgui--hint_color)", padding: "0 4px" }}>
        {rows.length === 1 ? "Идёт сбор" : "Идут сборы"}
      </div>
      {rows.map((row) => (
        <CardShell key={row.id}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{row.title}</div>
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
            {[
              row.amountPerPerson != null ? `по ${formatMoney(row.amountPerPerson)}` : null,
              row.totalGoal != null ? `нужно ${formatMoney(row.totalGoal)}` : null,
              row.deadline ? `до ${formatDayMonth(row.deadline)}` : null,
            ].filter(Boolean).join(" · ")}
          </div>
          {row.collectUrl && (
            <a
              href={row.collectUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 13.5, fontWeight: 600, color: "var(--tgui--link_color)" }}
            >
              Открыть сбор
            </a>
          )}
        </CardShell>
      ))}
    </CardStack>
  );
}
```

В `miniapp/src/screens/TeamScreen.tsx` отрисовать `<TeamCollections />` первым элементом внутри `ScreenScroll`, выше переключателя вида.

- [ ] **Step 4: Прогнать тесты и закоммитить**

Run: `npx vitest run miniapp/`
Expected: PASS.

```bash
npx vitest run server/src/db/no-real-names.test.ts
git add miniapp/src
git commit -m "feat(мини-апп): секция «Идёт сбор» во вкладке «Команда»"
```

---

### Task 15: Гейт

**Files:** ничего не создаётся — задача целиком про доказательства.

- [ ] **Step 1: Полный прогон**

```bash
npm test
npm run typecheck
```

Ожидается: оба зелёные. Записать число тестов и число файлов — с ними сверяется CI (было 1283 теста до этой работы).

- [ ] **Step 2: Страж приватности на живой базе**

```bash
npx vitest run server/src/db/no-real-names.test.ts
```

Ожидается: PASS. Если пропущен — значит нет `data/planer.db`, и это не доказательство: прогнать там, где база есть.

- [ ] **Step 3: Проверить, что кириллических идентификаторов не завелось**

```bash
git grep -nE "(const|let|function) [а-яА-ЯёЁ]" -- '*.ts' '*.tsx'
```

Ожидается: пусто.

- [ ] **Step 4: Проверить язык комментариев на сервере**

```bash
git grep -nE "^\s*(//|\*) .*[а-яА-ЯёЁ]" -- 'server/src/**/*.ts' | grep -v "«"
```

Ожидается: пусто. Русские доменные термины на сервере допускаются только в «ёлочках» внутри английской фразы; всё, что нашлось помимо них, — перевести.

- [ ] **Step 5: Пересобрать обе морды**

```bash
npm run build -w miniapp && npm run build -w admin
```

Ожидается: обе сборки проходят. (Если скрипта `build` в воркспейсе нет — свериться с тем, как фронтенды собирались в предыдущих фичах, и повторить.)

- [ ] **Step 6: Постусловие миграции ещё раз, на свежей копии живой базы**

Повторить Шаг 6 Задачи 3 на новой копии `data/planer.db` — между тем прогоном и этим успели пройти двенадцать задач, и проверять надо тот код, который поедет на сервер.

- [ ] **Step 7: Отчитаться**

В отчёте назвать числами: сколько тестов, сколько файлов тестов, что показал прогон миграции на копии, и **что осталось непроверенным живьём** — реальная отправка в Telegram кастомного сбора никакими тестами не доказывается, транспорт в них застабан.

Живую базу не трогать: она мигрирует сама при первом старте нового кода. Пуш и деплой — его решение, не спрашивать заранее и не делать самому.



