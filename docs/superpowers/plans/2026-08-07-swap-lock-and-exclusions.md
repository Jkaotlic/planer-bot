# Лок обменов и исключения людей — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Админ может одним тумблером закрыть обмены сменами для всей команды и двумя галками вывести конкретного человека из автоматических назначений и из обменов; все затронутые узнают об этом в личке.

**Architecture:** Правило «можно ли этот обмен» — чистая функция `swapBlockReason` в `@planer/shared`. Её зовёт `validateSwap`, через который проходят **оба** входа обмена (мини-апп и кнопка «Принять» в чате, которая идёт в `acceptSwap` напрямую мимо HTTP-роутов), и она же питает мини-апп — состояние кнопки и список кандидатов. Состояние лока лежит в новой таблице `app_settings` (ключ-значение), исключения — двумя boolean-колонками на `employees`. Гашение открытых заявок и рассылка разнесены: запись в БД в транзакции, `await`-рассылка после неё.

**Tech Stack:** TypeScript ESM, Drizzle + better-sqlite3, Hono, grammY, React (два фронта: `admin/` — десктоп, `miniapp/` — Telegram Mini App), vitest (+ jsdom для DOM-тестов).

**Спека:** `docs/superpowers/specs/2026-08-07-swap-lock-and-exclusions-design.md`

## Global Constraints

- **Node ≥ 22.22.2** (`.nvmrc`, `engines`). Гейт: `npm test` и `npm run typecheck` из корня.
- **Идентификаторы только латиницей** — включая тестовые фикстуры. В репозитории нет ни одного кириллического имени переменной, и это надо сохранить.
- **Комментарии в `server/src/**` — по-английски**, и в коде, **и в тестах**. Русские доменные термины — только в «ёлочках» внутри английской фразы. В `shared/`, в `miniapp/` и в `admin/` русские комментарии — намеренная конвенция, там пишем по-русски (см. `admin/src/screens/employees-error.test.tsx`).
- **Зеркальные тесты двух консолей — конвенция, а не копипаста.** `admin/` и `miniapp/` намеренно держат почти дословные пары тестовых файлов (существующий пример: `admin/src/screens/employees-error.test.tsx` — «Зеркало теста мини-аппа»). Расхождение двух фронтов должен ловить тест, а не пользователь.
- **Репозиторий публичный.** Имена только из вымышленного ростера: `Аня Смирнова`, `Игорь Петров`, `Марк Волков`. Страж — `server/src/db/no-real-names.test.ts`.
- **Каждый тест обязан падать без починки.** Перед коммитом задачи: `git stash push -- <файл реализации>` → прогнать тест → он **красный** → `git stash pop`. Зелёный тест на застэшенной реализации — дефект теста, а не удача.
- **Тесты парные.** На каждое «отказывает при ограничении» — «разрешает на тех же данных без ограничения». Одиночный негативный тест зеленеет от любой другой причины отказа.
- **Трогал мок или фикстуру — гоняй `npm test` целиком**, не только `typecheck`: `miniapp/src/api/mock.test.ts` утверждает точный набор данных.
- **Миграции только генератором:** `npx drizzle-kit generate`. Руками `server/drizzle/meta/_journal.json` не править.
- **Живую базу (`data/planer.db`) не трогать** ни на одном шаге.

---

## Карта файлов

**Создаются:**

| Файл | Ответственность |
|---|---|
| `server/src/repo/settings.ts` | чтение/запись `app_settings`; знает про ключ `swaps_locked` и больше ни про что |
| `server/src/repo/settings.test.ts` | тесты того же |
| `server/src/swap/swap-lock.ts` | смена состояния лока + гашение открытых заявок; возвращает погашенные для рассылки |
| `server/src/swap/swap-lock.test.ts` | тесты того же |
| `server/src/swap/swap-lock-notice.ts` | **чистые** билдеры текста: одно письмо на человека |
| `server/src/swap/swap-lock-notice.test.ts` | тесты того же |
| `admin/src/screens/SettingsScreen.tsx` | десктоп: раздел «Настройки» |
| `admin/src/screens/settings.test.tsx` | DOM-тест того же |
| `miniapp/src/screens/admin/AdminSettings.tsx` | мини-апп: раздел «Настройки» |
| `miniapp/src/screens/admin/admin-settings.test.tsx` | DOM-тест того же |
| `server/drizzle/0017_*.sql` | миграция (имя даст генератор) |

**Изменяются (главное):** `server/src/db/schema.ts`, `shared/src/swap.ts`, `shared/src/audit.ts`, `server/src/swap/swap-service.ts`, `server/src/http/app.ts`, `server/src/bot/bot.ts`, `server/src/bot/notify.ts`, `server/src/schedule/distribute-service.ts`, `server/src/repo/template-roles.ts`, `server/src/weekend/weekend-service.ts`, `server/src/repo/team-schedule.ts`, оба `api/client.ts`, `miniapp/src/api/mock.ts`, оба экрана «Работники», `miniapp/src/lib/swap-candidates.ts`.

---

## Task 1: Схема и репозиторий настроек

**Files:**
- Modify: `server/src/db/schema.ts`
- Create: `server/drizzle/0017_*.sql` (генератором)
- Create: `server/src/repo/settings.ts`
- Test: `server/src/repo/settings.test.ts`

**Interfaces:**
- Produces: `appSettings` (таблица), `employees.excludedFromAssignment: boolean`, `employees.excludedFromSwaps: boolean`, `isSwapsLocked(db: Db): boolean`, `setSwapsLocked(db: DbOrTx, locked: boolean, actorEmployeeId: number): void`, `swapsLockSetting(db: Db): AppSetting | undefined`, тип `DbOrTx`

- [ ] **Шаг 1: Написать падающий тест**

`server/src/repo/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { appSettings } from "../db/schema";
import { isSwapsLocked, setSwapsLocked } from "./settings";

describe("app settings", () => {
  // A database that has never seen this feature must behave exactly as before:
  // the migration inserts nothing, and «no row» has to read as «swaps are open».
  it("reads an empty table as unlocked", () => {
    expect(isSwapsLocked(makeTestDb())).toBe(false);
  });

  it("round-trips the lock in both directions", () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Игорь Петров" });
    setSwapsLocked(db, true, admin.id);
    expect(isSwapsLocked(db)).toBe(true);
    setSwapsLocked(db, false, admin.id);
    expect(isSwapsLocked(db)).toBe(false);
  });

  // Idempotent: the toggle is a switch, not a log. Two presses of «закрыть» must
  // leave one row, or `isSwapsLocked` would depend on which row it happened to read.
  it("keeps exactly one row when set twice", () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Игорь Петров" });
    setSwapsLocked(db, true, admin.id);
    setSwapsLocked(db, true, admin.id);
    const rows = db.select().from(appSettings).where(eq(appSettings.key, "swaps_locked")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.updatedByEmployeeId).toBe(admin.id);
  });

  // The two exclusion flags default to «участвует» — an existing roster must not
  // silently lose anybody the moment this migration runs.
  it("defaults both exclusion flags to false for a new employee", () => {
    const db = makeTestDb();
    const person = createEmployee(db, { displayName: "Аня Смирнова" });
    expect(person.excludedFromAssignment).toBe(false);
    expect(person.excludedFromSwaps).toBe(false);
  });
});
```

- [ ] **Шаг 2: Прогнать — тест обязан упасть**

Run: `npx vitest run server/src/repo/settings.test.ts`
Expected: FAIL — `Cannot find module './settings'`.

- [ ] **Шаг 3: Схема**

В `server/src/db/schema.ts` в блок `employees` (после `remindersEnabled`) добавить:

```ts
  /** An admin took this person out of AUTOMATIC placement: «Распределить честно»,
   *  the ★ queue, the weekend call for volunteers, and weekend assignment. An admin
   *  can still place them by hand — this is not archiving. */
  excludedFromAssignment: integer({ mode: "boolean" }).notNull().default(false),
  /** An admin took this person out of swaps, both ways: neither propose nor accept. */
  excludedFromSwaps: integer({ mode: "boolean" }).notNull().default(false),
```

Новая таблица (рядом с `calendarDays`):

```ts
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
```

И в конец файла, к прочим типам:

```ts
export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
```

- [ ] **Шаг 4: Сгенерировать миграцию**

Run: `npx drizzle-kit generate`
Expected: появился `server/drizzle/0017_<слово>.sql` с `CREATE TABLE app_settings` и двумя `ALTER TABLE employees ADD ...`. Открыть файл и **глазами убедиться**, что там нет `DROP TABLE` — колонки с `DEFAULT` SQLite добавляет через `ALTER`, пересоздание таблицы здесь означало бы, что генератор увидел что-то ещё.

- [ ] **Шаг 5: Репозиторий**

`server/src/repo/settings.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { appSettings, type AppSetting } from "../db/schema";

/**
 * Team-wide toggles. The only key today is `swaps_locked`.
 *
 * A missing row means «default», never «broken»: the migration seeds nothing, so
 * a database that predates this feature reads as «swaps are open» — which is how
 * it behaved before the feature existed.
 */
const SWAPS_LOCKED = "swaps_locked";

/**
 * The database, or a transaction opened on it.
 *
 * `setSwapLock` (Task 3) writes this flag and cancels the affected swap requests
 * in ONE transaction — both must land or neither — so it has to hand the
 * transaction handle to this writer. Drizzle types that handle differently from
 * `Db`, and a `tx as Db` cast at the call site would be a lie that compiles.
 */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export function isSwapsLocked(db: Db): boolean {
  return readSetting(db, SWAPS_LOCKED)?.value === "1";
}

/** The row behind the toggle — for «кто и когда закрыл» on the settings screen. */
export function readSetting(db: Db, key: string): AppSetting | undefined {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get();
}

export function setSwapsLocked(db: DbOrTx, locked: boolean, actorEmployeeId: number): void {
  db.insert(appSettings)
    .values({ key: SWAPS_LOCKED, value: locked ? "1" : "0", updatedByEmployeeId: actorEmployeeId, updatedAt: new Date() })
    // A switch, not a log: pressing «закрыть» twice must leave one row, or the
    // reader's answer would depend on which row it happened to see first.
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: locked ? "1" : "0", updatedByEmployeeId: actorEmployeeId, updatedAt: new Date() },
    })
    .run();
}

export function swapsLockSetting(db: Db): AppSetting | undefined {
  return readSetting(db, SWAPS_LOCKED);
}
```

- [ ] **Шаг 6: Прогнать — зелёно**

Run: `npx vitest run server/src/repo/settings.test.ts`
Expected: PASS, 4 теста.

- [ ] **Шаг 7: Проверить, что тест умеет падать**

```bash
git stash push -- server/src/repo/settings.ts
npx vitest run server/src/repo/settings.test.ts   # обязан быть КРАСНЫМ
git stash pop
```

- [ ] **Шаг 8: Полный гейт и коммит**

```bash
npm test && npm run typecheck
git add server/src/db/schema.ts server/drizzle server/src/repo/settings.ts server/src/repo/settings.test.ts
git commit -m "feat(db): app_settings и две колонки исключений на employees"
```

---

## Task 2: Правило `swapBlockReason` и его применение

**Files:**
- Modify: `shared/src/swap.ts`
- Modify: `shared/src/index.ts` (реэкспорт, если экспорт не через `export *`)
- Modify: `server/src/swap/swap-service.ts`
- Modify: `server/src/bot/bot.ts:76-91` (`reasonToRu`)
- Modify: `miniapp/src/screens/ProposeSwapScreen.tsx:27-49` (`SWAP_ERROR_MESSAGES`)
- Test: `shared/src/swap-validate.test.ts`, `server/src/swap/swap-service.test.ts`

**Interfaces:**
- Consumes: `isSwapsLocked` (Task 1), `employees.excludedFromSwaps` (Task 1)
- Produces: `swapBlockReason(input: { swapsLocked: boolean; fromExcluded: boolean; toExcluded: boolean }): "swaps-locked" | "from-excluded" | "to-excluded" | null`; `SwapContext` с тремя **обязательными** полями `swapsLocked`, `fromExcluded`, `toExcluded`; три новых значения `SwapRejectReason`

**Замечание про обязательность полей.** Три поля делаются обязательными, а не опциональными с дефолтом `false`. Цена — правка ~15 существующих вызовов в `shared/src/swap-validate.test.ts`. Выгода — забытый вызов даёт красный `tsc`, а не тихое «разрешено», что ровно тот класс дефекта, ради которого фича и делается.

- [ ] **Шаг 1: Написать падающие тесты в `shared`**

В `shared/src/swap-validate.test.ts` — рядом с `const now = ...` добавить общую «разрешающую» тройку и вписать её во **все** существующие вызовы `validateSwap`:

```ts
/** Мир, в котором ничего не запрещено. Спредится в каждый вызов, чтобы тест
 *  явно говорил, какие ограничения он проверяет, а какие снял. */
const open = { swapsLocked: false, fromExcluded: false, toExcluded: false } as const;
```

Пример правки существующего вызова — `...open` добавляется последним полем:

```ts
    const r = validateSwap({
      fromShift: from, toShift: to, fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now, ...open,
    });
```

Новый блок тестов в конец файла:

