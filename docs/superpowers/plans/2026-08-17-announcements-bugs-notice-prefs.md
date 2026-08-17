# Анонсы, багрепорты и выключатели уведомлений — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать админам рассылку анонсов команде, всем в команде — кнопку «сообщить о проблеме», а каждому админу — выключатели ненужных ему уведомлений.

**Architecture:** У админского уведомления появляется обязательный «вид» (`AdminNoticeKind`), и `notifyAdmins` начинает его требовать — компилятор заставляет каждое из восьми существующих писем назвать себя. Выключенные виды хранятся строками в `notification_mutes` («строки нет — включено»), эскалация уходит мимо этого механизма через отдельную `notifyAdminsAlways`. Анонс — экран в мини-аппе и один POST-маршрут, оставляющий строку в журнале. Багрепорт — кнопка в боте, `force_reply` плюс окно ожидания в таблице, и своя таблица со статусом «новый / разобран».

**Tech Stack:** TypeScript, grammy (Telegram), Hono (HTTP), Drizzle + SQLite (WAL), Zod, Vitest, React + `@telegram-apps/telegram-ui` (мини-апп).

**Spec:** [`docs/superpowers/specs/2026-08-17-announcements-bug-reports-notice-prefs-design.md`](../specs/2026-08-17-announcements-bug-reports-notice-prefs-design.md)

## Global Constraints

- **Ветка:** `feature/announcements-bugs-notice-prefs`. Не `main`.
- **Гейт после каждой задачи:** `npm test` (сейчас 1425 тестов, ~14 с), `npm run typecheck`, `npm run lint`. Ничего не считается готовым без прогнанной команды с показанным выводом.
- **Настоящих ФИО в репозитории быть не может.** Репозиторий публичный. Имена в тестах — только вымышленные: «Аня», «Игорь», «Марк». Сторож: `server/src/db/no-real-names.test.ts`.
- **Текст, который читает человек, — по-русски.** Английский остаётся в именах кода.
- **Комментарий объясняет «почему», а не «что».** Так написан весь существующий код.
- **Дата — командная:** `teamNow(config.teamTz)`, не `new Date()`. Единственное разрешённое спекой исключение — часовой потолок багрепортов (Задача 8): он меряет темп, а не календарь, и сравнивает метки времени.
- **Слои:** `shared/`, `server/` — слой 1, TDD обязателен. `miniapp/` — слой 2: логика тестируется, вёрстка нет.
- **Миграции** генерируются `npx drizzle-kit generate` и НИКОГДА не правятся руками после применения. Нумерация продолжает `0019_light_slapstick.sql`.
- **Потолки, значения дословно:** текст анонса ≤ 2000 символов; явный список адресатов ≤ 200; текст багрепорта ≤ 2000 символов; ≤ 5 багрепортов в час с человека; окно ожидания багрепорта 15 минут.
- **Три места на каждый новый маршрут мини-аппа:** интерфейс `ApiClient`, `realClient` и `devClient` (мок) в `miniapp/src/api/client.ts`. Пропустить мок — значит развести dev-путь с живым.

---

## Карта файлов

**Создаются:**

| Файл | Ответственность |
| --- | --- |
| `shared/src/notifications.ts` | список видов уведомлений и их подписи — единственный на весь проект |
| `server/src/repo/notice-prefs.ts` | чтение и запись `notification_mutes` |
| `server/src/announcements/announcement-service.ts` | кто получит анонс, каким текстом, с какими потолками |
| `server/src/bugs/bug-service.ts` | окно ожидания, приём багрепорта, потолки, статус |
| `server/src/repo/bugs.ts` | голые запросы к `bug_reports` и `bug_report_pending` |
| `miniapp/src/screens/admin/AdminAnnounce.tsx` | экран составления анонса |
| `miniapp/src/screens/admin/AdminBugs.tsx` | список багрепортов |

**Правятся:** `shared/src/index.ts`, `shared/src/audit.ts`, `server/src/db/schema.ts`, `server/src/bot/notify.ts`, `server/src/bot/bot.ts`, `server/src/bot/keyboard.ts`, `server/src/handover/handover-messenger.ts`, `server/src/handover/handover-service.ts`, `server/src/birthdays/birthday-notice.ts`, `server/src/http/app.ts`, `server/src/http/routes/my-entries.ts`, `miniapp/src/api/client.ts`, `miniapp/src/api/mock.ts`, `miniapp/src/App.tsx`, `miniapp/src/screens/AdminScreen.tsx`, `miniapp/src/screens/admin/AdminSettings.tsx`.

---

### Task 1: У уведомления появляется вид

Чистый рефакторинг: виды заводятся, но пока ничего не фильтруют. Поведение системы не меняется ни на йоту — это и есть критерий приёмки, и доказывают его существующие тесты, оставшиеся зелёными.

**Files:**
- Create: `shared/src/notifications.ts`
- Create: `shared/src/notifications.test.ts`
- Modify: `shared/src/index.ts`
- Modify: `server/src/bot/notify.ts:284-293`
- Modify: `server/src/handover/handover-messenger.ts:33-35`, `server/src/handover/handover-service.ts:41,145,280,300`
- Modify (вызовы): `server/src/bot/bot.ts:641,722`, `server/src/http/app.ts:883,1112,1128`, `server/src/http/routes/my-entries.ts:131,187,236`
- Modify (тест существующий): `server/src/bot/notify.test.ts`

**Interfaces:**
- Produces: `ADMIN_NOTICE_KINDS: readonly AdminNoticeKind[]`, `type AdminNoticeKind`, `ADMIN_NOTICE_LABELS: Record<AdminNoticeKind, { title: string; hint: string }>`, `notifyAdmins(bot: Bot, db: Db, kind: AdminNoticeKind, text: string): Promise<void>`, `notifyAdminsAlways(bot: Bot, db: Db, text: string): Promise<void>`, `HandoverMessenger.adminsAlways(text: string): Promise<void>`.

- [ ] **Шаг 1: Тест на подписи**

Создать `shared/src/notifications.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ADMIN_NOTICE_KINDS, ADMIN_NOTICE_LABELS } from "./notifications";

describe("виды админских уведомлений", () => {
  // Не «у каждого вида есть подпись» — это уже гарантирует `Record<AdminNoticeKind, …>`
  // на уровне tsc, и такой тест не смог бы упасть никогда. Падает этот — на пустой
  // строке и на скопированном заголовке, а обе эти ошибки живые.
  it("у каждого вида непустые заголовок и пояснение", () => {
    for (const kind of ADMIN_NOTICE_KINDS) {
      const label = ADMIN_NOTICE_LABELS[kind];
      expect(label.title.trim(), kind).not.toBe("");
      expect(label.hint.trim(), kind).not.toBe("");
    }
  });

  it("заголовки различны — иначе в списке два одинаковых переключателя", () => {
    const titles = ADMIN_NOTICE_KINDS.map((kind) => ADMIN_NOTICE_LABELS[kind].title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
```

- [ ] **Шаг 2: Прогнать, убедиться, что падает**

Run: `npx vitest run shared/src/notifications.test.ts`
Expected: FAIL — `Failed to resolve import "./notifications"`.

- [ ] **Шаг 3: Завести виды**

Создать `shared/src/notifications.ts`:

```ts
/**
 * Виды писем, которые бот шлёт админам, и подписи к их выключателям.
 *
 * Массив, а не просто объявление типа, по той же причине, что и `AUDIT_TYPES`:
 * тип выводится из него же, и тест может перебрать виды в рантайме.
 *
 * Эскалации передачи смены здесь нет и быть не может — она уходит мимо этого
 * механизма, через `notifyAdminsAlways`. Вид означает «это можно выключить», а
 * «смену завтра работать некому» выключить нельзя.
 */
export const ADMIN_NOTICE_KINDS = [
  "swaps",
  "weekend",
  "self_entries",
  "handovers",
  "celebrations",
  "bug_reports",
] as const;

export type AdminNoticeKind = (typeof ADMIN_NOTICE_KINDS)[number];

export const ADMIN_NOTICE_LABELS: Record<AdminNoticeKind, { title: string; hint: string }> = {
  swaps: { title: "Обмены сменами", hint: "Кто с кем поменялся сменами." },
  weekend: { title: "Работа в выходные", hint: "Кто согласился выйти в выходной, а кто отказался." },
  self_entries: { title: "Больничные и мероприятия", hint: "Работник сам поставил, поправил или снял себе запись." },
  handovers: { title: "Передача смен", hint: "Чужую смену забрал коллега. Письмо «смену никто не взял» приходит всегда." },
  celebrations: { title: "Дни рождения и сборы", hint: "Напоминания разослать поздравление и собрать деньги." },
  bug_reports: { title: "Сообщения о проблемах", hint: "Кто-то из команды пожаловался через кнопку «Проблема»." },
};
```

Добавить в `shared/src/index.ts` строку экспорта рядом с остальными:

```ts
export * from "./notifications";
```

- [ ] **Шаг 4: Прогнать — зелено**

Run: `npx vitest run shared/src/notifications.test.ts`
Expected: PASS, 2 теста.

- [ ] **Шаг 5: Потребовать вид в `notifyAdmins`**

В `server/src/bot/notify.ts` заменить существующую `notifyAdmins` (строки 284–293) на две функции:

