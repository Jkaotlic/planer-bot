# Причёсывание мини-приложения — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать шесть заноз в Telegram mini-app: обращение по фамилии, невидимый «сегодня», отсутствие возврата к текущему периоду, вечно висящие завершённые обмены, спрятанные дни рождения и невозможность пересмотреть созданные сборы.

**Architecture:** Три слоя, снизу вверх. В БД — три новые nullable-колонки (`employees.preferred_name`, `birthday_campaigns.scheduled_send_on`, `birthday_campaigns.schedule_notified_at`). В `@planer/shared` — цепочка обращения и нормализация ввода, общие для сервера и клиента. В мини-аппе — четыре экрана и два новых переиспользуемых компонента. Вся вычислимая логика выносится в чистые функции (`normalizePreferredName`, `isCurrentPeriod`, `splitSwaps`, `formatDayLabelRelative`) и тестируется без рендера — в проекте нет jsdom, `vitest.config.ts` задаёт `environment: "node"`.

**Tech Stack:** TypeScript, React 18, Vite, `@telegram-apps/telegram-ui`, Hono, Drizzle ORM + better-sqlite3, Vitest, npm workspaces (`shared` / `server` / `miniapp` / `admin`).

**Спека:** [`docs/superpowers/specs/2026-07-29-miniapp-polish-design.md`](../specs/2026-07-29-miniapp-polish-design.md)

## Global Constraints

- **Бот никогда не пишет команде сам.** Всё, что уходит всем коллегам, инициируется тапом админа. Новый тик из Задачи 9 пишет ТОЛЬКО админам. Это правило описано в шапке `server/src/birthdays/birthday-service.ts` и не отменяется.
- **Имя не выводится из ФИО.** `displayName` в ростере — «Фамилия Имя», у добавленных вручную — наоборот. Ни `split(" ")[0]`, ни `[1]` не допускаются нигде в этой задаче. Причина — в докблоке `shared/src/address.ts`.
- **Все миграции аддитивные.** Только новые nullable-колонки. `null` в каждой обязан означать ровно нынешнее поведение.
- **Цвет не единственный носитель смысла.** Каждая новая подсветка дублируется текстом, формой или ARIA-атрибутом.
- **Тесты — `node`, не `jsdom`.** Рендер-тестов в проекте нет и в этой задаче не заводится. Логика тестируется как чистые функции.
- **Команды из корня репозитория:** `npm test` (весь Vitest), `npm run typecheck` (все четыре tsconfig).
- **Язык интерфейса — русский**, тон неформальный, на «ты». Смотри существующие строки как образец.
- **Формат коммитов:** `тип(область): что изменилось` в нижнем регистре, по-английски или по-русски — как в `git log`. Каждая задача заканчивается коммитом.

---

## Файловая структура

**Создаются:**

| Файл | Ответственность |
|---|---|
| `miniapp/src/components/BackToTodayButton.tsx` | Пилюля «Сегодня» / «Эта неделя». Инлайн-стили, чтобы работать внутри чужого CSS |
| `miniapp/src/components/SectionChips.tsx` | Прокручиваемая лента чипов админ-навигации |
| `miniapp/src/components/AddressField.tsx` | Поле «Как ко мне обращаться» с сохранением |
| `miniapp/src/lib/swaps.ts` | `splitSwaps` — раскладка обменов на три корзины |
| `miniapp/src/lib/swaps.test.ts` | Тесты к ней |
| `server/drizzle/00NN_*.sql` ×2 | Миграции (генерируются drizzle-kit) |

**Меняются:** `shared/src/address.ts`, `server/src/db/schema.ts`, `server/src/repo/employees.ts`, `server/src/birthdays/birthday-service.ts`, `server/src/birthdays/birthday-notice.ts`, `server/src/http/app.ts`, `miniapp/src/api/client.ts`, `miniapp/src/api/mock.ts`, `miniapp/src/lib/week.ts`, `miniapp/src/screens/MyShiftsScreen.tsx`, `miniapp/src/screens/SwapsScreen.tsx`, `miniapp/src/screens/TeamScreen.tsx`, `miniapp/src/screens/AdminScreen.tsx`, `miniapp/src/screens/team/TeamRangeNav.tsx`, `miniapp/src/screens/team/TeamWeekGrid.tsx`, `miniapp/src/screens/team/team-schedule.css`, `miniapp/src/screens/admin/AdminScheduleScreen.tsx`, `miniapp/src/screens/admin/AdminEmployeesScreen.tsx`, `miniapp/src/screens/admin/AdminBirthdays.tsx`, `miniapp/src/components/ShiftRow.tsx`, `miniapp/src/components/SwapRequestCard.tsx`, `miniapp/src/index.css`.

---

## Task 1: Обращение — схема, `addressOf`, нормализация

**Files:**
- Modify: `shared/src/address.ts`
- Modify: `shared/src/address.test.ts`
- Modify: `server/src/db/schema.ts:11-31` (таблица `employees`)
- Modify: `server/src/repo/employees.ts`
- Create: `server/drizzle/00NN_*.sql` (генерируется)

**Interfaces:**
- Produces: `addressOf({ preferredName?, tgFirstName?, displayName })`, `normalizePreferredName(raw: unknown)`, `PREFERRED_NAME_MAX`, `setPreferredName(db, id, preferredName)`, колонка `employees.preferredName`.

- [ ] **Step 1: Написать падающие тесты для `addressOf` и `normalizePreferredName`**

Дописать в конец `shared/src/address.test.ts` (существующие пять тестов не трогать — они остаются валидными):

```ts
  it("prefers the name the person chose over whatever Telegram has", () => {
    // The complaint this whole change exists for: his Telegram first name is
    // literally his surname in Latin.
    expect(addressOf({ preferredName: "Андрей", tgFirstName: "Petrov", displayName: "Петров Алексей" })).toBe("Андрей");
  });

  it("treats a blank chosen name as absent and falls through", () => {
    expect(addressOf({ preferredName: "   ", tgFirstName: "Кирилл", displayName: "Орлов Кирилл" })).toBe("Кирилл");
    expect(addressOf({ preferredName: null, tgFirstName: null, displayName: "Кузнецов Михаил" })).toBe("Кузнецов Михаил");
  });

  it("trims the chosen name", () => {
    expect(addressOf({ preferredName: " Андрей ", tgFirstName: null, displayName: "Петров Алексей" })).toBe("Андрей");
  });
});

describe("normalizePreferredName", () => {
  it("accepts a trimmed name", () => {
    expect(normalizePreferredName(" Андрей ")).toEqual({ ok: true, value: "Андрей" });
  });

  it("turns blank input into null, so «clear it» and «erase it» agree", () => {
    expect(normalizePreferredName("")).toEqual({ ok: true, value: null });
    expect(normalizePreferredName("   ")).toEqual({ ok: true, value: null });
    expect(normalizePreferredName(null)).toEqual({ ok: true, value: null });
  });

  it("rejects a non-string and an over-long name", () => {
    expect(normalizePreferredName(42)).toEqual({ ok: false });
    expect(normalizePreferredName("я".repeat(PREFERRED_NAME_MAX + 1))).toEqual({ ok: false });
  });

  it("accepts exactly the maximum", () => {
    const name = "я".repeat(PREFERRED_NAME_MAX);
    expect(normalizePreferredName(name)).toEqual({ ok: true, value: name });
  });
```

И поправить строку импорта в начале файла:

```ts
import { addressOf, normalizePreferredName, PREFERRED_NAME_MAX } from "./address";
```

Обрати внимание: блок `describe("addressOf")` закрывается внутри вставки (`});` перед `describe("normalizePreferredName"`), а закрывающая скобка старого блока в конце файла становится закрывающей для нового. Ничего лишнего дописывать не надо.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run shared/src/address.test.ts`
Expected: FAIL — `normalizePreferredName is not exported` / `PREFERRED_NAME_MAX is not defined`.

- [ ] **Step 3: Реализовать в `shared/src/address.ts`**

Заменить тело функции `addressOf` и дописать нормализатор. Докблок над `addressOf` сохранить, добавив в него абзац про новое поле:

```ts
/**
 * How to address a person, as opposed to how to list them.
 *
 * `displayName` comes from the roster file and is «Фамилия Имя» — correct for a
 * work roster, a column header or an export, and wrong the moment the bot says
 * hello. Taking its first word gives the SURNAME: «Привет, Петров» reads as a
 * roll-call, which is exactly the complaint this exists to fix.
 *
 * We cannot decline or reorder a name we were handed as one string, and we must
 * not guess: «Аня Смирнова» (added by hand in the bot) and «Петров Алексей» (from
 * the file) are the same shape with the parts the other way round.
 *
 * So we don't guess. Three sources, in order of how much they were chosen:
 *
 *   1. `preferredName` — what the person (or an admin) typed into «Как ко мне
 *      обращаться». Deliberate, so it wins.
 *   2. `tgFirstName` — what they called themselves in Telegram. Usually right,
 *      but not always: one of ours is «Petrov» there, and people linked before
 *      we started storing it have nothing here at all.
 *   3. `displayName` — the roster's full name. Formal, but never rude.
 */
export function addressOf(person: {
  preferredName?: string | null;
  tgFirstName?: string | null;
  displayName: string;
}): string {
  return person.preferredName?.trim() || person.tgFirstName?.trim() || person.displayName;
}

/** A phone-sized field, and a greeting is one word or two. */
export const PREFERRED_NAME_MAX = 64;

export type PreferredNameResult = { ok: true; value: string | null } | { ok: false };

/**
 * What the person typed → what we store. Blank and whitespace collapse to
 * `null`, so «стереть поле» and «очистить поле» cannot end up meaning different
 * things. Shared by the worker's own route and the admin's, because two copies
 * of a validation rule are two rules.
 */
export function normalizePreferredName(raw: unknown): PreferredNameResult {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > PREFERRED_NAME_MAX) return { ok: false };
  return { ok: true, value: trimmed };
}
```

`shared/src/index.ts` уже делает `export * from "./address"` — трогать его не нужно.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run shared/src/address.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Добавить колонку в схему**

В `server/src/db/schema.ts`, в таблицу `employees`, сразу после `tgFirstName: text(),` добавить:

```ts
  /** How this person asked to be addressed. Null → fall back to Telegram's name,
   *  then to the roster's. See `addressOf` in @planer/shared. */
  preferredName: text(),
```

- [ ] **Step 6: Сгенерировать миграцию**

Run: `npm run db:generate -w @planer/server`
Expected: создан `server/drizzle/0014_*.sql` с единственной строкой `ALTER TABLE \`employees\` ADD \`preferred_name\` text;` и обновлённые `meta/_journal.json` + `meta/0014_snapshot.json`.

Открыть сгенерированный `.sql` и глазами проверить, что там ровно один `ALTER TABLE ... ADD`. Если drizzle-kit сгенерировал что-то ещё (пересоздание таблицы, DROP) — остановиться и разобраться, а не коммитить: на проде живая база.

- [ ] **Step 7: Добавить сеттер в репозиторий**

В `server/src/repo/employees.ts`, рядом с `setBirthDate` (строка ~115):

```ts
/**
 * Sets or clears how this person is addressed. `null` hands the decision back to
 * `addressOf`'s fallback chain rather than storing an empty greeting.
 */
export function setPreferredName(db: Db, id: number, preferredName: string | null): Employee | undefined {
  return db.update(employees).set({ preferredName }).where(eq(employees.id, id)).returning().all()[0];
}
```

- [ ] **Step 8: Прогнать весь набор и типы**

