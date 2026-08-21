# Возврат в меню, «Баги» в консоли и поиск человека — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вернуть человеку выход из багрепорта, довезти экран «Баги» до десктопной консоли и дать поиск человека во всех списках админки и рассылки на обоих фронтах.

**Architecture:** три независимых трека. Бот (`server/src/bot/`) получает `/menu` и кнопку «🏠 В меню» на вопросе багрепорта. Консоль получает экран «Баги» — перенос клиентской половины, сервер готов. Поиск строится на одной чистой функции в `shared/src/person-search.ts`, поверх которой на каждом фронте по два маленьких компонента: `PersonSearch` (фильтр видимого списка) и `PersonPicker` (выбор одного человека вместо `<select>`).

**Tech Stack:** TypeScript, grammy, hono, drizzle/SQLite, React 19, vitest + jsdom, `@telegram-apps/telegram-ui` (только мини-апп), biome.

**Spec:** `docs/superpowers/specs/2026-08-21-menu-return-bugs-console-person-search-design.md`

## Global Constraints

- **Слои.** `shared/`, `server/` — слой 1: TDD обязателен. `admin/`, `miniapp/` — слой 2: логика тестами, вёрстка нет.
- **Настоящих ФИО в репозитории быть не может.** Имена в тестах — «Аня», «Игорь», «Марк», «Нюта», «Семён». Сторож: `server/src/db/no-real-names.test.ts`.
- **Текст, который читает человек, — по-русски.** Английский только в именах кода.
- **Комментарий объясняет «почему», а не «что».**
- **Ветка:** `feature/menu-bugs-person-search`. Сообщения коммитов по-русски, в стиле истории.
- **Гейт после каждой задачи:** `npm test`, `npm run typecheck`, `npm run lint`. Одиночный файл — `npx vitest run <путь>`.
- **Порог показа поиска:** больше пяти человек в списке. Порог 3 в `miniapp/src/screens/ProposeSwapScreen.tsx` не трогать.
- **Проверка теста мутацией.** У каждой задачи есть шаг «сломай реализацию — тест обязан упасть». Тест, который проходит и на сломанной реализации, — не тест; он переписывается, а не принимается.

---

# Трек 1. Бот: выход из багрепорта

### Task 1: `/menu` и раскладка в ответе «Записал»

**Files:**
- Modify: `server/src/bot/bot.ts` (`publishBotCommands` ~127, `captureBugReport` ~543)
- Test: `server/src/bot/menu-buttons.test.ts`, `server/src/bot/bug-report-bot.test.ts`

**Interfaces:**
- Consumes: `menuFor(tgId, chatType)`, `replyWithMenu(ctx, text, extra?)` — оба уже есть в `bot.ts`.
- Produces: команда `/menu`; ответ «Записал, спасибо 🙏 Разберёмся.» несёт `reply_markup.keyboard`.

- [ ] **Step 1: Написать падающие тесты в `menu-buttons.test.ts`**

Дописать в конец файла новый `describe`. Хелперы `commandUpdate`, `groupCommandUpdate`, `linkedWorker`, `keyboardLabels`, `testBot` уже есть в этом файле — не дублировать.

```ts
describe("/menu — универсальный возврат раскладки", () => {
  it("привязанному работнику присылает раскладку без кнопки админки", async () => {
    const db = makeTestDb();
    linkedWorker(db, 777);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(777, "/menu"));

    const labels = keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload);
    expect(labels).toContain(BTN_WEEK);
    expect(labels).toContain(BTN_REMINDERS);
    expect(labels).not.toContain(BTN_ADMIN);
  });

  it("админу присылает раскладку с кнопкой админки", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 778);
    setEmployeeAdmin(db, worker.id, true);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(778, "/menu"));

    expect(keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload)).toContain(BTN_ADMIN);
  });

  it("незнакомцу отвечает «Сначала отправь /start» и раскладки не шлёт", async () => {
    const db = makeTestDb();
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(998, "/menu"));

    const reply = calls.find((c) => c.method === "sendMessage")!;
    expect(reply.payload.text).toContain("/start");
    expect(keyboardLabels(reply.payload)).toBeNull();
  });

  it("в группу не уходит — раскладку увидели бы все участники", async () => {
    const db = makeTestDb();
    linkedWorker(db, 779);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(groupCommandUpdate(779, "/menu"));

    expect(keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload)).toBeNull();
  });

  it("/menu перечислена в меню команд бота — иначе о ней никто не узнает", async () => {
    const db = makeTestDb();
    const { bot, calls } = testBot(db);
    await publishBotCommands(bot);

    const published = calls.find((c) => c.method === "setMyCommands")!;
    expect(published.payload.commands.map((c: { command: string }) => c.command)).toContain("menu");
  });
});
```

Дописать импорты в шапку файла: `BTN_REMINDERS` из `./keyboard`, `publishBotCommands` из `./bot`.

- [ ] **Step 2: Написать падающий тест в `bug-report-bot.test.ts`**

```ts
it("ответ «Записал» несёт раскладку — обычный путь не заканчивается пропавшими кнопками", async () => {
  const db = makeTestDb();
  worker(db, "Аня", 611);
  const { bot, calls } = testBot(db);

  await bot.handleUpdate(textUpdate(611, BTN_BUG));
  await bot.handleUpdate(textUpdate(611, "Кнопка не нажимается"));

  const confirmation = calls.filter((c) => c.method === "sendMessage").find((c) => String(c.payload.text).includes("Записал"))!;
  const labels = (confirmation.payload.reply_markup?.keyboard ?? []).flat().map((b: { text: string }) => b.text);
  expect(labels).toContain(BTN_WEEK);
});
```

- [ ] **Step 3: Прогнать — тесты обязаны упасть**

Run: `npx vitest run server/src/bot/menu-buttons.test.ts server/src/bot/bug-report-bot.test.ts`
Expected: FAIL — `/menu` не обработана (бот молчит, `calls` пуст), `setMyCommands` без `menu`, у «Записал» нет `reply_markup`.

- [ ] **Step 4: Реализовать**

В `publishBotCommands` добавить строку после `week`:

```ts
{ command: "menu", description: "Вернуть кнопки под полем ввода" },
```

Рядом с `bot.command("week", ...)` (после него) добавить:

```ts
/**
 * Возврат нижней раскладки из любого состояния.
 *
 * Нужна из-за `force_reply`: Telegram подменяет им раскладку полем ответа, и
 * человек, не ответивший на вопрос багрепорта, остаётся без кнопок и без
 * способа их вернуть — `/start` для этого не выглядит и в меню команд подписан
 * про другое. Кому раскладка положена, решает `menuFor`, а не это место.
 */
bot.command("menu", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  const who = acting(from.id);
  if (!who.ok) {
    await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
    return;
  }
  await replyWithMenu(ctx, "Кнопки на месте 👇");
});
```

В `captureBugReport` заменить `await ctx.reply("Записал, спасибо 🙏 Разберёмся.");` на:

```ts
// Через `replyWithMenu`, а не голым `ctx.reply`: вопрос был задан с
// `force_reply`, и раскладку у человека Telegram на это время убрал. Обычный
// путь «нажал → написал → отправил» обязан возвращать её сам, без лишнего тапа.
await replyWithMenu(ctx, "Записал, спасибо 🙏 Разберёмся.");
```

- [ ] **Step 5: Прогнать — тесты обязаны пройти**

Run: `npx vitest run server/src/bot/menu-buttons.test.ts server/src/bot/bug-report-bot.test.ts`
Expected: PASS

- [ ] **Step 6: Проверить тесты мутацией**

Сломать по одной и убедиться, что падает именно ожидаемый тест, потом вернуть:
1. в `bot.command("menu", ...)` заменить `replyWithMenu` на `ctx.reply` → падают первые два теста `/menu`;
2. убрать `if (!who.ok)` целиком → падает тест про незнакомца;
3. вернуть `ctx.reply` в `captureBugReport` → падает тест про «Записал».

Если хоть одна мутация не роняет тест — тест переписать, он ничего не проверяет.