```ts
/**
 * Письмо всем достижимым админам.
 *
 * `kind` — обязательный, и это главное в этой сигнатуре. Необязательный параметр
 * со значением по умолчанию однажды дал бы девятый вызов, который молча нельзя
 * выключить, и заметили бы это по жалобе. Здесь же tsc не даст добавить админское
 * уведомление, не решив, к какому виду оно относится.
 */
export async function notifyAdmins(bot: Bot, db: Db, kind: AdminNoticeKind, text: string): Promise<void> {
  for (const admin of listAdmins(db)) {
    if (admin.telegramUserId == null) continue;
    try {
      await bot.api.sendMessage(admin.telegramUserId, text);
    } catch (err) {
      console.error(`notifyAdmins(${kind}): failed for ${admin.telegramUserId}:`, safeErrorMessage(err));
    }
  }
}

/**
 * То же самое, но выключить это нельзя.
 *
 * Отдельная функция, а не флаг «невыключаемый вид», намеренно: читающий место
 * вызова должен видеть, что письмо пройдёт сквозь любые настройки, не ходя за
 * определением. Сегодня так уходит ровно одно — «смену никто не взял».
 */
export async function notifyAdminsAlways(bot: Bot, db: Db, text: string): Promise<void> {
  for (const admin of listAdmins(db)) {
    if (admin.telegramUserId == null) continue;
    try {
      await bot.api.sendMessage(admin.telegramUserId, text);
    } catch (err) {
      console.error(`notifyAdminsAlways: failed for ${admin.telegramUserId}:`, safeErrorMessage(err));
    }
  }
}
```

Импортировать тип в шапке файла: `import type { AdminNoticeKind } from "@planer/shared";`

- [ ] **Шаг 6: Прогнать typecheck, увидеть восемь красных вызовов**

Run: `npm run typecheck`
Expected: FAIL — ошибки «Expected 4 arguments, but got 3» в `bot.ts`, `app.ts`, `my-entries.ts`, `handover-messenger.ts`. Это и есть та самая гарантия в действии; выписать список файлов, чтобы ни один не потерялся.

- [ ] **Шаг 7: Проставить виды**

| Файл и строка | Вид |
| --- | --- |
| `server/src/bot/bot.ts:641` (обмен состоялся) | `"swaps"` |
| `server/src/bot/bot.ts:722` (выходная: подтвердил/отказался) | `"weekend"` |
| `server/src/http/app.ts:883` (обмен состоялся, путь мини-аппа) | `"swaps"` |
| `server/src/http/app.ts:1112`, `:1128` (выходная) | `"weekend"` |
| `server/src/http/routes/my-entries.ts:131,187,236` (самозапись) | `"self_entries"` |

Пример правки (`bot.ts:641`):

```ts
      await notifyAdmins(
        bot,
        db,
        "swaps",
        swapAcceptedAdminText(
```

- [ ] **Шаг 8: Развести эскалацию и «смену забрали»**

В `server/src/handover/handover-service.ts` в интерфейс `HandoverMessenger` (строка 41) добавить второй метод:

```ts
  admins(text: string): Promise<void>;
  /** Письмо, которое админ не может себе выключить: смена осталась без человека. */
  adminsAlways(text: string): Promise<void>;
```

Перевести на него оба вызова эскалации — строку 145 и строку 300 — заменив `deps.messenger.admins(` на `deps.messenger.adminsAlways(`. Вызов на строке 280 (`handoverTakenTextForAdmins`) остаётся на `admins`.

В `server/src/handover/handover-messenger.ts` (строки 33–35):

```ts
    async admins(text) {
      if (bot) await notifyAdmins(bot, db, "handovers", text);
    },
    async adminsAlways(text) {
      if (bot) await notifyAdminsAlways(bot, db, text);
    },
```

Импорт в шапке дополнить `notifyAdminsAlways`.

- [ ] **Шаг 9: Дни рождения и сборы**

`server/src/birthdays/birthday-notice.ts` шлёт через `adminRecipients` + собственный цикл, а не через `notifyAdmins` — трогать его в этой задаче не нужно, вид `celebrations` начнёт применяться в Задаче 2. Проверить это глазами: `grep -n "notifyAdmins\|sendMessage" server/src/birthdays/birthday-notice.ts`. Если вызов `notifyAdmins` там всё же есть — проставить `"celebrations"`.

- [ ] **Шаг 10: Поправить существующий тест**

В `server/src/bot/notify.test.ts` каждый вызов `notifyAdmins(bot, db, "текст")` получает вид третьим аргументом: `notifyAdmins(bot, db, "swaps", "текст")`. Смысл этих тестов не меняется — они про доставку, а не про виды.

- [ ] **Шаг 11: Полный гейт**

Run: `npm test && npm run typecheck && npm run lint`
Expected: всё зелёное, число тестов = 1425 + 2. Поведение не изменилось — ни один существующий тест не должен был потребовать правки, кроме сигнатурной в `notify.test.ts`.

- [ ] **Шаг 12: Коммит**

```bash
git add shared/src/notifications.ts shared/src/notifications.test.ts shared/src/index.ts \
        server/src/bot/notify.ts server/src/bot/notify.test.ts server/src/bot/bot.ts \
        server/src/handover/handover-messenger.ts server/src/handover/handover-service.ts \
        server/src/http/app.ts server/src/http/routes/my-entries.ts
git commit -m "refactor(уведомления): у админского письма появился обязательный вид

Восемь вызовов notifyAdmins назвали себя, потому что tsc не дал иначе.
Эскалация передачи уехала на отдельную notifyAdminsAlways: имя в месте
вызова говорит «это выключить нельзя» без похода за определением.

Поведение не изменилось — виды пока ничего не фильтруют."
```

---

### Task 2: Таблица выключателей и фильтрация

**Files:**
- Modify: `server/src/db/schema.ts`
- Create: `server/drizzle/00XX_notification_mutes.sql` (сгенерированная)
- Create: `server/src/repo/notice-prefs.ts`
- Create: `server/src/bot/notice-mutes.test.ts`
- Modify: `server/src/bot/notify.ts`

**Interfaces:**
- Consumes: `AdminNoticeKind`, `notifyAdmins`, `notifyAdminsAlways` (Задача 1).
- Produces: `isNoticeMuted(db: Db, employeeId: number, kind: AdminNoticeKind): boolean`, `setNoticeMuted(db: Db, employeeId: number, kind: AdminNoticeKind, muted: boolean): void`, `listMutedKinds(db: Db, employeeId: number): AdminNoticeKind[]`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `server/src/bot/notice-mutes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { notifyAdmins, notifyAdminsAlways } from "./notify";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { setNoticeMuted, isNoticeMuted, listMutedKinds } from "../repo/notice-prefs";
import { ADMIN_NOTICE_KINDS } from "@planer/shared";
import type { Db } from "../db/client";

function testBot() {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") sent.push(payload as { chat_id: number | string; text: string });
    return { ok: true, result: {} } as any;
  });
  return { bot, sent };
}

function admin(db: Db, name: string, tgId: number) {
  const a = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}`, isAdmin: true });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return a;
}

describe("выключенные виды уведомлений", () => {
  it("по умолчанию не выключено ничего", () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    expect(isNoticeMuted(db, anya.id, "swaps")).toBe(false);
    expect(listMutedKinds(db, anya.id)).toEqual([]);
  });

  // Обе половины в одном тесте намеренно: тест, проверяющий только «выключивший
  // не получил», остаётся зелёным и при «не пишем вообще никому».
  it("выключивший вид не получает письмо, а не выключивший — получает", async () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    admin(db, "Игорь", 222);
    setNoticeMuted(db, anya.id, "self_entries", true);

    const { bot, sent } = testBot();
    await notifyAdmins(bot, db, "self_entries", "Игорь поставил себе больничный");

    expect(sent.map((m) => m.chat_id)).toEqual([222]);
  });

  it("выключен один вид — другие продолжают приходить", async () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    setNoticeMuted(db, anya.id, "self_entries", true);

    const { bot, sent } = testBot();
    await notifyAdmins(bot, db, "swaps", "Обмен состоялся");

    expect(sent.map((m) => m.chat_id)).toEqual([111]);
  });

  it("эскалация доходит до админа, у которого выключены все виды", async () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    for (const kind of ADMIN_NOTICE_KINDS) setNoticeMuted(db, anya.id, kind, true);

    const { bot, sent } = testBot();
    await notifyAdminsAlways(bot, db, "Смена без человека — нужно решение");

    expect(sent.map((m) => m.chat_id)).toEqual([111]);
  });

  it("выключенное у одного админа не выключается у другого", async () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    const igor = admin(db, "Игорь", 222);
    setNoticeMuted(db, anya.id, "weekend", true);

    expect(isNoticeMuted(db, igor.id, "weekend")).toBe(false);
  });

  it("повторное выключение не заводит вторую строку, включение убирает", () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    setNoticeMuted(db, anya.id, "swaps", true);
    setNoticeMuted(db, anya.id, "swaps", true);
    expect(listMutedKinds(db, anya.id)).toEqual(["swaps"]);

    setNoticeMuted(db, anya.id, "swaps", false);
    expect(listMutedKinds(db, anya.id)).toEqual([]);
  });
});
```

- [ ] **Шаг 2: Прогнать, убедиться, что падает**

Run: `npx vitest run server/src/bot/notice-mutes.test.ts`
Expected: FAIL — `Failed to resolve import "../repo/notice-prefs"`.

- [ ] **Шаг 3: Таблица**

В `server/src/db/schema.ts` дописать после `appSettings`:

```ts
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
```

Импорт типа в шапке файла дополнить: `AdminNoticeKind` из `@planer/shared`.

- [ ] **Шаг 4: Сгенерировать миграцию**

Run: `npx drizzle-kit generate`
Expected: появился новый файл в `server/drizzle/` с `CREATE TABLE notification_mutes` и `CREATE UNIQUE INDEX notification_mute_unique`. Прочитать его глазами и убедиться, что там нет `DROP` ни одной существующей таблицы. Имя файла drizzle придумывает сам — не переименовывать.

- [ ] **Шаг 5: Репозиторий**

Создать `server/src/repo/notice-prefs.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { AdminNoticeKind } from "@planer/shared";
import type { Db } from "../db/client";
import { notificationMutes } from "../db/schema";