```ts
import { swapBlockReason } from "./swap";

describe("swapBlockReason", () => {
  it("ничего не запрещено — null", () => {
    expect(swapBlockReason({ swapsLocked: false, fromExcluded: false, toExcluded: false })).toBeNull();
  });

  // Порядок приоритета важен: человеку называют самую общую причину. «Обмены
  // закрыты для всех» полезнее, чем «тебе закрыли обмены», когда верно и то и другое.
  it("лок важнее личных исключений", () => {
    expect(swapBlockReason({ swapsLocked: true, fromExcluded: true, toExcluded: true })).toBe("swaps-locked");
  });

  it("своё исключение важнее чужого", () => {
    expect(swapBlockReason({ swapsLocked: false, fromExcluded: true, toExcluded: true })).toBe("from-excluded");
  });

  it("исключён только коллега", () => {
    expect(swapBlockReason({ swapsLocked: false, fromExcluded: false, toExcluded: true })).toBe("to-excluded");
  });
});

describe("validateSwap с ограничениями", () => {
  const from = shift({ id: 1, date: "2026-07-10", start: "09:00", end: "18:00", employeeId: 100 });
  const to = shift({ id: 2, date: "2026-07-10", start: "19:00", end: "23:00", employeeId: 200 });
  const base = {
    fromShift: from, toShift: to, fromEmployeeId: 100, toEmployeeId: 200,
    fromOtherShifts: [], toOtherShifts: [], now,
  };

  it("под локом отказывает", () => {
    expect(validateSwap({ ...base, ...open, swapsLocked: true }))
      .toEqual({ ok: false, reason: "swaps-locked" });
  });

  // Парный тест: те же самые данные без лока проходят. Без него первый тест
  // зеленел бы от любой другой причины отказа и не доказывал бы ничего.
  it("те же данные без лока проходят", () => {
    expect(validateSwap({ ...base, ...open })).toEqual({ ok: true });
  });

  // Ограничение стоит РАНЬШЕ проверок про сами смены: пара заведомо невалидна
  // (разные дни), и всё равно называется лок — иначе человек услышал бы причину,
  // которая исчезнет, если он выберет другую смену, а запрет останется.
  it("лок называется раньше, чем «разные дни»", () => {
    expect(validateSwap({ ...base, ...open, swapsLocked: true, toShift: shift({ id: 2, date: "2026-07-11", employeeId: 200 }) }))
      .toEqual({ ok: false, reason: "swaps-locked" });
  });

  it("исключён инициатор", () => {
    expect(validateSwap({ ...base, ...open, fromExcluded: true }))
      .toEqual({ ok: false, reason: "from-excluded" });
  });

  it("исключена вторая сторона", () => {
    expect(validateSwap({ ...base, ...open, toExcluded: true }))
      .toEqual({ ok: false, reason: "to-excluded" });
  });
});
```

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run shared/src/swap-validate.test.ts`
Expected: FAIL — `swapBlockReason` не экспортируется.

- [ ] **Шаг 3: Реализовать правило в `shared/src/swap.ts`**

Расширить `SwapRejectReason`, добавить функцию и поля контекста:

```ts
/**
 * Рантайм-массив, а не только объявление типа — по той же причине, что и
 * `AUDIT_TYPES` в `audit.ts`: тест на полноту таблицы русских подписей может
 * реально перебрать все значения, а не сверять два списка, набранных руками в
 * разных файлах. Причина, показанная человеку сырым кодом, — дефект, который в
 * этом проекте уже ловили.
 */
export const SWAP_REJECT_REASONS = [
  // Запреты, не зависящие от самих смен — см. `swapBlockReason`.
  "swaps-locked",
  "from-excluded",
  "to-excluded",
  "different-day",
  "from-shift-not-owned",
  "to-shift-not-owned",
  "from-shift-in-past",
  "to-shift-in-past",
  "double-booking-from",
  "double-booking-to",
  "identical-shift",
] as const;

export type SwapRejectReason = (typeof SWAP_REJECT_REASONS)[number];

/**
 * Почему обмен запрещён вне зависимости от того, какие смены выбраны, — или null.
 *
 * Отдельно от `validateSwap`, потому что мини-аппу это нужно ДО того, как вторая
 * смена вообще выбрана: погасить кнопку «Обменять» и вычистить список кандидатов.
 * Одна функция — один порядок приоритета на всех трёх поверхностях (сервер,
 * кнопка, список), иначе экран и сервер начнут называть разные причины.
 *
 * Порядок: сначала общий лок, потом своё исключение, потом чужое. Человеку
 * называют причину, которая от его действий не зависит.
 */
export function swapBlockReason(input: {
  swapsLocked: boolean;
  fromExcluded: boolean;
  toExcluded: boolean;
}): "swaps-locked" | "from-excluded" | "to-excluded" | null {
  if (input.swapsLocked) return "swaps-locked";
  if (input.fromExcluded) return "from-excluded";
  if (input.toExcluded) return "to-excluded";
  return null;
}
```

В `SwapContext` добавить три обязательных поля:

```ts
  /** Глобальный рубильник админа: обмены закрыты для всех. */
  swapsLocked: boolean;
  /** Инициатор выведен админом из обменов. */
  fromExcluded: boolean;
  /** Вторая сторона выведена админом из обменов. */
  toExcluded: boolean;
```

И в начало `validateSwap`, **после** двух проверок владения и **до** `different-day`:

```ts
  // Запреты, не зависящие от самих смен. Стоят раньше «разные дни / в прошлом /
  // та же смена»: выбор другой смены их не снимет, а причина, которую можно
  // «обойти», сбивает человека с толку сильнее, чем прямой запрет.
  const blocked = swapBlockReason(ctx);
  if (blocked) return { ok: false, reason: blocked };
```

Если `shared/src/index.ts` перечисляет экспорты руками — добавить туда `swapBlockReason`.

- [ ] **Шаг 4: Прогнать shared — зелёно**

Run: `npx vitest run shared/src/swap-validate.test.ts`
Expected: PASS.

- [ ] **Шаг 5: Написать падающие тесты сервиса**

В `server/src/swap/swap-service.test.ts` добавить импорты `setSwapsLocked` из `../repo/settings`, `employees` из `../db/schema`, `eq` из `drizzle-orm` и блок:

```ts
describe("swap service under admin restrictions", () => {
  it("createSwap refuses while swaps are locked, and allows once unlocked", () => {
    const { db, a, b, sa, sb } = setup();
    setSwapsLocked(db, true, b.id);
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW))
      .toEqual({ ok: false, reason: "swaps-locked" });
    setSwapsLocked(db, false, b.id);
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW).ok).toBe(true);
  });

  /**
   * The one test this whole feature rests on.
   *
   * The bot's «Принять» button calls `acceptSwap` directly (`bot.ts:459`), never
   * through an HTTP route — a guard placed in the route would leave that button
   * working while the Mini App was locked. The request here is created BEFORE the
   * lock, deliberately: `lockSwaps` (Task 3) cancels open requests, and a test
   * relying on that would be proving the cancellation, not the guard.
   */
  it("acceptSwap refuses while swaps are locked", () => {
    const { db, a, b, sa, sb } = setup();
    const proposed = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    setSwapsLocked(db, true, b.id);
    expect(acceptSwap(db, proposed.request.id, b.id, NOW))
      .toMatchObject({ ok: false, reason: "swaps-locked" });
  });

  it("decline and cancel stay open while swaps are locked", () => {
    const { db, a, b, sa, sb } = setup();
    const first = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    if (!first.ok) throw new Error("setup failed");
    setSwapsLocked(db, true, b.id);
    expect(declineSwap(db, first.request.id, b.id).ok).toBe(true);
  });

  it("createSwap refuses when the initiator is excluded, and allows once the flag is cleared", () => {
    const { db, a, b, sa, sb } = setup();
    db.update(employees).set({ excludedFromSwaps: true }).where(eq(employees.id, a.id)).run();
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW))
      .toEqual({ ok: false, reason: "from-excluded" });
    db.update(employees).set({ excludedFromSwaps: false }).where(eq(employees.id, a.id)).run();
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW).ok).toBe(true);
  });

  it("createSwap refuses when the counterparty is excluded", () => {
    const { db, a, b, sa, sb } = setup();
    db.update(employees).set({ excludedFromSwaps: true }).where(eq(employees.id, b.id)).run();
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW))
      .toEqual({ ok: false, reason: "to-excluded" });
  });
});
```

- [ ] **Шаг 6: Прогнать — красно**

Run: `npx vitest run server/src/swap/swap-service.test.ts`
Expected: FAIL — обмен проходит, потому что сервис ещё не читает ни лок, ни флаги.

- [ ] **Шаг 7: Применить правило в `swap-service.ts`**

Добавить импорты `isSwapsLocked` из `../repo/settings` и `getEmployeeById` из `../repo/employees`, и хелпер:

```ts
/** The three permission facts `validateSwap` needs, read from the database once
 *  per call. Kept here rather than at each call site so the two entrances — the
 *  Mini App route and the bot's «Принять» button — can never read them differently. */
function restrictionsFor(db: Db, fromEmployeeId: number, toEmployeeId: number) {
  return {
    swapsLocked: isSwapsLocked(db),
    fromExcluded: getEmployeeById(db, fromEmployeeId)?.excludedFromSwaps === true,
    toExcluded: getEmployeeById(db, toEmployeeId)?.excludedFromSwaps === true,
  };
}
```

В `createSwap` — в объект, передаваемый в `validateSwap`, добавить `...restrictionsFor(db, input.fromEmployeeId, toShift.employeeId)`.
В `acceptSwap` — аналогично `...restrictionsFor(db, req.fromEmployeeId, req.toEmployeeId)`.

- [ ] **Шаг 8: Прогнать — зелёно**

Run: `npx vitest run server/src/swap/swap-service.test.ts`
Expected: PASS.

- [ ] **Шаг 9: Перевести три новые причины на русский — оба фронта**

В `server/src/bot/bot.ts`, в `reasonToRu` перед `return "Не получилось"`:

```ts
  if (reason === "swaps-locked") return "Обмены сейчас закрыты админом";
  if (reason === "from-excluded") return "Тебе закрыли обмены смен";
  if (reason === "to-excluded") return "Коллеге закрыли обмены смен";
```

В `miniapp/src/screens/ProposeSwapScreen.tsx` — сделать таблицу экспортируемой (`export const SWAP_ERROR_MESSAGES`) и дополнить:

```ts
  // Три запрета, которые ставит админ. Список кандидатов их уже учитывает, так
  // что сюда попадают те, у кого экран провисел открытым дольше, чем действовало
  // разрешение.
  "swaps-locked": "Обмены сейчас закрыты — админ их приостановил.",
  "from-excluded": "Тебе закрыли обмены смен. Если это ошибка — напиши админу.",
  "to-excluded": "Этому коллеге закрыли обмены смен.",
```

- [ ] **Шаг 10: Сторож против сырого кода на экране**

Новый `miniapp/src/screens/propose-swap-reasons.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SWAP_REJECT_REASONS } from "@planer/shared";
import { SWAP_ERROR_MESSAGES } from "./ProposeSwapScreen";

describe("подписи причин отказа", () => {
  // Сырой код на экране — дефект, который в этом проекте уже ловили. Тест
  // перебирает рантайм-массив причин, поэтому новая причина без подписи
  // валит его, а не тихо доезжает до человека строкой «from-excluded».
  it("у каждой причины отказа есть русская фраза", () => {
    const missing = SWAP_REJECT_REASONS.filter((reason) => !SWAP_ERROR_MESSAGES[reason]);
    expect(missing).toEqual([]);
  });
});
```

В `server/src/bot/bot.ts` — экспортировать `reasonToRu` (`export function reasonToRu`), и в `server/src/bot/bot.test.ts` дописать:

```ts
  it("names each admin-set restriction in Russian rather than as a code", () => {
    expect(reasonToRu("swaps-locked")).toBe("Обмены сейчас закрыты админом");
    expect(reasonToRu("from-excluded")).toBe("Тебе закрыли обмены смен");
    expect(reasonToRu("to-excluded")).toBe("Коллеге закрыли обмены смен");
  });
```

Run: `npx vitest run miniapp/src/screens/propose-swap-reasons.test.ts server/src/bot/bot.test.ts`
Expected: PASS.

- [ ] **Шаг 11: Проверить, что главный тест умеет падать**

```bash
git stash push -- server/src/swap/swap-service.ts
npx vitest run server/src/swap/swap-service.test.ts   # обязан быть КРАСНЫМ
git stash pop
```

- [ ] **Шаг 12: Гейт и коммит**

```bash
npm test && npm run typecheck
git add shared/src/swap.ts shared/src/swap-validate.test.ts shared/src/index.ts \
        server/src/swap/swap-service.ts server/src/swap/swap-service.test.ts \
        server/src/bot/bot.ts server/src/bot/bot.test.ts \
        miniapp/src/screens/ProposeSwapScreen.tsx miniapp/src/screens/propose-swap-reasons.test.ts