Run: `npm test && npm run typecheck`
Expected: PASS. Существующие тесты не должны сломаться — колонка nullable, `addressOf` со старым объектом (без `preferredName`) ведёт себя как раньше.

- [ ] **Step 9: Коммит**

```bash
git add shared/src/address.ts shared/src/address.test.ts server/src/db/schema.ts server/src/repo/employees.ts server/drizzle
git commit -m "feat(address): имя, которое человек выбрал сам, важнее того, что знает телеграм"
```

---

## Task 2: Обращение — серверные роуты

**Files:**
- Modify: `server/src/http/app.ts:132-156` (`/api/me`, `PATCH /api/me/settings`), `:192` (`GET /api/admin/employees`), `:207-234` (`PATCH /api/admin/employees/:id`)
- Modify: `server/src/http/employees.test.ts`

**Interfaces:**
- Consumes: `addressOf`, `normalizePreferredName`, `PREFERRED_NAME_MAX`, `setPreferredName` из Задачи 1.
- Produces: `GET /api/me` → `{ id, displayName, address, preferredName, isAdmin, remindersEnabled }`; `PATCH /api/me/settings` → `{ remindersEnabled, preferredName, address }`; `GET /api/admin/employees` → строки с добавленным `address`; `PATCH /api/admin/employees/:id` принимает `preferredName`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `server/src/http/employees.test.ts`:

```ts
describe("preferred name", () => {
  it("greets by the chosen name, over Telegram's and over the roster's", async () => {
    const db = makeTestDb();
    worker(db, "Петров Алексей", 901);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 901);

    const before = await (await app.request("/api/me", bearer(token))).json();
    // `/api/auth` refreshes tgFirstName from the signed initData, which carries "T".
    expect(before.address).toBe("T");
    expect(before.preferredName).toBeNull();

    const saved = await app.request("/api/me/settings", authedJson(token, { preferredName: " Андрей " }, "PATCH"));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ preferredName: "Андрей", address: "Андрей" });

    const after = await (await app.request("/api/me", bearer(token))).json();
    expect(after.address).toBe("Андрей");
    expect(after.displayName).toBe("Петров Алексей"); // lists are untouched
  });

  it("accepts each settings field on its own — the route is a patch, not a form", async () => {
    const db = makeTestDb();
    worker(db, "Петров Алексей", 902);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 902);

    const onlyReminders = await app.request("/api/me/settings", authedJson(token, { remindersEnabled: false }, "PATCH"));
    expect(onlyReminders.status).toBe(200);
    expect(await onlyReminders.json()).toMatchObject({ remindersEnabled: false });

    const onlyName = await app.request("/api/me/settings", authedJson(token, { preferredName: "Андрей" }, "PATCH"));
    expect(onlyName.status).toBe(200);
    // Setting one must not quietly reset the other.
    expect(await onlyName.json()).toMatchObject({ remindersEnabled: false, preferredName: "Андрей" });
  });

  it("clears the name on blank, and refuses an over-long one", async () => {
    const db = makeTestDb();
    worker(db, "Петров Алексей", 903);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 903);

    await app.request("/api/me/settings", authedJson(token, { preferredName: "Андрей" }, "PATCH"));
    const cleared = await app.request("/api/me/settings", authedJson(token, { preferredName: "  " }, "PATCH"));
    expect(await cleared.json()).toMatchObject({ preferredName: null });

    const tooLong = await app.request("/api/me/settings", authedJson(token, { preferredName: "я".repeat(65) }, "PATCH"));
    expect(tooLong.status).toBe(400);
  });

  it("rejects an empty settings body", async () => {
    const db = makeTestDb();
    worker(db, "Петров Алексей", 904);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 904);
    expect((await app.request("/api/me/settings", authedJson(token, {}, "PATCH"))).status).toBe(400);
  });

  it("lets an admin set it for somebody who never will", async () => {
    // The case this exists for: workers linked before tgFirstName was stored have
    // nothing to fall back to but «Кузнецов Михаил».
    const db = makeTestDb();
    const mike = worker(db, "Кузнецов Михаил", 906);
    const app = createApp({ db, config });
    // 111 is in `config.adminTelegramIds`, so authing as it yields an admin token —
    // the same way every other admin test in this file gets one.
    const admin = await tokenFor(app, 111);

    const res = await app.request(`/api/admin/employees/${mike.id}`, authedJson(admin, { preferredName: "Михаил" }, "PATCH"));
    expect(res.status).toBe(200);
    expect(getEmployeeById(db, mike.id)!.preferredName).toBe("Михаил");

    const { employees } = await (await app.request("/api/admin/employees", bearer(admin))).json();
    expect(employees.find((e: { id: number }) => e.id === mike.id).address).toBe("Михаил");
    expect(listRecentAudit(db, 10).some((row) => row.action === "employee_updated")).toBe(true);
  });
});
```

Новых импортов не нужно: `worker`, `tokenFor`, `bearer`, `authedJson`, `getEmployeeById` и `listRecentAudit` в этом файле уже есть.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run server/src/http/employees.test.ts -t "preferred name"`
Expected: FAIL — `preferredName` отсутствует в ответе `/api/me`, `PATCH` с одним `preferredName` отдаёт 400.

- [ ] **Step 3: Расширить `/api/me`**

В `server/src/http/app.ts` в теле `app.get("/api/me", …)` добавить одно поле в возвращаемый объект, после `address`:

```ts
      address: addressOf(me),
      /** What they typed into «Как ко мне обращаться», so the field can show it. */
      preferredName: me.preferredName,
```

- [ ] **Step 4: Сделать `PATCH /api/me/settings` частичным**

Заменить целиком тело роута (`server/src/http/app.ts:148-156`):

```ts
  /** The settings a worker owns about themselves. Scoped to the caller by the
   *  token: there is no employee id in the path, so nobody can touch anybody else.
   *  A patch, not a form — the two fields live on different screens and are saved
   *  by different gestures, so either may arrive alone. */
  app.patch("/api/me/settings", requireAuth(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { remindersEnabled?: unknown; preferredName?: unknown };
    const hasReminders = body.remindersEnabled !== undefined;
    const hasPreferred = body.preferredName !== undefined;
    if (!hasReminders && !hasPreferred) return c.json({ error: "нечего сохранять" }, 400);
    if (hasReminders && typeof body.remindersEnabled !== "boolean") {
      return c.json({ error: "remindersEnabled должен быть true или false" }, 400);
    }
    const preferred = hasPreferred ? normalizePreferredName(body.preferredName) : null;
    if (preferred && !preferred.ok) {
      return c.json({ error: `Обращение — не длиннее ${PREFERRED_NAME_MAX} символов` }, 400);
    }

    const id = c.get("auth").employeeId;
    let employee = getEmployeeById(db, id);
    if (!employee) return c.json({ error: "not_found" }, 404);
    if (hasReminders) employee = setRemindersEnabled(db, id, body.remindersEnabled as boolean) ?? employee;
    if (preferred?.ok) employee = setPreferredName(db, id, preferred.value) ?? employee;

    return c.json({
      remindersEnabled: employee.remindersEnabled,
      preferredName: employee.preferredName,
      // Returned so the greeting can update without a second round trip.
      address: addressOf(employee),
    });
  });
```

Добавить в импорты из `../repo/employees`: `setPreferredName`. Добавить в импорты из `@planer/shared`: `normalizePreferredName`, `PREFERRED_NAME_MAX`. (`addressOf` и `getEmployeeById` там уже есть.)

- [ ] **Step 5: Отдавать действующее обращение в списке работников**

Заменить `server/src/http/app.ts:192`:

```ts
  // `address` is computed, not stored: the admin card shows what the bot will
  // actually say, so it is obvious whose greeting still needs setting.
  app.get("/api/admin/employees", requireAdmin(db, config.jwtSecret), (c) =>
    c.json({ employees: listActive(db).map((employee) => ({ ...employee, address: addressOf(employee) })) }));
```

- [ ] **Step 6: Принять `preferredName` в админском PATCH**

В `app.patch("/api/admin/employees/:id", …)` заменить разбор тела и применение:

```ts
    const body = (await c.req.json().catch(() => ({}))) as { displayName?: unknown; birthDate?: unknown; preferredName?: unknown };
    const hasName = body.displayName !== undefined;
    const hasBirthday = body.birthDate !== undefined;
    const hasPreferred = body.preferredName !== undefined;
    if (!hasName && !hasBirthday && !hasPreferred) return c.json({ error: "displayName is required" }, 400);

    if (hasName && (typeof body.displayName !== "string" || body.displayName.trim().length === 0)) {
      return c.json({ error: "displayName is required" }, 400);
    }
    // null clears it — nobody is obliged to give a birthday.
    if (hasBirthday && body.birthDate !== null && (typeof body.birthDate !== "string" || !isBirthDate(body.birthDate))) {
      return c.json({ error: "birthDate должен быть в виде ММ-ДД, например 05-08" }, 400);
    }
    const preferred = hasPreferred ? normalizePreferredName(body.preferredName) : null;
    if (preferred && !preferred.ok) {
      return c.json({ error: `Обращение — не длиннее ${PREFERRED_NAME_MAX} символов` }, 400);
    }

    let employee = getEmployeeById(db, id);
    if (!employee) return c.json({ error: "not_found" }, 404);
    if (hasName) employee = renameEmployee(db, id, (body.displayName as string).trim()) ?? employee;
    if (hasBirthday) employee = setBirthDate(db, id, body.birthDate as string | null) ?? employee;
    if (preferred?.ok) employee = setPreferredName(db, id, preferred.value) ?? employee;

    recordAudit(db, "employee_updated", c.get("auth").employeeId, {
      employeeId: id,
      displayName: employee.displayName,
      ...(hasBirthday ? { birthDate: employee.birthDate } : {}),
      ...(hasPreferred ? { preferredName: employee.preferredName } : {}),
    });
    return c.json({ employee: { ...employee, address: addressOf(employee) } });
```

Строка ошибки `"displayName is required"` для пустого тела сохраняется намеренно — на неё уже могут ссылаться существующие тесты.

- [ ] **Step 7: Убедиться, что тесты проходят**

Run: `npx vitest run server/src/http/employees.test.ts`
Expected: PASS, включая пять новых.

- [ ] **Step 8: Прогнать весь набор**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Коммит**

```bash
git add server/src/http/app.ts server/src/http/employees.test.ts
git commit -m "feat(api): обращение правит и сам человек, и админ за того, кто не дойдёт"
```

---

## Task 3: Обращение — мини-апп

**Files:**
- Modify: `miniapp/src/api/client.ts` (интерфейсы `Me`, `Employee`, `ApiClient`; реализации)
- Modify: `miniapp/src/api/mock.ts` (`MOCK_ME`, `mockSetRemindersEnabled`, новые моки)
- Create: `miniapp/src/components/AddressField.tsx`
- Modify: `miniapp/src/screens/MyShiftsScreen.tsx`
- Modify: `miniapp/src/App.tsx:190-199` (проброс обновления `me`)
- Modify: `miniapp/src/screens/admin/AdminEmployeesScreen.tsx`

**Interfaces:**
- Consumes: `/api/me`, `PATCH /api/me/settings`, `PATCH /api/admin/employees/:id`, `GET /api/admin/employees` из Задачи 2.
- Produces: `apiClient.setPreferredName`, `apiClient.setEmployeePreferredName`, компонент `AddressField`.

- [ ] **Step 1: Расширить типы и клиент**

В `miniapp/src/api/client.ts` в интерфейс `Me` добавить после `address`:

```ts
  /** What they typed into «Как ко мне обращаться». Null → `address` came from
   *  Telegram or from the roster. */
  preferredName: string | null;