/** Выключен ли у этого человека этот вид. Отсутствие строки = включено. */
export function isNoticeMuted(db: Db, employeeId: number, kind: AdminNoticeKind): boolean {
  return (
    db
      .select()
      .from(notificationMutes)
      .where(and(eq(notificationMutes.employeeId, employeeId), eq(notificationMutes.kind, kind)))
      .get() != null
  );
}

/** Выключить или включить обратно. Идемпотентно в обе стороны — эту ручку дёргают
 *  и с экрана, и кнопкой под самим уведомлением, и повторное нажатие не должно
 *  ни падать, ни заводить вторую строку. */
export function setNoticeMuted(db: Db, employeeId: number, kind: AdminNoticeKind, muted: boolean): void {
  if (!muted) {
    db.delete(notificationMutes)
      .where(and(eq(notificationMutes.employeeId, employeeId), eq(notificationMutes.kind, kind)))
      .run();
    return;
  }
  db.insert(notificationMutes).values({ employeeId, kind }).onConflictDoNothing().run();
}

export function listMutedKinds(db: Db, employeeId: number): AdminNoticeKind[] {
  return db
    .select()
    .from(notificationMutes)
    .where(eq(notificationMutes.employeeId, employeeId))
    .all()
    .map((row) => row.kind);
}
```

- [ ] **Шаг 6: Фильтр внутри `notifyAdmins`**

В `server/src/bot/notify.ts` в теле `notifyAdmins` добавить одну строку после проверки на `telegramUserId`:

```ts
  for (const admin of listAdmins(db)) {
    if (admin.telegramUserId == null) continue;
    // Единственное место на весь проект, где эта проверка делается. Если она
    // понадобится где-то ещё — значит, письмо шлют мимо `notifyAdmins`, и чинить
    // надо это, а не копировать условие.
    if (isNoticeMuted(db, admin.id, kind)) continue;
```

Импорт: `import { isNoticeMuted } from "../repo/notice-prefs";`. `notifyAdminsAlways` не трогать — в этом весь её смысл.

- [ ] **Шаг 7: Прогнать — зелено**

Run: `npx vitest run server/src/bot/notice-mutes.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Шаг 8: Полный гейт**

Run: `npm test && npm run typecheck && npm run lint`
Expected: зелено. Существующие тесты не должны были покраснеть: никто ничего не выключал, а отсутствие строки означает «включено».

- [ ] **Шаг 9: Коммит**

```bash
git add server/src/db/schema.ts server/drizzle/ server/src/repo/notice-prefs.ts \
        server/src/bot/notify.ts server/src/bot/notice-mutes.test.ts
git commit -m "feat(уведомления): админ может выключить вид письма

notification_mutes: строка есть — выключено, строки нет — включено, как в
app_settings. Миграция ничего не засеивает, поэтому живая база ведёт себя
ровно как до неё.

Проверка стоит внутри notifyAdmins — в одном месте на весь проект.
notifyAdminsAlways её не делает, и тест на эскалацию это сторожит."
```

---

### Task 3: Маршруты настроек

**Files:**
- Modify: `shared/src/audit.ts`
- Modify: `server/src/http/app.ts` (рядом с `PATCH /api/me/settings`, ~строка 308)
- Create: `server/src/http/notice-prefs-routes.test.ts`

**Interfaces:**
- Consumes: `isNoticeMuted`, `setNoticeMuted`, `listMutedKinds`, `ADMIN_NOTICE_KINDS`, `ADMIN_NOTICE_LABELS`.
- Produces: `GET /api/me/notifications` → `{ kinds: { kind, title, hint, enabled }[] }`; `PATCH /api/me/notifications` `{ kind, enabled }` → `{ kind, enabled }`; тип события `notice_prefs_changed`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `server/src/http/notice-prefs-routes.test.ts`. Способ поднять приложение и получить токен взять из соседнего `server/src/http/read.test.ts` — повторить его хелперы дословно, а не изобретать свои.

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { setNoticeMuted } from "../repo/notice-prefs";
import { issueToken } from "../auth/jwt";
import { createApp } from "./app";

const config = { jwtSecret: "s", teamTz: "Europe/Moscow", publicUrl: "http://x", adminTelegramIds: [] } as any;

async function tokenFor(id: number, isAdmin: boolean) {
  return issueToken({ employeeId: id, isAdmin }, config.jwtSecret);
}

describe("GET/PATCH /api/me/notifications", () => {
  it("отдаёт все виды, выключённый — с enabled:false", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    setNoticeMuted(db, anya.id, "swaps", true);
    const app = createApp({ db, config, bot: null });

    const res = await app.request("/api/me/notifications", {
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kinds: { kind: string; enabled: boolean; title: string }[] };
    expect(body.kinds).toHaveLength(6);
    expect(body.kinds.find((k) => k.kind === "swaps")?.enabled).toBe(false);
    expect(body.kinds.find((k) => k.kind === "weekend")?.enabled).toBe(true);
  });

  it("работнику отвечает 403 — этих писем он не получает вовсе", async () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i2" });
    const app = createApp({ db, config, bot: null });

    const res = await app.request("/api/me/notifications", {
      headers: { Authorization: `Bearer ${await tokenFor(marc.id, false)}` },
    });
    expect(res.status).toBe(403);
  });

  it("PATCH выключает и включает обратно, трогая только себя", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "i2", isAdmin: true });
    const app = createApp({ db, config, bot: null });
    const auth = { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" };

    const off = await app.request("/api/me/notifications", {
      method: "PATCH", headers: auth, body: JSON.stringify({ kind: "weekend", enabled: false }),
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ kind: "weekend", enabled: false });

    // Ключевая половина: id берётся из токена, в теле его нет — выключить чужое нечем.
    const igorRes = await app.request("/api/me/notifications", {
      headers: { Authorization: `Bearer ${await tokenFor(igor.id, true)}` },
    });
    const igorBody = (await igorRes.json()) as { kinds: { kind: string; enabled: boolean }[] };
    expect(igorBody.kinds.find((k) => k.kind === "weekend")?.enabled).toBe(true);

    const on = await app.request("/api/me/notifications", {
      method: "PATCH", headers: auth, body: JSON.stringify({ kind: "weekend", enabled: true }),
    });
    expect(await on.json()).toEqual({ kind: "weekend", enabled: true });
  });

  it("несуществующий вид — 400, а не тихо созданная строка", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    const app = createApp({ db, config, bot: null });

    const res = await app.request("/api/me/notifications", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "нет-такого", enabled: false }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Шаг 2: Прогнать, убедиться, что падает**

Run: `npx vitest run server/src/http/notice-prefs-routes.test.ts`
Expected: FAIL — 404 вместо 200 (маршрутов ещё нет).

- [ ] **Шаг 3: Тип события в журнале**

В `shared/src/audit.ts` в массив `AUDIT_TYPES` дописать рядом с `settings_changed`:

```ts
  "employee_invite_issued", "settings_changed", "notice_prefs_changed",
```

Прогнать `npm run typecheck` — `tsc` потребует описатель в `DESCRIBERS`. Дописать туда:

```ts
  // Отдельно от `settings_changed`: на вопрос «почему админ перестал получать
  // письма» должна отвечать строка журнала, а не догадка.
  notice_prefs_changed: (p) => ({
    icon: "🔕",
    title: p.enabled ? "Включил(а) себе уведомления" : "Выключил(а) себе уведомления",
    lines: [String(p.title ?? p.kind ?? "")],
  }),
```

- [ ] **Шаг 4: Маршруты**

В `server/src/http/app.ts` сразу после блока `PATCH /api/me/settings` (заканчивается на строке ~308):

```ts
  /**
   * Что писать этому админу.
   *
   * `requireAdmin`, а не `requireAuth`: этих писем не получает никто, кроме
   * админов, и переключатель, который у работника ничего не меняет, — ложь в
   * интерфейсе, а не безобидная лишняя настройка.
   *
   * Адресат берётся из токена, id в пути нет — чужие уведомления выключить нечем,
   * тем же правилом, что и в `/api/me/settings`.
   */
  app.get("/api/me/notifications", requireAdmin(db, config.jwtSecret), (c) => {
    const muted = new Set(listMutedKinds(db, c.get("auth").employeeId));
    return c.json({
      kinds: ADMIN_NOTICE_KINDS.map((kind) => ({
        kind,
        title: ADMIN_NOTICE_LABELS[kind].title,
        hint: ADMIN_NOTICE_LABELS[kind].hint,
        enabled: !muted.has(kind),
      })),
    });
  });

  app.patch("/api/me/notifications", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; enabled?: unknown };
    if (typeof body.enabled !== "boolean") return c.json({ error: "enabled должен быть true или false" }, 400);
    // Проверяем по списку, а не по типу: тело приходит из сети, и `as AdminNoticeKind`
    // завёл бы строку с любым мусором в `kind`.
    const kind = ADMIN_NOTICE_KINDS.find((k) => k === body.kind);
    if (!kind) return c.json({ error: "неизвестный вид уведомления" }, 400);

    const id = c.get("auth").employeeId;
    setNoticeMuted(db, id, kind, !body.enabled);
    recordAudit(db, "notice_prefs_changed", id, {
      employeeId: id,
      kind,
      title: ADMIN_NOTICE_LABELS[kind].title,
      enabled: body.enabled,
    });
    return c.json({ kind, enabled: body.enabled });
  });
```

Импорты в шапке `app.ts` дополнить: `ADMIN_NOTICE_KINDS`, `ADMIN_NOTICE_LABELS` из `@planer/shared`; `listMutedKinds`, `setNoticeMuted` из `../repo/notice-prefs`.

- [ ] **Шаг 5: Прогнать — зелено**

Run: `npx vitest run server/src/http/notice-prefs-routes.test.ts`
Expected: PASS, 4 теста.

- [ ] **Шаг 6: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add shared/src/audit.ts server/src/http/app.ts server/src/http/notice-prefs-routes.test.ts
git commit -m "feat(api): ручки для выключателей уведомлений

GET/PATCH /api/me/notifications под requireAdmin: работник этих писем не
получает, и переключатель у него был бы ложью. Адресат — из токена, в теле
его нет, поэтому выключить чужое нечем.

Вид проверяется по списку, а не приводится типом: тело приходит из сети."
```

---

### Task 4: Кнопка «не писать мне про это» под самим уведомлением

**Files:**
- Modify: `server/src/bot/notify.ts`
- Modify: `server/src/bot/bot.ts`
- Create: `server/src/bot/notice-mute-button.test.ts`

**Interfaces:**
- Consumes: `setNoticeMuted`, `ADMIN_NOTICE_LABELS`, `acting()` внутри `createBot`.
- Produces: callback `notice:mute:<kind>`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `server/src/bot/notice-mute-button.test.ts`. Пример проверки кнопки на исходящем сообщении:

```ts
import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { notifyAdmins, notifyAdminsAlways } from "./notify";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import type { Db } from "../db/client";

function testBot() {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string; reply_markup?: any }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") sent.push(payload as any);
    return { ok: true, result: {} } as any;
  });
  return { bot, sent };
}