git commit -m "feat(swaps): правило swapBlockReason закрывает оба входа обмена"
```

---

## Task 3: Смена лока и гашение открытых заявок

**Files:**
- Create: `server/src/swap/swap-lock.ts`
- Test: `server/src/swap/swap-lock.test.ts`

**Interfaces:**
- Consumes: `setSwapsLocked` (Task 1), `swapAuditPayload` из `server/src/util/message-lines.ts`
- Produces: `setSwapLock(db: Db, locked: boolean, actorEmployeeId: number): SwapAuditPayload[]`, `cancelSwapsForEmployee(db: Db, employeeId: number): SwapAuditPayload[]`

- [ ] **Шаг 1: Написать падающий тест**

`server/src/swap/swap-lock.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { createSwapRequest, getSwapRequest, setSwapStatus } from "../repo/swaps";
import { isSwapsLocked } from "../repo/settings";
import { setSwapLock, cancelSwapsForEmployee } from "./swap-lock";

function setup() {
  const db = makeTestDb();
  const anya = createEmployee(db, { displayName: "Аня Смирнова" });
  const igor = createEmployee(db, { displayName: "Игорь Петров" });
  const mark = createEmployee(db, { displayName: "Марк Волков" });
  const anyaShift = createShift(db, { date: "2026-08-13", start: "09:00", end: "18:00", employeeId: anya.id });
  const igorShift = createShift(db, { date: "2026-08-13", start: "12:00", end: "21:00", employeeId: igor.id });
  const markShift = createShift(db, { date: "2026-08-14", start: "09:00", end: "18:00", employeeId: mark.id });
  return { db, anya, igor, mark, anyaShift, igorShift, markShift };
}

describe("setSwapLock", () => {
  it("locks, cancels every pending request, and reports them", () => {
    const { db, anya, igor, anyaShift, igorShift } = setup();
    const request = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id,
      toEmployeeId: igor.id, toShiftId: igorShift.id,
    });

    const cancelled = setSwapLock(db, true, igor.id);

    expect(isSwapsLocked(db)).toBe(true);
    expect(getSwapRequest(db, request.id)?.status).toBe("cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({
      requestId: request.id,
      fromEmployeeId: anya.id,
      fromName: "Аня Смирнова",
      toEmployeeId: igor.id,
      toName: "Игорь Петров",
    });
  });

  // Settled requests are history. Rewriting them would make the archive lie about
  // what happened, and would notify people about a trade that finished days ago.
  it("leaves already-resolved requests alone", () => {
    const { db, anya, igor, anyaShift, igorShift } = setup();
    const request = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id,
      toEmployeeId: igor.id, toShiftId: igorShift.id,
    });
    setSwapStatus(db, request.id, "declined");

    const cancelled = setSwapLock(db, true, igor.id);

    expect(cancelled).toEqual([]);
    expect(getSwapRequest(db, request.id)?.status).toBe("declined");
  });

  it("unlocking cancels nothing and revives nothing", () => {
    const { db, anya, igor, anyaShift, igorShift } = setup();
    const request = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id,
      toEmployeeId: igor.id, toShiftId: igorShift.id,
    });
    setSwapLock(db, true, igor.id);
    const onUnlock = setSwapLock(db, false, igor.id);
    expect(isSwapsLocked(db)).toBe(false);
    expect(onUnlock).toEqual([]);
    expect(getSwapRequest(db, request.id)?.status).toBe("cancelled");
  });
});

describe("cancelSwapsForEmployee", () => {
  it("cancels the person's requests in both directions and leaves other people's alone", () => {
    const { db, anya, igor, mark, anyaShift, igorShift, markShift } = setup();
    const outgoing = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id,
      toEmployeeId: igor.id, toShiftId: igorShift.id,
    });
    const incoming = createSwapRequest(db, {
      fromEmployeeId: mark.id, fromShiftId: markShift.id,
      toEmployeeId: anya.id, toShiftId: anyaShift.id,
    });
    const untouched = createSwapRequest(db, {
      fromEmployeeId: igor.id, fromShiftId: igorShift.id,
      toEmployeeId: mark.id, toShiftId: markShift.id,
    });

    const cancelled = cancelSwapsForEmployee(db, anya.id);

    expect(cancelled.map((p) => p.requestId).sort()).toEqual([outgoing.id, incoming.id].sort());
    expect(getSwapRequest(db, outgoing.id)?.status).toBe("cancelled");
    expect(getSwapRequest(db, incoming.id)?.status).toBe("cancelled");
    expect(getSwapRequest(db, untouched.id)?.status).toBe("pending");
  });
});
```

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run server/src/swap/swap-lock.test.ts`
Expected: FAIL — `Cannot find module './swap-lock'`.

- [ ] **Шаг 3: Реализовать**

`server/src/swap/swap-lock.ts`:

```ts
import { and, eq, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { swapRequests } from "../db/schema";
import { setSwapsLocked } from "../repo/settings";
import { swapAuditPayload, type SwapAuditPayload } from "../util/message-lines";

/**
 * Flipping the team-wide swap lock, and what it costs the people mid-trade.
 *
 * Locking cancels every still-open request: the counterparty is holding a chat
 * message with live-looking «Принять»/«Отклонить» buttons whose only possible
 * answer would now be an error. The same thing already happens when an accepted
 * swap knocks out its siblings, so this is the established shape, not a new idea.
 *
 * Everything here is synchronous and inside one transaction, and the caller does
 * the `await` messaging AFTERWARDS. That ordering is not stylistic: the `races`
 * audit lens already caught a double broadcast in this codebase caused by a
 * status guard written *after* a loop of awaits.
 */

/** Payloads of the requests this call cancelled — for the caller to notify from. */
export function setSwapLock(db: Db, locked: boolean, actorEmployeeId: number): SwapAuditPayload[] {
  // Read the payloads BEFORE the status changes: `swapAuditPayload` resolves
  // names and shift lines, and those must describe the trade as it stood.
  const pending = locked ? listPending(db) : [];
  const payloads = pending.map((request) => swapAuditPayload(db, request));

  db.transaction((tx) => {
    // `setSwapsLocked` takes `DbOrTx` precisely so this needs no cast: the flag
    // and the cancellations are one fact, and half of it landing is worse than
    // neither — an admin would see «закрыто» while the buttons still worked.
    setSwapsLocked(tx, locked, actorEmployeeId);
    cancelAll(tx, pending);
  });

  return payloads;
}

/** Same, for one person being taken out of swaps: their open requests, both ways. */
export function cancelSwapsForEmployee(db: Db, employeeId: number): SwapAuditPayload[] {
  const pending = db
    .select()
    .from(swapRequests)
    .where(and(
      eq(swapRequests.status, "pending"),
      or(eq(swapRequests.fromEmployeeId, employeeId), eq(swapRequests.toEmployeeId, employeeId)),
    ))
    .all();
  const payloads = pending.map((request) => swapAuditPayload(db, request));

  db.transaction((tx) => cancelAll(tx, pending));

  return payloads;
}

function listPending(db: Db) {
  return db.select().from(swapRequests).where(eq(swapRequests.status, "pending")).all();
}

/** The one write both callers make. Extracted so the two paths cannot drift on
 *  what «cancelled» means or on whether `resolvedAt` gets stamped. */
function cancelAll(tx: DbOrTx, pending: readonly { id: number }[]): void {
  for (const request of pending) {
    tx.update(swapRequests)
      .set({ status: "cancelled", resolvedAt: new Date() })
      .where(eq(swapRequests.id, request.id))
      .run();
  }
}
```

`DbOrTx` is imported from `../repo/settings` alongside `setSwapsLocked`.

- [ ] **Шаг 4: Прогнать — зелёно**

Run: `npx vitest run server/src/swap/swap-lock.test.ts`
Expected: PASS, 4 теста.

- [ ] **Шаг 5: Проверить падаемость и закоммитить**

```bash
git stash push -- server/src/swap/swap-lock.ts
npx vitest run server/src/swap/swap-lock.test.ts   # КРАСНЫЙ
git stash pop
npm test && npm run typecheck
git add server/src/swap/swap-lock.ts server/src/swap/swap-lock.test.ts
git commit -m "feat(swaps): включение лока гасит открытые заявки"
```

---

## Task 4: Тексты уведомлений — одно письмо на человека

**Files:**
- Create: `server/src/swap/swap-lock-notice.ts`
- Test: `server/src/swap/swap-lock-notice.test.ts`

**Interfaces:**
- Consumes: `SwapAuditPayload` из `server/src/util/message-lines.ts`
- Produces: `buildSwapLockNotices(input: { locked: boolean; team: readonly NoticeTarget[]; cancelled: readonly SwapAuditPayload[] }): OutgoingNotice[]`, `buildExclusionNotices(input: { excluded: boolean; person: NoticeTarget; others: readonly NoticeTarget[]; cancelled: readonly SwapAuditPayload[] }): OutgoingNotice[]`, типы `NoticeTarget = { id: number; telegramUserId: number | null }` и `OutgoingNotice = { telegramUserId: number; text: string }`

**Отступление от спеки, осознанное.** В спеке у погашенной заявки было два разных текста — «Твоя заявка с …» для получателя лока и «Заявка на обмен с …» для второй стороны исключённого. Здесь **один** нейтральный билдер строки на оба случая: причину объясняет шапка письма, а два почти одинаковых текста в двух местах — это два места, где они разъедутся.

- [ ] **Шаг 1: Написать падающий тест**

`server/src/swap/swap-lock-notice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSwapLockNotices, buildExclusionNotices } from "./swap-lock-notice";
import type { SwapAuditPayload } from "../util/message-lines";

const ANYA = { id: 1, telegramUserId: 1001 };
const IGOR = { id: 2, telegramUserId: 1002 };
const MARK = { id: 3, telegramUserId: null };

const trade = (over: Partial<SwapAuditPayload> = {}): SwapAuditPayload => ({
  requestId: 10,
  fromEmployeeId: ANYA.id, fromName: "Аня Смирнова", fromShift: "Чт 13 авг · 09:00–18:00",
  toEmployeeId: IGOR.id, toName: "Игорь Петров", toShift: "Чт 13 авг · 12:00–21:00",
  ...over,
});

describe("buildSwapLockNotices", () => {
  it("tells the whole reachable team that swaps are closed", () => {
    const notices = buildSwapLockNotices({ locked: true, team: [ANYA, IGOR, MARK], cancelled: [] });
    // Марк has no Telegram account, so there is nowhere to send and nothing to count.
    expect(notices.map((n) => n.telegramUserId)).toEqual([1001, 1002]);
    expect(notices[0]!.text).toContain("🔒 Обмены смен закрыты.");
  });

  /**
   * One message per person, not one per request. Somebody with two open trades
   * used to be the case that produced three separate messages in one second.
   */
  it("folds every cancelled request of one person into a single message", () => {
    const notices = buildSwapLockNotices({
      locked: true,
      team: [ANYA, IGOR],
      cancelled: [trade(), trade({ requestId: 11, toShift: "Пт 14 авг · 10:00–19:00" })],
    });
    const forAnya = notices.find((n) => n.telegramUserId === 1001)!;
    expect(forAnya.text.match(/отменена/g)).toHaveLength(2);
    expect(notices).toHaveLength(2);
  });

  /**
   * The line names the OTHER side and the shift the reader was giving up: on
   * Anya's phone the useful fact is «this was with Igor», on Igor's it is the
   * reverse. Names stay in the nominative — the database has one display name and
   * nothing that would let us decline it, same rule as the birthday messages.
   */
  it("names the counterparty from the reader's point of view", () => {
    const notices = buildSwapLockNotices({ locked: true, team: [ANYA, IGOR], cancelled: [trade()] });
    const forAnya = notices.find((n) => n.telegramUserId === 1001)!;
    const forIgor = notices.find((n) => n.telegramUserId === 1002)!;
    expect(forAnya.text).toContain("Игорь Петров");
    // Her own shift, not his — the line is written from the reader's side.
    expect(forAnya.text).toContain("Чт 13 авг · 09:00–18:00");
    expect(forIgor.text).toContain("Аня Смирнова");
    expect(forIgor.text).toContain("Чт 13 авг · 12:00–21:00");
  });

  it("says nothing about requests when unlocking", () => {
    const notices = buildSwapLockNotices({ locked: false, team: [ANYA, IGOR], cancelled: [] });
    expect(notices[0]!.text).toBe("🔓 Обмены смен снова открыты.");
  });
});

describe("buildExclusionNotices", () => {
  it("tells the person, and tells each counterparty without naming the cause", () => {
    const notices = buildExclusionNotices({
      excluded: true, person: ANYA, others: [IGOR], cancelled: [trade()],
    });
    const forAnya = notices.find((n) => n.telegramUserId === 1001)!;
    const forIgor = notices.find((n) => n.telegramUserId === 1002)!;
    expect(forAnya.text).toContain("🔒 Тебе закрыли обмены смен.");
    // An admin's decision about one person is not broadcast to the rest.
    expect(forIgor.text).not.toContain("закрыли");
    expect(forIgor.text).toContain("Заявка на обмен — Аня Смирнова");
  });

  it("clearing the flag writes to that person only", () => {
    const notices = buildExclusionNotices({
      excluded: false, person: ANYA, others: [IGOR], cancelled: [],
    });
    expect(notices).toEqual([{ telegramUserId: 1001, text: "🔓 Тебе снова доступны обмены смен." }]);
  });

  /**
   * Guards the asymmetry that the two builders had before `linesFor` existed:
   * the lock builder suppressed cancellation lines when unlocking, this one did
   * not. A stale `cancelled` threaded in by a caller would have made «снова
   * доступны» sprout a list of requests that nothing had just cancelled.
   */
  it("«снова доступны» never grows cancellation lines, even if some are passed in", () => {
    const notices = buildExclusionNotices({
      excluded: false, person: ANYA, others: [], cancelled: [trade()],
    });
    expect(notices).toEqual([{ telegramUserId: 1001, text: "🔓 Тебе снова доступны обмены смен." }]);
  });
});
```