- [ ] **Step 7: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add server/src/bot/bot.ts server/src/bot/menu-buttons.test.ts server/src/bot/bug-report-bot.test.ts
git commit -m "feat(бот): /menu и раскладка в ответе на багрепорт"
```

---

### Task 2: кнопка «🏠 В меню» на вопросе багрепорта

**Files:**
- Modify: `server/src/bot/bot.ts` (`startBugReport` ~527, новый `bot.callbackQuery(/^bug:cancel$/)` рядом с `bug:resolve` ~725)
- Test: `server/src/bot/bug-report-bot.test.ts`

**Interfaces:**
- Consumes: `acting`, `menuFor`, `safeEdit`, `clearBugPending`, `getBugPending` (`../bugs/bug-service`).
- Produces: callback-данные `bug:cancel`.

- [ ] **Step 1: Написать падающие тесты**

Хелперы `worker`, `textUpdate`, `tapUpdate`, `testBot` уже есть в файле. `getBugPending` дописать в существующий импорт из `../bugs/bug-service`.

```ts
describe("выход из багрепорта", () => {
  it("«🏠 В меню» гасит окно: следующее сообщение уже не становится багрепортом", async () => {
    const db = makeTestDb();
    const anya = worker(db, "Аня", 621);
    const { bot } = testBot(db);

    await bot.handleUpdate(textUpdate(621, BTN_BUG));
    await bot.handleUpdate(tapUpdate(621, "bug:cancel"));
    await bot.handleUpdate(textUpdate(621, "просто пишу коллеге"));

    expect(getBugPending(db, anya.id)).toBeNull();
    expect(listBugReports(db, "all")).toHaveLength(0);
  });

  it("«🏠 В меню» присылает новое сообщение с раскладкой — правкой старого её не вернуть", async () => {
    const db = makeTestDb();
    worker(db, "Аня", 622);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(622, BTN_BUG));
    const before = calls.filter((c) => c.method === "sendMessage").length;
    await bot.handleUpdate(tapUpdate(622, "bug:cancel"));

    const sent = calls.filter((c) => c.method === "sendMessage");
    expect(sent.length).toBe(before + 1);
    const labels = (sent.at(-1)!.payload.reply_markup?.keyboard ?? []).flat().map((b: { text: string }) => b.text);
    expect(labels).toContain(BTN_WEEK);
  });

  it("вопрос несёт кнопку выхода — иначе о ней неоткуда узнать", async () => {
    const db = makeTestDb();
    worker(db, "Аня", 623);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(623, BTN_BUG));

    const question = calls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(question.payload.reply_markup.force_reply).toBe(true);
    const data = (question.payload.reply_markup.inline_keyboard ?? []).flat().map((b: { callback_data: string }) => b.callback_data);
    expect(data).toContain("bug:cancel");
  });
});
```

> **Внимание исполнителю.** Третий тест может оказаться невыполнимым: Telegram Bot API не разрешает `force_reply` и `inline_keyboard` в одном `reply_markup` — это одно поле, а не два. Прогони Step 2 и посмотри на реальный тип grammy. Если типы это запрещают — реализация меняется так: вопрос остаётся с `force_reply`, а **вторым** сообщением сразу уходит короткая строка «Передумал — вернись в меню» с одной inline-кнопкой «🏠 В меню». Тогда третий тест переписывается на «второе сообщение несёт `bug:cancel`», а первые два не меняются. Выбранный вариант объясни комментарием в коде.

- [ ] **Step 2: Прогнать — тесты обязаны упасть**

Run: `npx vitest run server/src/bot/bug-report-bot.test.ts`
Expected: FAIL — `bug:cancel` никем не обработан, окно ожидания живо, текст «просто пишу коллеге» лёг в `bug_reports`.

- [ ] **Step 3: Реализовать**

В `startBugReport` — кнопка выхода (по итогу Step 2 либо в том же `reply_markup`, либо отдельным сообщением):

```ts
const backToMenu = { inline_keyboard: [[{ text: "🏠 В меню", callback_data: "bug:cancel" }]] };
```

Новый обработчик рядом с `bug:resolve`:

```ts
/**
 * «🏠 В меню» под вопросом багрепорта.
 *
 * Гасит окно ожидания — без этого следующее написанное человеком сообщение,
 * адресованное совсем не боту, уехало бы админам багрепортом.
 *
 * Раскладка возвращается НОВЫМ сообщением, а не правкой этого: постоянная
 * клавиатура едет только с отправкой, отредактировать её в уже отправленное
 * Telegram не даёт. Правкой снимается лишь сама inline-кнопка, чтобы её нельзя
 * было нажать второй раз и получить второе «кнопки на месте».
 */
bot.callbackQuery(/^bug:cancel$/, async (ctx) => {
  const who = acting(ctx.from.id);
  if (!who.ok) {
    await ctx.answerCallbackQuery({ text: who.text });
    return;
  }
  clearBugPending(db, who.me.id);
  await ctx.answerCallbackQuery({ text: "Ок, не буду ждать" });
  await safeEdit(() => ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }));
  await ctx.reply("Кнопки на месте 👇", { reply_markup: menuFor(ctx.from.id, ctx.chat?.type) });
});
```

- [ ] **Step 4: Прогнать — тесты обязаны пройти**

Run: `npx vitest run server/src/bot/bug-report-bot.test.ts`
Expected: PASS

- [ ] **Step 5: Проверить тесты мутацией**

1. убрать `clearBugPending(db, who.me.id)` → падает первый тест (текст лёг багрепортом);
2. заменить `ctx.reply(..., { reply_markup: menuFor(...) })` на `ctx.reply("Кнопки на месте 👇")` → падает второй;
3. убрать кнопку из `startBugReport` → падает третий.

- [ ] **Step 6: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add server/src/bot/bot.ts server/src/bot/bug-report-bot.test.ts
git commit -m "fix(бот): выход из багрепорта — «🏠 В меню» гасит окно и возвращает раскладку"
```

---

# Трек 2. «Баги» в десктопной консоли

### Task 3: методы багрепортов в клиенте консоли

**Files:**
- Modify: `admin/src/api/client.ts` (тип `ApiClient` ~414, `realClient` ~725, `devClient` ~939)
- Modify: `admin/src/api/mock.ts` (в конец файла)
- Test: `admin/src/api/bug-reports-client.test.ts` (создать)

**Interfaces:**
- Produces:
  ```ts
  export interface BugReportRow {
    id: number; authorName: string; text: string;
    createdAt: string; resolvedAt: string | null; resolvedByName: string | null;
  }
  getBugReports(status: "open" | "all"): Promise<BugReportRow[]>;
  resolveBugReport(id: number, resolved: boolean): Promise<{ id: number; resolvedAt: string | null }>;
  ```
  Форма скопирована из `miniapp/src/api/client.ts:347` дословно — расхождение двух DTO под одну ручку было бы багом.

- [ ] **Step 1: Написать падающий тест**

Создать `admin/src/api/bug-reports-client.test.ts`. За образец взять `admin/src/api/mock.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { mockGetBugReports, mockResolveBugReport } from "./mock";

describe("мок багрепортов в консоли", () => {
  it("«Новые» не отдаёт разобранные, «Все» отдаёт", async () => {
    const open = await mockGetBugReports("open");
    const all = await mockGetBugReports("all");
    expect(open.every((r) => r.resolvedAt === null)).toBe(true);
    expect(all.length).toBeGreaterThan(open.length);
  });

  it("отметка «Разобрал» проставляет время, снятие — стирает", async () => {
    const [first] = await mockGetBugReports("open");
    const resolved = await mockResolveBugReport(first.id, true);
    expect(resolved.resolvedAt).not.toBeNull();
    const back = await mockResolveBugReport(first.id, false);
    expect(back.resolvedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать — тест обязан упасть**

Run: `npx vitest run admin/src/api/bug-reports-client.test.ts`
Expected: FAIL — `mockGetBugReports` не экспортирован.

- [ ] **Step 3: Реализовать**

В `admin/src/api/mock.ts` — перенести секцию из `miniapp/src/api/mock.ts` (найти там `mockGetBugReports`), сохранив её объяснения. Данные должны быть про вымышленных людей («Аня», «Марк»).

В `admin/src/api/client.ts`:
- рядом с `AnnouncementRecipient` добавить `BugReportRow` (форма выше, с комментарием, что она зеркалит мини-апповскую);
- в `ApiClient` — две подписи;
- в `realClient`:
  ```ts
  async getBugReports(status) {
    const { reports } = await authorizedGet<{ reports: BugReportRow[] }>(`/api/admin/bug-reports?status=${status}`);
    return reports;
  },
  resolveBugReport: (id, resolved) =>
    authorizedPostJson<{ id: number; resolvedAt: string | null }>(`/api/admin/bug-reports/${id}/resolve`, { resolved }),
  ```
  (имя хелпера POST-а сверить с соседями в файле — использовать то, которым пользуются остальные методы);
- в `devClient` — `getBugReports: (status) => mockGetBugReports(status),` и `resolveBugReport: (id, resolved) => mockResolveBugReport(id, resolved),`.

- [ ] **Step 4: Прогнать — тест обязан пройти**

Run: `npx vitest run admin/src/api/bug-reports-client.test.ts`
Expected: PASS

- [ ] **Step 5: Проверить тест мутацией**

Убрать в моке фильтр по `resolvedAt` для `"open"` → падает первый тест. Заставить `mockResolveBugReport` всегда ставить время → падает второй.

- [ ] **Step 6: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add admin/src/api/client.ts admin/src/api/mock.ts admin/src/api/bug-reports-client.test.ts
git commit -m "feat(админка): методы багрепортов в клиенте консоли"
```

---

### Task 4: экран «Баги» и пункт в сайдбаре

**Files:**
- Create: `admin/src/screens/BugsScreen.tsx`
- Create: `admin/src/screens/bugs-screen.test.tsx`
- Modify: `admin/src/components/Sidebar.tsx` (тип `NavKey:1`, `NAV_ITEMS:11`, новая иконка)
- Modify: `admin/src/App.tsx` (ветка рендера по `nav`)
- Modify: `admin/src/index.css` (классы карточки багрепорта)