function admin(db: Db, name: string, tgId: number) {
  const a = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}`, isAdmin: true });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return a;
}

describe("кнопка «не писать мне про это»", () => {
  it("едет с выключаемым уведомлением и несёт его вид", async () => {
    const db = makeTestDb();
    admin(db, "Аня", 111);
    const { bot, sent } = testBot();

    await notifyAdmins(bot, db, "self_entries", "Игорь поставил себе больничный");

    const buttons = sent[0]?.reply_markup?.inline_keyboard?.flat() ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].callback_data).toBe("notice:mute:self_entries");
  });

  it("НЕ едет с эскалацией — её выключить нельзя, и кнопка обещала бы обратное", async () => {
    const db = makeTestDb();
    admin(db, "Аня", 111);
    const { bot, sent } = testBot();

    await notifyAdminsAlways(bot, db, "Смена без человека — нужно решение");

    expect(sent[0]?.reply_markup).toBeUndefined();
  });
});
```

Отдельным тестом — сам обработчик нажатия. Способ прогнать апдейт через `createBot` взять из существующего `server/src/bot/reminders-toggle.test.ts`: там уже написано, как скормить боту callback-запрос и прочитать ответ. Повторить его форму, подставив `notice:mute:swaps`, и проверить, что после нажатия `isNoticeMuted(db, anya.id, "swaps")` стало `true`.

- [ ] **Шаг 2: Прогнать, убедиться, что падает**

Run: `npx vitest run server/src/bot/notice-mute-button.test.ts`
Expected: FAIL — `buttons` пустой, `reply_markup` отсутствует.

- [ ] **Шаг 3: Цеплять кнопку в `notifyAdmins`**

В `server/src/bot/notify.ts`, внутри `notifyAdmins`, перед циклом:

```ts
  // Кнопка едет с каждым выключаемым письмом по причине, уже записанной у
  // `notifyReminder`: за настройкой, о существовании которой не знаешь, не ходят.
  // Момент, когда админ хочет это выключить, наступает ровно тогда, когда оно у
  // него на экране.
  const kb = new InlineKeyboard().text("🔕 Не писать мне про это", `notice:mute:${kind}`);
```

и в самом вызове: `await bot.api.sendMessage(admin.telegramUserId, text, { reply_markup: kb });`

`notifyAdminsAlways` остаётся без кнопки — тест на это уже написан.

- [ ] **Шаг 4: Обработчик нажатия**

В `server/src/bot/bot.ts` рядом с обработчиком `reminders:(on|off)`:

```ts
  /**
   * «Не писать мне про это» под админским уведомлением.
   *
   * Как и у напоминаний, вид берётся из callback-данных, а человек — из того,
   * кто нажал: чужие уведомления выключить нечем. Проверка на админа нужна
   * отдельно — кнопка живёт в чате вечно, а админа могли разжаловать.
   */
  bot.callbackQuery(/^notice:mute:([a-z_]+)$/, async (ctx) => {
    const kind = ADMIN_NOTICE_KINDS.find((k) => k === ctx.match[1]);
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    if (!kind) {
      await ctx.answerCallbackQuery({ text: "Такого вида уведомлений больше нет" });
      return;
    }
    if (!who.me.isAdmin && !config.adminTelegramIds.includes(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Это настройка администратора" });
      return;
    }
    setNoticeMuted(db, who.me.id, kind, true);
    await ctx.answerCallbackQuery({ text: "Больше не буду 🔕" });
    // Существенное — до косметики: человек должен знать, где вернуть обратно.
    await ctx.reply(
      `«${ADMIN_NOTICE_LABELS[kind].title}» больше не пишу. Вернуть — в мини-аппе, «Админ» → «Настройки».`,
    );
    // Снимается только кнопка: текст уведомления по-прежнему нужен человеку.
    await safeEdit(() => ctx.editMessageReplyMarkup());
  });
```

Импорты `bot.ts` дополнить: `ADMIN_NOTICE_KINDS`, `ADMIN_NOTICE_LABELS` из `@planer/shared`; `setNoticeMuted` из `../repo/notice-prefs`.

- [ ] **Шаг 5: Прогнать — зелено**

Run: `npx vitest run server/src/bot/notice-mute-button.test.ts`
Expected: PASS.

- [ ] **Шаг 6: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add server/src/bot/notify.ts server/src/bot/bot.ts server/src/bot/notice-mute-button.test.ts
git commit -m "feat(бот): выключить уведомление можно прямо под ним

По причине, записанной у notifyReminder: за настройкой, о существовании
которой не знаешь, не ходят. У эскалации кнопки нет — она обещала бы то,
чего механизм не делает, и тест это сторожит."
```

---

### Task 5: Экран настроек в мини-аппе

Слой 2: тестируется логика клиента, не вёрстка.

**Files:**
- Modify: `miniapp/src/api/client.ts` (интерфейс `ApiClient` ~строка 597, `realClient` ~1094, `devClient` ~1153)
- Modify: `miniapp/src/api/mock.ts`
- Modify: `miniapp/src/screens/admin/AdminSettings.tsx`

**Interfaces:**
- Consumes: `GET /api/me/notifications`, `PATCH /api/me/notifications` (Задача 3).
- Produces: `apiClient.getNoticePrefs(): Promise<NoticePrefs>`, `apiClient.setNoticePref(kind: string, enabled: boolean): Promise<{ kind: string; enabled: boolean }>`, тип `NoticePrefs = { kinds: { kind: string; title: string; hint: string; enabled: boolean }[] }`.

- [ ] **Шаг 1: Тип и три реализации**

В `miniapp/src/api/client.ts`:

```ts
export interface NoticePref {
  kind: string;
  title: string;
  hint: string;
  enabled: boolean;
}
export interface NoticePrefs {
  kinds: NoticePref[];
}
```

В интерфейс `ApiClient` рядом с `getSettings`:

```ts
  getNoticePrefs(): Promise<NoticePrefs>;
  setNoticePref(kind: string, enabled: boolean): Promise<{ kind: string; enabled: boolean }>;
```

В `realClient`:

```ts
  getNoticePrefs: () => authorizedGet<NoticePrefs>("/api/me/notifications"),
  setNoticePref: (kind, enabled) =>
    authorizedPatchJson<{ kind: string; enabled: boolean }>("/api/me/notifications", { kind, enabled }),
```

Если `authorizedPatchJson` в файле ещё нет — найти, как сделан `authorizedPutJson`, и завести соседа тем же способом, поменяв метод на `PATCH`.

В `devClient` — мок, отдающий все шесть видов включёнными и запоминающий переключения в модульной переменной, чтобы dev-путь вёл себя как живой.

- [ ] **Шаг 2: Прогнать тест мока**

Run: `npx vitest run miniapp/src/api/mock.test.ts miniapp/src/api/client.test.ts`
Expected: PASS. Если в `client.test.ts` есть проверка, что `devClient` и `realClient` реализуют один интерфейс, — она и поймает забытый мок.

- [ ] **Шаг 3: Секция на экране**

В `miniapp/src/screens/admin/AdminSettings.tsx` добавить второй `<Section header="Что мне писать">` под существующим замком обменов: по `Cell` на вид, `Switch` справа, `hint` в `description`. Переключение зовёт `apiClient.setNoticePref`, ошибка рисуется рядом с тумблером — тем же приёмом, что уже используется в этом файле (экран не должен превращаться в тупик без перезагрузки).

Под списком — строка пояснения:

```tsx
<CardShell>
  <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
    Письмо «смену никто не взял» приходит всегда — его выключить нельзя.
  </div>