**Почему фраза построена через тире, а не «заявка с Игорем».** В базе лежит только именительный падеж, склонять русские фамилии кодом мы не будем — цена ошибки на живых людях высокая, а выигрыш косметический. Поэтому формулировка обходит падеж: `Заявка на обмен — Игорь Петров, Чт 13 авг · 12:00–21:00 — отменена.` Ровно тот же приём уже применён в поздравлениях с днём рождения (`defaultMessage` в `birthday-service.ts`), и там он выбран по той же причине.

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run server/src/swap/swap-lock-notice.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Шаг 3: Реализовать**

`server/src/swap/swap-lock-notice.ts`:

```ts
import type { SwapAuditPayload } from "../util/message-lines";

/**
 * What goes out when an admin closes swaps, or takes one person out of them.
 *
 * Pure on purpose — no database, no bot, no clock. The route reads the team, the
 * lock service returns the cancelled trades, and this decides who hears what. It
 * is the only place that knows the wording, so a change lands on every path.
 *
 * ONE message per person, never one per request: the schedule-change feature
 * settled that rule, and somebody with two open trades is exactly the case that
 * makes three near-identical messages arrive in the same second.
 *
 * Names stay in the nominative. We store one display name and nothing that would
 * let us decline it, and «заявка с Игорь Петров» is the sort of thing that gets
 * noticed when it lands in 25 chats at once — same rule as `defaultMessage` in
 * the birthday service.
 */

export interface NoticeTarget {
  id: number;
  telegramUserId: number | null;
}

export interface OutgoingNotice {
  telegramUserId: number;
  text: string;
}

const LOCKED_HEADER = [
  "🔒 Обмены смен закрыты.",
  "Пока админ не откроет их обратно, предложить или принять обмен нельзя.",
].join("\n");

const UNLOCKED_HEADER = "🔓 Обмены смен снова открыты.";

/**
 * One cancelled trade, from the reader's side: the OTHER person's name and the
 * reader's OWN shift — «Заявка на обмен — Игорь Петров, Чт 13 авг · 12:00–21:00 —
 * отменена.» On the other phone the same trade reads the other way round.
 */
function cancelledLine(readerId: number, trade: SwapAuditPayload): string {
  const isInitiator = readerId === trade.fromEmployeeId;
  const otherName = isInitiator ? trade.toName : trade.fromName;
  const ownShift = isInitiator ? trade.fromShift : trade.toShift;
  return `Заявка на обмен — ${otherName}, ${ownShift} — отменена.`;
}

/**
 * Every cancelled trade this person was part of, already worded for them.
 *
 * All three recipient paths below need exactly this, and three copies of
 * «filter by id, map through cancelledLine» is three chances for them to drift
 * on who counts as involved — which is how one path ended up appending lines
 * regardless of whether anything had actually been cancelled.
 */
function linesFor(personId: number, cancelled: readonly SwapAuditPayload[]): string[] {
  return cancelled
    .filter((trade) => trade.fromEmployeeId === personId || trade.toEmployeeId === personId)
    .map((trade) => cancelledLine(personId, trade));
}

export function buildSwapLockNotices(input: {
  locked: boolean;
  team: readonly NoticeTarget[];
  cancelled: readonly SwapAuditPayload[];
}): OutgoingNotice[] {
  return input.team.flatMap((person) => {
    if (person.telegramUserId == null) return [];
    const lines = [input.locked ? LOCKED_HEADER : UNLOCKED_HEADER];
    // Unlocking cancels nothing, so there is never anything to append to it.
    const mine = input.locked ? linesFor(person.id, input.cancelled) : [];
    if (mine.length > 0) lines.push("", ...mine);
    return [{ telegramUserId: person.telegramUserId, text: lines.join("\n") }];
  });
}

export function buildExclusionNotices(input: {
  excluded: boolean;
  person: NoticeTarget;
  others: readonly NoticeTarget[];
  cancelled: readonly SwapAuditPayload[];
}): OutgoingNotice[] {
  const notices: OutgoingNotice[] = [];

  if (input.person.telegramUserId != null) {
    const lines = [
      input.excluded
        ? "🔒 Тебе закрыли обмены смен. Если это ошибка — напиши админу."
        : "🔓 Тебе снова доступны обмены смен.",
    ];
    // Same guard as the lock builder: clearing the flag cancels nothing, so
    // «снова доступны» must never grow a list of cancelled requests under it.
    const mine = input.excluded ? linesFor(input.person.id, input.cancelled) : [];
    if (mine.length > 0) lines.push("", ...mine);
    notices.push({ telegramUserId: input.person.telegramUserId, text: lines.join("\n") });
  }

  // The other side hears WHAT happened, never WHY: an admin's decision about one
  // person is not something the rest of the team is told.
  for (const other of input.others) {
    if (other.telegramUserId == null) continue;
    const mine = linesFor(other.id, input.cancelled);
    if (mine.length === 0) continue;
    notices.push({ telegramUserId: other.telegramUserId, text: mine.join("\n") });
  }

  return notices;
}
```

- [ ] **Шаг 4: Прогнать, проверить падаемость, закоммитить**

```bash
npx vitest run server/src/swap/swap-lock-notice.test.ts   # PASS
git stash push -- server/src/swap/swap-lock-notice.ts
npx vitest run server/src/swap/swap-lock-notice.test.ts   # КРАСНЫЙ
git stash pop
npm test && npm run typecheck
git add server/src/swap/swap-lock-notice.ts server/src/swap/swap-lock-notice.test.ts
git commit -m "feat(swaps): тексты уведомлений о локе — одно письмо на человека"
```

---

## Task 5: Роуты настроек, рассылка и журнал

**Files:**
- Modify: `shared/src/audit.ts` (`AUDIT_TYPES` + описатель)
- Modify: `server/src/http/app.ts` (два новых роута рядом с `/api/admin/events`, ~строка 518)
- Test: `shared/src/audit.test.ts`, `server/src/http/settings-route.test.ts` (файл существует — дописать)

**Interfaces:**
- Consumes: `setSwapLock` (Task 3), `buildSwapLockNotices` (Task 4), `swapsLockSetting` (Task 1)
- Produces: `GET /api/admin/settings` → `{ swapsLocked: boolean; swapsLockUpdatedAt: string | null; swapsLockUpdatedBy: string | null }`; `PUT /api/admin/settings/swaps-lock` тело `{ locked: boolean }` → `{ locked: boolean; cancelled: number; delivered: number; intended: number }`; тип аудита `swaps_lock_changed`

- [ ] **Шаг 1: Написать падающие тесты**

В `server/src/http/settings-route.test.ts` дописать (используя тот же способ поднятия приложения и выдачи админского токена, что уже применён в этом файле):

**Тесты роутов обязаны стоять на непустых данных.** Прогон на базе без людей и без открытых заявок даст `cancelled: 0`, `delivered: 0`, `intended: 0` — и пройдёт при любой, в том числе сломанной, арифметике. Поэтому happy-path тест **сначала заводит двух работников с привязанным телеграмом и открытую заявку между ними**, и только потом дёргает лок.

```ts
  it("PUT /api/admin/settings/swaps-lock closes swaps and reports what it cost", async () => {
    // ... поднять app и админский токен ровно как в соседних тестах файла ...
    // Two reachable people and one open request between them: on an empty
    // database every count below is zero, and a zero proves nothing about the
    // arithmetic that produced it.
    const anya = createEmployee(db, { displayName: "Аня Смирнова", telegramUserId: 1001 });
    const igor = createEmployee(db, { displayName: "Игорь Петров", telegramUserId: 1002 });
    const anyaShift = createShift(db, { date: "2026-08-13", start: "09:00", end: "18:00", employeeId: anya.id });
    const igorShift = createShift(db, { date: "2026-08-13", start: "12:00", end: "21:00", employeeId: igor.id });
    createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id,
      toEmployeeId: igor.id, toShiftId: igorShift.id,
    });

    const res = await app.request("/api/admin/settings/swaps-lock", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ locked: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locked).toBe(true);
    expect(body.cancelled).toBe(1);
    // `intended` counts everyone the notice was addressed to. The admin who
    // pressed the button is an employee too, so this is the reachable headcount,
    // not the number of people in the swap.
    expect(body.intended).toBeGreaterThan(0);
    expect(body.delivered).toBeLessThanOrEqual(body.intended);

    const state = await app.request("/api/admin/settings", { headers: { authorization: `Bearer ${token}` } });
    expect(await state.json()).toMatchObject({ swapsLocked: true, swapsLockUpdatedBy: "Игорь Петров" });
  });

  // The other half of the pair: unlocking must report an honest zero and must
  // not reach into anybody's requests.
  it("PUT /api/admin/settings/swaps-lock reopening cancels nothing", async () => {
    // ... same seeding as above, then lock, then unlock ...
    const res = await app.request("/api/admin/settings/swaps-lock", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ locked: false }),
    });
    expect(await res.json()).toMatchObject({ locked: false, cancelled: 0 });
  });

  it("PUT /api/admin/settings/swaps-lock rejects a non-boolean body", async () => {
    const res = await app.request("/api/admin/settings/swaps-lock", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ locked: "yes" }),
    });
    expect(res.status).toBe(400);
    // Pin the wording too: a refusal a person reads must stay Russian.
    expect((await res.json()).error).toBe("locked должен быть true или false");
  });

  it("locking writes one journal row naming what happened", async () => {
    // ... after the seeded PUT above ...
    const events = await (await app.request("/api/admin/journal", { headers: { authorization: `Bearer ${token}` } })).json();
    expect(events.events[0]).toMatchObject({ type: "swaps_lock_changed" });
    expect(events.events[0].payload).toMatchObject({ locked: true, cancelled: 1 });
  });
```

**Теста «GET /api/admin/settings is admin-only» здесь НЕТ, и это осознанно.** Весь префикс `/api/admin/*` закрыт общим middleware (`app.use("/api/admin/*", requireAdmin(...))`), у которого есть свой тест — `server/src/http/admin-guard.test.ts`. Такой тест на новом роуте зеленел бы и при полностью отсутствующем роуте: `git stash push -- server/src/http/app.ts` не сделал бы его красным. Это ровно «тест, который не может упасть», и добавлять его — театр, а не проверка.

В `shared/src/audit.test.ts` дописать:

```ts
  it("описывает закрытие и открытие обменов", () => {
    const closed = describeAuditEvent({
      type: "swaps_lock_changed",
      payload: { locked: true, cancelled: 3, delivered: 24, intended: 26 },
    });
    expect(closed.title).toBe("Обмены смен закрыты");
    expect(closed.lines).toContain("отменено заявок: 3");
    expect(closed.lines).toContain("дошло до 24 из 26");

    const opened = describeAuditEvent({ type: "swaps_lock_changed", payload: { locked: false, cancelled: 0, delivered: 26, intended: 26 } });
    expect(opened.title).toBe("Обмены смен открыты");
    // Открытие ничего не гасит — строки про заявки быть не должно.
    expect(opened.lines.some((line) => line.startsWith("отменено"))).toBe(false);
  });
```

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run shared/src/audit.test.ts server/src/http/settings-route.test.ts`
Expected: FAIL — тип `swaps_lock_changed` неизвестен, роутов нет.

- [ ] **Шаг 3: Тип и описатель аудита**

В `shared/src/audit.ts` в массив `AUDIT_TYPES` добавить `"swaps_lock_changed"` (рядом со `swap_*`), и в `DESCRIBERS`:

```ts
  swaps_lock_changed: (p) => ({
    icon: "🔒",
    title: p.locked === true ? "Обмены смен закрыты" : "Обмены смен открыты",
    lines: [
      ...(p.locked === true ? [`отменено заявок: ${num(p.cancelled) ?? 0}`] : []),
      `дошло до ${num(p.delivered) ?? 0} из ${num(p.intended) ?? 0}`,
    ],
  }),
