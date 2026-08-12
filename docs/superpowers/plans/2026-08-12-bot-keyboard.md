# Постоянная клавиатура в боте — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Команды бота `/week`, `/notifications`, `/admin` и вход в мини-апп становятся кнопками постоянной клавиатуры под полем ввода, при этом сами команды продолжают работать.

**Architecture:** Раскладка — чистая функция в новом `server/src/bot/keyboard.ts`, проверяемая без Telegram. Тела трёх команд выносятся в функции внутри `createBot`, и текстовый обработчик зовёт те же функции, что и команды, — один вход, а не два. Клавиатура едет только с текстовыми ответами бота: у сообщения ровно одно поле `reply_markup`, а `/week` и `/notifications` уже заняли его inline-клавиатурами.

**Tech Stack:** TypeScript, grammy 1.44, vitest, drizzle + better-sqlite3.

**Спека:** `docs/superpowers/specs/2026-08-12-bot-keyboard-design.md`

## Global Constraints

- **Слой 1** (`server/`) — TDD обязателен: сначала падающий тест, потом код.
- **Ветка:** `feature/bot-keyboard`. Уже создана, спека в неё закоммичена.
- **Текст, который читает человек, — по-русски.** Английский только в именах кода.
- **Комментарий объясняет «почему», а не «что».** Так написан весь файл `bot.ts`; новый код пишется так же.
- **Настоящих ФИО в репозитории быть не может.** Имена в тестах вымышлены: «Иванов Иван», «Аня», «Игорь», «Марк». Сторож — `server/src/db/no-real-names.test.ts`.
- **Дата — командная:** `teamNow(config.teamTz)`, а не `new Date()`. В этом плане прямых обращений к дате нет, но правило действует.
- **Гейт после каждой задачи:**
  ```bash
  npm test
  npm run typecheck
  npm run lint
  ```
  Ничего не считается готовым без прогнанной команды с показанным выводом.
- **Сообщения коммитов — по-русски**, в стиле истории: `feat(...)`, `refactor(...)`, `test(...)`. В теле — что стало правдой и чем доказано.

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `server/src/bot/keyboard.ts` (**создать**) | Метки кнопок и раскладка. Чистая функция: ни базы, ни Telegram. |
| `server/src/bot/keyboard.test.ts` (**создать**) | Проверки раскладки напрямую, без перехвата вызовов. |
| `server/src/bot/menu-buttons.test.ts` (**создать**) | Доставка клавиатуры и маршрутизация нажатий — через перехват исходящих вызовов. |
| `server/src/bot/bot.ts` (**править**) | `menuFor`, `replyWithMenu`, вынос тел трёх команд, обработчик текста. |

Почему раскладка отдельным файлом, а не внутри `bot.ts`: `bot.ts` — 600 строк, и правило «кому какие кнопки» в нём утонет. Отдельный файл держит правило там, где его видно, и позволяет проверять его без единого фейкового апдейта.

---

### Task 1: Раскладка клавиатуры

**Files:**
- Create: `server/src/bot/keyboard.ts`
- Test: `server/src/bot/keyboard.test.ts`

**Interfaces:**
- Consumes: `Keyboard` из `grammy` (версия 1.44 — у класса есть `.text()`, `.webApp(text, url)`, `.row()`, `.resized()`, `.persistent()`, и поля `keyboard: KeyboardButton[][]`, `resize_keyboard?: boolean`, `is_persistent?: boolean`).
- Produces:
  - `export const BTN_WEEK = "📅 График"`
  - `export const BTN_MY_SHIFTS = "📋 Мои смены"`
  - `export const BTN_REMINDERS = "🔔 Напоминания"`
  - `export const BTN_ADMIN = "⚙️ Админка"`
  - `export function mainKeyboard(opts: { isAdmin: boolean; publicUrl: string }): Keyboard`

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/bot/keyboard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mainKeyboard, BTN_WEEK, BTN_MY_SHIFTS, BTN_REMINDERS, BTN_ADMIN } from "./keyboard";

const PUBLIC_URL = "https://x.keenetic.pro";

/** Все метки раскладки одним списком — для этих проверок разбивка по строкам не важна. */
function labels(kb: ReturnType<typeof mainKeyboard>): string[] {
  return kb.keyboard.flat().map((btn) => btn.text);
}