</CardShell>
```

- [ ] **Шаг 4: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add miniapp/src/api/client.ts miniapp/src/api/mock.ts miniapp/src/screens/admin/AdminSettings.tsx
git commit -m "feat(мини-апп): переключатели уведомлений в админских настройках

Шесть тумблеров и честная строка про то, что эскалацию выключить нельзя:
экран, умалчивающий об исключении, врёт ровно там, где это дорого."
```

---

### Task 6: Анонсы — сервер

**Files:**
- Create: `server/src/announcements/announcement-service.ts`
- Create: `server/src/announcements/announcement-service.test.ts`
- Create: `server/src/http/announcements.test.ts`
- Modify: `shared/src/audit.ts`
- Modify: `server/src/http/app.ts`

**Interfaces:**
- Consumes: `listActive`, `getEmployeeById`, `addressOf`, `notifyUser`.
- Produces: `ANNOUNCEMENT_TEXT_MAX = 2000`, `ANNOUNCEMENT_RECIPIENTS_MAX = 200`, `type Audience = { kind: "all" } | { kind: "picked"; employeeIds: readonly number[] }`, `announcementText(senderName: string, text: string): string`, `announcementRecipients(db: Db, audience: Audience, senderId: number): { reachable: Employee[]; unreachable: string[] }`, `sendAnnouncement(bot: Bot | null, db: Db, input: { senderId: number; text: string; audience: Audience }): Promise<{ delivered: number; intended: number; unreachable: string[] }>`; маршрут `POST /api/admin/announcements`; тип события `announcement_sent`.

- [ ] **Шаг 1: Написать падающий тест сервиса**

Создать `server/src/announcements/announcement-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setRemindersEnabled } from "../repo/employees";
import { setNoticeMuted } from "../repo/notice-prefs";
import { ADMIN_NOTICE_KINDS } from "@planer/shared";
import { announcementText, announcementRecipients, sendAnnouncement } from "./announcement-service";
import type { Db } from "../db/client";

function testBot(failId?: number) {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") {
      const p = payload as { chat_id: number | string; text: string };
      if (p.chat_id === failId) throw new Error("telegram down");
      sent.push(p);
    }
    return { ok: true, result: {} } as any;
  });
  return { bot, sent };
}

function linked(db: Db, name: string, tgId: number, isAdmin = false) {
  const e = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}`, isAdmin });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return e;
}

describe("анонс", () => {
  it("подписан отправителем — анонимной рассылке в рабочем чате нечего ответить", () => {
    expect(announcementText("Аня", "В пятницу переезд")).toBe("📣 Объявление от Ани:\n\nВ пятницу переезд");
  });

  it("уходит выбранным и не уходит остальным", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const igor = linked(db, "Игорь", 222);
    const marc = linked(db, "Марк", 333);
    linked(db, "Лена", 444);

    const { bot, sent } = testBot();
    const res = await sendAnnouncement(bot, db, {
      senderId: anya.id,
      text: "Собрание в 15:00",
      audience: { kind: "picked", employeeIds: [igor.id, marc.id] },
    });

    expect(sent.map((m) => m.chat_id).sort()).toEqual([222, 333]);
    expect(res).toMatchObject({ delivered: 2, intended: 2, unreachable: [] });
  });

  it("«всем» доходит до человека с выключенными напоминаниями и до оглохшего админа", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const igor = linked(db, "Игорь", 222, true);
    const marc = linked(db, "Марк", 333);
    setRemindersEnabled(db, marc.id, false);
    for (const kind of ADMIN_NOTICE_KINDS) setNoticeMuted(db, igor.id, kind, true);

    const { bot, sent } = testBot();
    await sendAnnouncement(bot, db, { senderId: anya.id, text: "Переезд", audience: { kind: "all" } });

    // Отправитель копию не получает — он секунду назад нажал кнопку.
    expect(sent.map((m) => m.chat_id).sort()).toEqual([222, 333]);
  });

  it("человек без Telegram попадает в unreachable, а не в delivered", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    createEmployee(db, { displayName: "Марк", inviteToken: "i-none" });
    linked(db, "Игорь", 222);

    const { bot } = testBot();
    const res = await sendAnnouncement(bot, db, { senderId: anya.id, text: "Переезд", audience: { kind: "all" } });

    expect(res.delivered).toBe(1);
    expect(res.unreachable).toEqual(["Марк"]);
  });

  it("недостижимый чат в середине не обрывает рассылку следующим", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    linked(db, "Игорь", 222);
    linked(db, "Марк", 333);
    linked(db, "Лена", 444);

    const { bot, sent } = testBot(333);
    const res = await sendAnnouncement(bot, db, { senderId: anya.id, text: "Переезд", audience: { kind: "all" } });

    expect(sent.map((m) => m.chat_id).sort()).toEqual([222, 444]);
    expect(res.delivered).toBe(2);
    expect(res.intended).toBe(3);
  });

  it("архивный не считается адресатом даже при явном выборе", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const marc = linked(db, "Марк", 333);
    const { archiveEmployee } = await import("../repo/employees");
    archiveEmployee(db, marc.id, "2026-08-17");

    const picked = announcementRecipients(db, { kind: "picked", employeeIds: [marc.id] }, anya.id);
    expect(picked.reachable).toEqual([]);
    expect(picked.unreachable).toEqual(["Марк"]);
  });
});
```

- [ ] **Шаг 2: Прогнать, убедиться, что падает**

Run: `npx vitest run server/src/announcements/announcement-service.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Шаг 3: Сервис**

Создать `server/src/announcements/announcement-service.ts`:

```ts
import type { Bot } from "grammy";
import { addressOf } from "@planer/shared";
import type { Db } from "../db/client";
import type { Employee } from "../db/schema";
import { getEmployeeById, listActive } from "../repo/employees";
import { notifyUser } from "../bot/notify";

/**
 * Рассылка произвольного текста команде.
 *
 * Единственный поток в системе, который проходит сквозь ВСЕ настройки: и
 * `remindersEnabled`, и `notification_mutes`. Отписаться от объявлений нельзя —
 * иначе фича не даёт того, ради чего заводится. Поэтому он такой один, и поэтому
 * рассылать умеют только админы.
 */

/** Лимит Telegram — 4096, подпись отправителя съедает часть, и запас нужен на
 *  случай длинных имён. Ограничение это про сообщение, а не про базу. */
export const ANNOUNCEMENT_TEXT_MAX = 2000;

/** Один процесс обслуживает и API, и long-polling бота: тридцать сообщений ему
 *  безразличны, три тысячи — нет. Ростер команды — десятки человек, так что
 *  потолок не мешает работе и ловит только явную ошибку или злоупотребление. */
export const ANNOUNCEMENT_RECIPIENTS_MAX = 200;

export type Audience = { kind: "all" } | { kind: "picked"; employeeIds: readonly number[] };

export function announcementText(senderName: string, text: string): string {
  return `📣 Объявление от ${senderName}:\n\n${text}`;
}

/**
 * Кому уйдёт и кому не уйдёт.
 *
 * `excludedFromAssignment` НЕ исключается: это правило про раздачу смен, а не
 * про право знать новость. Отправитель исключается всегда.
 */
export function announcementRecipients(
  db: Db,
  audience: Audience,
  senderId: number,
): { reachable: Employee[]; unreachable: string[] } {
  // Архивный в `pool` при явном выборе ПОПАДАЕТ, и это не недосмотр: письмо ему
  // не уйдёт, но назвать его надо поимённо — админ, не увидевший имени в отчёте,
  // решит, что письмо ушло. `listActive` архивных не отдаёт вовсе, поэтому в
  // ветке «всем» их и нет.
  const pool =
    audience.kind === "all"
      ? listActive(db).filter((e) => e.id !== senderId)
      : audience.employeeIds
          .map((id) => getEmployeeById(db, id))
          .filter((e): e is Employee => e != null && e.id !== senderId);

  return {
    reachable: pool.filter((e) => e.isActive && e.telegramUserId != null),
    unreachable: pool.filter((e) => !e.isActive || e.telegramUserId == null).map((e) => e.displayName),
  };
}

export async function sendAnnouncement(
  bot: Bot | null,
  db: Db,
  input: { senderId: number; text: string; audience: Audience },
): Promise<{ delivered: number; intended: number; unreachable: string[] }> {
  const sender = getEmployeeById(db, input.senderId);
  const { reachable, unreachable } = announcementRecipients(db, input.audience, input.senderId);
  const message = announcementText(sender ? addressOf(sender) : "администратора", input.text);

  let delivered = 0;
  for (const person of reachable) {
    if (person.telegramUserId == null) continue;
    // Один закрытый чат не обрывает рассылку: следующие в списке и есть те, до
    // кого ещё можно достучаться. Тот же приём, что в `notifyVacantSlot`.
    if (bot && (await notifyUser(bot, person.telegramUserId, message))) delivered += 1;
  }
  return { delivered, intended: reachable.length, unreachable };
}
```

- [ ] **Шаг 4: Прогнать — зелено**

Run: `npx vitest run server/src/announcements/announcement-service.test.ts`
Expected: PASS, 6 тестов. Если тест про подпись упал на форме обращения — сверить с тем, что реально возвращает `addressOf`, и поправить ожидание в тесте, а не выдумывать своё склонение.

- [ ] **Шаг 5: Тип события**

В `shared/src/audit.ts` в `AUDIT_TYPES` дописать `"announcement_sent",` рядом с `collection_*`, и описатель в `DESCRIBERS`:

```ts
  announcement_sent: (p) => ({
    icon: "📣",
    title: "Разослано объявление",
    lines: [
      String(p.text ?? ""),
      `Кому: ${p.audience === "all" ? "всей команде" : "выбранным"} · дошло ${p.delivered} из ${p.intended}`,
    ],
  }),
```