**Interfaces:**
- Consumes: `apiClient.getBugReports`, `apiClient.resolveBugReport`, `BugReportRow` (Task 3); `formatAuditMoment` из `@planer/shared`.
- Produces: `NavKey` пополняется значением `"bugs"`; `export function BugsScreen()`.

- [ ] **Step 1: Написать падающий тест**

Создать `admin/src/screens/bugs-screen.test.tsx`, за образец взять `admin/src/screens/announce-screen.test.tsx` (тот же харнесс: `jsdom`, `createRoot`, `settle`, `buttonByText`).

```ts
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type BugReportRow } from "../api/client";
import { BugsScreen } from "./BugsScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function report(patch: Partial<BugReportRow> = {}): BugReportRow {
  return {
    id: 1, authorName: "Аня", text: "Кнопка «Больничный» не открывается",
    createdAt: "2026-08-20T09:00:00.000Z", resolvedAt: null, resolvedByName: null, ...patch,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(BugsScreen)); });
  await settle();
  return host;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку «${text}»`);
  return found;
}

describe("«Баги» в консоли", () => {
  it("рисует автора и текст жалобы", async () => {
    vi.spyOn(apiClient, "getBugReports").mockResolvedValue([report()]);
    const el = await mount();
    expect(el.textContent).toContain("Аня");
    expect(el.textContent).toContain("Кнопка «Больничный» не открывается");
  });

  it("«Разобрал» шлёт resolved: true и перечитывает список с сервера", async () => {
    const get = vi.spyOn(apiClient, "getBugReports").mockResolvedValue([report()]);
    const resolve = vi.spyOn(apiClient, "resolveBugReport").mockResolvedValue({ id: 1, resolvedAt: "2026-08-21T10:00:00.000Z" });
    const el = await mount();
    const callsBefore = get.mock.calls.length;

    await act(async () => { buttonByText(el, "Разобрал").click(); });
    await settle();

    expect(resolve).toHaveBeenCalledWith(1, true);
    expect(get.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("у разобранной кнопка возвращает в работу — отметка обратима", async () => {
    vi.spyOn(apiClient, "getBugReports").mockResolvedValue([
      report({ resolvedAt: "2026-08-20T12:00:00.000Z", resolvedByName: "Игорь" }),
    ]);
    const resolve = vi.spyOn(apiClient, "resolveBugReport").mockResolvedValue({ id: 1, resolvedAt: null });
    const el = await mount();

    await act(async () => { buttonByText(el, "Вернуть в работу").click(); });
    await settle();

    expect(resolve).toHaveBeenCalledWith(1, false);
  });

  it("«Все» перечитывает список другим статусом, а не фильтрует загруженное", async () => {
    const get = vi.spyOn(apiClient, "getBugReports").mockResolvedValue([report()]);
    const el = await mount();

    await act(async () => { buttonByText(el, "Все").click(); });
    await settle();

    expect(get).toHaveBeenCalledWith("all");
  });

  it("ошибка загрузки названа и даёт «Повторить»", async () => {
    const get = vi.spyOn(apiClient, "getBugReports").mockRejectedValue(new Error("Сервер недоступен"));
    const el = await mount();
    expect(el.textContent).toContain("Сервер недоступен");

    const callsBefore = get.mock.calls.length;
    await act(async () => { buttonByText(el, "Повторить").click(); });
    await settle();
    expect(get.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
```

- [ ] **Step 2: Прогнать — тест обязан упасть**

Run: `npx vitest run admin/src/screens/bugs-screen.test.tsx`
Expected: FAIL — модуль `./BugsScreen` не найден.

- [ ] **Step 3: Реализовать экран**

`admin/src/screens/BugsScreen.tsx` — поведение переносится дословно из `miniapp/src/screens/admin/AdminBugs.tsx` (включая объяснение, зачем таблица `bug_reports` вообще заведена и почему отметка обратима), вёрстка консольная: обёртка `<div className="employees-screen">`, заголовок `employees-header` / `employees-title`, переключатель статуса — две кнопки `btn btn-primary` / `btn btn-secondary` (как в `AnnounceScreen`), карточки — новый класс `bug-card`.

Обязательное к сохранению: список после отметки **перечитывается** (`setAttempt`), а не правится на месте; ошибка отметки живёт на карточке, ошибка загрузки — на экране, с «Повторить».

- [ ] **Step 4: Реализовать пункт сайдбара и ветку в `App.tsx`**

В `Sidebar.tsx` расширить `NavKey` значением `"bugs"`, добавить в `NAV_ITEMS` между `announce` и `log`:

```tsx
{ key: "bugs", label: "Баги", icon: <BugIcon /> },
```

и саму иконку в узоре 18×18, как у соседей:

```tsx
/** Жук — та же метафора, что у кнопки «🐞 Проблема» в боте: человек ищет глазами
 *  то, что нажимал, а не то, как это называется в базе. */
function BugIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="8" y="8" width="8" height="12" rx="4" />
      <path d="M9 8a3 3 0 0 1 6 0M3 12h5M16 12h5M4 7l3 2M20 7l-3 2M4 18l3-2M20 18l-3-2" />
    </svg>
  );
}
```

В `App.tsx` добавить ветку рендера рядом с `announce`.

- [ ] **Step 5: Стили**

В `admin/src/index.css` — `.bug-card` (рамка `--separator`, радиус 10, паддинг 12, зазор снизу 10), `.bug-card-meta` (12.5px, `--hint`), `.bug-card-text` (`white-space: pre-wrap; word-break: break-word`).

- [ ] **Step 6: Прогнать — тест обязан пройти**

Run: `npx vitest run admin/src/screens/bugs-screen.test.tsx`
Expected: PASS

- [ ] **Step 7: Проверить тесты мутацией**

1. заменить перечитывание после отметки на локальную правку состояния → падает второй тест;
2. заставить переключатель «Все» фильтровать уже загруженный массив → падает четвёртый;
3. убрать `catch` у загрузки → падает пятый.

- [ ] **Step 8: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add admin/src/screens/BugsScreen.tsx admin/src/screens/bugs-screen.test.tsx admin/src/components/Sidebar.tsx admin/src/App.tsx admin/src/index.css
git commit -m "feat(админка): экран «Баги» в десктопной консоли"
```

---

# Трек 3. Поиск человека

### Task 5: правило совпадения имени в `shared/`

**Files:**
- Create: `shared/src/person-search.ts`
- Create: `shared/src/person-search.test.ts`
- Modify: `shared/src/index.ts` (добавить `export * from "./person-search";`)

**Interfaces:**
- Produces:
  ```ts
  export interface SearchablePerson { displayName: string; preferredName?: string | null }
  export function matchesPerson(person: SearchablePerson, query: string): boolean
  export function filterPeople<T extends SearchablePerson>(people: readonly T[], query: string): T[]
  export const PERSON_SEARCH_THRESHOLD = 5
  export function shouldShowPersonSearch(count: number): boolean
  ```
  `preferredName` необязателен намеренно: `AnnouncementRecipient` его не несёт, и требовать поле, которого у половины вызывающих нет, значило бы городить заглушки на местах.

- [ ] **Step 1: Написать падающий тест**

`shared/src/person-search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterPeople, matchesPerson, shouldShowPersonSearch } from "./person-search";

const anya = { displayName: "Иванова Анна", preferredName: "Нюта" };
const igor = { displayName: "Петров Игорь", preferredName: null };
const semen = { displayName: "Семёнов Марк", preferredName: null };

describe("совпадение имени", () => {
  it("пустой и пробельный запрос совпадают со всеми — поле, в которое не ввели, ничего не прячет", () => {
    expect(matchesPerson(igor, "")).toBe(true);
    expect(matchesPerson(igor, "   ")).toBe(true);
  });

  it("находит по фамилии и не находит чужого", () => {
    expect(matchesPerson(anya, "иванова")).toBe(true);
    expect(matchesPerson(igor, "иванова")).toBe(false);
  });

  it("регистр не важен", () => {
    expect(matchesPerson(anya, "ИВАНОВА")).toBe(true);
  });

  it("«ё» и «е» — одна буква: «семенов» находит «Семёнова»", () => {
    expect(matchesPerson(semen, "семенов")).toBe(true);
    expect(matchesPerson(semen, "семёнов")).toBe(true);
  });

  it("два слова совпадают в любом порядке", () => {
    expect(matchesPerson(anya, "ан ив")).toBe(true);
    expect(matchesPerson(anya, "ив ан")).toBe(true);
    expect(matchesPerson(anya, "ив петров")).toBe(false);
  });

  it("совпадает серединой слова — люди ищут по куску фамилии", () => {
    expect(matchesPerson(anya, "ванов")).toBe(true);
  });

  it("находит по тому, как человек попросил себя называть", () => {
    expect(matchesPerson(anya, "нюта")).toBe(true);
    expect(matchesPerson(igor, "нюта")).toBe(false);
  });

  it("человек без preferredName не ломает поиск", () => {
    expect(matchesPerson({ displayName: "Петров Игорь" }, "игорь")).toBe(true);
  });
});

describe("фильтр списка", () => {
  it("сохраняет порядок исходного списка и не мутирует его", () => {
    const people = [semen, anya, igor];
    expect(filterPeople(people, "о").map((p) => p.displayName)).toEqual([
      "Семёнов Марк", "Иванова Анна", "Петров Игорь",
    ]);
    expect(people).toEqual([semen, anya, igor]);
  });

  it("пустой запрос возвращает всех", () => {
    expect(filterPeople([anya, igor], "  ")).toHaveLength(2);
  });
});

describe("порог показа", () => {
  it("на пяти поля нет, на шести есть", () => {
    expect(shouldShowPersonSearch(5)).toBe(false);
    expect(shouldShowPersonSearch(6)).toBe(true);
  });
});
```

- [ ] **Step 2: Прогнать — тест обязан упасть**

Run: `npx vitest run shared/src/person-search.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
/**
 * Как имя совпадает с тем, что набрали в поиске.
 *
 * Одно место на всю систему намеренно: правило живёт на семи экранах двух
 * фронтов, и семь похожих копий разъехались бы — «Семён» находился бы по
 * «семен» в консоли и не находился бы в мини-аппе.
 */

export interface SearchablePerson {
  displayName: string;
  /** Как человек попросил себя называть. Необязателен: у `AnnouncementRecipient`
   *  этого поля нет вовсе, и требовать его значило бы разводить заглушки. */
  preferredName?: string | null;
}

/** Больше пяти. На трёх строках поле поиска — лишняя строка, которая занимает
 *  место и ничего не экономит. */
export const PERSON_SEARCH_THRESHOLD = 5;

export function shouldShowPersonSearch(count: number): boolean {
  return count > PERSON_SEARCH_THRESHOLD;
}

/** «Ё» приравнивается к «е»: в ростере она есть, на клавиатуре её не набирают. */
function norm(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е");
}

/**
 * Каждое слово запроса должно найтись подстрокой — не с начала слова: люди
 * ищут по куску фамилии («ванов»), и поиск, который так не умеет, читается как
 * сломанный. Слова независимы, поэтому «ан ив» и «ив ан» — один и тот же запрос.
 */
export function matchesPerson(person: SearchablePerson, query: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = norm(`${person.displayName} ${person.preferredName ?? ""}`);
  return words.every((word) => haystack.includes(word));
}

/** Порядок — решение экрана, а не поиска: фильтр ничего не пересортировывает. */
export function filterPeople<T extends SearchablePerson>(people: readonly T[], query: string): T[] {
  return people.filter((person) => matchesPerson(person, query));
}
```

Дописать `export * from "./person-search";` в `shared/src/index.ts`.

- [ ] **Step 4: Прогнать — тест обязан пройти**

Run: `npx vitest run shared/src/person-search.test.ts`
Expected: PASS

- [ ] **Step 5: Проверить тесты мутацией**

1. убрать `.replace(/ё/g, "е")` → падает тест про «ё»;
2. заменить `words.every(...)` на `haystack.includes(norm(query))` → падает тест про два слова в любом порядке;
3. заменить `includes` на `startsWith` → падает тест про середину слова;
4. убрать `preferredName` из `haystack` → падает тест про «нюта»;
5. вернуть `false` при пустом запросе → падает первый тест;
6. поменять `>` на `>=` в `shouldShowPersonSearch` → падает тест про порог.

- [ ] **Step 6: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add shared/src/person-search.ts shared/src/person-search.test.ts shared/src/index.ts
git commit -m "feat(домен): одно правило совпадения имени для поиска человека"
```

---

### Task 6: `PersonSearch` в консоли и поиск в «Анонсах»

**Files:**
- Create: `admin/src/components/PersonSearch.tsx`
- Modify: `admin/src/screens/AnnounceScreen.tsx` (список выбора ~146-163)
- Modify: `admin/src/index.css` (правило `input[type="search"]`, `.person-search`)
- Test: `admin/src/screens/announce-search.test.tsx` (создать)

**Interfaces:**
- Consumes: `filterPeople`, `shouldShowPersonSearch` из `@planer/shared` (Task 5).
- Produces:
  ```tsx
  export function PersonSearch(props: {
    value: string;
    onChange: (value: string) => void;
    /** Сколько человек в списке ДО фильтрации — по нему решается, показывать ли поле. */
    count: number;
    disabled?: boolean;
  }): JSX.Element | null
  ```
  Поле несёт `aria-label="Поиск по имени"` — по нему его находят все экранные тесты трека.

- [ ] **Step 1: Написать падающий тест**

`admin/src/screens/announce-search.test.tsx`. Харнесс скопировать из `announce-screen.test.tsx` (`mount`, `settle`, `buttonByText`, `pickerRow`, `type` для `textarea`), добавив:

```ts
function searchField(el: HTMLElement): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]');
  if (!found) throw new Error("не нашёл поле поиска");
  return found;
}

async function typeSearch(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function visibleNames(el: HTMLElement): string[] {
  return [...el.querySelectorAll<HTMLElement>(".announce-picker-row")].map((r) => (r.textContent ?? "").trim());
}

const TEAM = [
  { id: 1, displayName: "Иванова Анна", reachable: true },
  { id: 2, displayName: "Петров Игорь", reachable: true },
  { id: 3, displayName: "Семёнов Марк", reachable: true },
  { id: 4, displayName: "Соколова Вера", reachable: true },
  { id: 5, displayName: "Кузнецов Пётр", reachable: true },
  { id: 6, displayName: "Орлова Ника", reachable: true },
];
```

Сами тесты:

```ts
describe("поиск получателя в «Анонсах»", () => {
  it("прячет несовпавшие строки и оставляет совпавшие", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    const el = await mount();
    await act(async () => { buttonByText(el, "Выбрать").click(); });
    await settle();

    await typeSearch(searchField(el), "ив");
    expect(visibleNames(el).join(" ")).toContain("Иванова Анна");
    expect(visibleNames(el).join(" ")).not.toContain("Петров Игорь");
  });

  it("ПОИСК НЕ СНИМАЕТ ГАЛОЧКИ: отметил при одном запросе, отметил при другом — уйдёт обоим", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 2, intended: 2, unreachable: [] });
    const el = await mount();
    await act(async () => { buttonByText(el, "Выбрать").click(); });
    await settle();

    const field = searchField(el);
    await typeSearch(field, "иванова");
    await act(async () => { pickerRow(el, "Иванова Анна").querySelector("input")!.click(); });
    await typeSearch(field, "семёнов");
    await act(async () => { pickerRow(el, "Семёнов Марк").querySelector("input")!.click(); });
    await typeSearch(field, "");

    await type(textareaByLabel(el, "Текст анонса"), "Завтра сбор в 10");
    await act(async () => { buttonByText(el, "Отправить").click(); });
    await act(async () => { buttonByText(el, "Да, отправить").click(); });
    await settle();

    expect(send).toHaveBeenCalledWith("Завтра сбор в 10", [1, 3]);
  });

  it("блок «Уйдёт» поиску не подчиняется — выбранный виден, даже когда скрыт", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    const el = await mount();
    await act(async () => { buttonByText(el, "Выбрать").click(); });
    await settle();

    await typeSearch(searchField(el), "иванова");
    await act(async () => { pickerRow(el, "Иванова Анна").querySelector("input")!.click(); });
    await typeSearch(searchField(el), "орлова");

    const recipients = el.querySelector(".birthday-recipients")!;
    expect(recipients.textContent).toContain("Иванова Анна");
  });

  it("на коротком списке поля поиска нет", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM.slice(0, 3));
    const el = await mount();
    await act(async () => { buttonByText(el, "Выбрать").click(); });
    await settle();

    expect(el.querySelector('input[aria-label="Поиск по имени"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать — тест обязан упасть**

Run: `npx vitest run admin/src/screens/announce-search.test.tsx`
Expected: FAIL — поля поиска на экране нет.

- [ ] **Step 3: Реализовать компонент**

`admin/src/components/PersonSearch.tsx`:

```tsx
import { shouldShowPersonSearch } from "@planer/shared";

/**
 * Поле поиска над списком людей.
 *
 * Само решает, показываться ли: правило «на коротком списке поиска нет» одно на
 * все экраны, и разложенное по семи местам оно бы разъехалось. `count` — длина
 * списка ДО фильтрации, иначе поле исчезало бы под собственным запросом,
 * стоило отфильтровать список до пяти строк.
 */
export function PersonSearch({ value, onChange, count, disabled }: {
  value: string;
  onChange: (value: string) => void;
  count: number;
  disabled?: boolean;
}) {
  if (!shouldShowPersonSearch(count)) return null;
  return (
    <input
      className="person-search"
      type="search"
      aria-label="Поиск по имени"
      placeholder="Поиск по имени"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
```

- [ ] **Step 4: Вставить в «Анонсы»**

В `AnnounceScreen.tsx`: состояние `const [query, setQuery] = useState("")`; внутри `audienceMode === "picked"` над списком — `<PersonSearch value={query} onChange={setQuery} count={recipients.length} disabled={sending} />`; сам список рисуется из `filterPeople(recipients, query)`.

Ключевое: `picked`, `reachable` и всё, что уходит на сервер, считаются из **`recipients`**, а не из отфильтрованного. Отдельным комментарием на месте:

```tsx
// Фильтруется ТОЛЬКО отрисовка. `selectedIds` живёт своей жизнью, а «Уйдёт»
// ниже считается из полного списка: анонс не отзывается и идёт сквозь все
// настройки тишины, и поиск, роняющий выбор скрытых, однажды отправит
// сообщение не тем.
```

Добавить строку «Никого с таким именем нет», когда фильтр пуст, а список — нет.

- [ ] **Step 5: Стили**

В `admin/src/index.css` дописать `input[type="search"]` в общее правило `select, input[type="text"], …` и добавить `.person-search { margin-bottom: 8px; }`.

- [ ] **Step 6: Прогнать — тест обязан пройти**

Run: `npx vitest run admin/src/screens/announce-search.test.tsx admin/src/screens/announce-screen.test.tsx`
Expected: PASS (старые тесты «Анонсов» тоже — поведение отправки не менялось)

- [ ] **Step 7: Проверить тесты мутацией**

1. заменить `recipients` на отфильтрованный список в вычислении `picked` → падает тест про «не снимает галочки»;
2. сбрасывать `setSelectedIds(new Set())` в `onChange` поиска → падает он же;
3. убрать `count` и показывать поле всегда → падает тест про короткий список.

- [ ] **Step 8: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add admin/src/components/PersonSearch.tsx admin/src/screens/AnnounceScreen.tsx admin/src/screens/announce-search.test.tsx admin/src/index.css
git commit -m "feat(админка): поиск получателя в «Анонсах» — прячет строки, но не снимает галочки"
```

---

### Task 7: поиск в «Работниках» и «Видах смен» (консоль)

**Files:**
- Modify: `admin/src/screens/EmployeesScreen.tsx` (секции списка ~219-248)
- Modify: `admin/src/screens/ShiftKindsScreen.tsx` (матрица ~213-246)
- Test: `admin/src/screens/employees-search.test.tsx` (создать)

**Interfaces:**
- Consumes: `PersonSearch` (Task 6), `filterPeople` (Task 5).

- [ ] **Step 1: Написать падающий тест**

Главное здесь — ловушка нумерации. В `EmployeesSection` позиция строки считается как `index + 1` по **видимому** массиву, и наивная фильтрация превратила бы «переставить на позицию 2» в перестановку не туда.

`admin/src/screens/employees-search.test.tsx`. Харнесс копируется из `admin/src/screens/employees-restrictions.test.tsx` — оттуда берутся `settle`, `Harness` (обёртка, держащая состояние ростера) и `mount`; `mountWith(list)` — это её `mount` с переданным `initial`. Плюс три собственных хелпера:

`Employee` в консоли — плоский литерал без фабрики (см. `EMPLOYEES` в `employees-restrictions.test.tsx`), поэтому шестерых удобнее собрать так:

```ts
const person = (id: number, displayName: string): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ").at(-1)!,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false,
});

const SIX_PEOPLE: Employee[] = [
  person(1, "Иванова Анна"),
  person(2, "Петров Игорь"),
  person(3, "Семёнов Марк"),
  person(4, "Соколова Вера"),
  person(5, "Кузнецов Пётр"),
  person(6, "Орлова Ника"),
];

function searchField(el: HTMLElement): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]');
  if (!found) throw new Error("не нашёл поле поиска");
  return found;
}