```

В интерфейс `Employee` добавить:

```ts
  /** Set by the worker or by an admin; null falls back through Telegram to the roster. */
  preferredName: string | null;
  /** What the bot will actually call them — computed server-side by `addressOf`. */
  address: string;
```

В интерфейс `ApiClient` рядом с `setRemindersEnabled` добавить:

```ts
  /** `null` clears it and hands the greeting back to Telegram's name. */
  setPreferredName(preferredName: string | null): Promise<{ preferredName: string | null; address: string }>;
```

и рядом с `renameEmployee`:

```ts
  setEmployeePreferredName(id: number, preferredName: string | null): Promise<void>;
```

Реализации — рядом с соответствующими существующими:

```ts
  setPreferredName: (preferredName) =>
    authorizedPatchJson<{ preferredName: string | null; address: string }>("/api/me/settings", { preferredName }),
```

```ts
  async setEmployeePreferredName(id, preferredName) {
    await authorizedPatchJson(`/api/admin/employees/${id}`, { preferredName });
  },
```

- [ ] **Step 2: Обновить моки**

В `miniapp/src/api/mock.ts`:

`MOCK_ME` получает поле (комментарий над `address` оставить):

```ts
export const MOCK_ME: Me = {
  id: 1,
  displayName: "Аня Смирнова",
  // Telegram's own first name — deliberately NOT derived from displayName, which
  // in the live roster is «Фамилия Имя». See `addressOf` in @planer/shared.
  address: "Аня",
  preferredName: null,
  isAdmin: true,
  remindersEnabled: true,
};
```

Добавить рядом с `mockSetRemindersEnabled`:

```ts
export async function mockSetPreferredName(preferredName: string | null): Promise<{ preferredName: string | null; address: string }> {
  await delay(200);
  const value = preferredName?.trim() || null;
  MOCK_ME.preferredName = value;
  // Mirrors `addressOf`: chosen name, then Telegram's, then the roster's.
  MOCK_ME.address = value ?? "Аня";
  return { preferredName: value, address: MOCK_ME.address };
}

export async function mockSetEmployeePreferredName(id: number, preferredName: string | null): Promise<void> {
  await delay(200);
  const employee = EMPLOYEES.find((e) => e.id === id);
  if (!employee) return;
  employee.preferredName = preferredName?.trim() || null;
  employee.address = employee.preferredName ?? employee.displayName;
}
```

Заменить массив `EMPLOYEES` (`miniapp/src/api/mock.ts:70-78`) целиком — у всех семи записей появляются два поля:

```ts
const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: true, isActive: true, telegramUserId: 100001, birthDate: "03-14", preferredName: null, address: "Аня Смирнова" },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 100002, birthDate: "08-05", preferredName: null, address: "Игорь Петров" },
  { id: 3, displayName: "Марк Волков", isAdmin: false, isActive: true, telegramUserId: null, birthDate: null, preferredName: null, address: "Марк Волков" },
  { id: 4, displayName: "Даша Кузнецова", isAdmin: false, isActive: true, telegramUserId: 100004, birthDate: "12-31", preferredName: null, address: "Даша Кузнецова" },
  { id: 5, displayName: "Олег Соколов", isAdmin: false, isActive: true, telegramUserId: 100005, birthDate: null, preferredName: null, address: "Олег Соколов" },
  { id: 6, displayName: "Света Орлова", isAdmin: false, isActive: false, telegramUserId: 100006, birthDate: null, preferredName: null, address: "Света Орлова" },
  { id: 7, displayName: "Нина Белова", isAdmin: false, isActive: true, telegramUserId: 100007, birthDate: "02-29", preferredName: null, address: "Нина Белова" },
];
```

Прописать оба мока в `devClient` (`miniapp/src/api/client.ts:870`) — рядом с соответствующими существующими строками:

```ts
  setPreferredName: (preferredName) => mockSetPreferredName(preferredName),
```
```ts
  setEmployeePreferredName: (id, preferredName) => mockSetEmployeePreferredName(id, preferredName),
```

и добавить `mockSetPreferredName`, `mockSetEmployeePreferredName` в блок импорта из `./mock` в начале `client.ts` (строки 4-43).

- [ ] **Step 3: Создать `AddressField`**

Create `miniapp/src/components/AddressField.tsx`:

```tsx
import { useState } from "react";
import { Button, Input } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";

/**
 * «Как ко мне обращаться» — the one thing a worker can tell the bot about
 * themselves besides the reminders switch.
 *
 * It exists because neither source we had is reliable: the roster is «Фамилия
 * Имя» and cannot be split without guessing, and a Telegram first name can be a
 * surname in Latin («Petrov») or missing entirely. So we ask.
 *
 * Saved by an explicit button, not on blur: this is the string the bot will use
 * in every message, and a half-typed name committed by a stray tap is worse than
 * one extra press.
 */