- [ ] **Шаг 6: Маршрут с падающим тестом**

Создать `server/src/http/announcements.test.ts` по образцу `notice-prefs-routes.test.ts` из Задачи 3. Проверяет: 403 работнику; 400 на пустом тексте; 400 на тексте длиннее 2000; 400 на пустом списке при `picked`; 200 и `{delivered, intended, unreachable}` на нормальном; строка `announcement_sent` появилась в журнале.

Прогнать: `npx vitest run server/src/http/announcements.test.ts` → FAIL (404).

Затем в `server/src/http/app.ts` рядом с блоком коллекций:

```ts
  /**
   * Рассылка объявления команде.
   *
   * Превью-эндпоинта нет намеренно: у сбора текст собирается сервером из
   * шаблона, и админ обязан увидеть результат; текст анонса — ровно то, что
   * админ напечатал, и ходить за ним на сервер незачем. Кто достижим, решает и
   * докладывает этот маршрут, в одном месте.
   */
  app.post("/api/admin/announcements", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown; audience?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return c.json({ error: "Текст объявления пустой" }, 400);
    if (text.length > ANNOUNCEMENT_TEXT_MAX) {
      return c.json({ error: `Слишком длинно — не больше ${ANNOUNCEMENT_TEXT_MAX} символов` }, 400);
    }

    let audience: Audience;
    if (body.audience === "all") {
      audience = { kind: "all" };
    } else {
      const ids = Array.isArray(body.audience) ? body.audience : null;
      if (!ids || ids.some((id) => typeof id !== "number")) {
        return c.json({ error: "audience — «all» или список id" }, 400);
      }
      if (ids.length === 0) return c.json({ error: "Некому отправлять — никто не выбран" }, 400);
      if (ids.length > ANNOUNCEMENT_RECIPIENTS_MAX) {
        return c.json({ error: `Слишком много адресатов — не больше ${ANNOUNCEMENT_RECIPIENTS_MAX}` }, 400);
      }
      audience = { kind: "picked", employeeIds: ids as number[] };
    }

    const senderId = c.get("auth").employeeId;
    const result = await sendAnnouncement(bot, db, { senderId, text, audience });
    recordAudit(db, "announcement_sent", senderId, {
      text,
      audience: audience.kind === "all" ? "all" : "picked",
      delivered: result.delivered,
      intended: result.intended,
      unreachable: result.unreachable,
    });
    return c.json(result);
  });
```

Импорты `app.ts` дополнить сервисом и константами.

- [ ] **Шаг 7: Гейт и коммит**

```bash
npx vitest run server/src/http/announcements.test.ts
npm test && npm run typecheck && npm run lint
git add server/src/announcements/ server/src/http/app.ts server/src/http/announcements.test.ts shared/src/audit.ts
git commit -m "feat(api): рассылка объявлений команде

Единственный поток, проходящий сквозь все настройки: от объявления
отписаться нельзя, иначе фича не даёт того, ради чего заводится.

Подписан отправителем, архивные и непривязанные попадают в unreachable
поимённо, один закрытый чат не обрывает рассылку следующим."
```

---

### Task 7: Анонсы — экран

**Files:**
- Create: `miniapp/src/screens/admin/AdminAnnounce.tsx`
- Modify: `miniapp/src/screens/AdminScreen.tsx`
- Modify: `miniapp/src/App.tsx`
- Modify: `miniapp/src/api/client.ts`, `miniapp/src/api/mock.ts`
- Modify: `server/src/bot/bot.ts` (`miniAppKeyboard`)
- Create: `miniapp/src/screens/admin-deeplink.test.ts`

**Interfaces:**
- Consumes: `POST /api/admin/announcements`.
- Produces: `apiClient.sendAnnouncement(text: string, audience: "all" | number[]): Promise<{ delivered: number; intended: number; unreachable: string[] }>`; `adminSectionFromSearch(search: string): AdminSection | null`.

- [ ] **Шаг 1: Тест на разбор ссылки**

Создать `miniapp/src/screens/admin-deeplink.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { adminSectionFromSearch } from "./AdminScreen";

describe("adminSectionFromSearch", () => {
  it("?screen=announce открывает раздел анонсов", () => {
    expect(adminSectionFromSearch("?screen=announce")).toBe("announce");
  });
  it("чужие и пустые значения — null, экран открывается как обычно", () => {
    expect(adminSectionFromSearch("?screen=sick")).toBeNull();
    expect(adminSectionFromSearch("?screen=%D1%84%D1%8B%D0%B2")).toBeNull();
    expect(adminSectionFromSearch("")).toBeNull();
  });
});
```

Run: `npx vitest run miniapp/src/screens/admin-deeplink.test.ts` → FAIL (нет экспорта).

- [ ] **Шаг 2: Разделы**

В `miniapp/src/screens/AdminScreen.tsx`: добавить в тип `AdminSection` значение `"announce"` и в `SECTIONS` — `{ key: "announce", label: "Анонсы" }`. Раздел «Баги» придёт со своим экраном в Задаче 10: чип, за которым пустота, — тот же наблюдаемый дефект, что кнопка, которая ничего не делает.

```ts
/** Раздел, на котором открыться, если мини-апп запущен ссылкой из бота.
 *  Своя функция, а не `screenFromSearch`: та отвечает за формы-оверлеи
 *  (больничный, мероприятие), а это — про вкладку админа. Один параметр,
 *  но два разных вопроса к нему. */
export function adminSectionFromSearch(search: string): AdminSection | null {
  const value = new URLSearchParams(search).get("screen");
  return value === "announce" ? "announce" : null;
}
```

И `AdminScreen` принимает `initialSection?: AdminSection`, используя его как начальное состояние `useState`.

- [ ] **Шаг 3: Вкладка при запуске**

В `miniapp/src/App.tsx` начальное значение `tab`:

```ts
  // Кнопка «📣 Анонс» в боте открывает мини-апп сразу на нужной вкладке.
  const [tab, setTab] = useState<TabKey>(() =>
    adminSectionFromSearch(window.location.search) ? "admin" : "mine",
  );
```

и передать `initialSection={adminSectionFromSearch(window.location.search) ?? undefined}` в `<AdminScreen />`.

- [ ] **Шаг 4: Клиент в трёх местах**

`ApiClient`, `realClient` (`authorizedPostJson` к `/api/admin/announcements`), `devClient` (мок, возвращающий правдоподобный отчёт).

- [ ] **Шаг 5: Экран**

`miniapp/src/screens/admin/AdminAnnounce.tsx`: `textarea`, переключатель «Всем / Выбрать», список активных работников с галочками (список берётся тем же вызовом, которым пользуется `AdminEmployeesScreen` — не заводить второй), счётчик символов, кнопка «Отправить» с подтверждением в два нажатия (тот же узор, что у рассылки на «Сборах» — первое нажатие взводит, второе шлёт), и отчёт после отправки: «Дошло N из M», а ниже поимённо те, до кого не дошло.

Подтверждение обязательно: отправленное сообщение не отзывается.

- [ ] **Шаг 6: Кнопка в боте**

В `server/src/bot/bot.ts` в `miniAppKeyboard` добавить третьей строкой вход для админов. Поскольку `miniAppKeyboard` сейчас не знает, кто перед ним, добавить параметр:

```ts
export function miniAppKeyboard(publicUrl: string, opts: { isAdmin: boolean }): InlineKeyboard {
```

и при `opts.isAdmin` дописать `.row().webApp("📣 Анонс", `${publicUrl}/app/?screen=announce`)`. Вызов в `sendMiniApp` передаёт `{ isAdmin: who.me.isAdmin || config.adminTelegramIds.includes(from.id) }` — тем же правилом, что и `menuFor`.

Существующий сторож `server/src/bot/keyboard.test.ts` проверяет, что входов в мини-апп нет в обычной клавиатуре; убедиться, что он остался зелёным, — новая кнопка обязана быть inline, иначе `initData` не придёт и вход не сработает ни у кого.

- [ ] **Шаг 7: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add miniapp/src server/src/bot/bot.ts
git commit -m "feat(мини-апп): экран анонсов и вход в него из бота

Отправка в два нажатия: отправленное сообщение не отзывается, поэтому
подтверждение со списком имён обязательно, а не желательно.

Вход — inline-кнопка: из обычной клавиатуры мини-апп не получает initData
и отвечает 401 всем без исключения."
```

---

### Task 8: Багрепорт — данные и правила

**Files:**
- Modify: `server/src/db/schema.ts`
- Create: `server/drizzle/00XX_bug_reports.sql` (сгенерированная)
- Create: `server/src/repo/bugs.ts`
- Create: `server/src/bugs/bug-service.ts`
- Create: `server/src/bugs/bug-service.test.ts`
- Modify: `shared/src/audit.ts`

**Interfaces:**
- Produces: `BUG_TEXT_MAX = 2000`, `BUG_REPORTS_PER_HOUR = 5`, `BUG_PENDING_TTL_MS = 900_000`, `openBugPrompt(db, employeeId, promptMessageId): void`, `getBugPending(db, employeeId): { promptMessageId: number; createdAt: Date } | null`, `clearBugPending(db, employeeId): void`, `shouldCapture(pending, replyToMessageId, now): boolean`, `submitBugReport(db, employeeId, text, now): { ok: true; report: BugReport } | { ok: false; reason: string }`, `listBugReports(db, status): BugReportView[]`, `resolveBugReport(db, id, adminId, resolved, now): BugReport | null`; типы событий `bug_report_created`, `bug_report_resolved`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `server/src/bugs/bug-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import {
  BUG_PENDING_TTL_MS, BUG_REPORTS_PER_HOUR, BUG_TEXT_MAX,
  openBugPrompt, getBugPending, clearBugPending, shouldCapture,
  submitBugReport, listBugReports, resolveBugReport,
} from "./bug-service";