async function typeSearch(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function rowNames(el: HTMLElement): string[] {
  return [...el.querySelectorAll(".employee-row-name")].map((n) => (n.textContent ?? "").trim());
}
```

Сами тесты:

```ts
describe("поиск работника в консоли", () => {
  it("прячет несовпавшие строки", async () => {
    const el = await mountWith(SIX_PEOPLE);
    await typeSearch(searchField(el), "семён");
    expect(rowNames(el)).toEqual(["Семёнов Марк"]);
  });

  it("позиция в списке считается от полного ростера, а не от найденного", async () => {
    const el = await mountWith(SIX_PEOPLE); // Семёнов — третий из шести
    await typeSearch(searchField(el), "семён");
    const position = el.querySelector<HTMLInputElement>(".employee-row input[aria-label='Позиция в списке']")!;
    expect(position.value).toBe("3");
  });

  it("поиск не трогает архив: свернутая секция остаётся свернутой", async () => {
    const el = await mountWith(SIX_PEOPLE);
    await typeSearch(searchField(el), "семён");
    expect(el.querySelector(".collapsible-archive")).not.toBeNull();
  });
});
```

> Точное `aria-label` поля позиции и класс архива исполнителю **сверить в коде** (`EmployeeRow`, `CollapsibleArchive.tsx`) и поправить селекторы, а не подгонять код под выдуманное имя.

- [ ] **Step 2: Прогнать — тест обязан упасть**

Run: `npx vitest run admin/src/screens/employees-search.test.tsx`
Expected: FAIL — поля поиска нет.

- [ ] **Step 3: Реализовать в «Работниках»**

Поиск один на экран (над обеими секциями — активными и архивом), `count` — длина полного ростера.

В `EmployeesSection` **не** передавать отфильтрованный индекс. Позиция берётся из исходного списка:

```tsx
// Позиция — место в РОСТЕРЕ, а не в том, что осталось после поиска. Считать её
// по видимому индексу значило бы переставлять человека не туда, стоило кому-то
// что-нибудь набрать в поиске.
position={onReorder ? fullOrder.indexOf(employee.id) + 1 : undefined}
```

- [ ] **Step 4: Реализовать в «Видах смен»**

Поиск над матрицей «Работник / Допущен / Любит», `count` — длина списка работников. Фильтруется только отрисовка строк; `kind.pool` и `kind.preference` считаются и сохраняются из полного списка — кнопка «Сбросить на «все»» и счётчики не должны зависеть от того, что набрано в поиске.

- [ ] **Step 5: Прогнать — тест обязан пройти**

Run: `npx vitest run admin/src/screens/employees-search.test.tsx admin/src/screens/employees-restrictions.test.tsx admin/src/screens/shift-kinds-rotation.test.tsx`
Expected: PASS

- [ ] **Step 6: Проверить тесты мутацией**

Вернуть `position={index + 1}` по отфильтрованному списку → падает тест про позицию. Если не падает — тест не проверяет ничего и переписывается.

- [ ] **Step 7: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add admin/src/screens/EmployeesScreen.tsx admin/src/screens/ShiftKindsScreen.tsx admin/src/screens/employees-search.test.tsx
git commit -m "feat(админка): поиск в «Работниках» и «Видах смен»"
```

---

### Task 8: поиск строк в гриде расписания (консоль)

**Files:**
- Modify: `admin/src/components/ScheduleGrid.tsx`
- Modify: `admin/src/App.tsx` (состояние запроса, передача в грид и в `BalanceRail`)
- Test: `admin/src/components/schedule-grid-search.test.tsx` (создать)

**Interfaces:**
- Consumes: `PersonSearch`, `filterPeople`.
- Produces: `ScheduleGrid` получает необязательный проп `query?: string`.

- [ ] **Step 1: Написать падающий тест**

`admin/src/components/schedule-grid-search.test.tsx`. `ScheduleGrid` — чистый компонент без запросов, поэтому харнесс минимальный:

```ts
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ScheduleGrid } from "./ScheduleGrid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIX_PEOPLE = [
  { id: 1, displayName: "Иванова Анна" },
  { id: 2, displayName: "Петров Игорь" },
  { id: 3, displayName: "Семёнов Марк" },
  { id: 4, displayName: "Соколова Вера" },
  { id: 5, displayName: "Кузнецов Пётр" },
  { id: 6, displayName: "Орлова Ника" },
];

const WEEK = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
});

async function mountGrid(employees: unknown[], extra: { query?: string }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(ScheduleGrid, {
      employees, shifts: [], templates: [], weekDates: WEEK,
      onAddClick: () => {}, onEntryClick: () => {}, ...extra,
    } as never));
  });
  return host;
}

describe("поиск по гриду расписания", () => {
  it("оставляет строки совпавших и прячет остальные", async () => {
    const el = await mountGrid(SIX_PEOPLE, { query: "семён" });
    expect([...el.querySelectorAll(".employee-name")].map((n) => n.textContent)).toEqual(["Семёнов Марк"]);
  });

  it("пустой запрос показывает всех", async () => {
    const el = await mountGrid(SIX_PEOPLE, { query: "" });
    expect(el.querySelectorAll(".employee-name")).toHaveLength(6);
  });

  it("шапка недели остаётся на месте — поиск фильтрует людей, а не дни", async () => {
    const el = await mountGrid(SIX_PEOPLE, { query: "семён" });
    expect(el.querySelectorAll("thead th").length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Прогнать — тест обязан упасть**

Run: `npx vitest run admin/src/components/schedule-grid-search.test.tsx`
Expected: FAIL — пропа `query` нет, все шесть строк на месте.

- [ ] **Step 3: Реализовать**

В `ScheduleGrid` — `employees` фильтруется через `filterPeople(employees, query ?? "")`. Поле поиска живёт в `App.tsx` над гридом (рядом с `TopBar`), `count={activeEmployees.length}`.

`BalanceRail` **не** фильтровать: он про справедливость раздачи по всей команде, и половина команды в нём — это не «отфильтровано», а неверное число. Комментарием на месте.

- [ ] **Step 4: Прогнать — тест обязан пройти**

Run: `npx vitest run admin/src/components/schedule-grid-search.test.tsx`
Expected: PASS

- [ ] **Step 5: Проверить тест мутацией**

Убрать фильтрацию → падает первый тест. Отфильтровать заодно и `weekDates` → падает третий.

- [ ] **Step 6: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add admin/src/components/ScheduleGrid.tsx admin/src/App.tsx admin/src/components/schedule-grid-search.test.tsx
git commit -m "feat(админка): поиск по строкам грида расписания"
```

---

### Task 9: `PersonPicker` — выбор одного человека вместо `<select>` (консоль)

**Files:**
- Create: `admin/src/components/PersonPicker.tsx`
- Create: `admin/src/components/person-picker.test.tsx`
- Modify: `admin/src/screens/CollectionsScreen.tsx` (два `<select aria-label="Кому">` / `"Кому сбор"` — ~436 и ~816)
- Modify: `admin/src/components/AddEntryPanel.tsx` (выбор работника ~160-175)
- Modify: `admin/src/index.css`

**Interfaces:**
- Consumes: `PersonSearch`, `filterPeople`.
- Produces:
  ```tsx
  export function PersonPicker<T extends { id: number; displayName: string; preferredName?: string | null }>(props: {
    label: string;
    people: readonly T[];
    /** 0 — «никто не выбран»; так же, как это уже кодировали `<select>`ы. */
    value: number;
    onChange: (id: number) => void;
    /** Подпись строки «никто», например «Общий сбор — на всех». Без неё строки нет. */
    emptyOptionLabel?: string;
    disabled?: boolean;
  }): JSX.Element
  ```

- [ ] **Step 1: Написать падающий тест**

`admin/src/components/person-picker.test.tsx`:

```ts
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonPicker } from "./PersonPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIX = [
  { id: 1, displayName: "Иванова Анна" },
  { id: 2, displayName: "Петров Игорь" },
  { id: 3, displayName: "Семёнов Марк" },
  { id: 4, displayName: "Соколова Вера" },
  { id: 5, displayName: "Кузнецов Пётр" },
  { id: 6, displayName: "Орлова Ника" },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
  vi.restoreAllMocks();
});

async function mountPicker(props: Parameters<typeof PersonPicker>[0]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(PersonPicker, { label: "Кому", ...props })); });
  return host;
}

function rowByName(el: HTMLElement, name: string): HTMLButtonElement {
  const found = [...el.querySelectorAll<HTMLButtonElement>(".person-picker-row")].find(
    (r) => (r.textContent ?? "").includes(name),
  );
  if (!found) throw new Error(`не нашёл строку «${name}»`);
  return found;
}

function selectedRowName(el: HTMLElement): string {
  const row = el.querySelector<HTMLElement>(".person-picker-row.selected");
  return (row?.textContent ?? "").trim();
}

function searchField(el: HTMLElement): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]');
  if (!found) throw new Error("не нашёл поле поиска");
  return found;
}

async function typeSearch(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("выбор одного человека", () => {
  it("клик по строке отдаёт её id", async () => {
    const onChange = vi.fn();
    const el = await mountPicker({ people: SIX, value: 0, onChange });
    await act(async () => { rowByName(el, "Семёнов Марк").click(); });
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("выбранный назван всегда — даже когда поиск его спрятал", async () => {
    const el = await mountPicker({ people: SIX, value: 3, onChange: vi.fn() });
    await typeSearch(searchField(el), "орлова");
    expect(el.querySelector(".person-picker-chosen")!.textContent).toContain("Семёнов Марк");
  });

  it("поиск не меняет выбор: набрал, стёр — выбран тот же", async () => {
    const onChange = vi.fn();
    const el = await mountPicker({ people: SIX, value: 3, onChange });
    await typeSearch(searchField(el), "орлова");
    await typeSearch(searchField(el), "");
    expect(onChange).not.toHaveBeenCalled();
    expect(selectedRowName(el)).toBe("Семёнов Марк");
  });

  it("строка «никто» показывается, когда её подпись задана, и выбирается", async () => {
    const onChange = vi.fn();
    const el = await mountPicker({ people: SIX, value: 3, onChange, emptyOptionLabel: "Общий сбор — на всех" });
    await act(async () => { rowByName(el, "Общий сбор — на всех").click(); });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("на коротком списке поля поиска нет, сами строки на месте", async () => {
    const el = await mountPicker({ people: SIX.slice(0, 3), value: 0, onChange: vi.fn() });
    expect(el.querySelector('input[aria-label="Поиск по имени"]')).toBeNull();
    expect(el.querySelectorAll(".person-picker-row")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Прогнать — тест обязан упасть**

Run: `npx vitest run admin/src/components/person-picker.test.tsx`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать компонент**

Разметка: подпись → строка «Выбран: …» (`.person-picker-chosen`) → `PersonSearch` → прокручиваемый список `.person-picker-list` из `<button type="button" className="person-picker-row" aria-pressed={selected}>`.

Комментарий на месте, зачем это вместо `<select>`:

```tsx
// Не `<select>`: на телефоне он открывается системным колесом, в котором нет
// никакого поиска, а людей под два десятка. Строка «Выбран: …» стоит отдельно
// и поиску не подчиняется — иначе, отфильтровав список, человек переставал
// видеть собственный выбор и переставлял его вслепую.
```

- [ ] **Step 4: Стили**

`.person-picker-list { max-height: 208px; overflow-y: auto; border: 1px solid var(--separator); border-radius: 8px; }`, `.person-picker-row` (полная ширина, слева, паддинг 8/10, hover — `--surface-2` или что уже используется соседями), `.person-picker-row.selected` (та же обводка, что у `.category-option.selected`), `.person-picker-chosen` (12.5px, `--hint`).

- [ ] **Step 5: Заменить `<select>` на «Сборах» и в «Добавить смену»**

На «Сборах» — оба места, `emptyOptionLabel="Общий сбор — на всех"`, `disabled` там же, где он стоял (`busy`, `subjectFrozen`). В `AddEntryPanel` — выбор работника, без строки «никто», если её там не было.

- [ ] **Step 6: Прогнать — тесты обязаны пройти**

Run: `npx vitest run admin/src/components/person-picker.test.tsx admin/src/collections-screen.test.tsx admin/src/components/add-entry-panel.test.tsx`
Expected: PASS. Соседние тесты, искавшие `<select aria-label="Кому">`, придётся переписать на новый узор — это ожидаемо: менялся способ выбора, а не правило.

- [ ] **Step 7: Проверить тесты мутацией**

1. подчинить строку «Выбран: …» поиску → падает второй тест;
2. сбрасывать `onChange(0)` при вводе в поиск → падает третий;
3. показывать поле поиска всегда → падает пятый.

- [ ] **Step 8: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add admin/src/components/PersonPicker.tsx admin/src/components/person-picker.test.tsx admin/src/screens/CollectionsScreen.tsx admin/src/components/AddEntryPanel.tsx admin/src/index.css
git commit -m "feat(админка): выбор человека с поиском вместо выпадающего списка"
```

---

### Task 10: фильтр «кто» в консольном «Журнале» — серверный

**Files:**
- Modify: `admin/src/api/client.ts` (`JournalPage:267`, подпись `getJournal:453`, `realClient.getJournal:826`)
- Modify: `admin/src/api/mock.ts` (`mockGetJournal` — добавить `availableActors` и учёт `actor`)
- Modify: `admin/src/screens/JournalScreen.tsx` (~177-233)
- Test: `admin/src/screens/journal-actor.test.tsx` (создать)

**Interfaces:**
- Consumes: ручка `/api/admin/journal` — уже принимает `actor` и отдаёт `availableActors` (`server/src/http/app.ts:793`, `server/src/repo/audit.ts:55`). Сервер не трогаем.
- Produces: `JournalPage.availableActors: { id: number; displayName: string }[]`; `getJournal(params: { types?; actor?; from?; to?; limit?; offset? })`.

- [ ] **Step 1: Написать падающий тест**

`admin/src/screens/journal-actor.test.tsx`. Харнесс (`mount`, `settle`, `byText`, `click`) копируется из `admin/src/screens/journal-error.test.tsx`.

**Важно:** журнал живёт за вкладкой — после `mount()` нужно `await click(byText(el, "Кто что менял"))`, иначе экрана с фильтрами на странице просто нет. Во всех тестах ниже это первый шаг.

Плюс собственные хелперы:

```ts
const PAGE = {
  total: 2, limit: 50, offset: 0,
  availableTypes: ["shift_created"],
  availableActors: [
    { id: 1, displayName: "Иванова Анна" },
    { id: 3, displayName: "Семёнов Марк" },
  ],
  events: [{ id: 1, type: "shift_created", createdAt: "2026-08-20T09:00:00.000Z", actorName: "Иванова Анна", payload: {} }],
};

function actorSelect(el: HTMLElement): HTMLSelectElement {
  const found = el.querySelector<HTMLSelectElement>('select[aria-label="Кто"]');
  if (!found) throw new Error("не нашёл фильтр «кто»");
  return found;
}

function actorOptions(el: HTMLElement): string[] {
  return [...actorSelect(el).options].map((o) => o.text.trim());
}

async function selectActor(el: HTMLElement, name: string) {
  const select = actorSelect(el);
  const option = [...select.options].find((o) => o.text.trim() === name)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
```

Сами тесты:

```ts
describe("фильтр «кто» в журнале консоли", () => {
  it("выбор человека уходит в запрос параметром actor, а не фильтруется на клиенте", async () => {
    const get = vi.spyOn(apiClient, "getJournal").mockResolvedValue(PAGE);
    const el = await mount();
    await click(byText(el, "Кто что менял"));
    await selectActor(el, "Семёнов Марк");
    await settle();
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 3 }));
  });

  it("смена человека сбрасывает страницу на первую — иначе offset остался бы от чужого набора", async () => {
    const get = vi.spyOn(apiClient, "getJournal").mockResolvedValue({ ...PAGE, total: 500 });
    const el = await mount();
    await click(byText(el, "Кто что менял"));
    await click(byText(el, "Старее →"));
    await selectActor(el, "Семёнов Марк");
    await settle();
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 3, offset: 0 }));
  });

  it("список «кто» строится из availableActors ответа, а не из ростера", async () => {
    vi.spyOn(apiClient, "getJournal").mockResolvedValue({
      ...PAGE,
      availableActors: [{ id: 3, displayName: "Семёнов Марк" }],
    });
    const el = await mount();
    await click(byText(el, "Кто что менял"));
    expect(actorOptions(el)).toEqual(["Все", "Семёнов Марк"]);
  });
});
```

- [ ] **Step 2: Прогнать — тест обязан упасть**

Run: `npx vitest run admin/src/screens/journal-actor.test.tsx`
Expected: FAIL — фильтра «кто» на экране нет.

- [ ] **Step 3: Реализовать**

Клиент: `availableActors` в `JournalPage`, `actor?: number` в подписи и `if (params.actor != null) q.set("actor", String(params.actor));` в `realClient.getJournal` — дословно как в `miniapp/src/api/client.ts:1118`. Мок — `availableActors` из тех, кто реально встречается в его событиях, и фильтрация по `actor`.

Экран: состояние `actor`, селект «Кто» рядом с селектом типа, `useEffect` зависит и от `actor`, `offset` сбрасывается при смене — как это уже сделано в `miniapp/src/screens/admin/AdminJournal.tsx:143`.

Комментарий, почему серверный:

```tsx
// Фильтр серверный, а не по загруженной странице: total и пагинация считаются
// на сервере, и клиентский фильтр заставил бы экран врать про то, сколько
// всего событий нашлось.
```

- [ ] **Step 4: Прогнать — тест обязан пройти**

Run: `npx vitest run admin/src/screens/journal-actor.test.tsx admin/src/screens/journal-error.test.tsx admin/src/screens/journal-row.test.tsx`
Expected: PASS

- [ ] **Step 5: Проверить тесты мутацией**

1. фильтровать `page.events` на клиенте вместо параметра → падает первый тест;
2. убрать сброс `offset` → падает второй;
3. строить список «кто» из `getEmployees` → падает третий.

- [ ] **Step 6: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add admin/src/api/client.ts admin/src/api/mock.ts admin/src/screens/JournalScreen.tsx admin/src/screens/journal-actor.test.tsx
git commit -m "feat(админка): фильтр «кто» в журнале консоли — серверный, как в мини-аппе"
```

---

### Task 11: `PersonSearch` в мини-аппе — «Анонс», «Работники», «Виды смен»

**Files:**
- Create: `miniapp/src/components/PersonSearch.tsx`
- Modify: `miniapp/src/screens/admin/AdminAnnounce.tsx` (~163-181)
- Modify: `miniapp/src/screens/admin/AdminEmployeesScreen.tsx` (~211-262)
- Modify: `miniapp/src/screens/admin/AdminShiftKinds.tsx` (~303)
- Test: `miniapp/src/screens/admin/admin-announce-search.test.tsx` (создать)

**Interfaces:**
- Consumes: `filterPeople`, `shouldShowPersonSearch` (Task 5).
- Produces: `export function PersonSearch(props: { value: string; onChange: (v: string) => void; count: number; disabled?: boolean })` — тот же контракт и то же `aria-label="Поиск по имени"`, что в консоли; отличается только внутренностями (`Input` из `@telegram-apps/telegram-ui`).

- [ ] **Step 1: Написать падающий тест**

Харнесс — как в `miniapp/src/screens/propose-swap.test.tsx` (`jsdom`, `AppRoot`, `createRoot`).

Строкам выбора получателя в `AdminAnnounce.tsx` сейчас нечем зацепиться — это голый `<label>` со стилями инлайном. В Step 4 им добавляется `className="announce-picker-row"`, то же имя, что уже носит консольная строка: два фронта, один узор, и тесту есть за что держаться.

```ts
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type AnnouncementRecipient } from "../../api/client";
import { AdminAnnounce } from "./AdminAnnounce";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEAM: AnnouncementRecipient[] = [
  { id: 1, displayName: "Иванова Анна", reachable: true },
  { id: 2, displayName: "Петров Игорь", reachable: true },
  { id: 3, displayName: "Семёнов Марк", reachable: true },
  { id: 4, displayName: "Соколова Вера", reachable: true },
  { id: 5, displayName: "Кузнецов Пётр", reachable: true },
  { id: 6, displayName: "Орлова Ника", reachable: true },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

async function mount(team: AnnouncementRecipient[]) {
  vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(team);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminAnnounce))); });
  await settle();
  return host;
}