export function AddressField({
  preferredName,
  address,
  onSaved,
}: {
  preferredName: string | null;
  /** What the bot says today — shown as the placeholder when nothing is set. */
  address: string;
  onSaved: (next: { preferredName: string | null; address: string }) => void;
}) {
  const [draft, setDraft] = useState(preferredName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();
  const changed = trimmed !== (preferredName ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await apiClient.setPreferredName(trimmed || null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "10px 20px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <Input
        header="Как ко мне обращаться"
        placeholder={address}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.4 }}>
        Так бот будет здороваться и подписывать напоминания. Оставь пустым — вернётся имя из Telegram.
      </div>
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>}
      <Button size="s" mode="filled" stretched loading={busy} disabled={busy || !changed} onClick={() => void save()}>
        Сохранить
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Подключить в «Мои смены»**

В `miniapp/src/screens/MyShiftsScreen.tsx`:

Импорт: `import { AddressField } from "../components/AddressField";`

В `MyShiftsScreenProps` добавить:

```ts
  /** Keeps `me` in step when the greeting name is saved. */
  onAddressChanged: (next: { preferredName: string | null; address: string }) => void;
```

В сигнатуру функции добавить `onAddressChanged`, и после секции «Уведомления» дописать:

```tsx
      <List>
        <Section header="Обращение">
          <AddressField
            preferredName={me.preferredName}
            address={me.address}
            onSaved={onAddressChanged}
          />
        </Section>
      </List>
```

В `miniapp/src/App.tsx` в рендер `<MyShiftsScreen …>` добавить проп рядом с `onRemindersChanged`:

```tsx
          onAddressChanged={({ preferredName, address }) =>
            setData((prev) => (prev ? { ...prev, me: { ...prev.me, preferredName, address } } : prev))
          }
```

- [ ] **Step 5: Подключить в админскую карточку работника**

В `miniapp/src/screens/admin/AdminEmployeesScreen.tsx`:

`EmployeeRow` получает ещё один необязательный проп — рядом с `onRename`:

```ts
  /** When provided, an admin can set how the bot addresses this worker. */
  onPreferredName?: (preferredName: string | null) => void;
```

Внутри `EmployeeRow` рядом с состоянием `editing` завести второе:

```ts
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState(employee.preferredName ?? "");
```

Перед существующим `if (editing)` добавить ветку:

```tsx
  if (editingAddress) {
    return (
      <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <Input
          header="Обращение"
          placeholder={employee.address}
          value={addressDraft}
          disabled={busy}
          onChange={(e) => setAddressDraft(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="s"
            mode="filled"
            stretched
            loading={busy}
            disabled={busy}
            onClick={() => {
              onPreferredName?.(addressDraft.trim() || null);
              setEditingAddress(false);
            }}
          >
            Сохранить
          </Button>
          <Button size="s" mode="gray" disabled={busy} onClick={() => { setAddressDraft(employee.preferredName ?? ""); setEditingAddress(false); }}>
            Отмена
          </Button>
        </div>
      </div>
    );
  }
```

В блоке с ФИО, сразу под `<div>{employee.displayName}</div>`, добавить строку с действующим обращением:

```tsx
          {/* What the bot will actually say. Shown always, not «when it differs
              from the first word of displayName» — guessing which word is the
              given name is exactly what this whole change refuses to do. */}
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5 }}>Бот зовёт: {employee.address}</div>
```

В ряд кнопок, сразу после кнопки `✎ Имя`:

```tsx
        {onPreferredName && (
          <Button size="s" mode="bezeled" disabled={busy} onClick={() => { setAddressDraft(employee.preferredName ?? ""); setEditingAddress(true); }}>
            ✎ Обращение
          </Button>
        )}
```

И передать проп у обоих вызовов `EmployeeRow` (активные и архивные):

```tsx
                onPreferredName={(preferredName) => withBusy(e.id, () => apiClient.setEmployeePreferredName(e.id, preferredName))}
```

- [ ] **Step 6: Проверить типы и сборку**

Run: `npm run typecheck && npm test`
Expected: PASS. Если `typecheck` ругается на недостающие `preferredName`/`address` в моках — дозаполнить записи `EMPLOYEES`, это и есть цель шага.

- [ ] **Step 7: Коммит**

```bash
git add miniapp/src
git commit -m "feat(miniapp): «Привет, Petrov» больше не здоровается ни с кем"
```

---

## Task 4: Подсветка текущего дня

**Files:**
- Modify: `miniapp/src/lib/week.ts`
- Create: `miniapp/src/lib/week.test.ts` (файла нет — создаётся)
- Modify: `miniapp/src/components/ShiftRow.tsx`
- Modify: `miniapp/src/screens/MyShiftsScreen.tsx`
- Modify: `miniapp/src/screens/TeamScreen.tsx:106-113`
- Modify: `miniapp/src/screens/team/team-schedule.css:150-152`
- Modify: `miniapp/src/screens/team/TeamWeekGrid.tsx:50-60`
- Modify: `miniapp/src/screens/admin/AdminScheduleScreen.tsx:259-297`

**Interfaces:**
- Produces: `formatDayLabelRelative(iso, today)`, `ShiftRow` с пропом `isToday`, `DayChip` с пропом `isToday`, CSS-класс `.team-week__day.is-today` / `.team-week__cell.is-today`.

- [ ] **Step 1: Написать падающий тест на подпись дня**

Create `miniapp/src/lib/week.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatDayLabel, formatDayLabelRelative } from "./week";

describe("formatDayLabelRelative", () => {
  it("says «Сегодня» when the shown day is today", () => {
    expect(formatDayLabelRelative("2026-07-29", "2026-07-29")).toBe("Сегодня, Ср 29 июля");
  });

  it("reads exactly like the plain label on any other day", () => {
    expect(formatDayLabelRelative("2026-07-30", "2026-07-29")).toBe(formatDayLabel("2026-07-30"));
    expect(formatDayLabelRelative("2026-07-28", "2026-07-29")).toBe(formatDayLabel("2026-07-28"));
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run miniapp/src/lib/week.test.ts`
Expected: FAIL — `formatDayLabelRelative is not exported`.

- [ ] **Step 3: Реализовать в `miniapp/src/lib/week.ts`**

Дописать сразу после `formatDayLabel`:

```ts
/**
 * "Сегодня, Ср 29 июля" on the current day, "Чт, 30 июля" on any other.
 *
 * `today` is passed in rather than read from the clock so the function stays
 * pure and testable — the screens hand it `toISODate(new Date())`.
 */
export function formatDayLabelRelative(iso: string, today: string): string {
  if (iso !== today) return formatDayLabel(iso);
  return `Сегодня, ${weekdayShort(iso)} ${monthDayFormatter.format(parseISODate(iso))}`;
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npx vitest run miniapp/src/lib/week.test.ts`
Expected: PASS.

- [ ] **Step 5: Подсветить сегодняшнюю строку в «Мои смены»**

В `miniapp/src/components/ShiftRow.tsx` добавить проп и обёртку. Интерфейс:

```ts
  /** Today's row is marked: an accent rail on the left and a «Сегодня» chip. */
  isToday?: boolean;
```

Тело компонента заменить на:

```tsx
export function ShiftRow({ shift, templates, onSwap, isToday }: ShiftRowProps) {
  const isSwappable = shift.category === "shift";

  return (
    <div
      style={
        isToday
          ? {
              // A rail rather than a filled row: the entry chip inside already
              // carries the preset's colour, and two backgrounds fight.
              boxShadow: "inset 3px 0 var(--tgui--link_color)",
              background: "color-mix(in srgb, var(--tgui--link_color) 7%, transparent)",
            }
          : undefined
      }
    >
      <Cell
        before={<DayBadge date={shift.date} endDate={shift.endDate} />}
        // The chip already names the entry ("Утро" / "Отпуск"), so it stands in for
        // the subtitle that used to repeat that same label right above it. Unlike
        // the old category chip it shows on every row, since a work shift's preset
        // is exactly what the colour is here to tell apart.
        description={<EntryChip entry={shift} templates={templates} />}
        after={isSwappable && onSwap ? <SwapChip onClick={() => onSwap(shift)} /> : undefined}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {formatTimeRange(shift)}
          {isToday && <TodayChip />}
        </span>
      </Cell>
    </div>
  );
}

/** The text half of the "today" signal — colour is never the only carrier. */
function TodayChip() {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.2,
        borderRadius: 999,
        padding: "2px 8px",
        color: "var(--tgui--button_text_color)",
        background: "var(--tgui--link_color)",
      }}
    >
      Сегодня
    </span>
  );
}
```

В `miniapp/src/screens/MyShiftsScreen.tsx` вычислить сегодня и передать. Импорт `toISODate` добавить к существующему импорту из `../lib/week`:

```tsx
  const today = toISODate(new Date());
```

и в `.map`:

```tsx
              <ShiftRow key={shift.id} shift={shift} templates={templates} onSwap={onProposeSwap} isToday={shift.date === today} />
```

- [ ] **Step 6: Сказать «Сегодня» в заголовке «Команда → Сегодня»**

В `miniapp/src/screens/TeamScreen.tsx` заменить вычисление `label` (строки 107-113):

```tsx
  const today = toISODate(new Date());
  const label =
    view.displayMode === "today"
      ? formatDayLabelRelative(view.displayDate, today)
      : formatWeekRangeLabel(
          parseISODate(displayRange.from),
          parseISODate(displayRange.to),
        );
```

и добавить `formatDayLabelRelative` в импорт из `../lib/week`, убрав оттуда `formatDayLabel`, если он больше не используется (проверить: `grep -n "formatDayLabel\b" miniapp/src/screens/TeamScreen.tsx`).

- [ ] **Step 7: Подтонировать колонку сегодня в недельной сетке**

В `miniapp/src/screens/team/team-schedule.css` заменить правило `.team-week__day.is-today` (строки 150-152):

```css
.team-week__day.is-today {
  color: var(--tgui--text_color);
  font-weight: 700;
  background: color-mix(in srgb, var(--tgui--link_color) 18%, transparent);
  box-shadow: inset 0 3px var(--tgui--link_color);
}

/* The whole column, not just its header — on a phone a 3px rail above one of
   seven narrow columns is invisible. */
.team-week__cell.is-today {
  box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--tgui--link_color) 9%, transparent);
}

/* A coloured entry keeps its own preset colour: the tint would falsify it. The
   column is still marked by its header and by the empty cells around it. */
.team-week__cell.has-entry.is-today {
  box-shadow: inset 0 0 0 1.5px var(--tgui--link_color);
}
```

В `miniapp/src/screens/team/TeamWeekGrid.tsx` пробросить `today` в ячейки. Компонент `WeekCellButton` получает проп:

```tsx
function WeekCellButton({
  cell,
  employeeName,
  isDark,
  isToday,
  onOpen,
}: {
  cell: WeekCell;
  employeeName: string;
  isDark: boolean;
  isToday: boolean;
  onOpen: () => void;
}) {
```

в обеих ветках добавить класс — в пустой:

```tsx
        className={`team-week__cell${isWeekend(cell.date) ? " is-weekend" : ""}${isToday ? " is-today" : ""}`}
```

и в заполненной:

```tsx
        className={`team-week__cell has-entry${isWeekend(cell.date) ? " is-weekend" : ""}${isToday ? " is-today" : ""}`}
```

а в месте вызова:

```tsx
                <WeekCellButton
                  key={`${row.employeeId ?? "open"}:${cell.date}`}
                  cell={cell}
                  employeeName={row.displayName}
                  isDark={isDark}
                  isToday={cell.date === today}
                  onOpen={() => {
```

Заголовку колонки добавить ARIA — цвет в сетке единственный носитель, поэтому нужен машиночитаемый дубль. В `model.days.map`:

```tsx
            <div
              key={day}
              className={`team-week__day${day === today ? " is-today" : ""}${isWeekend(day) ? " is-weekend" : ""}`}
              data-date={day}
              aria-current={day === today ? "date" : undefined}
              role="columnheader"
            >
```

- [ ] **Step 8: Отметить сегодня в админской ленте дней**

В `miniapp/src/screens/admin/AdminScheduleScreen.tsx`:

`DayStrip` получает `today` и передаёт дальше:

```tsx
function DayStrip({ dates, selected, today, onSelect }: { dates: readonly string[]; selected: string; today: string; onSelect: (iso: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
      {dates.map((iso) => (
        <DayChip key={iso} iso={iso} active={iso === selected} isToday={iso === today} onSelect={() => onSelect(iso)} />
      ))}
    </div>
  );
}
```

`DayChip` рисует точку под числом:

```tsx
function DayChip({ iso, active, isToday, onSelect }: { iso: string; active: boolean; isToday: boolean; onSelect: () => void }) {
```

и в конце его разметки, после `<span>{dayOfMonth(iso)}</span>`:

```tsx
      {/* «Выбран» and «сегодня» were the same style, so three weeks out you
          could not tell where you were. The dot is drawn independently of the
          selection and stays visible on the selected chip too. */}
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: 999,
          background: isToday ? (active ? fg : "var(--tgui--link_color)") : "transparent",
        }}
        aria-hidden="true"
      />
```

Место вызова `DayStrip` (строка ~161) — добавить проп. Экран уже держит сегодняшнюю дату в начальном состоянии `selectedDate`, но она меняется; нужно отдельное значение:

```tsx
  const today = toISODate(new Date());
```

рядом с `weekDates` (строка ~65), и:

```tsx
          <DayStrip dates={weekDates} selected={selectedDate} today={today} onSelect={(d) => { setSelectedDate(d); setNotice(null); }} />
```

- [ ] **Step 9: Проверить**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Коммит**

```bash
git add miniapp/src
git commit -m "feat(miniapp): сегодня видно во всех четырёх местах, где есть дни"
```

---

## Task 5: Возврат к текущему периоду

**Files:**
- Modify: `miniapp/src/lib/week.ts`
- Modify: `miniapp/src/lib/week.test.ts`
- Create: `miniapp/src/components/BackToTodayButton.tsx`
- Modify: `miniapp/src/screens/team/TeamRangeNav.tsx`
- Modify: `miniapp/src/screens/TeamScreen.tsx`
- Modify: `miniapp/src/screens/admin/AdminScheduleScreen.tsx`

**Interfaces:**
- Consumes: `mondayOf`, `parseISODate`, `toISODate` из `lib/week`.
- Produces: `isCurrentPeriod(mode: "day" | "week", shownIso, todayIso)`, компонент `BackToTodayButton`, `TeamRangeNav` с пропами `backLabel` / `onBack`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `miniapp/src/lib/week.test.ts`:

```ts
import { isCurrentPeriod } from "./week";

describe("isCurrentPeriod", () => {
  it("in day mode, only the exact day counts as current", () => {
    expect(isCurrentPeriod("day", "2026-07-29", "2026-07-29")).toBe(true);
    expect(isCurrentPeriod("day", "2026-07-30", "2026-07-29")).toBe(false);
  });

  it("in week mode, any day of this week counts", () => {
    // 2026-07-29 is a Wednesday; its week runs Mon 27 — Sun 2 Aug.
    expect(isCurrentPeriod("week", "2026-07-27", "2026-07-29")).toBe(true);
    expect(isCurrentPeriod("week", "2026-08-02", "2026-07-29")).toBe(true);
    expect(isCurrentPeriod("week", "2026-08-03", "2026-07-29")).toBe(false);
    expect(isCurrentPeriod("week", "2026-07-26", "2026-07-29")).toBe(false);
  });
});
```

Импорт `isCurrentPeriod` добавить в уже существующую строку импорта из `./week`, а не новой строкой.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run miniapp/src/lib/week.test.ts -t isCurrentPeriod`
Expected: FAIL — `isCurrentPeriod is not exported`.

- [ ] **Step 3: Реализовать**

Дописать в конец `miniapp/src/lib/week.ts`:

```ts
/**
 * Does the shown period already contain today? The "back to today" affordance
 * hides when it does, so it never occupies space it cannot use.
 *
 * Both arguments are "YYYY-MM-DD"; `today` is passed in rather than read from
 * the clock, so this stays pure.
 */
export function isCurrentPeriod(mode: "day" | "week", shownIso: string, todayIso: string): boolean {
  if (mode === "day") return shownIso === todayIso;
  return toISODate(mondayOf(parseISODate(shownIso))) === toISODate(mondayOf(parseISODate(todayIso)));
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npx vitest run miniapp/src/lib/week.test.ts`
Expected: PASS.

- [ ] **Step 5: Создать компонент**

Create `miniapp/src/components/BackToTodayButton.tsx`:

```tsx
/**
 * «Сегодня» / «Эта неделя» — one tap back from wherever the calendar was left.
 *
 * Styled inline rather than by class on purpose. It is rendered inside
 * `.team-range-nav`, whose own `button` rule sets `min-height: 40px` and
 * `font-size: 28px` for the chevrons; a class would lose that specificity
 * fight, and inline styles win it without a `!important` or a longer selector.
 */
export function BackToTodayButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: 26,
        border: 0,
        borderRadius: 999,
        padding: "0 12px",
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: "26px",
        whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        color: "var(--tgui--button_text_color)",
        background: "var(--tgui--button_color)",
      }}
    >
      ↩ {label}
    </button>
  );
}
```

- [ ] **Step 6: Встроить в `TeamRangeNav`**

Заменить `miniapp/src/screens/team/TeamRangeNav.tsx` целиком:

```tsx
import { BackToTodayButton } from "../../components/BackToTodayButton";