```

- [ ] **Шаг 4: Роуты**

В `server/src/http/app.ts` добавить импорты `swapsLockSetting`, `isSwapsLocked` из `../repo/settings`, `setSwapLock` из `../swap/swap-lock`, `buildSwapLockNotices` из `../swap/swap-lock-notice`, и рядом с `/api/admin/events`:

```ts
  app.get("/api/admin/settings", requireAdmin(db, config.jwtSecret), (c) => {
    const setting = swapsLockSetting(db);
    const actor = setting?.updatedByEmployeeId == null ? undefined : getEmployeeById(db, setting.updatedByEmployeeId);
    return c.json({
      swapsLocked: isSwapsLocked(db),
      swapsLockUpdatedAt: setting?.updatedAt?.toISOString() ?? null,
      swapsLockUpdatedBy: actor?.displayName ?? null,
    });
  });

  /**
   * The team-wide swap switch.
   *
   * Order matters and is not stylistic: the database write and the cancellation
   * happen first, synchronously, in one transaction; only then does the awaited
   * broadcast run. The `races` lens already caught a double broadcast in this
   * codebase that came from writing a status guard *after* a loop of awaits.
   */
  app.put("/api/admin/settings/swaps-lock", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { locked?: unknown };
    if (typeof body.locked !== "boolean") return c.json({ error: "locked должен быть true или false" }, 400);

    const actorId = c.get("auth").employeeId;
    const cancelled = setSwapLock(db, body.locked, actorId);

    const team = listActive(db);
    const notices = buildSwapLockNotices({ locked: body.locked, team, cancelled });
    let delivered = 0;
    if (bot) {
      for (const notice of notices) {
        if (await notifyUser(bot, notice.telegramUserId, notice.text)) delivered += 1;
      }
    }
    const reach = { delivered, intended: notices.length };

    recordAudit(db, "swaps_lock_changed", actorId, { locked: body.locked, cancelled: cancelled.length, ...reach });
    return c.json({ locked: body.locked, cancelled: cancelled.length, ...reach });
  });
```

`notifyUser` (`server/src/bot/notify.ts:94`) уже возвращает `Promise<boolean>` — «дошло / не дошло», с логированием внутри. Считать `delivered` инкрементом по этому значению и **не** заводить свой try/catch: способ подсчёта доставки в проекте должен остаться один.

- [ ] **Шаг 5: Прогнать, проверить падаемость, закоммитить**

```bash
npx vitest run shared/src/audit.test.ts server/src/http/settings-route.test.ts   # PASS
git stash push -- server/src/http/app.ts
npx vitest run server/src/http/settings-route.test.ts   # КРАСНЫЙ
git stash pop
npm test && npm run typecheck
git add shared/src/audit.ts shared/src/audit.test.ts server/src/http/app.ts server/src/http/settings-route.test.ts
git commit -m "feat(api): роуты лока обменов, рассылка и строка журнала"
```

---

## Task 6: Десктоп-консоль — раздел «Настройки»

**Files:**
- Create: `admin/src/screens/SettingsScreen.tsx`
- Create: `admin/src/screens/settings.test.tsx`
- Modify: `admin/src/api/client.ts` (тип + два метода в `ApiClient` и в реализации)
- Modify: `admin/src/components/Sidebar.tsx` (`NavKey` + пункт + иконка)
- Modify: `admin/src/App.tsx` (ветка рендера)

**Interfaces:**
- Consumes: `GET /api/admin/settings`, `PUT /api/admin/settings/swaps-lock` (Task 5)
- Produces: `AdminSettings { swapsLocked: boolean; swapsLockUpdatedAt: string | null; swapsLockUpdatedBy: string | null }`, `apiClient.getSettings()`, `apiClient.setSwapsLock(locked: boolean): Promise<{ locked: boolean; cancelled: number; delivered: number; intended: number }>`, `NavKey` расширен значением `"settings"`

- [ ] **Шаг 1: Написать падающий DOM-тест**

`admin/src/screens/settings.test.tsx` — рецепт целиком снят с `admin/src/screens/employees-error.test.tsx` (jsdom + `vi.spyOn(apiClient, …)`):

```tsx
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { SettingsScreen } from "./SettingsScreen";

/**
 * «Настройки» — один тумблер, который пишет всей команде разом.
 *
 * Два требования здесь не косметические. Подтверждение второго нажатия — потому
 * что это единственное действие в консоли, после которого 26 человек получают
 * сообщение, и отменить его нельзя. Ошибка рядом с тумблером, а не вместо него —
 * потому что из состояния «на экране только текст ошибки» нет выхода без F5;
 * этот класс дефекта в проекте уже ловили дважды.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPEN = { swapsLocked: false, swapsLockUpdatedAt: "2026-08-07T11:30:00.000Z", swapsLockUpdatedBy: "Игорь Петров" };

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(SettingsScreen)));
  await settle();
  return host;
}

/** Кнопка по её подписи — так же, как её ищет глазами человек. */
function buttonWith(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`нет кнопки с текстом «${text}»`);
  return found as HTMLButtonElement;
}

describe("SettingsScreen", () => {
  it("показывает состояние обменов и кто его менял", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(OPEN);
    const el = await mount();
    expect(el.textContent ?? "").toContain("Открыты");
    expect(el.textContent ?? "").toContain("Игорь Петров");
  });

  it("первое нажатие не отправляет запрос, а спрашивает подтверждение", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(OPEN);
    const setLock = vi.spyOn(apiClient, "setSwapsLock");
    const el = await mount();

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();

    expect(setLock).not.toHaveBeenCalled();
    expect(el.textContent ?? "").toContain("Да, закрыть");
  });

  it("подтверждение закрывает обмены и называет цену", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(OPEN);
    const setLock = vi.spyOn(apiClient, "setSwapsLock")
      .mockResolvedValue({ locked: true, cancelled: 2, delivered: 24, intended: 26 });
    const el = await mount();

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();
    await act(async () => buttonWith(el, "Да, закрыть").click());
    await settle();

    expect(setLock).toHaveBeenCalledTimes(1);
    expect(setLock).toHaveBeenCalledWith(true);
    const shown = el.textContent ?? "";
    expect(shown).toContain("2");   // отменённые заявки
    expect(shown).toContain("24");  // дошло
    expect(shown).toContain("26");  // из скольких
  });

  it("ошибка сохранения показывается рядом с тумблером, а не вместо него", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(OPEN);
    vi.spyOn(apiClient, "setSwapsLock").mockRejectedValue(new Error("сеть недоступна"));
    const el = await mount();

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();
    await act(async () => buttonWith(el, "Да, закрыть").click());
    await settle();

    expect(el.textContent ?? "").toContain("сеть недоступна");
    // Тумблер обязан остаться на экране: иначе из этого состояния нет выхода без F5.
    expect(buttonWith(el, "Закрыть обмены")).toBeTruthy();
  });

  /**
   * Окно между «сервер ответил» и «экран перечитан».
   *
   * `confirming` сбрасывается сразу после ответа `setSwapsLock`, а `saving` —
   * только в `finally`, после `reload()`. Между ними экран рисует состояние
   * `confirming=false, saving=true`: подтверждения на экране уже нет, а ОСНОВНАЯ
   * кнопка снова видна. Если она не погашена — второе нажатие уходит вторым
   * сообщением всей команде.
   *
   * Поэтому тест держит незавершённым именно `reload()` (второй `getSettings`),
   * а не `setSwapsLock`, и щупает ОСНОВНУЮ кнопку. Проверка кнопки
   * подтверждения тут ничего не стоит: у неё `disabled` был и до починки, и до
   * этого окна экран всё равно не доходит.
   *
   * Подпись основной кнопки в этом окне ещё старая («Закрыть обмены»): она
   * считается от `settings.swapsLocked`, а `settings` обновится только после
   * перечитывания.
   */
  it("в окне между ответом и перечитыванием основная кнопка погашена", async () => {
    let releaseReload!: (value: AdminSettings) => void;
    vi.spyOn(apiClient, "getSettings")
      .mockResolvedValueOnce(OPEN)
      .mockReturnValueOnce(new Promise((resolve) => { releaseReload = resolve; }));
    vi.spyOn(apiClient, "setSwapsLock")
      .mockResolvedValue({ locked: true, cancelled: 0, delivered: 1, intended: 1 });
    const el = await mount();

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();
    await act(async () => buttonWith(el, "Да, закрыть").click());
    await settle();

    expect(buttonWith(el, "Закрыть обмены").disabled).toBe(true);

    await act(async () => releaseReload({ ...OPEN, swapsLocked: true }));
    await settle();
  });

  it("взведение убирает ошибку прошлой попытки", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(OPEN);
    vi.spyOn(apiClient, "setSwapsLock").mockRejectedValue(new Error("сеть недоступна"));
    const el = await mount();

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();
    await act(async () => buttonWith(el, "Да, закрыть").click());
    await settle();
    expect(el.textContent ?? "").toContain("сеть недоступна");

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();
    // Старый отказ рядом с новым подтверждением читается как отказ на него.
    expect(el.textContent ?? "").not.toContain("сеть недоступна");
  });

  it("если тумблер ни разу не трогали, так и написано", async () => {
    vi.spyOn(apiClient, "getSettings")
      .mockResolvedValue({ swapsLocked: false, swapsLockUpdatedAt: null, swapsLockUpdatedBy: null });
    const el = await mount();
    expect(el.textContent ?? "").toContain("Ни разу не меняли");
  });
});
```

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run admin/src/screens/settings.test.tsx`
Expected: FAIL — `Cannot find module './SettingsScreen'`.

- [ ] **Шаг 3: Клиент**

В `admin/src/api/client.ts` добавить тип и методы в интерфейс `ApiClient` и в реализацию (по образцу соседних методов, тем же `request`-хелпером, каким сделан `getEvents`):

```ts
export interface AdminSettings {
  swapsLocked: boolean;
  /** ISO-строка или null, если тумблер ни разу не трогали. */
  swapsLockUpdatedAt: string | null;
  swapsLockUpdatedBy: string | null;
}

export interface SwapLockResult {
  locked: boolean;
  cancelled: number;
  delivered: number;
  intended: number;
}
```

```ts
  getSettings(): Promise<AdminSettings>;
  setSwapsLock(locked: boolean): Promise<SwapLockResult>;
```

- [ ] **Шаг 4: Экран**

`admin/src/screens/SettingsScreen.tsx` — по образцу `BirthdaysScreen.tsx`: загрузка в `useEffect`, локальный `error`, кнопка, которая сначала «взводится» (`confirming`), а вторым нажатием отправляет. Обязательные элементы:

- заголовок «Настройки», подзаголовок-объяснение: *закрытые обмены отменяют все неотвеченные заявки и пишут об этом всей команде*;
- состояние: «Обмены смен — Открыты / Закрыты»;
- **подписи кнопок ровно эти** (тест ищет по тексту, и в обеих консолях они одинаковы): основная — `Закрыть обмены` либо `Открыть обмены` по текущему состоянию; кнопка подтверждения — `Да, закрыть` либо `Да, открыть`; отмена — `Отмена`;
- **все три кнопки гасятся на время запроса** (`disabled={saving}`), как это уже сделано в `BirthdaysScreen.tsx`. Без этого есть окно: `confirming` сбрасывается сразу после ответа сервера, а `saving` — только после `reload()`, и между ними основная кнопка снова кликабельна. Взвести и подтвердить повторно в этом окне значит разослать команде второе сообщение — ровно то, ради чего подтверждение и заводилось;
- **кнопка подтверждения на время запроса пишет `Отправляю…`** — как `BirthdaysScreen.tsx`. Погашенная кнопка без текста говорит «сломалось», погашенная с подписью — «идёт». Подпись основной кнопки при этом НЕ меняется: она считается от `settings.swapsLocked`, который обновится только после перечитывания;
- **взведение сбрасывает и прошлую ошибку тоже**, не только прошлый результат: иначе рядом с новым подтверждением висит текст отказа от предыдущей попытки;
- подпись «Закрыл Игорь Петров · 7 августа, 14:30» (форматировать `formatAuditMoment` из `@planer/shared` — та же функция, что рисует время в журнале, чтобы формат не разъехался); если `swapsLockUpdatedBy === null` — «Ни разу не меняли»;
- после успеха — строка результата: `Обмены закрыты. Отменено заявок: 2. Уведомление дошло до 24 из 26.` Хвост про доставку строить через уже существующий `withNotifyNotice` из `admin/src/lib/notify-text.ts`;
- `error` рисуется **рядом** с тумблером, никогда вместо него.

- [ ] **Шаг 5: Навигация**

В `admin/src/components/Sidebar.tsx`: `NavKey` += `"settings"`, в `NAV_ITEMS` последним пунктом `{ key: "settings", label: "Настройки", icon: <GearIcon /> }`, и добавить `GearIcon` в том же стиле, что соседние (18×18, `stroke="currentColor"`, `strokeWidth="2"`).
В `admin/src/App.tsx` — ветка `active === "settings" && <SettingsScreen />` рядом с прочими.

- [ ] **Шаг 6: Прогнать, проверить падаемость, закоммитить**

```bash
npx vitest run admin/src/screens/settings.test.tsx   # PASS
git stash push -- admin/src/screens/SettingsScreen.tsx
npx vitest run admin/src/screens/settings.test.tsx   # КРАСНЫЙ
git stash pop
npm test && npm run typecheck
git add admin/src
git commit -m "feat(admin): раздел «Настройки» с тумблером обменов"
```

---

## Task 7: Мини-апп — раздел «Настройки»

**Files:**
- Create: `miniapp/src/screens/admin/AdminSettings.tsx`
- Create: `miniapp/src/screens/admin/admin-settings.test.tsx`
- Modify: `miniapp/src/api/client.ts` (типы + методы)
- Modify: `miniapp/src/api/mock.ts` (мок-состояние + две реализации)
- Modify: `miniapp/src/screens/AdminScreen.tsx` (`AdminSection` + чип + ветка)