describe("mainKeyboard", () => {
  it("админу даёт кнопку админки", () => {
    expect(labels(mainKeyboard({ isAdmin: true, publicUrl: PUBLIC_URL }))).toContain(BTN_ADMIN);
  });

  it("обычному работнику кнопку админки не даёт — её единственный ответ был бы отказом", () => {
    expect(labels(mainKeyboard({ isAdmin: false, publicUrl: PUBLIC_URL }))).not.toContain(BTN_ADMIN);
  });

  it("работник получает график, мини-апп и напоминания — и ничего сверх того", () => {
    expect(labels(mainKeyboard({ isAdmin: false, publicUrl: PUBLIC_URL }))).toEqual([
      BTN_WEEK,
      BTN_MY_SHIFTS,
      BTN_REMINDERS,
    ]);
  });

  it("кнопка мини-аппа открывает его по адресу из конфига, а не по зашитому", () => {
    const kb = mainKeyboard({ isAdmin: false, publicUrl: "https://other.example" });
    const btn = kb.keyboard.flat().find((b) => b.text === BTN_MY_SHIFTS);
    expect(btn).toMatchObject({ web_app: { url: "https://other.example/app/" } });
  });

  it("клавиатура сжата по кнопкам и не сворачивается после нажатия", () => {
    const kb = mainKeyboard({ isAdmin: true, publicUrl: PUBLIC_URL });
    expect(kb.resize_keyboard).toBe(true);
    expect(kb.is_persistent).toBe(true);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run server/src/bot/keyboard.test.ts`
Expected: FAIL — `Failed to resolve import "./keyboard"`.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `server/src/bot/keyboard.ts`:

```ts
import { Keyboard } from "grammy";

/**
 * Метки кнопок постоянной клавиатуры.
 *
 * Экспортируются, потому что метка — единственный ключ маршрутизации: Telegram
 * присылает нажатие обычным текстовым сообщением, и обработчик узнаёт кнопку
 * только по точному совпадению строки. Вторая копия метки, набранная руками в
 * обработчике, однажды разъедется с этой — и кнопка станет рисоваться, ничего
 * при этом не делая.
 */
export const BTN_WEEK = "📅 График";
export const BTN_MY_SHIFTS = "📋 Мои смены";
export const BTN_REMINDERS = "🔔 Напоминания";
export const BTN_ADMIN = "⚙️ Админка";

/**
 * Раскладка под полем ввода.
 *
 * Чистая функция от «кто это» — ни базы, ни Telegram, — чтобы правило «кому
 * какие кнопки» проверялось напрямую, а не через перехват исходящих вызовов.
 *
 * `isAdmin` здесь уже посчитан вместе с аллоулистом (`ADMIN_TELEGRAM_IDS`), см.
 * `menuFor` в bot.ts: `/admin` повышает аллоулистнутого до админа лишь при
 * первом обращении, а до него его строка говорит `isAdmin: false`. Кнопка,
 * спрятанная от того, кому команда уже отвечает, — такая же ложь, как кнопка,
 * показанная тому, кому она откажет.
 */
export function mainKeyboard(opts: { isAdmin: boolean; publicUrl: string }): Keyboard {
  const kb = new Keyboard()
    .text(BTN_WEEK)
    // Мини-апп открывается прямо из клавиатуры: до этой кнопки бот трижды писал
    // «открой мини-апп», но открыть его из бота было нечем — ссылки в коде нет,
    // вход живёт в настройках BotFather.
    .webApp(BTN_MY_SHIFTS, `${opts.publicUrl}/app/`)
    .row()
    .text(BTN_REMINDERS);
  if (opts.isAdmin) kb.row().text(BTN_ADMIN);
  // resized — иначе клавиатура занимает пол-экрана. persistent — иначе Telegram
  // сворачивает её после первого нажатия, и человек решает, что она пропала.
  return kb.resized().persistent();
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npx vitest run server/src/bot/keyboard.test.ts`
Expected: PASS, 5 тестов.

Если TypeScript ругается на `btn.text` в `labels` — значит `KeyboardButton` в этой версии типов union, у которого `text` не поднят в общий предок. Тогда заменить тело `labels` на `kb.keyboard.flat().map((btn) => (btn as { text: string }).text)` и оставить комментарий, почему приведение здесь безопасно: в Bot API у всякой кнопки обычной клавиатуры есть `text`.

- [ ] **Step 5: Прогнать гейт**

Run: `npm test && npm run typecheck && npm run lint`
Expected: всё зелёное, тестов на 5 больше прежнего.

- [ ] **Step 6: Коммит**

```bash
git add server/src/bot/keyboard.ts server/src/bot/keyboard.test.ts
git commit -m "feat(бот): раскладка постоянной клавиатуры

Чистая функция «кто это → какие кнопки»: график, мини-апп, напоминания, и
админка только тому, кому /admin действительно отвечает — включая
аллоулистнутого, чья строка ещё говорит isAdmin: false.

Кнопка мини-аппа несёт web_app с адресом из конфига. До неё бот трижды писал
«открой мини-апп», но открыть его из бота было нечем: ссылки в коде нет вовсе.

Доказано пятью тестами без единого обращения к Telegram."
```

---

### Task 2: Клавиатура доезжает до человека

**Files:**
- Modify: `server/src/bot/bot.ts` (импорты 1-37; тело `createBot` — `/start` на 174-238, `/admin` на 243-303)
- Test: `server/src/bot/menu-buttons.test.ts` (создать)

**Interfaces:**
- Consumes: `mainKeyboard` из Task 1.
- Produces (внутри `createBot`, наружу не экспортируются):
  - `function menuFor(tgId: number, chatType: string | undefined): Keyboard | undefined`
  - `async function replyWithMenu(ctx: Context, text: string, extra?: MenuExtra): Promise<void>`
  - `type MenuExtra = { link_preview_options?: { is_disabled: boolean } }`

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/bot/menu-buttons.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { BTN_WEEK, BTN_REMINDERS, BTN_ADMIN } from "./keyboard";
import { makeTestDb } from "../db/testdb";
import {
  createEmployee,
  linkTelegramAccount,
  getByTelegramId,
  archiveEmployee,
  setEmployeeAdmin,
} from "../repo/employees";
import { createShift } from "../repo/shifts";
import type { Config } from "../config";
import type { Db } from "../db/client";

// 111 — единственный аллоулистнутый id в этих тестах; все остальные обычные люди.
const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};

function testBot(db: Db) {
  const bot = createBot({ db, config });
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: {} } as any;
  });
  return { bot, calls };
}

function commandUpdate(tgId: number, text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 4, date: 1_712_803_046,
      chat: { id: tgId, first_name: "T", type: "private" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
      entities: [{ type: "bot_command" as const, offset: 0, length: text.length }],
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

/** Та же команда, но пришедшая из группы, куда бот добавлен. */
function groupCommandUpdate(tgId: number, text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 4, date: 1_712_803_046,
      chat: { id: -1_001_234_567, title: "Смены", type: "supergroup" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
      entities: [{ type: "bot_command" as const, offset: 0, length: text.length }],
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

/** Привязанный работник с одной сменой на этой неделе — чтобы /week рисовал картинку. */
function linkedWorker(db: Db, tgId: number) {
  createEmployee(db, { displayName: "Иванов Иван", inviteToken: `tok-${tgId}` });
  linkTelegramAccount(db, `tok-${tgId}`, tgId, "ivanov", "Иван");
  const linked = getByTelegramId(db, tgId)!;
  createShift(db, { employeeId: linked.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });
  return linked;
}

/** Метки клавиатуры из перехваченного payload, или null — если её там нет. */
function keyboardLabels(payload: any): string[] | null {
  const kb = payload?.reply_markup?.keyboard;
  if (!kb) return null;
  return kb.flat().map((btn: { text: string }) => btn.text);
}

describe("постоянная клавиатура — доставка", () => {
  it("привязанный работник получает её на /start, без кнопки админки", async () => {
    const db = makeTestDb();
    linkedWorker(db, 222);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(222, "/start"));

    const labels = keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload);
    expect(labels).toContain(BTN_WEEK);
    expect(labels).not.toContain(BTN_ADMIN);
  });

  it("в группу не уходит — её увидели бы все участники", async () => {
    const db = makeTestDb();
    linkedWorker(db, 333);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(groupCommandUpdate(333, "/start"));

    expect(keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload)).toBeNull();
  });

  it("незнакомцу не уходит — нажимать ему нечего", async () => {
    const db = makeTestDb();
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(999, "/start"));

    const reply = calls.find((c) => c.method === "sendMessage")!;
    expect(reply.payload.text).toContain("не зарегистрирован");
    expect(keyboardLabels(reply.payload)).toBeNull();
  });

  it("архивному не уходит, а текст отказа не меняется", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 444);
    archiveEmployee(db, worker.id, "2026-08-06");
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(444, "/start"));

    const reply = calls.find((c) => c.method === "sendMessage")!;
    expect(reply.payload.text).toContain("архиве");
    expect(keyboardLabels(reply.payload)).toBeNull();
  });

  it("админ получает кнопку админки", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 555);
    setEmployeeAdmin(db, worker.id, true);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(555, "/start"));

    expect(keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload)).toContain(BTN_ADMIN);
  });

  it("аллоулистнутый получает кнопку админки ещё до того, как его строка стала админской", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 111);
    expect(worker.isAdmin).toBe(false); // строка ещё обычная — /admin повысит её только при обращении
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(111, "/start"));

    expect(keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload)).toContain(BTN_ADMIN);
  });

  it("отказ /admin обычному работнику приходит с клавиатурой, но без кнопки админки", async () => {
    const db = makeTestDb();
    linkedWorker(db, 666);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(666, "/admin"));

    const reply = calls.find((c) => c.method === "sendMessage")!;
    expect(reply.payload.text).toContain("только администраторам");
    expect(keyboardLabels(reply.payload)).toContain(BTN_REMINDERS);
    expect(keyboardLabels(reply.payload)).not.toContain(BTN_ADMIN);
  });

  it("ссылка на админку приходит с клавиатурой и по-прежнему без превью", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 777);
    setEmployeeAdmin(db, worker.id, true);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(777, "/admin"));

    const reply = calls.find((c) => c.method === "sendMessage" && String(c.payload.text).includes("/admin/#token="))!;
    expect(reply.payload.link_preview_options).toEqual({ is_disabled: true });
    expect(keyboardLabels(reply.payload)).toContain(BTN_ADMIN);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run server/src/bot/menu-buttons.test.ts`
Expected: FAIL — восемь тестов, в которых ждут клавиатуру, падают на `expected null to contain "📅 График"`; тесты «не уходит» проходят случайно, потому что клавиатуры нет нигде. Это нормально: они охраняют не появление, а отсутствие.

- [ ] **Step 3: Написать минимальную реализацию**

В `server/src/bot/bot.ts`:

1. Расширить импорт grammy (строка 1) — добавить `Keyboard` и тип `Context`:

```ts
import { Bot, InlineKeyboard, InputFile, Keyboard, type Context } from "grammy";
```

2. Добавить импорт раскладки после импорта `week-image` (строка 22):

```ts
import { mainKeyboard, BTN_WEEK, BTN_REMINDERS, BTN_ADMIN } from "./keyboard";
```

`BTN_WEEK`, `BTN_REMINDERS` и `BTN_ADMIN` понадобятся в Task 4; если biome ругается на неиспользованный импорт — довезти их там, а здесь импортировать только `mainKeyboard`.

3. Рядом с `acting` (после строки 172, внутри `createBot`) добавить:

```ts
  /** Что можно доложить к текстовому ответу: у `/admin` это отключённое превью ссылки. */
  type MenuExtra = { link_preview_options?: { is_disabled: boolean } };

  /**
   * Клавиатура для этого человека — или ничего, если слать её некому.
   *
   * Три отказа. Групповой чат: клавиатуру увидели бы все участники, а бот и так
   * не рассказывает там про график (`/week` молчит по той же причине). Человек
   * не в системе и архивный: нажимать им нечего, а «Мои смены» привели бы их в
   * мини-апп, который отвечает им 403.
   *
   * Аллоулистнутый (`ADMIN_TELEGRAM_IDS`) — то же документированное исключение,
   * что и везде в этом файле: `/api/auth` восстанавливает его при входе, поэтому
   * архивным он здесь не считается и админскую кнопку получает сразу — `/admin`
   * ему отвечает, а до первого обращения его строка ещё говорит `isAdmin: false`.
   */
  function menuFor(tgId: number, chatType: string | undefined): Keyboard | undefined {
    if (chatType !== "private") return undefined;
    const me = getByTelegramId(db, tgId);
    if (!me) return undefined;
    const allowlisted = config.adminTelegramIds.includes(tgId);
    if (!me.isActive && !allowlisted) return undefined;
    return mainKeyboard({ isAdmin: me.isAdmin || allowlisted, publicUrl: config.publicUrl });
  }

  /**
   * Текстовый ответ с постоянной клавиатурой.
   *
   * Только текстовый: у сообщения ровно одно поле `reply_markup`, и у `/week`
   * с `/notifications` оно уже занято листалкой недель и переключателем
   * напоминаний. Прицепить к ним ещё и клавиатуру нельзя физически — она едет
   * с теми ответами, где это поле свободно.
   */
  async function replyWithMenu(ctx: Context, text: string, extra?: MenuExtra): Promise<void> {
    const tgId = ctx.from?.id;
    await ctx.reply(text, {
      ...extra,
      reply_markup: tgId == null ? undefined : menuFor(tgId, ctx.chat?.type),
    });
  }
```

4. В обработчике `/start` заменить **все восемь** вызовов `await ctx.reply(...)` на `await replyWithMenu(ctx, ...)`. Тексты не трогать. Список мест (номера строк до правки):

   - 188 «Ты в архиве — новая ссылка не поможет…»
   - 191 «Ты уже привязан, …»
   - 201 «Готово, …! Ты в системе ✅…»
   - 204 «Ссылка недействительна…»
   - 217 «Ты в архиве — доступ в мини-апп закрыт…»
   - 222 «Привет, …! 👋 Открой мини-апп…»
   - 234 «Привет, …! Ты вошёл как админ ✅…»
   - 237 «Ты пока не зарегистрирован…»

   Разбирать, какие из них клавиатуру заслуживают, не нужно: это решает `menuFor`, и в четырёх из восьми она вернёт `undefined` сама. Единообразие здесь дешевле восьми ветвлений.

5. В обработчике `/admin` заменить на `replyWithMenu` три вызова:

   - 255 «Ты в архиве — админка недоступна…»
   - 268 «Админка доступна только администраторам.»
   - 281 «Сначала отправь /start.»

   и финальный ответ со ссылкой (299-302) — у него есть второй аргумент:

```ts
    await replyWithMenu(
      ctx,
      `Вход в админку (ссылка личная, не пересылай — действует 12 часов, потом попроси новую через /admin):\n${url}`,
      { link_preview_options: { is_disabled: true } },
    );
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npx vitest run server/src/bot/menu-buttons.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Прогнать гейт**

Run: `npm test && npm run typecheck && npm run lint`
Expected: всё зелёное. Существующие тесты `/start` и `/admin` тоже должны пройти — тексты ответов не менялись, добавилось только поле `reply_markup`.

- [ ] **Step 6: Коммит**

```bash
git add server/src/bot/bot.ts server/src/bot/menu-buttons.test.ts
git commit -m "feat(бот): клавиатура доезжает до человека вместе с ответом

/start и /admin отвечают через replyWithMenu, и клавиатура едет с ними. Кому
её слать, решает одно место — menuFor: в группу не шлём (её увидели бы все
участники), человеку не в системе и архивному не шлём (нажимать нечего, а
«Мои смены» привели бы в мини-апп, который отвечает им 403).

Аллоулистнутый получает админскую кнопку сразу, не дожидаясь, пока /admin
повысит его строку, — команда ему уже отвечает.

Только текстовые ответы: у сообщения одно поле reply_markup, и у /week с
/notifications оно занято листалкой и переключателем."
```

---

### Task 3: Три команды получают тела, которые можно позвать дважды

**Files:**
- Modify: `server/src/bot/bot.ts` (`/admin` 243-303, `/notifications` 307-317, `/week` 329-361)

**Interfaces:**
- Produces (внутри `createBot`):
  - `async function sendAdminLink(ctx: Context): Promise<void>`
  - `async function sendReminders(ctx: Context): Promise<void>`
  - `async function sendWeek(ctx: Context): Promise<void>`

Это **чистый рефактор: поведение не меняется ни на байт.** Доказательство — существующий набор тестов, который целиком про это поведение и написан (`week-command.test.ts`, `reminders-toggle.test.ts`, `bot.test.ts`, и восемь новых из Task 2). Новых тестов здесь нет, и это не пропуск TDD: писать новый тест на неизменившееся поведение — значит писать тест, который не может упасть.

Почему вообще выносим: два входа, рассказывающие разное про одно и то же, в этом репозитории уже стоили правки — кнопка «Принять» в боте и маршрут мини-аппа писали в журнал по-разному (историю хранит комментарий на `bot.ts:483`). Общее тело — единственная форма, при которой команда и кнопка не могут разъехаться.

- [ ] **Step 1: Зафиксировать состояние ДО**

Run: `npm test 2>&1 | tail -5`
Записать количество прошедших тестов. После рефактора оно должно совпасть до единицы — это и есть постусловие.

- [ ] **Step 2: Вынести тело `/admin`**

Тело обработчика (всё от `const from = ctx.from;` до конца) переносится в функцию, объявленную рядом с `menuFor`, а обработчик становится однострочным:

Строки **244-302** (всё тело обработчика, от `const from = ctx.from;` до закрывающей скобки последнего `await replyWithMenu(...)`) переносятся **дословно, без единой правки** внутрь новой функции. Обёртка вокруг них:

```ts
  /**
   * Выдаёт админу ссылку на десктопную консоль. Вынесено из обработчика, чтобы
   * команда и кнопка клавиатуры звали одно и то же: два входа, отвечающие
   * по-разному на один вопрос, — наблюдаемый дефект, а не мелочь.
   */
  async function sendAdminLink(ctx: Context): Promise<void> {
    // ← сюда переносятся строки 244-302 как есть
  }

  bot.command("admin", (ctx) => sendAdminLink(ctx));
```

Комментарий-шапка обработчика (строки 240-242, «/admin — hands an admin a browser login link…») переезжает вместе с телом и склеивается с докблоком функции: он объясняет, что делает этот код, и должен остаться рядом с ним.

За чем следить: `ctx.match` в этом обработчике не используется (в отличие от `/start`), поэтому сужение типа с `CommandContext` до `Context` безопасно. Если TypeScript всё же ругнётся на что-то внутри тела — значит перенесено не дословно, и это надо не «чинить», а перенести заново.

- [ ] **Step 3: Прогнать тесты**

Run: `npm test 2>&1 | tail -5`
Expected: то же число прошедших, что в шаге 1.

- [ ] **Step 4: Вынести тело `/notifications`**

```ts
  /** Показывает состояние напоминаний и одну кнопку, которая его переключает. */
  async function sendReminders(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    const me = who.me;
    await ctx.reply(remindersStateText(me.remindersEnabled), { reply_markup: remindersKeyboard(me.remindersEnabled) });
  }

  bot.command("notifications", (ctx) => sendReminders(ctx));
```

Обрати внимание: здесь `ctx.reply`, а **не** `replyWithMenu`. Оба ответа этой функции клавиатуру нести не могут или не должны — успешный занял `reply_markup` переключателем, а отказ адресован тому, кому `menuFor` всё равно вернёт `undefined`.

- [ ] **Step 5: Прогнать тесты**

Run: `npm test 2>&1 | tail -5`
Expected: то же число прошедших.

- [ ] **Step 6: Вынести тело `/week`**

Строки **330-360** (тело обработчика целиком) переносятся дословно:

```ts
  /**
   * График команды картинкой.
   *
   * Приватные чаты только. Каждый другой ответ этого бота касается того, кто
   * спросил; этот — роспись всей команды, и он ушёл бы туда, откуда пришёл
   * апдейт. Попади бот в группу — одна команда опубликовала бы там роспись.
   * Гарантия живёт в коде, а не в галочке BotFather, которую можно снять.
   */
  async function sendWeek(ctx: Context): Promise<void> {
    // ← сюда переносятся строки 330-360 как есть, включая проверку
    //    `if (ctx.chat?.type !== "private") return;`
  }

  bot.command("week", (ctx) => sendWeek(ctx));
```

Комментарий про приватные чаты (нынешние строки 331-336) поднимается в докблок функции — он объясняет ровно эту проверку и должен остаться на виду, а не внутри тела. Текст комментария в докблоке выше — это он же, переписанный без потери смысла; если сомневаешься, перенеси исходный дословно.

- [ ] **Step 7: Прогнать гейт**

Run: `npm test && npm run typecheck && npm run lint`
Expected: всё зелёное, число прошедших тестов совпадает с шагом 1.

- [ ] **Step 8: Коммит**

```bash
git add server/src/bot/bot.ts
git commit -m "refactor(бот): у /week, /notifications и /admin появились тела, которые можно позвать дважды

Поведение не изменилось ни на байт: обработчики стали однострочными, весь их
текст переехал в sendWeek, sendReminders и sendAdminLink без правок. Доказано
тем же набором тестов, что и до рефактора, — число прошедших совпадает.

Сделано ради следующего шага: кнопка клавиатуры будет звать те же функции, что
и команда. Два входа, отвечающие по-разному на один вопрос, в этом репозитории
уже стоили правки — кнопка «Принять» и маршрут мини-аппа писали в журнал
по-разному."
```

---

### Task 4: Нажатие кнопки отвечает тем же, чем команда

**Files:**
- Modify: `server/src/bot/bot.ts` (добавить обработчик текста после всех `bot.command(...)`, то есть после `bot.command("week", …)`)
- Test: `server/src/bot/menu-buttons.test.ts` (дописать блок)

**Interfaces:**
- Consumes: `BTN_WEEK`, `BTN_REMINDERS`, `BTN_ADMIN` из Task 1; `sendWeek`, `sendReminders`, `sendAdminLink` из Task 3.
- Produces: ничего наружу.

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `server/src/bot/menu-buttons.test.ts`:

```ts
/** Нажатая кнопка приходит обычным текстом — без entity `bot_command`. */
function textUpdate(tgId: number, text: string) {
  return {
    update_id: 3,
    message: {
      message_id: 7, date: 1_712_803_046,
      chat: { id: tgId, first_name: "T", type: "private" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

/** Тот же текст, но из группы. */
function groupTextUpdate(tgId: number, text: string) {
  return {
    update_id: 3,
    message: {
      message_id: 7, date: 1_712_803_046,
      chat: { id: -1_001_234_567, title: "Смены", type: "supergroup" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

describe("постоянная клавиатура — нажатия", () => {
  it("«График» отвечает тем же, чем /week", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1001);

    const viaCommand = testBot(db);
    await viaCommand.bot.handleUpdate(commandUpdate(1001, "/week"));
    const fromCommand = viaCommand.calls.find((c) => c.method === "sendPhoto");

    const viaButton = testBot(db);
    await viaButton.bot.handleUpdate(textUpdate(1001, BTN_WEEK));
    const fromButton = viaButton.calls.find((c) => c.method === "sendPhoto");

    expect(fromCommand?.payload.caption).toBeDefined();
    expect(fromButton?.payload.caption).toBe(fromCommand?.payload.caption);
    expect(JSON.stringify(fromButton?.payload.reply_markup)).toBe(
      JSON.stringify(fromCommand?.payload.reply_markup),
    );
  });

  it("«Напоминания» отвечают тем же, чем /notifications", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1002);

    const viaCommand = testBot(db);
    await viaCommand.bot.handleUpdate(commandUpdate(1002, "/notifications"));
    const fromCommand = viaCommand.calls.find((c) => c.method === "sendMessage");

    const viaButton = testBot(db);
    await viaButton.bot.handleUpdate(textUpdate(1002, BTN_REMINDERS));
    const fromButton = viaButton.calls.find((c) => c.method === "sendMessage");

    expect(fromCommand?.payload.text).toContain("Напоминания о сменах");
    expect(fromButton?.payload.text).toBe(fromCommand?.payload.text);
    expect(JSON.stringify(fromButton?.payload.reply_markup)).toBe(
      JSON.stringify(fromCommand?.payload.reply_markup),
    );
  });

  it("«Админка» от не-админа отказывает так же, как команда", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1003);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(textUpdate(1003, BTN_ADMIN));

    expect(calls.find((c) => c.method === "sendMessage")?.payload.text).toContain("только администраторам");
  });

  it("«График» из группы не отвечает ничем — иначе кнопка обходила бы защиту /week", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1004);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(groupTextUpdate(1004, BTN_WEEK));

    expect(calls).toEqual([]);
  });

  it("на произвольный текст бот молчит, как молчал", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1005);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(textUpdate(1005, "привет"));

    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run server/src/bot/menu-buttons.test.ts`
Expected: FAIL — три теста про «График», «Напоминания» и «Админка» падают (бот на этот текст пока не отвечает вовсе); два про молчание проходят и охраняют, чтобы обработчик не начал отвечать на лишнее.

- [ ] **Step 3: Написать минимальную реализацию**

В `server/src/bot/bot.ts`, сразу после `bot.command("week", (ctx) => sendWeek(ctx));`:

```ts
  /**
   * Нажатая кнопка постоянной клавиатуры. Telegram присылает её обычным
   * текстовым сообщением, поэтому единственный ключ — точное совпадение метки.
   *
   * Регистрируется после всех `bot.command(...)` намеренно: grammy передаёт
   * управление дальше по цепочке только если предыдущий обработчик об этом
   * попросил, а команды не просят — значит `/week` сюда не долетит и обработан
   * дважды не будет.
   *
   * Приватные чаты только. Не для симметрии: без этой проверки кнопка «График»
   * стала бы обходом защиты `/week`, которая существует ровно для того, чтобы
   * роспись всей команды не публиковалась в группу.
   *
   * На всё остальное бот молчит, как молчал до этой кнопки. Отвечать на
   * произвольный текст его никто не просил.
   */
  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const text = ctx.msg.text;
    if (text === BTN_WEEK) await sendWeek(ctx);
    else if (text === BTN_REMINDERS) await sendReminders(ctx);
    else if (text === BTN_ADMIN) await sendAdminLink(ctx);
  });
```

Кнопка «Мои смены» здесь не нужна: она `web_app`, её нажатие открывает мини-апп и текста боту не шлёт.

Если импорт `BTN_WEEK`, `BTN_REMINDERS`, `BTN_ADMIN` не был добавлен в Task 2 — добавить его сейчас (строка с `./keyboard`).

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npx vitest run server/src/bot/menu-buttons.test.ts`
Expected: PASS, 13 тестов в файле.

- [ ] **Step 5: Прогнать гейт**

Run: `npm test && npm run typecheck && npm run lint`
Expected: всё зелёное; общее число тестов = исходное + 18 (5 из Task 1, 8 из Task 2, 5 отсюда).

- [ ] **Step 6: Коммит**

```bash
git add server/src/bot/bot.ts server/src/bot/menu-buttons.test.ts
git commit -m "feat(бот): нажатие кнопки отвечает ровно тем же, чем команда

Обработчик текста ловит точное совпадение с меткой и зовёт те же функции, что
и слеш-команды. Доказано сравнением перехваченных payload'ов двух прогонов —
подпись картинки и листалка недель у кнопки и у /week совпадают побайтно, а не
«похожи».

Приватные чаты только: без этой проверки кнопка «График» стала бы обходом
защиты /week, которая не даёт опубликовать роспись команды в группу.

На произвольный текст бот по-прежнему не отвечает ничем — ноль исходящих
вызовов на «привет»."
```

---

## Что делать после плана

1. **Слить ветку** — `superpowers:finishing-a-development-branch`.
2. **Сказать команде «нажмите /start один раз».** Это не косметика, а условие, при котором клавиатуру увидят все: у сообщения одно поле `reply_markup`, и человек, который после деплоя шлёт только `/week`, получит лишь фотографию с листалкой. Размен принят владельцем сознательно, альтернатива (колонка «показывали ли мы этому чату клавиатуру») стоит дороже.
3. **Заход 2 — самозапись работника в график.** Спека ещё не написана; решения владельца для неё уже зафиксированы таблицей в спеке этого захода.

## Чего в этом плане нет

- **Кнопок «🤒 Больничный» и «📌 Мероприятие»** — их поведение появляется в заходе 2, и кнопки добавляются в `mainKeyboard` там же. Кнопка, ведущая в ненаписанный экран, хуже отсутствующей.
- **`setChatMenuButton`** — ещё один возможный вход в мини-апп, владелец про него не просил.
- **Починки блокера в сборах** — находка записана в `docs/audit/ledger.md`, чинится отдельным заходом. Смешивать две работы значит лишить обе доказательства.