export function TeamRangeNav({
  label,
  busy,
  backLabel,
  onBack,
  onPrevious,
  onNext,
}: {
  label: string;
  busy: boolean;
  /** «Сегодня» or «Эта неделя». */
  backLabel: string;
  /** Omit when the shown period already is the current one — the pill hides. */
  onBack?: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="team-range-nav">
      <button
        type="button"
        aria-label="Предыдущий период"
        disabled={busy}
        onClick={onPrevious}
      >
        ‹
      </button>
      <div className="team-range-nav__center">
        <strong aria-live="polite">{label}</strong>
        {onBack && <BackToTodayButton label={backLabel} disabled={busy} onClick={onBack} />}
      </div>
      <button
        type="button"
        aria-label="Следующий период"
        disabled={busy}
        onClick={onNext}
      >
        ›
      </button>
    </div>
  );
}
```

В `miniapp/src/screens/team/team-schedule.css` дописать после блока `.team-range-nav button`:

```css
.team-range-nav__center {
  display: grid;
  justify-items: center;
  gap: 4px;
  min-width: 0;
}
```

- [ ] **Step 7: Подключить в `TeamScreen`**

В `miniapp/src/screens/TeamScreen.tsx` заменить рендер `<TeamRangeNav …>`:

```tsx
        <TeamRangeNav
          label={label}
          busy={view.loading}
          backLabel={view.displayMode === "today" ? "Сегодня" : "Эта неделя"}
          onBack={
            isCurrentPeriod(view.displayMode === "today" ? "day" : "week", view.displayDate, today)
              ? undefined
              : () => { if (!view.loading) void load(view.displayMode, today); }
          }
          onPrevious={() => move(-1)}
          onNext={() => move(1)}
        />
```

Добавить `isCurrentPeriod` в импорт из `../lib/week`. Переменная `today` уже объявлена в Задаче 4, шаг 6.

- [ ] **Step 8: Подключить в админ-расписании**

В `miniapp/src/screens/admin/AdminScheduleScreen.tsx` заменить `WeekBar`:

```tsx
function WeekBar({ label, backVisible, onBack, onPrev, onNext }: {
  label: string;
  /** False when the shown week already contains today. */
  backVisible: boolean;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
      <Button size="s" mode="gray" onClick={onPrev} aria-label="Прошлая неделя">
        ‹
      </Button>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{label}</span>
        {backVisible && <BackToTodayButton label="Эта неделя" onClick={onBack} />}
      </span>
      <Button size="s" mode="gray" onClick={onNext} aria-label="Следующая неделя">
        ›
      </Button>
    </div>
  );
}
```

Добавить функцию возврата рядом с `goWeek` (строка ~115):

```tsx
  /** Back to the current week AND to today. Returning to the week but leaving the
   *  selection on, say, Thursday would drop the admin on a day they never picked. */
  function goToday() {
    const todayIso = toISODate(new Date());
    setWeekStart(mondayOf(new Date()));
    setSelectedDate(todayIso);
    setNotice(null);
  }
```

Место вызова (строка ~160):

```tsx
          <WeekBar
            label={formatWeekRangeLabel(weekStart, addDays(weekStart, 6))}
            backVisible={!isCurrentPeriod("week", toISODate(weekStart), today)}
            onBack={goToday}
            onPrev={() => goWeek(-1)}
            onNext={() => goWeek(1)}
          />
```

Импорты: `BackToTodayButton` из `../../components/BackToTodayButton`, `isCurrentPeriod` добавить к существующему импорту из `../../lib/week`.

- [ ] **Step 9: Проверить**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Коммит**

```bash
git add miniapp/src
git commit -m "feat(miniapp): из любой точки календаря один тап домой"
```

---

## Task 6: Архив обменов

**Files:**
- Create: `miniapp/src/lib/swaps.ts`
- Create: `miniapp/src/lib/swaps.test.ts`
- Modify: `miniapp/src/components/SwapRequestCard.tsx`
- Modify: `miniapp/src/screens/SwapsScreen.tsx`

**Interfaces:**
- Consumes: тип `SwapRequest` из `miniapp/src/api/client.ts`.
- Produces: `splitSwaps(swaps): SwapBuckets`, компонент `ArchivedSwapCard`.

- [ ] **Step 1: Написать падающий тест**

Create `miniapp/src/lib/swaps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SwapRequest } from "../api/client";
import { splitSwaps } from "./swaps";

const swap = (id: number, direction: SwapRequest["direction"], status: SwapRequest["status"]): SwapRequest => ({
  id,
  direction,
  status,
  message: null,
  createdAt: `2026-07-${String(id).padStart(2, "0")}T10:00:00.000Z`,
  counterpartyName: `Коллега ${id}`,
  yourShift: null,
  theirShift: null,
});