const T0 = new Date("2026-08-17T10:00:00Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);

describe("окно ожидания багрепорта", () => {
  it("без нажатой кнопки ловить нечего", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    expect(getBugPending(db, marc.id)).toBeNull();
  });

  it("свежее окно ловит обычное сообщение", () => {
    const pending = { promptMessageId: 77, createdAt: T0 };
    expect(shouldCapture(pending, undefined, plus(60_000))).toBe(true);
  });

  it("окно старше 15 минут обычное сообщение не ловит", () => {
    const pending = { promptMessageId: 77, createdAt: T0 };
    expect(shouldCapture(pending, undefined, plus(BUG_PENDING_TTL_MS + 1))).toBe(false);
  });

  // Реплай — однозначное доказательство намерения: человек ответил именно на
  // приглашение. Возраст тут ни при чём, поэтому окно на него не распространяется.
  it("реплай на приглашение ловится и через сутки", () => {
    const pending = { promptMessageId: 77, createdAt: T0 };
    expect(shouldCapture(pending, 77, plus(24 * 3600_000))).toBe(true);
  });

  it("реплай на чужое сообщение — не багрепорт", () => {
    const pending = { promptMessageId: 77, createdAt: T0 };
    expect(shouldCapture(pending, 999, plus(BUG_PENDING_TTL_MS + 1))).toBe(false);
  });

  it("второе нажатие заменяет окно, а не заводит второе", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    openBugPrompt(db, marc.id, 10);
    openBugPrompt(db, marc.id, 20);
    expect(getBugPending(db, marc.id)?.promptMessageId).toBe(20);
  });
});

describe("приём багрепорта", () => {
  it("сохраняет текст и отдаёт запись", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    const res = submitBugReport(db, marc.id, "Кнопка «График» рисует прошлую неделю", T0);
    expect(res.ok).toBe(true);
    expect(listBugReports(db, "open")).toHaveLength(1);
  });

  it("пустой текст не принимается", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    const res = submitBugReport(db, marc.id, "   ", T0);
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("пуст") });
  });

  it("слишком длинный текст отклоняется с внятным ответом", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    const res = submitBugReport(db, marc.id, "я".repeat(BUG_TEXT_MAX + 1), T0);
    expect(res.ok).toBe(false);
  });

  it("шестой за час отклоняется, а через час снова можно", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    for (let i = 0; i < BUG_REPORTS_PER_HOUR; i += 1) {
      expect(submitBugReport(db, marc.id, `баг ${i}`, plus(i * 1000)).ok).toBe(true);
    }
    expect(submitBugReport(db, marc.id, "шестой", plus(6000)).ok).toBe(false);
    expect(submitBugReport(db, marc.id, "через час", plus(3600_001)).ok).toBe(true);
  });

  it("потолок считается по человеку, а не на всех сразу", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "i2" });
    for (let i = 0; i < BUG_REPORTS_PER_HOUR; i += 1) submitBugReport(db, marc.id, `баг ${i}`, plus(i * 1000));
    expect(submitBugReport(db, igor.id, "мой первый", plus(6000)).ok).toBe(true);
  });
});

describe("статус багрепорта", () => {
  it("«Разобрал» и обратно, с отметкой кем", () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i2", isAdmin: true });
    const created = submitBugReport(db, marc.id, "что-то сломалось", T0);
    if (!created.ok) throw new Error("не создался");

    const done = resolveBugReport(db, created.report.id, anya.id, true, plus(1000));
    expect(done?.resolvedByEmployeeId).toBe(anya.id);
    expect(listBugReports(db, "open")).toHaveLength(0);
    expect(listBugReports(db, "all")).toHaveLength(1);

    const back = resolveBugReport(db, created.report.id, anya.id, false, plus(2000));
    expect(back?.resolvedAt).toBeNull();
    expect(listBugReports(db, "open")).toHaveLength(1);
  });
});
```

- [ ] **Шаг 2: Прогнать, убедиться, что падает**

Run: `npx vitest run server/src/bugs/bug-service.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Шаг 3: Таблицы**

В `server/src/db/schema.ts`:

```ts
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
```

- [ ] **Шаг 4: Миграция**

Run: `npx drizzle-kit generate`
Expected: новый файл с `CREATE TABLE bug_report_pending` и `CREATE TABLE bug_reports`. Прочитать глазами, `DROP` существующих таблиц быть не должно.

- [ ] **Шаг 5: Репозиторий и сервис**

`server/src/repo/bugs.ts` — голые запросы: `upsertPending`, `selectPending`, `deletePending`, `insertReport`, `countReportsSince`, `selectReports`, `updateResolved`.

`server/src/bugs/bug-service.ts` — правила:

```ts
/** Столько живёт окно ожидания. Пятнадцать минут — это «отвлёкся, вернулся и
 *  дописал», но не «через два часа случайно рассказал боту про обед». */
export const BUG_PENDING_TTL_MS = 15 * 60_000;

/** Лимит Telegram — 4096; здесь запас, потому что текст ещё едет админам с
 *  приклеенным именем автора. */
export const BUG_TEXT_MAX = 2000;

/**
 * Единственное место в системе, где работник может слать админам произвольный
 * текст. Без потолка одна раздражённая пятиминутка превращается в тридцать
 * сообщений в чате у каждого админа.
 */
export const BUG_REPORTS_PER_HOUR = 5;

/**
 * Считать ли это сообщение багрепортом.
 *
 * Чистая функция от окна, реплая и времени — чтобы правило проверялось напрямую,
 * а не через перехват апдейтов Telegram.
 *
 * Реплай засчитывается независимо от возраста окна: `message_id` — однозначное
 * доказательство, что человек отвечает именно на приглашение. Окно нужно только
 * второму пути, где такого доказательства нет.
 *
 * Час здесь и в потолке ниже — реальное истёкшее время, а не командная дата:
 * оба меряют темп, а не календарь. Это единственное место в проекте, где
 * `teamNow` намеренно не при чём.
 */
export function shouldCapture(
  pending: { promptMessageId: number; createdAt: Date },
  replyToMessageId: number | undefined,
  now: Date,
): boolean {
  if (replyToMessageId === pending.promptMessageId) return true;
  if (replyToMessageId !== undefined) return false;
  return now.getTime() - pending.createdAt.getTime() <= BUG_PENDING_TTL_MS;
}
```

`submitBugReport` проверяет по порядку: непустой после `trim`, длина, потолок за час — и только потом пишет. Отказы возвращаются готовой русской фразой (`{ ok: false, reason: "…" }`), как это уже сделано в `handover-service`: боту переводить нечего.

`listBugReports(db, "open" | "all")` отдаёт записи с приклеенным именем автора и именем разобравшего — свежие сверху.

- [ ] **Шаг 6: Типы событий**

В `shared/src/audit.ts` дописать `"bug_report_created", "bug_report_resolved",` и описатели:

```ts
  bug_report_created: (p) => ({ icon: "🐞", title: "Сообщение о проблеме", lines: [String(p.text ?? "")] }),
  bug_report_resolved: (p) => ({
    icon: "🐞",
    title: p.resolved ? "Проблема разобрана" : "Проблема снова открыта",
    lines: [String(p.text ?? "")],
  }),
```

- [ ] **Шаг 7: Прогнать — зелено**

Run: `npx vitest run server/src/bugs/bug-service.test.ts`
Expected: PASS, 12 тестов.

- [ ] **Шаг 8: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add server/src/db/schema.ts server/drizzle/ server/src/repo/bugs.ts server/src/bugs/ shared/src/audit.ts
git commit -m "feat(баги): таблицы и правила приёма багрепорта

Окно ожидания живёт в базе, а не в памяти: рестарт здесь и есть деплой, а
молча съеденный багрепорт — худшее, что эта кнопка может сделать.

Реплай засчитывается в любом возрасте (message_id — доказательство), окно
в 15 минут нужно только второму пути, где доказательства нет. Потолок пять
в час на человека: это единственное место, где работник шлёт админам
произвольный текст."
```

---

### Task 9: Багрепорт — кнопка и разбор в боте

**Files:**
- Modify: `server/src/bot/keyboard.ts`, `server/src/bot/keyboard.test.ts`
- Modify: `server/src/bot/bot.ts`
- Modify: `server/src/bot/notify.ts`
- Create: `server/src/bot/bug-report-bot.test.ts`

**Interfaces:**
- Consumes: всё из Задачи 8, `notifyAdmins(…, "bug_reports", …)`.
- Produces: `BTN_BUG = "🐞 Проблема"`, callback `bug:resolve:<id>`, `notifyBugReport(bot, db, reportId, text)`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `server/src/bot/bug-report-bot.test.ts`. Способ скормить боту текстовый апдейт взять из `server/src/bot/menu-buttons.test.ts` (там уже написано, как собрать `Update` с текстом и прогнать через `bot.handleUpdate`). Проверяются четыре поведения:

```
1. нажал «🐞 Проблема» → следующее обычное сообщение легло в bug_reports
   и ушло админам;
2. нажал «🐞 Проблема» → написал «📅 График» → пришёл график, в bug_reports пусто
   (метка кнопки всегда кнопка, иначе передумавший человек отправил бы в багрепорт
   слово «График» и не понял бы, почему график не показали);
3. кнопку не нажимал → написал «привет» → в bug_reports пусто и бот промолчал
   (сегодня бот не отвечает на произвольный текст, и эта работа не должна это менять);