function byText(el: HTMLElement, text: string): HTMLElement {
  const found = [...el.querySelectorAll<HTMLElement>("button, div, span")].find(
    (n) => (n.textContent ?? "").trim() === text,
  );
  if (!found) throw new Error(`не нашёл «${text}»`);
  return found;
}

function rows(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(".announce-picker-row")];
}

function rowByName(el: HTMLElement, name: string): HTMLElement {
  const found = rows(el).find((r) => (r.textContent ?? "").includes(name));
  if (!found) throw new Error(`не нашёл строку «${name}»`);
  return found;
}

function searchField(el: HTMLElement): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]');
  if (!found) throw new Error("не нашёл поле поиска");
  return found;
}

async function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openPicker(el: HTMLElement) {
  await act(async () => { byText(el, "Выбрать").click(); });
  await settle();
}

describe("поиск получателя в мини-апповском анонсе", () => {
  it("прячет несовпавшие строки и оставляет совпавшие", async () => {
    const el = await mount(TEAM);
    await openPicker(el);

    await typeInto(searchField(el), "ив");
    const names = rows(el).map((r) => (r.textContent ?? "").trim()).join(" ");
    expect(names).toContain("Иванова Анна");
    expect(names).not.toContain("Петров Игорь");
  });

  it("ПОИСК НЕ СНИМАЕТ ГАЛОЧКИ: отметил при одном запросе, отметил при другом — уйдёт обоим", async () => {
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 2, intended: 2, unreachable: [] });
    const el = await mount(TEAM);
    await openPicker(el);

    const field = searchField(el);
    await typeInto(field, "иванова");
    await act(async () => { rowByName(el, "Иванова Анна").querySelector("input")!.click(); });
    await typeInto(field, "семёнов");
    await act(async () => { rowByName(el, "Семёнов Марк").querySelector("input")!.click(); });
    await typeInto(field, "");

    await typeInto(el.querySelector("textarea")!, "Завтра сбор в 10");
    await act(async () => { byText(el, "Отправить").click(); });
    await act(async () => { byText(el, "Да, отправить").click(); });
    await settle();

    expect(send).toHaveBeenCalledWith("Завтра сбор в 10", [1, 3]);
  });

  it("на коротком списке поля поиска нет", async () => {
    const el = await mount(TEAM.slice(0, 3));
    await openPicker(el);

    expect(el.querySelector('input[aria-label="Поиск по имени"]')).toBeNull();
  });
});
```

> Подписи кнопок подтверждения («Отправить», «Да, отправить») исполнителю сверить в `AdminAnnounce.tsx` — у мини-аппа они могли разойтись с консольными — и подставить настоящие, а не переименовывать кнопки под тест.

- [ ] **Step 2: Прогнать — тест обязан упасть**

Run: `npx vitest run miniapp/src/screens/admin/admin-announce-search.test.tsx`
Expected: FAIL — поля поиска нет.

- [ ] **Step 3: Реализовать компонент**

```tsx
import { Input } from "@telegram-apps/telegram-ui";
import { shouldShowPersonSearch } from "@planer/shared";