describe("splitSwaps", () => {
  it("keeps only what still needs an answer in the two live buckets", () => {
    const buckets = splitSwaps([
      swap(1, "incoming", "pending"),
      swap(2, "outgoing", "pending"),
      swap(3, "incoming", "accepted"),
      swap(4, "outgoing", "declined"),
    ]);
    expect(buckets.incoming.map((s) => s.id)).toEqual([1]);
    expect(buckets.outgoing.map((s) => s.id)).toEqual([2]);
  });

  it("archives every settled request from both sides", () => {
    // The hole this closes: a settled INCOMING request used to be visible
    // nowhere at all, so half the history was missing.
    const buckets = splitSwaps([
      swap(3, "incoming", "accepted"),
      swap(4, "outgoing", "declined"),
      swap(5, "incoming", "cancelled"),
      swap(6, "outgoing", "expired"),
    ]);
    expect(buckets.archived.map((s) => s.id)).toEqual([6, 5, 4, 3]);
    expect(buckets.incoming).toEqual([]);
    expect(buckets.outgoing).toEqual([]);
  });

  it("orders the archive newest first", () => {
    const buckets = splitSwaps([swap(3, "incoming", "accepted"), swap(9, "outgoing", "declined")]);
    expect(buckets.archived.map((s) => s.id)).toEqual([9, 3]);
  });

  it("handles an empty list", () => {
    expect(splitSwaps([])).toEqual({ incoming: [], outgoing: [], archived: [] });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run miniapp/src/lib/swaps.test.ts`
Expected: FAIL — `Cannot find module './swaps'`.

- [ ] **Step 3: Реализовать**

Create `miniapp/src/lib/swaps.ts`:

```ts
import type { SwapRequest } from "../api/client";

export interface SwapBuckets {
  /** Somebody is waiting on YOUR answer. */
  incoming: SwapRequest[];
  /** You are waiting on THEIRS. */
  outgoing: SwapRequest[];
  /** Settled, either way round — newest first. */
  archived: SwapRequest[];
}

/**
 * Three buckets from one list.
 *
 * The archive is derived from `status`, not stored: a request is settled or it
 * isn't, and a second source of truth for that could only ever disagree with the
 * first. Nothing new goes to the server.
 *
 * It also closes a hole. The screen used to keep incoming requests only while
 * they were pending, so an accepted or declined one vanished the moment it was
 * answered — the history was outgoing-only.
 */
export function splitSwaps(swaps: readonly SwapRequest[]): SwapBuckets {
  const buckets: SwapBuckets = { incoming: [], outgoing: [], archived: [] };
  for (const swap of swaps) {
    if (swap.status !== "pending") buckets.archived.push(swap);
    else if (swap.direction === "incoming") buckets.incoming.push(swap);
    else buckets.outgoing.push(swap);
  }
  buckets.archived.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return buckets;
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npx vitest run miniapp/src/lib/swaps.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Добавить read-only карточку**

Дописать в конец `miniapp/src/components/SwapRequestCard.tsx`:

```tsx
export interface ArchivedSwapCardProps {
  request: SwapRequest;
}

/**
 * A settled swap, either direction. No buttons: there is nothing left to accept,
 * decline or cancel, and the past tense in the labels says so without a chip.
 */
export function ArchivedSwapCard({ request }: ArchivedSwapCardProps) {
  const outgoing = request.direction === "outgoing";
  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{request.counterpartyName}</div>
        <SwapStatusPill status={request.status} />
      </div>
      <SwapDirectionLine
        label={outgoing ? "Ты отдавал →" : "Коллега отдавал →"}
        shift={outgoing ? request.yourShift : request.theirShift}
      />
      <SwapDirectionLine
        label={outgoing ? "Взамен просил →" : "Взамен просил твою →"}
        shift={outgoing ? request.theirShift : request.yourShift}
      />
      {request.message && <MessageBubble message={request.message} />}
    </CardShell>
  );
}
```

- [ ] **Step 6: Перестроить экран**

Заменить `miniapp/src/screens/SwapsScreen.tsx` целиком:

```tsx
import { useState, type ReactNode } from "react";
import { Button, List, Placeholder, Section, Title } from "@telegram-apps/telegram-ui";
import type { SwapRequest } from "../api/client";
import { ArchivedSwapCard, IncomingSwapCard, OutgoingSwapCard } from "../components/SwapRequestCard";
import { ScreenScroll } from "../components/ScreenScroll";
import { splitSwaps } from "../lib/swaps";

export interface SwapsScreenProps {
  swaps: SwapRequest[];
  onAccept: (id: number) => void;
  onDecline: (id: number) => void;
  onCancel: (id: number) => void;
  /** The id of the request currently being mutated, if any — disables its own buttons while the request is in flight. */
  busyId: number | null;
}

/** "Обмены": what still needs an answer, split from what is already settled. */
export function SwapsScreen({ swaps, onAccept, onDecline, onCancel, busyId }: SwapsScreenProps) {
  const { incoming, outgoing, archived } = splitSwaps(swaps);
  // Collapsed by default — the whole point is that finished swaps stop competing
  // for attention with the ones that still need something.
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <ScreenScroll>
      <header style={{ margin: "8px 4px 20px" }}>
        <Title level="2" weight="2">
          Обмены
        </Title>
      </header>

      <List>
        <Section header="Входящие">
          {incoming.length === 0 ? (
            <Placeholder description="Пока нет заявок на обмен" />
          ) : (
            <CardStack>
              {incoming.map((request) => (
                <IncomingSwapCard
                  key={request.id}
                  request={request}
                  busy={busyId === request.id}
                  onAccept={() => onAccept(request.id)}
                  onDecline={() => onDecline(request.id)}
                />
              ))}
            </CardStack>
          )}
        </Section>

        <Section header="Мои заявки">
          {outgoing.length === 0 ? (
            <Placeholder description="Пока нет заявок на обмен" />
          ) : (
            <CardStack>
              {outgoing.map((request) => (
                <OutgoingSwapCard
                  key={request.id}
                  request={request}
                  busy={busyId === request.id}
                  onCancel={() => onCancel(request.id)}
                />
              ))}
            </CardStack>
          )}
        </Section>

        {/* An empty archive draws nothing at all — an empty section would be one
            more thing to read past. */}
        {archived.length > 0 && (
          <Section header={`Архив · ${archived.length}`}>
            <CardStack>
              <Button size="s" mode="gray" stretched onClick={() => setArchiveOpen(!archiveOpen)}>
                {archiveOpen ? "Свернуть" : "Показать завершённые"}
              </Button>
              {archiveOpen && archived.map((request) => <ArchivedSwapCard key={request.id} request={request} />)}
            </CardStack>
          </Section>
        )}
      </List>
    </ScreenScroll>
  );
}

/** Vertically stacked cards with breathing room between them — wraps in a single
 * element so `Section` doesn't mistake the cards for separate rows needing dividers. */
function CardStack({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px" }}>{children}</div>;
}
```

- [ ] **Step 7: Проверить**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
git add miniapp/src
git commit -m "feat(swaps): завершённые уезжают в архив, и наконец-то видны входящие из прошлого"
```

---

## Task 7: Админ-навигация лентой чипов, дни рождения — своя секция

**Files:**
- Create: `miniapp/src/components/SectionChips.tsx`
- Modify: `miniapp/src/screens/AdminScreen.tsx`
- Modify: `miniapp/src/screens/admin/AdminEmployeesScreen.tsx`
- Modify: `miniapp/src/screens/admin/AdminBirthdays.tsx`
- Modify: `miniapp/src/index.css:62-68`

**Interfaces:**
- Produces: `SectionChips<K>({ sections, active, onChange })`; `AdminBirthdays` без пропа `onClose`.

- [ ] **Step 1: Создать ленту чипов**

Create `miniapp/src/components/SectionChips.tsx`:

```tsx
import { useEffect, useRef } from "react";

/**
 * The admin tab's sub-navigation.
 *
 * Replaces a `SegmentedControl`, which could not carry five items: at four,
 * «Расписание» already rendered as «Расписа…», which is what the `.admin-sections`
 * padding hack in `index.css` existed to fight. A scrolling row of chips fits
 * five, and the sixth whenever it turns up.
 *
 * Always scrollable — it does not try to detect overflow and switch behaviour,
 * because the width it would measure depends on the phone, the font and the
 * label, and guessing wrong means a section nobody can reach.
 */
export function SectionChips<K extends string>({
  sections,
  active,
  onChange,
}: {
  sections: readonly { key: K; label: string }[];
  active: K;
  onChange: (key: K) => void;
}) {
  const chips = useRef<Partial<Record<K, HTMLButtonElement>>>({});

  useEffect(() => {
    // Without this, picking a section whose chip sits off-screen leaves the
    // selection invisible — you tap and nothing appears to happen.
    chips.current[active]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <div
      role="tablist"
      aria-label="Разделы админки"
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        scrollSnapType: "x proximity",
        scrollbarWidth: "none",
        padding: "12px 16px 2px",
        margin: 0,
      }}
    >
      {sections.map(({ key, label }) => {
        const selected = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(key)}
            ref={(element) => {
              if (element) chips.current[key] = element;
              else delete chips.current[key];
            }}
            style={{
              flex: "none",
              scrollSnapAlign: "center",
              minHeight: 34,
              border: 0,
              borderRadius: 999,
              padding: "0 14px",
              font: "inherit",
              fontSize: 13.5,
              fontWeight: selected ? 600 : 500,
              whiteSpace: "nowrap",
              cursor: "pointer",
              color: selected ? "var(--tgui--button_text_color)" : "var(--tgui--text_color)",
              background: selected ? "var(--tgui--button_color)" : "var(--tgui--secondary_bg_color)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Переписать `AdminScreen`**

Заменить `miniapp/src/screens/AdminScreen.tsx` целиком:

```tsx
import { useState } from "react";
import { AdminScheduleScreen } from "./admin/AdminScheduleScreen";
import { AdminWeekendScreen } from "./admin/AdminWeekendScreen";
import { AdminEmployeesScreen } from "./admin/AdminEmployeesScreen";
import { AdminBirthdays } from "./admin/AdminBirthdays";
import { AdminJournal } from "./admin/AdminJournal";
import { SectionChips } from "../components/SectionChips";
import { toISODate } from "../lib/week";

type AdminSection = "schedule" | "weekend" | "employees" | "birthdays" | "journal";

const SECTIONS: readonly { key: AdminSection; label: string }[] = [
  { key: "schedule", label: "Расписание" },
  { key: "weekend", label: "Выходные" },
  { key: "employees", label: "Работники" },
  { key: "birthdays", label: "Дни рождения" },
  { key: "journal", label: "Журнал" },
];

/**
 * The admin-only "Админ" tab: a scrolling chip row over the five admin surfaces
 * (schedule / weekend marketplace / workers / birthdays / journal). Each
 * sub-screen owns its own data-loading and mutations — nothing is fetched until
 * its section is first shown, so opening the tab is cheap. Rendered only when
 * `me.isAdmin` (see `App`), and every call it makes is `requireAdmin`-guarded
 * server-side.
 */
export function AdminScreen() {
  const [section, setSection] = useState<AdminSection>("schedule");

  return (
    <div>
      <SectionChips sections={SECTIONS} active={section} onChange={setSection} />

      {section === "schedule" && <AdminScheduleScreen />}
      {section === "weekend" && <AdminWeekendScreen />}
      {section === "employees" && <AdminEmployeesScreen />}
      {section === "birthdays" && <AdminBirthdays />}
      {section === "journal" && <AdminJournal today={toISODate(new Date())} />}
    </div>
  );
}
```

- [ ] **Step 3: Убрать костыль из CSS**

Удалить из `miniapp/src/index.css` оба правила (строки 62-68):

```css
.admin-sections button {
  padding-inline: 3px;
}

.admin-sections button > * {
  font-size: 12.5px;
}
```

- [ ] **Step 4: `AdminBirthdays` перестаёт быть подэкраном**

В `miniapp/src/screens/admin/AdminBirthdays.tsx`:

Сигнатуру заменить на `export function AdminBirthdays() {`.

Удалить блок с кнопкой возврата в конце `CardStack`:

```tsx
        <CardShell>
          <Button size="s" mode="gray" stretched onClick={onClose}>
            ← Назад к работникам
          </Button>
        </CardShell>
```

Обернуть возвращаемое в `ScreenScroll` + `List`, поскольку теперь это самостоятельный экран, а не вставка внутрь чужого списка. Импорты добавить: `import { List } from "@telegram-apps/telegram-ui";` (дописать `List` в существующий импорт) и `import { ScreenScroll } from "../../components/ScreenScroll";`.

Обе ветки `return` (спиннер и основная) обернуть так:

```tsx
    return (
      <ScreenScroll>
        <List>
          <Section header="Дни рождения">
            …существующее тело…
          </Section>
        </List>
      </ScreenScroll>
    );
```

- [ ] **Step 5: Вычистить дни рождения из «Работников»**

В `miniapp/src/screens/admin/AdminEmployeesScreen.tsx` удалить:

- импорт `import { AdminBirthdays } from "./AdminBirthdays";`
- состояние `const [birthdaysOpen, setBirthdaysOpen] = useState(false);` вместе с комментарием над ним
- весь блок `if (birthdaysOpen) { … }` со стоящим над ним комментарием «The birthday screen hangs off this one…»
- кнопку `<Button size="m" mode="bezeled" stretched onClick={() => setBirthdaysOpen(true)}>🎂 Дни рождения</Button>`

- [ ] **Step 6: Проверить**

Run: `npm test && npm run typecheck`
Expected: PASS. `miniapp/src/screens/admin/birthdays.test.ts` тестирует `statusOf` / `whenLabel` / `recipientsPhrase` — чистые функции, они не затронуты.

- [ ] **Step 7: Коммит**

```bash
git add miniapp/src
git commit -m "feat(admin): пятая секция не влезала в сегменты — теперь лента чипов"
```

---

## Task 8: Дата отсылки — схема, сервис, роуты

**Files:**
- Modify: `server/src/db/schema.ts` (таблица `birthdayCampaigns`)
- Create: `server/drizzle/00NN_*.sql` (генерируется)
- Modify: `server/src/birthdays/birthday-service.ts`
- Modify: `server/src/http/app.ts:322-370`
- Modify: `server/src/http/birthdays-route.test.ts`

**Interfaces:**
- Produces: колонки `scheduledSendOn` / `scheduleNotifiedAt`; `updateCampaign(db, employeeId, asOf, { collectUrl?, messageText?, scheduledSendOn? })`; `listAllCampaigns(db, limit?)` → `CampaignListRow[]`; `GET /api/admin/birthdays/campaigns`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `server/src/http/birthdays-route.test.ts`:

```ts
describe("scheduled send date", () => {
  it("saves a reminder date alongside the link", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    const res = await app.request(`/api/admin/birthdays/${id}?${ASOF}`,
      send(token, { collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-03" }, "PUT"));
    expect(res.status).toBe(200);
    expect((await res.json()).campaign).toMatchObject({ scheduledSendOn: "2026-08-03", scheduleNotifiedAt: null });
  });

  it("refuses a date in the past, after the birthday, or in the wrong shape", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    const past = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: "2026-07-31" }, "PUT"));
    expect(past.status).toBe(400);

    // Reminding to send a collection after the day has been and gone is pointless.
    const late = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: "2026-08-06" }, "PUT"));
    expect(late.status).toBe(400);

    const shape = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: "3 августа" }, "PUT"));
    expect(shape.status).toBe(400);
  });

  it("clears the date on null", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: "2026-08-03" }, "PUT"));
    const cleared = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: null }, "PUT"));
    expect((await cleared.json()).campaign.scheduledSendOn).toBeNull();
  });
});

describe("GET /api/admin/birthdays/campaigns", () => {
  it("returns a round whose birthday has already passed — which /birthdays cannot", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    // Prepare the 2026 round while it is still ahead of us…
    await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { collectUrl: "https://sber.ru/x" }, "PUT"));

    // …then look from a month later, when `upcomingBirthdays` keys on 2027 and
    // drops the 2026 round entirely. This is the gap the endpoint exists to fill.
    const upcoming = await (await app.request("/api/admin/birthdays?asOf=2026-09-01", auth(token))).json();
    expect(upcoming.birthdays.find((b: { employeeId: number }) => b.employeeId === id).campaign).toBeNull();

    const { campaigns } = await (await app.request("/api/admin/birthdays/campaigns", auth(token))).json();
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({ displayName: "Именинник", birthDateLabel: "5 августа" });
    expect(campaigns[0].campaign).toMatchObject({ collectUrl: "https://sber.ru/x", year: 2026 });
  });

  it("is admin-only", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    person(db, "Работник", 222, null);
    expect((await app.request("/api/admin/birthdays/campaigns", auth(await tokenFor(app, 222)))).status).toBe(403);
  });
});
```

Новых импортов не нужно. Админский токен берётся как во всех существующих тестах этого файла — `tokenFor(app, 111)`: id 111 лежит в `config.adminTelegramIds`, и `/api/auth` заводит для него админскую запись сам.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run server/src/http/birthdays-route.test.ts -t "scheduled send date"`
Expected: FAIL — поле `scheduledSendOn` не сохраняется, роут `/campaigns` отдаёт 404.

- [ ] **Step 3: Добавить колонки**

В `server/src/db/schema.ts` в `birthdayCampaigns`, после `adminNotifiedAt`:

```ts
    /** The day the admin asked to be reminded to send the collection. YYYY-MM-DD,
     *  null when they did not ask. Never triggers a send by itself — see
     *  `runBirthdayNoticeTick`. */
    scheduledSendOn: text(),
    /** When that reminder went out, so it goes out once rather than every tick. */
    scheduleNotifiedAt: integer({ mode: "timestamp" }),
```

- [ ] **Step 4: Сгенерировать миграцию**

Run: `npm run db:generate -w @planer/server`
Expected: `server/drizzle/0015_*.sql` с двумя `ALTER TABLE ... ADD`. Проверить глазами, как в Задаче 1.

- [ ] **Step 5: Расширить сервис**

В `server/src/birthdays/birthday-service.ts`:

Добавить `desc` к импорту из `drizzle-orm` (там уже `and, eq`).

`updateCampaign` — добавить поле в patch:

```ts
/** Saves the link, the wording and/or the reminder date. A link moves the round to «готово к отправке». */
export function updateCampaign(
  db: Db,
  employeeId: number,
  asOf: string,
  patch: { collectUrl?: string | null; messageText?: string | null; scheduledSendOn?: string | null },
): BirthdayCampaign | null {
  const campaign = ensureCampaign(db, employeeId, asOf);
  if (!campaign) return null;
  if (campaign.status === "sent") return campaign; // settled; nothing left to edit

  const collectUrl = patch.collectUrl !== undefined ? patch.collectUrl : campaign.collectUrl;
  const messageText = patch.messageText !== undefined ? patch.messageText : campaign.messageText;
  const scheduledSendOn = patch.scheduledSendOn !== undefined ? patch.scheduledSendOn : campaign.scheduledSendOn;
  // Moving the date re-arms the reminder: an admin who pushes it back a day means
  // to be told on the new day, not to be told nothing because the old one fired.
  const scheduleNotifiedAt = scheduledSendOn === campaign.scheduledSendOn ? campaign.scheduleNotifiedAt : null;

  return db
    .update(birthdayCampaigns)
    .set({ collectUrl, messageText, scheduledSendOn, scheduleNotifiedAt, status: collectUrl ? "ready" : "pending" })
    .where(eq(birthdayCampaigns.id, campaign.id))
    .returning()
    .all()[0]!;
}
```

Дописать в конец файла:

```ts
export interface CampaignListRow {
  campaign: BirthdayCampaign;
  displayName: string;
  /** "5 августа", or "" for somebody whose birthday was cleared after the fact. */
  birthDateLabel: string;
}

/**
 * Every round ever prepared, newest first.
 *
 * `upcomingBirthdays` cannot answer this: it keys campaigns by the NEXT
 * occurrence of a birthday, so the moment a birthday passes its campaign drops
 * out of that list entirely — which is precisely the one an admin wants to look
 * back at. Hence a separate read.
 *
 * Bounded because this table grows by one row per person per year and the screen
 * scrolls; a hundred is several years of a team this size.
 */
export function listAllCampaigns(db: Db, limit = 100): CampaignListRow[] {
  const people = new Map(db.select().from(employees).all().map((employee) => [employee.id, employee] as const));
  return db
    .select()
    .from(birthdayCampaigns)
    .orderBy(desc(birthdayCampaigns.celebratedOn))
    .limit(limit)
    .all()
    .flatMap((campaign) => {
      const employee = people.get(campaign.employeeId);
      if (!employee) return [];
      return [{
        campaign,
        displayName: employee.displayName,
        birthDateLabel: employee.birthDate ? formatBirthDate(employee.birthDate) : "",
      }];
    });
}
```

- [ ] **Step 6: Роут PUT — принять и провалидировать дату**

В `server/src/http/app.ts` в `app.put("/api/admin/birthdays/:id", …)`:

Расширить тип тела и объект `patch`:

```ts
    const body = (await c.req.json().catch(() => ({}))) as { collectUrl?: unknown; messageText?: unknown; scheduledSendOn?: unknown };

    const patch: { collectUrl?: string | null; messageText?: string | null; scheduledSendOn?: string | null } = {};
```

После блока разбора `messageText` и ДО проверки `Object.keys(patch).length === 0` вставить:

```ts
    if (body.scheduledSendOn !== undefined) {
      if (body.scheduledSendOn === null) {
        patch.scheduledSendOn = null;
      } else if (typeof body.scheduledSendOn !== "string" || !dateStr.safeParse(body.scheduledSendOn).success) {
        return c.json({ error: "Дата напоминания должна быть в виде ГГГГ-ММ-ДД" }, 400);
      } else {
        // The window is «from today up to and including the birthday». Earlier is
        // already gone; later is a reminder to send a collection for a party that
        // has happened.
        if (body.scheduledSendOn < asOf) {
          return c.json({ error: "Дата напоминания уже прошла" }, 400);
        }
        const round = ensureCampaign(db, Number(c.req.param("id")), asOf);
        if (!round) return c.json({ error: "not_found" }, 404);
        if (body.scheduledSendOn > round.celebratedOn) {
          return c.json({ error: "Напоминать после самого дня рождения уже поздно" }, 400);
        }
        patch.scheduledSendOn = body.scheduledSendOn;
      }
    }
```

Добавить `ensureCampaign` и `listAllCampaigns` в импорт из `../birthdays/birthday-service`.

- [ ] **Step 7: Роут списка кампаний**

Добавить рядом с `app.get("/api/admin/birthdays", …)`:

```ts
  /** Every round ever prepared — the ones already sent included. Separate from
   *  `/birthdays` because that one looks forward and this one looks back. */
  app.get("/api/admin/birthdays/campaigns", requireAdmin(db, config.jwtSecret), (c) =>
    c.json({ campaigns: listAllCampaigns(db) }));
```

Роут обязан быть объявлен ДО `app.get("/api/admin/birthdays/:id/preview", …)` — Hono матчит по порядку, и `/campaigns` иначе рискует уехать в параметризованный путь. Разместить его сразу после `GET /api/admin/birthdays`.

- [ ] **Step 8: Убедиться, что тесты проходят**

Run: `npx vitest run server/src/http/birthdays-route.test.ts`
Expected: PASS.

- [ ] **Step 9: Прогнать всё**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Коммит**

```bash
git add server/src server/drizzle
git commit -m "feat(birthdays): дата напоминания и список всех сборов, включая ушедшие"
```

---

## Task 9: Тик напоминания о сборе

**Files:**
- Modify: `server/src/birthdays/birthday-service.ts`
- Modify: `server/src/birthdays/birthday-notice.ts`
- Modify: `server/src/birthdays/birthday-notice.test.ts`

**Interfaces:**
- Consumes: `scheduledSendOn`, `scheduleNotifiedAt`, `adminRecipients`, `notifyUser`, `recordAudit`.
- Produces: `campaignsScheduledFor(db, date)`, `markScheduleNotified(db, campaignId, when)`, `scheduleNoticeMessage(name, birthDateLabel, collectUrl)`; `runBirthdayNoticeTick` шлёт ещё и напоминания.

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `server/src/birthdays/birthday-notice.test.ts`:

```ts
describe("runBirthdayNoticeTick — scheduled collection reminders", () => {
  it("reminds admins on the day they picked, with the link they saved", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    // Prepare the round and mark the week-ahead nudge as already done, so this
    // test observes only the scheduled reminder.
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    const campaign = ensureCampaign(db, who, TODAY)!;
    markAdminNotified(db, campaign.id, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent.map((m) => m.to)).toEqual([2]);
    expect(sent[0]!.text).toContain("Именинник");
    expect(sent[0]!.text).toContain("https://sber.ru/x");
  });

  it("reminds once, not every tick", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, ensureCampaign(db, who, TODAY)!.id, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent).toHaveLength(1);
  });

  it("stays quiet on any other day", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-04" });
    markAdminNotified(db, ensureCampaign(db, who, TODAY)!.id, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent).toHaveLength(0);
  });

  it("says nothing about a round that already went out", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    const campaign = ensureCampaign(db, who, TODAY)!;
    markAdminNotified(db, campaign.id, new Date());
    markSent(db, campaign.id, 4, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent).toHaveLength(0);
  });

  it("still never messages the team", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    person(db, "Обычный коллега", 3, null);
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, ensureCampaign(db, who, TODAY)!.id, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent.map((m) => m.to)).toEqual([2]);
  });

  it("records an audit line of its own", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, ensureCampaign(db, who, TODAY)!.id, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(listRecentAudit(db, 10).some((row) => row.action === "birthday_schedule_notice")).toBe(true);
  });
});
```

Импорт в шапке файла дополнить: `markAdminNotified` добавляется к уже импортируемым из `./birthday-service`.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run server/src/birthdays/birthday-notice.test.ts -t "scheduled collection reminders"`
Expected: FAIL — ничего не отправляется.

- [ ] **Step 3: Добавить хелперы в сервис**

В `server/src/birthdays/birthday-service.ts` добавить `isNull` к импорту из `drizzle-orm` и дописать:

```ts
/**
 * Rounds whose reminder day is today and which have not been reminded about.
 * A round already sent is skipped: there is nothing left to remind anyone of.
 */
export function campaignsScheduledFor(db: Db, date: string): BirthdayCampaign[] {
  return db
    .select()
    .from(birthdayCampaigns)
    .where(and(eq(birthdayCampaigns.scheduledSendOn, date), isNull(birthdayCampaigns.scheduleNotifiedAt)))
    .all()
    .filter((campaign) => campaign.status !== "sent");
}

/** Records that the scheduled reminder went out, so it goes out once. */
export function markScheduleNotified(db: Db, campaignId: number, when: Date): void {
  db.update(birthdayCampaigns)
    .set({ scheduleNotifiedAt: when })
    .where(eq(birthdayCampaigns.id, campaignId))
    .run();
}

/**
 * The reminder an admin asked for. Same nominative rule as `defaultMessage` —
 * we store one display name and nothing that would let us decline it.
 */
export function scheduleNoticeMessage(name: string, birthDateLabel: string, collectUrl: string | null): string {
  const lines = [`⏰ Пора разослать сбор — ${name}, день рождения ${birthDateLabel}.`];
  if (collectUrl) lines.push("", `Ссылка: ${collectUrl}`);
  lines.push("", "Открой «Дни рождения» в мини-приложении и нажми «Разослать».");
  return lines.join("\n");
}
```

- [ ] **Step 4: Второй проход в тике**

В `server/src/birthdays/birthday-notice.ts` расширить импорт из `./birthday-service`:

```ts
import {
  ADMIN_NOTICE_DAYS,
  adminNoticeMessage,
  adminRecipients,
  campaignsScheduledFor,
  ensureCampaign,
  markAdminNotified,
  markScheduleNotified,
  scheduleNoticeMessage,
  upcomingBirthdays,
} from "./birthday-service";
```

Дописать `formatBirthDate` к импорту из `@planer/shared` (в этом файле его пока нет — добавить строку `import { formatBirthDate } from "@planer/shared";`), и `employees` + `eq`, чтобы достать имя. Проще — взять имя через уже доступный репозиторий: добавить `import { getEmployeeById } from "../repo/employees";`.

Обновить докблок функции и добавить второй цикл перед `return sent`:

```ts
/**
 * The two things the bot does about birthdays on its own, and both talk to the
 * ADMINS only. Never the team — the collection is the admin's to send, after
 * they have made the link and seen what will go out.
 *
 *   1. A week ahead: «у Х день рождения через 7 дней».
 *   2. On the day an admin asked to be reminded: «пора разослать сбор по Х».
 *
 * Each nudges once (`adminNotifiedAt` / `scheduleNotifiedAt`), so a tick that
 * runs every five minutes doesn't turn into a five-minute alarm.
 *
 * Returns how many admin messages went out.
 */
```

и перед `return sent`:

```ts
  for (const campaign of campaignsScheduledFor(db, today)) {
    const employee = getEmployeeById(db, campaign.employeeId);
    if (!employee?.birthDate) continue;

    const admins = adminRecipients(db, campaign.employeeId);
    if (admins.length === 0) continue;

    const text = scheduleNoticeMessage(employee.displayName, formatBirthDate(employee.birthDate), campaign.collectUrl);
    let delivered = 0;
    for (const admin of admins) {
      if (await notifyUser(bot, admin.telegramUserId!, text)) delivered += 1;
    }

    // Marked either way, for the same reason as the notice above: a Telegram
    // outage must not become a nag loop. The date is still on the screen.
    markScheduleNotified(db, campaign.id, new Date());
    recordAudit(db, "birthday_schedule_notice", null, {
      employeeId: campaign.employeeId,
      displayName: employee.displayName,
      scheduledSendOn: campaign.scheduledSendOn,
      delivered,
    });
    sent += delivered;
  }
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npx vitest run server/src/birthdays/birthday-notice.test.ts`
Expected: PASS, включая шесть новых и все прежние.

- [ ] **Step 6: Прогнать всё**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add server/src
git commit -m "feat(birthdays): в назначенный день бот пинает админов, команду по-прежнему не трогает"
```

---

## Task 10: Мини-апп — секция «Сборы» и поле даты

**Files:**
- Modify: `miniapp/src/api/client.ts`
- Modify: `miniapp/src/api/mock.ts`
- Modify: `miniapp/src/screens/admin/AdminBirthdays.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/birthdays/campaigns`, `PUT /api/admin/birthdays/:id` со `scheduledSendOn` из Задачи 8.
- Produces: `apiClient.getBirthdayCampaigns()`, тип `CampaignListRow`, поле даты в `CampaignEditor`, секция «Сборы».

- [ ] **Step 1: Расширить типы и клиент**

В `miniapp/src/api/client.ts` в `BirthdayCampaign` добавить:

```ts
  /** The day an admin asked to be reminded to send it. Null when they didn't ask. */
  scheduledSendOn: string | null;
  scheduleNotifiedAt: string | null;
```

Добавить новый тип рядом с `UpcomingBirthday`:

```ts
/** A prepared round, with the person it belongs to. Unlike `UpcomingBirthday`
 *  this includes rounds whose birthday has already passed. */
export interface CampaignListRow {
  campaign: BirthdayCampaign;
  displayName: string;
  birthDateLabel: string;
}
```

В интерфейсе `ApiClient` расширить сигнатуру сохранения и добавить чтение:

```ts
  saveBirthdayCampaign(
    employeeId: number,
    patch: { collectUrl?: string | null; messageText?: string | null; scheduledSendOn?: string | null },
  ): Promise<BirthdayCampaign>;
  /** Every round ever prepared, newest first — the sent ones included. */
  getBirthdayCampaigns(): Promise<CampaignListRow[]>;
```

Реализация рядом с `getBirthdays`:

```ts
  async getBirthdayCampaigns() {
    const { campaigns } = await authorizedGet<{ campaigns: CampaignListRow[] }>("/api/admin/birthdays/campaigns");
    return campaigns;
  },
```

- [ ] **Step 2: Обновить моки**

В `miniapp/src/api/mock.ts`:

В литерале `created` внутри `campaignFor` добавить `scheduledSendOn: null, scheduleNotifiedAt: null,`.

В `mockSaveBirthdayCampaign` после блока `messageText` добавить:

```ts
  if (patch.scheduledSendOn !== undefined) {
    const value = patch.scheduledSendOn;
    if (value !== null) {
      // Mirrors the server: within [today, celebratedOn].
      const today = toISODate(new Date());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Дата напоминания должна быть в виде ГГГГ-ММ-ДД");
      if (value < today) throw new Error("Дата напоминания уже прошла");
      if (value > campaign.celebratedOn) throw new Error("Напоминать после самого дня рождения уже поздно");
    }
    if (value !== campaign.scheduledSendOn) campaign.scheduleNotifiedAt = null;
    campaign.scheduledSendOn = value;
  }
```

Дописать мок списка рядом с `mockGetBirthdays`:

```ts
export async function mockGetBirthdayCampaigns(): Promise<CampaignListRow[]> {
  await delay(200);
  return [...CAMPAIGNS]
    .sort((a, b) => b.celebratedOn.localeCompare(a.celebratedOn))
    .flatMap((campaign) => {
      const employee = EMPLOYEES.find((e) => e.id === campaign.employeeId);
      if (!employee?.birthDate) return [];
      return [{ campaign: { ...campaign }, displayName: employee.displayName, birthDateLabel: formatBirthDate(employee.birthDate) }];
    });
}
```

Добавить `CampaignListRow` в импорт типов из `./client` (блок в начале `mock.ts`, строки 18-20).

Прописать мок в `devClient` (`miniapp/src/api/client.ts:870`) рядом со строкой `getBirthdays:`:

```ts
  getBirthdayCampaigns: () => mockGetBirthdayCampaigns(),
```

и добавить `mockGetBirthdayCampaigns` в блок импорта из `./mock` в начале `client.ts`.

- [ ] **Step 3: Поле даты в редакторе**

В `miniapp/src/screens/admin/AdminBirthdays.tsx` в `CampaignEditor`:

Добавить состояние рядом с остальными:

```ts
  const [scheduledSendOn, setScheduledSendOn] = useState(birthday.campaign?.scheduledSendOn ?? "");
```

В `handleSave` добавить поле в патч:

```ts
      await apiClient.saveBirthdayCampaign(birthday.employeeId, {
        collectUrl: collectUrl.trim() || null,
        messageText: messageText.trim() || null,
        scheduledSendOn: scheduledSendOn || null,
      });
```

В неотправленной ветке, между `Input` со ссылкой и `Textarea`, вставить:

```tsx
          {/* A native date field: unlike the birthday itself this one has a real
              year, and the range is what the server enforces anyway. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--tgui--hint_color)" }}>Напомнить мне</span>
            <input
              type="date"
              value={scheduledSendOn}
              disabled={busy}
              min={todayIso}
              max={birthday.celebratedOn}
              aria-label="Дата напоминания о сборе"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--tgui--outline)",
                background: "var(--tgui--secondary_bg_color)",
                color: "var(--tgui--text_color)",
                font: "inherit",
                fontSize: 13.5,
              }}
              onChange={(e) => { setScheduledSendOn(e.target.value); setConfirming(false); }}
            />
            <span style={{ fontSize: 12.5, color: "var(--tgui--hint_color)", lineHeight: 1.4 }}>
              В этот день бот напишет админам. Команде — по-прежнему только по твоему тапу.
            </span>
          </div>
```

Объявить `todayIso` в начале `CampaignEditor`:

```ts
  const todayIso = toISODate(new Date());
```

и добавить `import { toISODate } from "../../lib/week";`.

- [ ] **Step 4: Секция «Сборы»**

В том же файле добавить компонент перед `BirthdayCard`:

```tsx
/**
 * Every round ever prepared, the sent ones included.
 *
 * Read from its own endpoint rather than filtered out of the list above: that
 * one keys campaigns by the NEXT birthday, so a round drops out of it the day
 * after the party — exactly the round somebody wants to look back at.
 */
function CampaignsSection({ onOpen }: { onOpen: (employeeId: number) => void }) {
  const [rows, setRows] = useState<CampaignListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getBirthdayCampaigns()
      .then(setRows)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Не удалось загрузить сборы"));
  }, []);

  if (error) return <CardShell><div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div></CardShell>;
  if (!rows) return <CardShell><Spinner size="s" /></CardShell>;
  if (rows.length === 0) return <CardShell><div style={{ color: "var(--tgui--hint_color)", fontSize: 13.5 }}>Сборов пока не было.</div></CardShell>;

  return (
    <>
      {rows.map(({ campaign, displayName, birthDateLabel }) => (
        <CardShell key={campaign.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{displayName}</div>
              <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
                {birthDateLabel} · {campaign.year}
                {campaign.scheduledSendOn && ` · напомнить ${campaign.scheduledSendOn}`}
              </div>
            </div>
            <span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: TONE_COLOR[campaign.status === "sent" ? "sent" : campaign.collectUrl ? "ready" : "pending"] }}>
              {campaign.status === "sent" ? `Разослано · ${campaign.sentCount}` : campaign.collectUrl ? "Готово" : "Нет ссылки"}
            </span>
          </div>
          {campaign.collectUrl && <CopyableLink url={campaign.collectUrl} />}
          <Button size="s" mode="bezeled" stretched onClick={() => onOpen(campaign.employeeId)}>
            {campaign.status === "sent" ? "Посмотреть" : "Открыть"}
          </Button>
        </CardShell>
      ))}
    </>
  );
}