4. окно старше 15 минут → сообщение не поймано.
```

Каждое — отдельным `it` с явными проверками и по базе, и по отправленным сообщениям.

- [ ] **Шаг 2: Прогнать, убедиться, что падает**

Run: `npx vitest run server/src/bot/bug-report-bot.test.ts`
Expected: FAIL.

- [ ] **Шаг 3: Кнопка на клавиатуре**

`server/src/bot/keyboard.ts`:

```ts
export const BTN_BUG = "🐞 Проблема";
```

и в `mainKeyboard` во второй ряд: `.row().text(BTN_REMINDERS).text(BTN_BUG)`, а `BTN_ADMIN` по-прежнему добавляется только админу. Клавиатура остаётся двухрядной — это было осознанное решение в комментарии этого файла.

Дописать в `keyboard.test.ts` проверку, что `BTN_BUG` есть у всех — и у работника, и у админа.

- [ ] **Шаг 4: Приглашение и разбор**

В `server/src/bot/bot.ts`:

```ts
  /**
   * «Сообщить о проблеме»: бот спрашивает, человек отвечает.
   *
   * `force_reply` — не украшение: Telegram сам ставит курсор в поле ввода и
   * привязывает ответ к этому сообщению, поэтому обычный путь не требует от
   * человека ничего, кроме «набрать и отправить». Окно в базе — страховка на
   * случай, когда он свернул чат и написал отдельным сообщением.
   */
  async function startBugReport(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    const sent = await ctx.reply(
      "Опиши, что не так — одним сообщением. Чем конкретнее, тем быстрее починим.",
      { reply_markup: { force_reply: true, input_field_placeholder: "Что сломалось?" } },
    );
    openBugPrompt(db, who.me.id, sent.message_id);
  }

  /** Текст, пришедший после нажатия кнопки. Вызывается последним — метки кнопок
   *  разбираются раньше и сюда не доходят. */
  async function captureBugReport(ctx: Context, text: string): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) return;
    const pending = getBugPending(db, who.me.id);
    if (!pending) return;
    if (!shouldCapture(pending, ctx.msg?.reply_to_message?.message_id, new Date())) return;

    const res = submitBugReport(db, who.me.id, text, new Date());
    if (!res.ok) {
      await ctx.reply(res.reason);
      return;
    }
    clearBugPending(db, who.me.id);
    recordAudit(db, "bug_report_created", who.me.id, { text: res.report.text });
    await ctx.reply("Записал, спасибо 🙏 Разберёмся.");
    await notifyBugReport(bot, db, res.report.id, `🐞 ${who.me.displayName}: ${res.report.text}`);
  }
```

И в существующем `bot.on("message:text")` — порядок из спеки:

```ts
    if (text === BTN_WEEK) await sendWeek(ctx);
    else if (text === BTN_MY_SHIFTS) await sendMiniApp(ctx);
    else if (text === BTN_REMINDERS) await sendReminders(ctx);
    else if (text === BTN_ADMIN) await sendAdminLink(ctx);
    else if (text === BTN_BUG) await startBugReport(ctx);
    // Последним и только здесь: всё, что выше, — метки кнопок, и они всегда кнопки.
    // На остальное бот молчит, как молчал, — если окна ожидания нет.
    else await captureBugReport(ctx, text);
```

- [ ] **Шаг 5: Доставка админам и «Разобрал»**

В `server/src/bot/notify.ts`:

```ts
/** Багрепорт админам, с кнопкой «Разобрал». Через `notifyAdmins`, а не своим
 *  циклом, — чтобы выключатель вида `bug_reports` работал и здесь. */
export async function notifyBugReport(bot: Bot, db: Db, reportId: number, text: string): Promise<void> {
  await notifyAdmins(bot, db, "bug_reports", text, { text: "✅ Разобрал", data: `bug:resolve:${reportId}` });
}
```

Для этого у `notifyAdmins` появляется необязательный пятый параметр. Итоговая сигнатура — та, с которой файл останется жить:

```ts
export async function notifyAdmins(
  bot: Bot,
  db: Db,
  kind: AdminNoticeKind,
  text: string,
  /** Кнопка про само событие — например «Разобрал» у багрепорта. Едет ПЕРВОЙ
   *  строкой, над выключателем: она про то, что человек только что прочитал, а
   *  выключатель — про поток вообще. */
  action?: { text: string; data: string },
): Promise<void> {
```

а клавиатура собирается одна на оба (кнопка «🔕 Не писать мне про это» из Задачи 4 остаётся на месте):

```ts
  const kb = new InlineKeyboard();
  if (action) kb.text(action.text, action.data).row();
  kb.text("🔕 Не писать мне про это", `notice:mute:${kind}`);
```

Тесты Задачи 4 обязаны остаться зелёными: без `action` клавиатура прежняя — одна кнопка выключателя.

В `server/src/bot/bot.ts` — обработчик:

```ts
  bot.callbackQuery(/^bug:resolve:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    if (!who.me.isAdmin && !config.adminTelegramIds.includes(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Это может только админ" });
      return;
    }
    const updated = resolveBugReport(db, id, who.me.id, true, new Date());
    if (!updated) {
      await ctx.answerCallbackQuery({ text: "Сообщение не найдено" });
      return;
    }
    recordAudit(db, "bug_report_resolved", who.me.id, { text: updated.text, resolved: true });
    await ctx.answerCallbackQuery({ text: "Отметил ✅" });
    await safeEdit(() => ctx.editMessageReplyMarkup());
  });
```

- [ ] **Шаг 6: Прогнать — зелено**

Run: `npx vitest run server/src/bot/bug-report-bot.test.ts server/src/bot/keyboard.test.ts server/src/bot/menu-buttons.test.ts`
Expected: PASS.

- [ ] **Шаг 7: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add server/src/bot/
git commit -m "feat(бот): кнопка «Проблема» и приём багрепорта

force_reply ставит курсор в поле сам, окно в базе прощает тех, кто написал
отдельным сообщением. Метка кнопки всегда остаётся кнопкой: передумавший
человек, набравший «График», получает график, а не отправляет его в баги.

На произвольный текст без нажатой кнопки бот молчит ровно как раньше —
на это есть отдельный тест."
```

---

### Task 10: Багрепорт — админский экран

**Files:**
- Modify: `server/src/http/app.ts`
- Create: `server/src/http/bug-reports.test.ts`
- Create: `miniapp/src/screens/admin/AdminBugs.tsx`
- Modify: `miniapp/src/screens/AdminScreen.tsx`, `miniapp/src/api/client.ts`, `miniapp/src/api/mock.ts`

**Interfaces:**
- Consumes: `listBugReports`, `resolveBugReport`.
- Produces: `GET /api/admin/bug-reports?status=open|all` → `{ reports: { id, authorName, text, createdAt, resolvedAt, resolvedByName }[] }`; `POST /api/admin/bug-reports/:id/resolve` `{ resolved }` → `{ id, resolvedAt }`; `apiClient.getBugReports(status)`, `apiClient.resolveBugReport(id, resolved)`.

- [ ] **Шаг 1: Тест маршрутов**

Создать `server/src/http/bug-reports.test.ts` по образцу Задачи 3. Проверяет: работнику 403 на обоих маршрутах; `status=open` не отдаёт разобранные, `status=all` отдаёт; `resolve` проставляет отметку и обратим; несуществующий id — 404; в журнале появилась строка `bug_report_resolved`.

Run: `npx vitest run server/src/http/bug-reports.test.ts` → FAIL (404).

- [ ] **Шаг 2: Маршруты**

Дописать в `server/src/http/app.ts` рядом с журналом, под `requireAdmin`, зовя `listBugReports` и `resolveBugReport`. Тело `POST` принимает `{ resolved: boolean }` — обратимо, как «Собрали, закрыть» у сборов: неотменяемое нажатие не стоит ничего.

- [ ] **Шаг 3: Прогнать — зелено**

Run: `npx vitest run server/src/http/bug-reports.test.ts`
Expected: PASS.

- [ ] **Шаг 4: Экран и чип**

`miniapp/src/screens/admin/AdminBugs.tsx`: список карточек «кто · когда · текст», кнопка «Разобрал» / «Вернуть в работу», переключатель «Новые / Все». В `AdminScreen.tsx` добавить чип `{ key: "bugs", label: "Баги" }` и отрисовку `{section === "bugs" && <AdminBugs />}`. Клиент — в трёх местах, как всегда.

- [ ] **Шаг 5: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add server/src/http/ miniapp/src/
git commit -m "feat(баги): админский экран со статусом «новый / разобран»

Ради этого и заводилась таблица: в чате багрепорт тонет за сутки. Отметка
обратима — неотменяемое нажатие не стоит ничего."
```

---

## Финальная проверка

- [ ] **Полный гейт на чистом дереве**

```bash
npm test && npm run typecheck && npm run lint
```

Ожидаемо: зелено, тестов заметно больше 1425. Показать вывод — «посмотрел код» доказательством не является.

- [ ] **Проверка живого поведения** (слой 4 — сначала диагностика, потом мутация)

На работающем сервисе, ПОСЛЕ деплоя: нажать «🐞 Проблема», написать текст, убедиться, что он пришёл админу и виден на экране «Баги»; разослать анонс на одного себя-плюс-одного и сверить отчёт «дошло N из M»; выключить один вид, вызвать соответствующее событие, убедиться, что письмо не пришло, а второму админу пришло.

- [ ] **Обновить ledger**

Всё, что всплыло по дороге и не относится к этой работе, — в `docs/audit/ledger.md`, а не «чинится заодно».