**Interfaces:**
- Consumes: те же два роута (Task 5)
- Produces: `AdminSettings`, `SwapLockResult`, `apiClient.getSettings()`, `apiClient.setSwapsLock(locked)`, `AdminSection` расширен значением `"settings"`

- [ ] **Шаг 1: Написать падающий DOM-тест**

`miniapp/src/screens/admin/admin-settings.test.tsx` — **тот же файл теста, что в Task 6**, с тремя отличиями мини-аппа:

1. импорт `apiClient` из `"../../api/client"`, компонента — из `"./AdminSettings"`;
2. компонент оборачивается в провайдер telegram-ui, как в `shift-kinds-rotation.test.tsx`:

```tsx
import { AppRoot } from "@telegram-apps/telegram-ui";
// ...
    root!.render(createElement(AppRoot, null, createElement(AdminSettings)));
```

3. `settle(14)` вместо `settle(8)` — мок мини-аппа отвечает через `setTimeout`, и восьми оборотов ему местами не хватает (это уже учтено в соседних тестах мини-аппа).

**Все семь `it` — дословно те же**, включая «тумблер остался на экране после ошибки» и «в окне между ответом и перечитыванием основная кнопка погашена»: два фронта показывают одно и то же, и расхождение между ними должен ловить тест, а не пользователь. Смотри на **фактический** `admin/src/screens/settings.test.tsx` в репозитории, а не на код-блок Шага 1 Task 6 — файл дорос до семи тестов в ходе правок, и он же является образцом.

Экран мини-аппа обязан повторить и то, что стоит за этими тестами: гашение всех трёх кнопок на время запроса, `Отправляю…` на кнопке подтверждения, сброс прошлой ошибки при взведении и «Ни разу не меняли», когда тумблер не трогали.

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run miniapp/src/screens/admin/admin-settings.test.tsx`
Expected: FAIL — модуля нет.

- [ ] **Шаг 3: Клиент и мок**

В `miniapp/src/api/client.ts` — те же `AdminSettings`, `SwapLockResult` и два метода в `ApiClient`.
В `miniapp/src/api/mock.ts` — модульная переменная состояния и две реализации:

```ts
/** Живёт между вызовами, чтобы DEV-тумблер вёл себя как настоящий: нажал —
 *  и следующий getSettings отдаёт новое состояние. */
let mockSwapsLocked = false;

export function mockGetSettings(): AdminSettings {
  return {
    swapsLocked: mockSwapsLocked,
    swapsLockUpdatedAt: mockSwapsLocked ? new Date().toISOString() : null,
    swapsLockUpdatedBy: mockSwapsLocked ? "Игорь Петров" : null,
  };
}

export function mockSetSwapsLock(locked: boolean): SwapLockResult {
  mockSwapsLocked = locked;
  return { locked, cancelled: locked ? 2 : 0, delivered: 5, intended: 6 };
}
```

Подключить их в `client.ts` тем же способом, каким там короткозамыкаются остальные методы под `import.meta.env.DEV`.

- [ ] **Шаг 4: Экран и чип**

`miniapp/src/screens/admin/AdminSettings.tsx` — те же элементы, что в десктопном варианте, на компонентах `@telegram-apps/telegram-ui` (`List`/`Section`/`Cell`/`Switch`/`Button`), по образцу `AdminBirthdays.tsx`.
В `miniapp/src/screens/AdminScreen.tsx`: `AdminSection` += `"settings"`, в `SECTIONS` — `{ key: "settings", label: "Настройки" }`, и ветка `{section === "settings" && <AdminSettings />}`. Комментарий над `SECTIONS` говорит «пять админских поверхностей» — поправить на шесть.

- [ ] **Шаг 5: Полный прогон (тронут мок!), падаемость, коммит**

```bash
npm test                                  # ЦЕЛИКОМ: mock.test.ts утверждает набор данных
git stash push -- miniapp/src/screens/admin/AdminSettings.tsx
npx vitest run miniapp/src/screens/admin/admin-settings.test.tsx   # КРАСНЫЙ
git stash pop
npm run typecheck
git add miniapp/src
git commit -m "feat(miniapp): раздел «Настройки» с тумблером обменов"
```

---

## Task 8: Две галки в `PATCH /api/admin/employees/:id`

**Files:**
- Modify: `shared/src/audit.ts` (`employee_restrictions_changed` + описатель)
- Modify: `server/src/repo/employees.ts` (сеттер)
- Modify: `server/src/http/app.ts:369-408`
- Test: `server/src/http/employees.test.ts`, `shared/src/audit.test.ts`

**Interfaces:**
- Consumes: `cancelSwapsForEmployee` (Task 3), `buildExclusionNotices` (Task 4)
- Produces: `setEmployeeRestrictions(db: Db, id: number, patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean }): Employee | undefined`; тип аудита `employee_restrictions_changed`; `PATCH /api/admin/employees/:id` принимает два новых булевых поля

- [ ] **Шаг 1: Написать падающие тесты**

В `server/src/http/employees.test.ts`:

```ts
  it("PATCH accepts both restriction flags and reports them back", async () => {
    // PATCH { excludedFromAssignment: true, excludedFromSwaps: true }
    // → 200, employee.excludedFromAssignment === true, employee.excludedFromSwaps === true
  });

  it("PATCH rejects a non-boolean restriction flag", async () => {
    // PATCH { excludedFromSwaps: "yes" } → 400
  });

  // Cancelling is the point: the counterparty is holding chat buttons whose only
  // possible answer would now be an error.
  it("closing a person's swaps cancels their open requests in both directions", async () => {
    // подготовить две заявки (исходящую и входящую) для этого человека и одну чужую
    // PATCH { excludedFromSwaps: true }
    // → его две в статусе cancelled, чужая всё ещё pending
  });

  // Paired: the flag alone is what cancels, so clearing it must not.
  it("clearing the flag cancels nothing", async () => {
    // PATCH { excludedFromSwaps: false } при живой чужой заявке → она осталась pending
  });

  it("a PATCH that does not touch the flags writes no restrictions journal row", async () => {
    // PATCH { displayName: "Аня Смирнова" } → в журнале нет employee_restrictions_changed
  });

  /**
   * The assignment flag is deliberately silent.
   *
   * A worker cannot see how the bot hands shifts out, so «тебя исключили из
   * назначений» would tell them about machinery they never knew existed and start
   * a conversation the admin did not ask for. The flag leaves a journal row and
   * nothing else. Without this test the notification would arrive the first time
   * somebody «tidied up» the route by treating both flags the same way.
   */
  it("the assignment flag notifies nobody", async () => {
    // подменить отправку сообщений; PATCH { excludedFromAssignment: true }
    // → ни одного sendMessage; при этом в журнале employee_restrictions_changed есть
  });

  it("the swaps flag does notify the person", async () => {
    // парный: PATCH { excludedFromSwaps: true } → сообщение этому человеку ушло
  });
```

Отдельно: `GET /api/admin/employees` (`server/src/http/app.ts:348`) отдаёт строку работника целиком через `{ ...employee }`, поэтому обе новые колонки попадают в ответ **сами**. Специально ничего добавлять не надо — но и «почистить» этот спред нельзя, экраны Task 12 читают галки именно оттуда. Написать это комментарием у роута.

В `shared/src/audit.test.ts`:

```ts
  it("описывает изменение ограничений работника", () => {
    const view = describeAuditEvent({
      type: "employee_restrictions_changed",
      payload: {
        employeeId: 4, displayName: "Аня Смирнова",
        before: { excludedFromAssignment: false, excludedFromSwaps: false },
        after: { excludedFromAssignment: true, excludedFromSwaps: false },
      },
    });
    expect(view.title).toBe("Изменены ограничения работника");
    expect(view.lines).toContain("Аня Смирнова");
    expect(view.lines).toContain("назначения: участвует → не участвует");
    // Обмены не менялись — строки про них быть не должно.
    expect(view.lines.some((line) => line.startsWith("обмены"))).toBe(false);
  });
```

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run shared/src/audit.test.ts server/src/http/employees.test.ts`
Expected: FAIL.

- [ ] **Шаг 3: Тип и описатель аудита**

В `AUDIT_TYPES` добавить `"employee_restrictions_changed"` (рядом с `employee_admin_changed`), в `DESCRIBERS`:

```ts
  employee_restrictions_changed: (p) => {
    const before = obj(p.before);
    const after = obj(p.after);
    const word = (value: unknown) => (value === true ? "не участвует" : "участвует");
    const lines = [personLabel(p, "displayName")];
    if (before.excludedFromAssignment !== after.excludedFromAssignment) {
      lines.push(`назначения: ${word(before.excludedFromAssignment)} → ${word(after.excludedFromAssignment)}`);
    }
    if (before.excludedFromSwaps !== after.excludedFromSwaps) {
      lines.push(`обмены: ${word(before.excludedFromSwaps)} → ${word(after.excludedFromSwaps)}`);
    }
    return { icon: "🚦", title: "Изменены ограничения работника", lines };
  },
```

- [ ] **Шаг 4: Сеттер**

В `server/src/repo/employees.ts`:

```ts
/** The two admin-set restriction flags. Both optional: they live on one card but
 *  are flipped by separate gestures, so either may arrive alone. */
export function setEmployeeRestrictions(
  db: Db,
  id: number,
  patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean },
): Employee | undefined {
  return db.update(employees).set(patch).where(eq(employees.id, id)).returning().all()[0];
}
```

- [ ] **Шаг 5: Роут**

В `PATCH /api/admin/employees/:id` (`server/src/http/app.ts:369`):

1. Расширить деструктуризацию тела двумя полями и флаги `hasExcludedAssignment` / `hasExcludedSwaps`; добавить их в условие «нечего сохранять».
2. Валидация: если поле пришло и это не `boolean` → `400` с русским текстом.
3. `beforeEdit` дополнить снимком обеих галок; `after` — тоже.
4. После существующих мутаций — `setEmployeeRestrictions`, и **только если галки реально изменились** — `recordAudit(db, "employee_restrictions_changed", ...)` с `{ employeeId, displayName, before, after }`.
5. Если `excludedFromSwaps` **стал** `true` — вызвать `cancelSwapsForEmployee(db, id)`; в обоих случаях (стал `true` или `false`) построить `buildExclusionNotices` и разослать **после** записи, тем же способом, что в Task 5. `others` — все активные, кроме самого человека.

Существующий `recordAudit(db, "employee_updated", ...)` **остаётся** и по-прежнему пишется только по своим трём полям: `employee_updated` про имя/ДР/обращение, `employee_restrictions_changed` — про галки. Один `PATCH` может дать обе строки, если админ поменял и то и другое — это правда о том, что он сделал.

- [ ] **Шаг 6: Прогнать, падаемость, коммит**

```bash
npx vitest run shared/src/audit.test.ts server/src/http/employees.test.ts   # PASS
git stash push -- server/src/http/app.ts
npx vitest run server/src/http/employees.test.ts   # КРАСНЫЙ
git stash pop
npm test && npm run typecheck
git add shared/src/audit.ts shared/src/audit.test.ts server/src/repo/employees.ts \
        server/src/http/app.ts server/src/http/employees.test.ts
git commit -m "feat(api): две галки ограничений на карточке работника"
```

---

## Task 9: Мини-апп — кнопка «Обменять» и список кандидатов

**Files:**
- Modify: `server/src/http/app.ts` (`/api/me`, ~строка 260)
- Modify: `server/src/repo/team-schedule.ts` (`TeamScheduleView.employees` += флаг)
- Modify: `miniapp/src/api/client.ts` (`Me`, `TeamEmployee`), `miniapp/src/api/mock.ts`
- Modify: `miniapp/src/lib/swap-candidates.ts`
- Modify: `miniapp/src/components/ShiftRow.tsx`, `miniapp/src/screens/MyShiftsScreen.tsx`, `miniapp/src/App.tsx`
- Test: `server/src/http/read.test.ts`, `miniapp/src/lib/swap-candidates.test.ts`, `miniapp/src/components/shift-row-today.test.tsx` (или новый `shift-row-swap-lock.test.tsx`)

**Interfaces:**
- Consumes: `isSwapsLocked` (Task 1), `employees.excludedFromSwaps` (Task 1)
- Produces: `Me` += `swapsLocked: boolean`, `excludedFromSwaps: boolean`; `TeamEmployee` += `excludedFromSwaps: boolean`; `swapCandidates(fromShift, dayShifts, meId, now, excludedIds: ReadonlySet<number>)`; `ShiftRowProps` += `swapBlockedReason?: string`

- [ ] **Шаг 1: Написать падающие тесты**

**Пятый аргумент `swapCandidates` делается обязательным**, не опциональным с дефолтом — по той же причине, что три поля в Task 2: забытый вызов должен валить `tsc`, а не тихо показывать в списке того, с кем меняться нельзя. Существующие вызовы в `miniapp/src/lib/swap-candidates.test.ts` дополняются `new Set()`; `tsc` покажет все.