/** The link, readable and copyable — the reason this list exists. */
function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          fontFamily: "var(--tgui--font_family_mono, monospace)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--tgui--hint_color)",
        }}
      >
        {url}
      </span>
      <Button
        size="s"
        mode="gray"
        onClick={() => {
          navigator.clipboard
            .writeText(url)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            // Clipboard is unavailable in an insecure context; the text above is
            // still selectable, so there is nothing to report.
            .catch(() => {});
        }}
      >
        {copied ? "✓" : "Копировать"}
      </Button>
    </div>
  );
}
```

Добавить `CampaignListRow` в импорт типов из `../../api/client`.

- [ ] **Step 5: Встроить секцию в экран**

В теле `AdminBirthdays`, после `CardStack` с ближайшими днями рождения, добавить вторую секцию внутри того же `List`:

```tsx
        <Section header="Сборы">
          <CardStack>
            <CampaignsSection onOpen={(employeeId) => { setNotice(null); setOpenId(employeeId); }} />
          </CardStack>
        </Section>
```

Тап по строке разворачивает уже существующую карточку в секции «Ближайшие» — тот же `openId`, тот же `CampaignEditor`, второго редактора не появляется. Для человека, чей день рождения уже прошёл, карточки в «Ближайших» может не быть; в этом случае тап ничего не раскроет, и это верно: редактировать в разосланном сообщении нечего, а ссылка и статус видны прямо в строке.

- [ ] **Step 6: Проверить**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Прогнать сборку мини-аппа**

Run: `npm run build -w @planer/miniapp`
Expected: сборка проходит без ошибок.

- [ ] **Step 8: Коммит**

```bash
git add miniapp/src
git commit -m "feat(miniapp): сборы списком — видно, что ушло, и когда напомнить про остальное"
```

---

## Финальная проверка

- [ ] **Step 1: Весь набор целиком**

Run: `npm test && npm run typecheck && npm run build -w @planer/miniapp`
Expected: PASS во всех трёх.

- [ ] **Step 2: Миграции на копии боевой базы**

```bash
cp data/planer.db /tmp/migration-check.db
DATABASE_URL=/tmp/migration-check.db npm start -w @planer/server
```

Дождаться, пока сервер поднимется, остановить его, и проверить:

```bash
sqlite3 /tmp/migration-check.db "select preferred_name from employees limit 1; select scheduled_send_on, schedule_notified_at from birthday_campaigns limit 1;"
```

Expected: колонки существуют, значения пустые. Ошибок миграции нет.

- [ ] **Step 3: Ручной прогон мини-аппа в dev**

```bash
npm run dev -w @planer/miniapp
```

Пройти по списку: приветствие меняется после сохранения обращения; сегодняшняя смена подсвечена; в «Команде» кнопка возврата появляется только после ухода со текущего периода; архив обменов свёрнут; в админке пять чипов и они прокручиваются; в «Днях рождения» есть секция «Сборы» и поле даты.

---

## Ревью плана

**Покрытие спеки:**

| Раздел спеки | Задачи |
|---|---|
| §3 Обращение по имени | 1, 2, 3 |
| §4 Подсветка текущего дня | 4 |
| §5 Возврат к текущему периоду | 5 |
| §6 Архив обменов | 6 |
| §7.1 Навигация лентой чипов | 7 |
| §7.2 Секция «Сборы» + новый эндпоинт | 8 (сервер), 10 (клиент) |
| §7.3 Дата отсылки | 8 |
| §7.4 Тик | 9 |
| §8 Миграции | 1 (шаги 5-6), 8 (шаги 3-4) |
| §9 Тестирование | тесты внутри задач 1, 2, 4, 5, 6, 8, 9 |

**Согласованность имён между задачами:** `addressOf` / `normalizePreferredName` / `PREFERRED_NAME_MAX` / `setPreferredName` (Задача 1) используются под теми же именами в Задаче 2. `isCurrentPeriod` (Задача 5) и `formatDayLabelRelative` (Задача 4) — оба из `miniapp/src/lib/week.ts`. `updateCampaign` расширяется в Задаче 8 и вызывается с новым полем в тестах Задачи 9. `CampaignListRow` объявлен на сервере (Задача 8) и продублирован в клиентских типах (Задача 10) — так же, как уже сделано с `UpcomingBirthday` и `BirthdayCampaign`.