/** Тот же контракт, что у консольного `PersonSearch`, и тот же `aria-label`:
 *  правило «когда показывать» живёт в `shared`, а различается только оболочка —
 *  здесь компонент из telegram-ui, там голый input. */
export function PersonSearch({ value, onChange, count, disabled }: {
  value: string; onChange: (value: string) => void; count: number; disabled?: boolean;
}) {
  if (!shouldShowPersonSearch(count)) return null;
  return (
    <div style={{ padding: "2px 0 8px" }}>
      <Input type="search" aria-label="Поиск по имени" placeholder="Поиск по имени"
        value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
```

- [ ] **Step 4: Вставить на три экрана**

«Анонс» — над списком получателей; строке выбора добавляется `className="announce-picker-row"` (ей нечем зацепиться, и имя берётся то же, что в консоли); `selectedIds`, `picked` и `reachable` считаются из полного `recipients`, тем же комментарием, что в консоли. «Работники» — над списком активных, архив не трогать. «Виды смен» — над матрицей, `pool`/`preference` из полного списка.

- [ ] **Step 5: Прогнать — тесты обязаны пройти**

Run: `npx vitest run miniapp/src/screens/admin/`
Expected: PASS

- [ ] **Step 6: Проверить тесты мутацией**

Те же три мутации, что в Task 6, — на мини-апповском «Анонсе».

- [ ] **Step 7: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add miniapp/src/components/PersonSearch.tsx miniapp/src/screens/admin/AdminAnnounce.tsx miniapp/src/screens/admin/AdminEmployeesScreen.tsx miniapp/src/screens/admin/AdminShiftKinds.tsx miniapp/src/screens/admin/admin-announce-search.test.tsx
git commit -m "feat(мини-апп): поиск человека в анонсе, работниках и видах смен"
```

---

### Task 12: `PersonPicker` в мини-аппе — «Сборы» и «Расписание»

**Files:**
- Create: `miniapp/src/components/PersonPicker.tsx`
- Create: `miniapp/src/components/person-picker.test.tsx`
- Modify: `miniapp/src/screens/admin/AdminCollections.tsx` (два `Select header="Кому"` — ~445 и ~866)
- Modify: `miniapp/src/screens/admin/AdminScheduleScreen.tsx` (`Select header="Работник"` — ~703 и ~999)

**Interfaces:**
- Consumes: `PersonSearch` (Task 11), `filterPeople`.
- Produces: тот же контракт, что у консольного `PersonPicker` (Task 9), плюс необязательный `note?: (person: T) => string | null` — «Заполнить неделю» помечает строкой «· вне назначений» тех, кого бот сам не поставил бы; эта пометка обязана пережить замену `Select`.

- [ ] **Step 1: Написать падающий тест**

`miniapp/src/components/person-picker.test.tsx` — тот же файл, что в Task 9, с двумя отличиями: компонент оборачивается в `AppRoot`, и добавлен шестой тест про пометку.

```ts
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { PersonPicker } from "./PersonPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIX = [
  { id: 1, displayName: "Иванова Анна" },
  { id: 2, displayName: "Петров Игорь" },
  { id: 3, displayName: "Семёнов Марк" },
  { id: 4, displayName: "Соколова Вера" },
  { id: 5, displayName: "Кузнецов Пётр" },
  { id: 6, displayName: "Орлова Ника" },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
  vi.restoreAllMocks();
});

async function mountPicker(props: Parameters<typeof PersonPicker>[0]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(PersonPicker, { label: "Кому", ...props })));
  });
  return host;
}

function rowByName(el: HTMLElement, name: string): HTMLElement {
  const found = [...el.querySelectorAll<HTMLElement>(".person-picker-row")].find(
    (r) => (r.textContent ?? "").includes(name),
  );
  if (!found) throw new Error(`не нашёл строку «${name}»`);
  return found;
}

function selectedRowName(el: HTMLElement): string {
  const row = el.querySelector<HTMLElement>(".person-picker-row.selected");
  return (row?.textContent ?? "").trim();
}

function searchField(el: HTMLElement): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]');
  if (!found) throw new Error("не нашёл поле поиска");
  return found;
}

async function typeSearch(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("выбор одного человека в мини-аппе", () => {
  it("клик по строке отдаёт её id", async () => {
    const onChange = vi.fn();
    const el = await mountPicker({ people: SIX, value: 0, onChange });
    await act(async () => { rowByName(el, "Семёнов Марк").click(); });
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("выбранный назван всегда — даже когда поиск его спрятал", async () => {
    const el = await mountPicker({ people: SIX, value: 3, onChange: vi.fn() });
    await typeSearch(searchField(el), "орлова");
    expect(el.querySelector(".person-picker-chosen")!.textContent).toContain("Семёнов Марк");
  });

  it("поиск не меняет выбор: набрал, стёр — выбран тот же", async () => {
    const onChange = vi.fn();
    const el = await mountPicker({ people: SIX, value: 3, onChange });
    await typeSearch(searchField(el), "орлова");
    await typeSearch(searchField(el), "");
    expect(onChange).not.toHaveBeenCalled();
    expect(selectedRowName(el)).toContain("Семёнов Марк");
  });

  it("строка «никто» показывается, когда её подпись задана, и выбирается", async () => {
    const onChange = vi.fn();
    const el = await mountPicker({ people: SIX, value: 3, onChange, emptyOptionLabel: "Общий сбор — на всех" });
    await act(async () => { rowByName(el, "Общий сбор — на всех").click(); });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("на коротком списке поля поиска нет, сами строки на месте", async () => {
    const el = await mountPicker({ people: SIX.slice(0, 3), value: 0, onChange: vi.fn() });
    expect(el.querySelector('input[aria-label="Поиск по имени"]')).toBeNull();
    expect(el.querySelectorAll(".person-picker-row")).toHaveLength(3);
  });

  it("пометка «вне назначений» переживает замену выпадающего списка", async () => {
    const el = await mountPicker({
      people: SIX,
      value: 0,
      onChange: vi.fn(),
      note: (p) => (p.id === 2 ? "· вне назначений" : null),
    });
    expect(rowByName(el, "Петров Игорь").textContent).toContain("вне назначений");
    expect(rowByName(el, "Семёнов Марк").textContent).not.toContain("вне назначений");
  });
});
```

- [ ] **Step 2: Прогнать — тест обязан упасть**

Run: `npx vitest run miniapp/src/components/person-picker.test.tsx`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать компонент**

`Section` + `PersonSearch` + строки `Cell` с галочкой у выбранного (`after`), над ними — строка «Выбран: …», поиску не подчиняющаяся. Список ограничить по высоте с прокруткой, чтобы форма не растягивалась на два десятка строк.

- [ ] **Step 4: Заменить четыре `Select`**

«Сборы» — оба «Кому», с `emptyOptionLabel="Общий сбор — на всех"` и тем же фильтром `e.isActive && e.id !== viewerId`. «Расписание» — «Работник» в редакторе записи (`emptyOptionLabel="— не назначен —"`) и в «Заполнить неделю» (`emptyOptionLabel="— выберите —"`, `note` с пометкой «· вне назначений» через `takesPartInAssignment(e)`).

Комментарий про «не фильтруем список в «Заполнить неделю»» сохранить дословно — это зафиксированное решение заказчика, а не случайность.

- [ ] **Step 5: Прогнать — тесты обязаны пройти**

Run: `npx vitest run miniapp/`
Expected: PASS. Тесты, искавшие `<select>` на этих экранах, переписать под новый узор.

- [ ] **Step 6: Проверить тесты мутацией**

1. подчинить строку «Выбран: …» поиску → падает соответствующий тест;
2. убрать `note` из отрисовки → падает шестой тест;
3. потерять фильтр `e.id !== viewerId` на «Сборах» → падает тест соседнего файла (`AdminCollections-*.test.tsx`); если не падает — дописать его туда.

- [ ] **Step 7: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add miniapp/src/components/PersonPicker.tsx miniapp/src/components/person-picker.test.tsx miniapp/src/screens/admin/AdminCollections.tsx miniapp/src/screens/admin/AdminScheduleScreen.tsx
git commit -m "feat(мини-апп): выбор человека с поиском вместо выпадающего списка"
```

---

## Финальная проверка

- [ ] `npm test` — весь набор зелёный, число тестов выросло относительно 1791
- [ ] `npm run typecheck` — все воркспейсы
- [ ] `npm run lint`
- [ ] `grep -rn "your_bot_username" admin/dist miniapp/dist` после сборки — пусто (фронты собираются только с `VITE_BOT_USERNAME`)
- [ ] Ручная проверка бота на тестовом токене: «🐞 Проблема» → «🏠 В меню» → кнопки вернулись; «🐞 Проблема» → текст → «Записал» с кнопками; `/menu` из чистого чата
- [ ] Ledger (`docs/audit/ledger.md`) пополнен находками, всплывшими попутно, — если такие были