`miniapp/src/lib/swap-candidates.test.ts` — дописать:

Тестов два, и они про разное. Первый закрепляет **порядок** проверок, второй — саму видимость. Порядок закрепляется только на коллеге с **такой же** сменой (`templateId` как у `mine`, то есть 4): на смене другого вида `isIdenticalShift` даст `false` при любом порядке, и `sameKindCount === 0` будет держаться, даже если проверку исключения переставить после проверки «та же смена». То есть тест на другой смене не доказывает ничего.

```ts
  /**
   * Исключённый коллега с ТАКОЙ ЖЕ сменой не попадает ни в кандидаты, ни в
   * «столько же работают такую же».
   *
   * Смена нарочно совпадает по виду с моей: если переставить проверку исключения
   * ПОСЛЕ `isIdenticalShift`, он утечёт в `sameKindCount`, и экран скажет «ещё 1
   * работает такую же смену» про человека, с которым меняться нельзя. На коллеге
   * с другой сменой этот тест был бы зелёным при любом порядке.
   */
  it("исключённый коллега с такой же сменой не считается и в «таких же»", () => {
    const twin = shift({ id: 9, employeeId: 7, employeeName: "Игорь Петров", start: "15:00", end: "23:00", templateId: 4, title: "Вечер" });
    const { candidates, sameKindCount } = swapCandidates(mine, [twin], 1, NOW, new Set([7]));
    expect(candidates).toEqual([]);
    expect(sameKindCount).toBe(0);
  });

  it("он же без исключения — считается как «такая же смена»", () => {
    const twin = shift({ id: 9, employeeId: 7, employeeName: "Игорь Петров", start: "15:00", end: "23:00", templateId: 4, title: "Вечер" });
    const { candidates, sameKindCount } = swapCandidates(mine, [twin], 1, NOW, new Set());
    expect(candidates).toEqual([]);
    expect(sameKindCount).toBe(1);
  });

  it("исключённого из обменов коллегу в кандидатах нет", () => {
    const other = shift({ id: 9, employeeId: 7, employeeName: "Игорь Петров", start: "09:00", end: "18:00" });
    const { candidates } = swapCandidates(mine, [other], 1, NOW, new Set([7]));
    expect(candidates).toEqual([]);
  });

  it("тот же коллега без исключения в кандидатах есть", () => {
    const other = shift({ id: 9, employeeId: 7, employeeName: "Игорь Петров", start: "09:00", end: "18:00" });
    const { candidates } = swapCandidates(mine, [other], 1, NOW, new Set());
    expect(candidates.map((s) => s.id)).toEqual([9]);
  });
```

`server/src/http/read.test.ts` — дописать (поднятие приложения и токен — как в соседних тестах файла):

```ts
  it("GET /api/me carries the swap-permission facts the screen needs", async () => {
    const open = await (await app.request("/api/me", { headers: { authorization: `Bearer ${token}` } })).json();
    expect(open).toMatchObject({ swapsLocked: false, excludedFromSwaps: false });

    setSwapsLocked(db, true, me.id);
    const locked = await (await app.request("/api/me", { headers: { authorization: `Bearer ${token}` } })).json();
    expect(locked).toMatchObject({ swapsLocked: true });
  });

  it("GET /api/team/schedule marks who is out of swaps", async () => {
    db.update(employees).set({ excludedFromSwaps: true }).where(eq(employees.id, other.id)).run();
    const res = await app.request(
      "/api/team/schedule?from=2026-08-10&to=2026-08-16",
      { headers: { authorization: `Bearer ${token}` } },
    );
    const body = await res.json();
    expect(body.employees.find((e: { id: number }) => e.id === other.id)).toMatchObject({ excludedFromSwaps: true });
    expect(body.employees.find((e: { id: number }) => e.id === me.id)).toMatchObject({ excludedFromSwaps: false });
  });
```

Новый `miniapp/src/components/shift-row-swap-lock.test.tsx` — рецепт тот же, что в `miniapp/src/components/shift-row-today.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { ShiftRow } from "./ShiftRow";

/**
 * Пропавшая кнопка читается как поломка, погашенная — как правило.
 *
 * Это не вкусовщина: мини-апп — один длинный скролл, и «кнопки просто нет»
 * человеку неотличимо от «экран не догрузился». Поэтому кнопка остаётся на
 * месте, гаснет и несёт фразу, объясняющую запрет.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHIFT: Shift = {
  id: 1, date: "2026-08-13", start: "09:00", end: "18:00", endDate: null,
  category: "shift", title: "День", location: null, templateId: 2,
  employeeId: 1, unrecognisedCode: null,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(props: { onSwap: (shift: Shift) => void; swapBlockedReason?: string }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(ShiftRow, { shift: SHIFT, templates: [], ...props })));
  });
  return host;
}

function swapButton(el: HTMLElement): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Обменять"));
  if (!found) throw new Error("кнопки «Обменять» нет на строке");
  return found as HTMLButtonElement;
}

describe("ShiftRow под запретом обменов", () => {
  it("кнопка не исчезает, а гаснет с пояснением и не срабатывает", async () => {
    const onSwap = vi.fn();
    const el = await mount({ onSwap, swapBlockedReason: "Обмены сейчас закрыты" });

    expect(el.textContent ?? "").toContain("Обмены сейчас закрыты");
    await act(async () => swapButton(el).click());
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("без запрета кнопка активна и зовёт onSwap", async () => {
    const onSwap = vi.fn();
    const el = await mount({ onSwap });

    await act(async () => swapButton(el).click());
    expect(onSwap).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run miniapp/src/lib/swap-candidates.test.ts server/src/http/read.test.ts`
Expected: FAIL.

- [ ] **Шаг 3: Сервер**

В `/api/me` добавить в ответ:

```ts
      /** Правило обменов приходит вместе с «кто я»: экран должен погасить кнопку
       *  «Обменять», а не показать её и получить отказ на нажатие. */
      swapsLocked: isSwapsLocked(db),
      excludedFromSwaps: me.excludedFromSwaps,
```

В `server/src/repo/team-schedule.ts` — в `TeamScheduleView["employees"]` добавить поле и заполнить его:

```ts
export interface TeamScheduleView {
  employees: { id: number; displayName: string; rosterOrder: number | null; excludedFromSwaps: boolean }[];
  shifts: TeamScheduleEntry[];
}
```

```ts
    excludedFromSwaps: employee.excludedFromSwaps,
```

- [ ] **Шаг 4: Мини-апп**

`Me` и `TeamEmployee` в `miniapp/src/api/client.ts` — добавить те же поля; `MOCK_ME` и мок-расписание в `mock.ts` — тоже (у мока `swapsLocked: false`, и **один** человек с `excludedFromSwaps: true`, чтобы DEV-экран показывал живой случай).

`swapCandidates` — новый последний параметр и одна строка фильтра:

```ts
export function swapCandidates(
  fromShift: Shift,
  dayShifts: readonly Shift[],
  meId: number,
  now: Date,
  /** Кого админ вывел из обменов. Отдельным множеством, а не полем на смене:
   *  запрет висит на человеке, а не на конкретной записи графика. */
  excludedIds: ReadonlySet<number>,
): SwapCandidates {
```

```ts
    // Раньше проверки «такая же смена»: исключённого не прячут как одинакового,
    // с ним нельзя меняться вообще, и в sameKindCount он попасть не должен.
    if (excludedIds.has(shift.employeeId)) continue;
```

`ShiftRow` — новый необязательный проп и поведение:

```ts
  /** Почему обмен сейчас недоступен. Кнопка остаётся на месте, но гаснет и несёт
   *  эту фразу: пропавшая кнопка читается как поломка, погашенная — как правило. */
  swapBlockedReason?: string;
```

`MyShiftsScreen` — считать фразу один раз и раздать её строкам. **Приоритет причин не переписывать руками**, а спросить у `swapBlockReason`: она для того и заведена, чтобы сервер, кнопка и список кандидатов называли причины в одном порядке. Тернарник, повторяющий её порядок, верен ровно до первой правки на сервере — и промолчит, когда разъедется.

```ts
import { swapBlockReason } from "@planer/shared";

// Причина одна на весь экран, и её порядок берётся у той же функции, что решает
// на сервере. `toExcluded: false` — здесь речь только про меня; исключённые
// коллеги отсеиваются отдельно, в списке кандидатов.
const BLOCK_PHRASES = {
  "swaps-locked": "Обмены сейчас закрыты",
  "from-excluded": "Обмены тебе закрыты — спроси у админа",
  "to-excluded": "Обмены тебе закрыты — спроси у админа",
} as const;

const blocked = swapBlockReason({
  swapsLocked: me.swapsLocked,
  fromExcluded: me.excludedFromSwaps,
  toExcluded: false,
});
const swapBlockedReason = blocked ? BLOCK_PHRASES[blocked] : undefined;
```

`miniapp/src/App.tsx` — в месте, где строится список кандидатов, собрать множество из `teamSchedule.employees` и передать пятым аргументом:

```ts
const excludedIds = new Set(teamSchedule.employees.filter((e) => e.excludedFromSwaps).map((e) => e.id));
```

- [ ] **Шаг 5: Полный прогон (тронут мок!), падаемость, коммит**

```bash
npm test
git stash push -- miniapp/src/lib/swap-candidates.ts
npx vitest run miniapp/src/lib/swap-candidates.test.ts   # КРАСНЫЙ
git stash pop
npm run typecheck
git add server/src/http/app.ts server/src/repo/team-schedule.ts server/src/http/read.test.ts miniapp/src
git commit -m "feat(miniapp): кнопка «Обменять» знает про лок и про исключения"
```

---

## Task 10: Распределение и очередь

**Files:**
- Modify: `server/src/schedule/distribute-service.ts:191-241`
- Modify: `server/src/repo/template-roles.ts:77-97`
- Test: `server/src/schedule/distribute.test.ts`, `server/src/repo/template-roles.test.ts`

**Interfaces:**
- Consumes: `employees.excludedFromAssignment` (Task 1)
- Produces: поведение — `buildDistribution` и `rotationCandidatesFor` не видят исключённых; причина `empty_pool` считается по **всем** активным

- [ ] **Шаг 1: Написать падающие тесты**

`server/src/schedule/distribute.test.ts`:

```ts
  it("never assigns an excluded worker, and assigns them again once the flag is cleared", () => {
    // одна вакантная смена, ровно два активных человека, один исключён
    // → назначен только второй; снять флаг у первого, повторить на тех же данных → он получает смену
  });

  /**
   * `empty_pool` means «this preset lists nobody who is on the roster» — a broken
   * configuration the admin has to fix. A pool of people who are merely excluded
   * from assignment is not broken, so the reason must stay `nobody_free`.
   * That is why the reason is computed over ALL active workers, not the filtered set.
   */
  it("a pool of excluded-only people reports nobody_free, not empty_pool", () => {
    // пресет с пулом из одного человека, этот человек исключён
    // → unfilled[0].reason === "nobody_free"
  });

  it("a pool of archived-only people still reports empty_pool", () => {
    // сторож против того, чтобы починка выше стёрла настоящий empty_pool
  });

  /**
   * The flag must not creep into archiving.
   *
   * `listActive` is read by nearly everything — the team grid, reminders, birthday
   * collections, reports, the CSV export. This flag touches exactly five call
   * sites and none of those. The cheap way to «implement» it would have been to
   * filter `listActive` itself, which would silently delete the person from half
   * the product; this test is what makes that mistake loud.
   */
  it("an excluded worker is still on the team, still reminded, still exported", () => {
    // работник с excludedFromAssignment: true и сменой на завтра
    // → listActive(db) его содержит
    // → readTeamSchedule на его неделю содержит его в employees[]
    // → dueReminders / runReminderTick на завтрашнюю дату его смену видит
  });
```

`server/src/repo/template-roles.test.ts`:

```ts
  it("rotationCandidatesFor skips an excluded worker and keeps the rest", () => {
    // парный: с флагом — его нет; без флага — есть
  });
```

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run server/src/schedule/distribute.test.ts server/src/repo/template-roles.test.ts`

- [ ] **Шаг 3: Реализовать**

`server/src/schedule/distribute-service.ts`, в `buildDistribution`:

```ts
  // Everyone the roster still counts — including people an admin took out of
  // automatic assignment. Kept separate from `workers` below because the
  // `empty_pool` / `nobody_free` split below is judged against this list.
  const active = listActive(db);
  const workers = active
    .filter((employee) => !employee.excludedFromAssignment)
    .map((e) => seedWorkerLoad(db, e.id, from, to, nameById));
```

и в вычислении `reason`:

```ts
      // Judged over ALL active people, not over `workers`: `empty_pool` means the
      // preset lists nobody who is on the roster — a misconfiguration. A pool of
      // people who are merely excluded from assignment is configured correctly and
      // simply has nobody available, which is what `nobody_free` says.
      reason: active.some((employee) => allowedByPool(slot.pool, employee.id)) ? "nobody_free" : "empty_pool",
```

`server/src/repo/template-roles.ts:79`:

```ts
  // Excluded people are out of every automatic hand-out, and this queue is the
  // ★ hint on both consoles — showing them as «next up» would invite exactly the
  // assignment the flag exists to prevent.
  const eligible = listActive(db).filter(
    (employee) => !employee.excludedFromAssignment && (pool.size === 0 || pool.has(employee.id)),
  );
```

- [ ] **Шаг 4: Прогнать, падаемость, коммит**

```bash
npx vitest run server/src/schedule/distribute.test.ts server/src/repo/template-roles.test.ts   # PASS
git stash push -- server/src/schedule/distribute-service.ts
npx vitest run server/src/schedule/distribute.test.ts   # КРАСНЫЙ
git stash pop
npm test && npm run typecheck
git add server/src/schedule/distribute-service.ts server/src/repo/template-roles.ts \
        server/src/schedule/distribute.test.ts server/src/repo/template-roles.test.ts
git commit -m "feat(schedule): исключённые вне распределения и вне ★-очереди"
```

---

## Task 11: Выходные — рассылка и назначение

**Files:**
- Modify: `server/src/bot/notify.ts:166-185` (`notifyVacantSlot`)
- Modify: `server/src/weekend/weekend-service.ts:138-145` (`assignSlot`)
- Modify: `server/src/http/app.ts:1279` (ветка без бота: `intended` считается там отдельно)
- Test: `server/src/bot/notify.test.ts`, `server/src/weekend/weekend.test.ts`

**Interfaces:**
- Consumes: `employees.excludedFromAssignment` (Task 1)
- Produces: `assignSlot` умеет отказать причиной `"excluded"`; `notifyVacantSlot` не пишет исключённым и не считает их в `intended`

- [ ] **Шаг 1: Написать падающие тесты**

`server/src/bot/notify.test.ts`:

```ts
  it("notifyVacantSlot skips excluded workers and does not count them as intended", async () => {
    // три активных, один исключён, у всех привязан телеграм
    // → sendMessage вызван дважды, intended === 2
  });

  it("the same slot reaches all three once the flag is cleared", async () => {
    // парный тест
  });
```

`server/src/weekend/weekend.test.ts`:

```ts
  // The UI cannot offer this — an excluded person never got the call and never
  // tapped «Хочу» — but the route takes an employeeId from the request body, so
  // the door has to be shut on the route itself.
  it("assignSlot refuses an excluded worker even when interest exists", () => {
    // проставить интерес, затем флаг → { ok: false, reason: "excluded" }
    // снять флаг → назначение проходит
  });
```

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run server/src/bot/notify.test.ts server/src/weekend/weekend.test.ts`

- [ ] **Шаг 3: Реализовать**

`server/src/bot/notify.ts`, в `notifyVacantSlot`:

```ts
  // A call for weekend volunteers is an assignment offer, so people an admin took
  // out of assignments are out of this too. Filtered before `intended` is measured,
  // or «дошло до N из M» would count people we deliberately never wrote to.
  const team = listActive(db).filter((employee) => !employee.excludedFromAssignment);
```

`server/src/weekend/weekend-service.ts`, в `assignSlot` — сразу после `isOnStaff`:

```ts
  if (getEmployeeById(db, employeeId)?.excludedFromAssignment === true) {
    return { ok: false, reason: "excluded" };
  }
```

Расширить union причин в типе `AssignOutcome` значением `"excluded"` и дописать русский текст отказа там же, где переводятся остальные причины этого роута (`server/src/http/app.ts`, обработчик `/api/admin/weekend/slots/:id/assign`) — например «Этот человек выведен из назначений».

В `server/src/http/app.ts:1279` ветка без бота считает `intended: listActive(db).length` — применить тот же фильтр, иначе без бота счётчик разойдётся с тем, что даёт `notifyVacantSlot`.

- [ ] **Шаг 4: Прогнать, падаемость, коммит**

```bash
npx vitest run server/src/bot/notify.test.ts server/src/weekend/weekend.test.ts   # PASS
git stash push -- server/src/bot/notify.ts
npx vitest run server/src/bot/notify.test.ts   # КРАСНЫЙ
git stash pop
npm test && npm run typecheck
git add server/src/bot/notify.ts server/src/weekend/weekend-service.ts server/src/http/app.ts \
        server/src/bot/notify.test.ts server/src/weekend/weekend.test.ts
git commit -m "feat(weekend): исключённых не зовут на выходные и нельзя назначить"
```

---

## Task 12: Галки на экране «Работники» в обеих консолях

**Files:**
- Modify: `admin/src/api/client.ts` (`Employee` += два поля, метод), `admin/src/screens/EmployeesScreen.tsx`
- Modify: `miniapp/src/api/client.ts` (`Employee` += два поля, метод), `miniapp/src/api/mock.ts`, `miniapp/src/screens/admin/AdminEmployeesScreen.tsx`
- Modify: `miniapp/src/screens/admin/AdminScheduleScreen.tsx` (пометка в выборе человека для «Заполнить неделю»)
- Test: `admin/src/screens/employees-error.test.tsx` (дописать) или новый `admin/src/screens/employees-restrictions.test.tsx`; `miniapp/src/screens/admin/admin-employees-restrictions.test.tsx`

**Interfaces:**
- Consumes: `PATCH /api/admin/employees/:id` с двумя новыми полями (Task 8)
- Produces: `apiClient.setEmployeeRestrictions(id: number, patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean }): Promise<void>` в обоих клиентах

- [ ] **Шаг 1: Написать падающие DOM-тесты**

**Сначала — про поломку, которая случится сразу.** Добавление двух **обязательных** полей в `Employee` красит `tsc` в красный на каждой тестовой фикстуре работника в обеих консолях (например `admin/src/screens/employees-error.test.tsx:26-30`, `miniapp/src/screens/admin/shift-kinds-rotation.test.tsx:29-32`). Это ожидаемо и правильно: `npm run typecheck` перечислит все места, дописать `excludedFromAssignment: false, excludedFromSwaps: false`. Делать поля необязательными, чтобы этого избежать, — нельзя: тогда экран, забывший их прочитать, молча покажет галку снятой у исключённого человека.

`admin/src/screens/employees-restrictions.test.tsx` (для мини-аппа — тот же файл, с `AppRoot`-обёрткой и импортами из `"../../api/client"` / `"./AdminEmployeesScreen"`):

```tsx
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Employee } from "../api/client";
import { EmployeesScreen } from "./EmployeesScreen";

/**
 * Две галки ограничений на карточке работника.
 *
 * Второй тест здесь — про дефект, пойманный в этом проекте дважды: управляемый
 * элемент откатывается после УСПЕШНОГО сохранения, потому что экран рисует не
 * свой ответ, а те же данные, что были. На скриншоте это не видно вообще —
 * ловится только DOM-тестом.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: true, isActive: true, telegramUserId: 10, birthDate: null, address: "Аня", excludedFromAssignment: false, excludedFromSwaps: false },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 11, birthDate: null, address: "Игорь", excludedFromAssignment: true, excludedFromSwaps: false },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(EmployeesScreen, { employees: EMPLOYEES, onChanged: async () => {} }));
  });
  await settle();
  return host;
}

/** Чекбокс по подписи рядом с ним, в карточке нужного работника. */
function checkboxIn(el: HTMLElement, employeeId: number, label: string): HTMLInputElement {
  const card = el.querySelector(`[data-employee-id="${employeeId}"]`);
  if (!card) throw new Error(`нет карточки работника #${employeeId}`);
  const found = [...card.querySelectorAll("label")]
    .find((l) => (l.textContent ?? "").includes(label))
    ?.querySelector("input[type=checkbox]");
  if (!found) throw new Error(`нет галки «${label}» у работника #${employeeId}`);
  return found as HTMLInputElement;
}

async function toggle(box: HTMLInputElement) {
  await act(async () => box.click());
  await settle();
}

describe("галки ограничений на карточке работника", () => {
  it("рисует обе галки в том состоянии, которое пришло с сервера", async () => {
    const el = await mount();
    expect(checkboxIn(el, 1, "Не участвует в назначениях").checked).toBe(false);
    expect(checkboxIn(el, 2, "Не участвует в назначениях").checked).toBe(true);
    expect(checkboxIn(el, 2, "Не участвует в обменах").checked).toBe(false);
  });

  it("после успешного сохранения галка остаётся в новом положении", async () => {
    const save = vi.spyOn(apiClient, "setEmployeeRestrictions").mockResolvedValue(undefined);
    const el = await mount();

    await toggle(checkboxIn(el, 1, "Не участвует в обменах"));

    expect(save).toHaveBeenCalledWith(1, { excludedFromSwaps: true });
    // До починки здесь было false: сервер сохранил, экран об этом не узнал.
    expect(checkboxIn(el, 1, "Не участвует в обменах").checked).toBe(true);
  });

  it("отказ возвращает галку и пишет причину в карточке этого работника", async () => {
    vi.spyOn(apiClient, "setEmployeeRestrictions").mockRejectedValue(new Error("сеть недоступна"));
    const el = await mount();

    await toggle(checkboxIn(el, 1, "Не участвует в обменах"));

    expect(checkboxIn(el, 1, "Не участвует в обменах").checked).toBe(false);
    const card = el.querySelector('[data-employee-id="1"]')!;
    expect(card.textContent ?? "").toContain("сеть недоступна");
  });

  it("ошибка одного работника не появляется у соседнего и не убирает его со списка", async () => {
    vi.spyOn(apiClient, "setEmployeeRestrictions").mockRejectedValue(new Error("сеть недоступна"));
    const el = await mount();

    await toggle(checkboxIn(el, 1, "Не участвует в обменах"));

    const neighbour = el.querySelector('[data-employee-id="2"]')!;
    expect(neighbour.textContent ?? "").not.toContain("сеть недоступна");
    expect(checkboxIn(el, 2, "Не участвует в назначениях")).toBeTruthy();
  });
});
```

Тест требует `data-employee-id` на карточке строки — если его там нет, атрибут добавляется в Шаге 4 вместе с блоком «Ограничения». Это не «правка ради теста»: искать строку человека по порядковому номеру в списке — способ, который ломается от любой пересортировки.

- [ ] **Шаг 2: Прогнать — красно**

Run: `npx vitest run admin/src/screens miniapp/src/screens/admin`

- [ ] **Шаг 3: Клиенты**

В обоих `api/client.ts`: в интерфейс `Employee` добавить

```ts
  /** Админ вывел человека из автоматических назначений: распределение, ★-очередь,
   *  выходные. Ручную постановку это не запрещает. */
  excludedFromAssignment: boolean;
  /** Админ вывел человека из обменов — в обе стороны. */
  excludedFromSwaps: boolean;
```

и метод `setEmployeeRestrictions` в `ApiClient` и в реализацию (обёртка над тем же `PATCH`, каким уже сделан `renameEmployee` / `setBirthDate`). В `miniapp/src/api/mock.ts` — проставить оба поля всем мок-работникам, одному из них `excludedFromSwaps: true`.

- [ ] **Шаг 4: Экраны**

В карточке работника обеих консолей — блок «Ограничения» с двумя чекбоксами:

- «Не участвует в назначениях» + подпись «бот не ставит его при распределении и не зовёт на выходные; вручную поставить можно»;
- «Не участвует в обменах» + подпись «ни предложить, ни принять обмен; открытые заявки будут отменены».

Ошибка — через уже существующий `withError`/`withoutError` (`miniapp/src/lib/error-map.ts`) в мини-аппе и по образцу соседних действий в десктопе: фраза живёт **в строке этого работника**, не в шапке экрана.

- [ ] **Шаг 5: Пометка в «Заполнить неделю»**

В `miniapp/src/screens/admin/AdminScheduleScreen.tsx` (выбор работника для bulk-заполнения, ~строка 879) исключённого **не убирать** — ручная постановка разрешена, — но дописать к имени пометку «· вне назначений».

```tsx
{/* Не фильтруем: «Заполнить неделю» — ручная постановка, админ называет
    человека сам, и по решению заказчика это разрешено. Пометка нужна, чтобы
    не выбрать по инерции того, кого бот сам никогда бы не поставил. */}
```

- [ ] **Шаг 6: Полный прогон, падаемость, коммит**

```bash
npm test                                # мок тронут
git stash push -- admin/src/screens/EmployeesScreen.tsx
npx vitest run admin/src/screens        # КРАСНЫЙ
git stash pop
npm run typecheck
git add admin/src miniapp/src
git commit -m "feat(консоли): галки ограничений на карточке работника"
```

---

## Финальная проверка

- [ ] `npm test` — зелёно, число файлов тестов не уменьшилось.
- [ ] `npm run typecheck` — чисто на всех четырёх воркспейсах.
- [ ] `npx vitest run server/src/db/no-real-names.test.ts` — страж приватности зелёный.
- [ ] `git grep -nE "(const|let|function) [а-яА-ЯёЁ]"` — пусто.
- [ ] `git grep -nE "^\s*//.*[а-яА-ЯёЁ]" -- server/src` — только «ёлочки» внутри английских фраз, новых русских комментариев в `server/src` нет.
- [ ] Оба фронта пересобраны, хеши бандлов сверены.
- [ ] После пуша — `gh run list`: **«гейт зелёный на этой машине» ≠ «CI зелёный»**. Сверять не только `success`, но и число прогнанных файлов тестов.
