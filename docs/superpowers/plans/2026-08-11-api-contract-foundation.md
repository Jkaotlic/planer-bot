# Контракт API: каркас и первые два домена — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** контракт API перестаёт быть устной договорённостью: zod-схемы в `@planer/shared` становятся единственным источником правды, расхождение сервера и клиента падает на компиляции или в гейте, а логика клиента и dev-мок съезжаются в один пакет `@planer/client`.

**Architecture:** контракт — общее знание сервера и клиентов, поэтому zod-схемы живут в `shared/src/api/` (по файлу на домен, типы через `z.infer`). Транспорт — знание только клиентов, поэтому `ApiClient`, разбор ошибок и dev-мок уезжают в новый воркспейс `client/`, которого сервер не видит. Работа идёт вертикальными срезами: домен целиком проходит путь схемы → сервер → роутер → клиент → оба фронта, и гейт зелёный после каждого среза.

**Tech Stack:** TypeScript 5.9 (ESM, npm workspaces), zod 3.25, vitest 2.1, Hono 4, Drizzle + better-sqlite3, React 18 + Vite 6.

**Спека:** `docs/superpowers/specs/2026-08-11-api-contract-and-hardening-design.md`
**Ветка:** `feature/api-contract` (уже создана, спека на ней закоммичена)

## Объём этого плана

Этот план — **каркас и первые два домена из девяти**: `read` и `employees`. Остальные
семь (`entries`, `swaps`, `weekend`, `collections`, `roster`, `reports`, `auth/me`)
получат свой план после того, как форма среза обкатана. Писать сейчас точный код для
девятого домена, не зная граблей первого, — значит писать фикцию.

Признак, что план сработал: два домена переехали, `app.ts` похудел на их маршруты, оба
фронта ходят через `@planer/client`, и форма среза описана достаточно точно, чтобы
следующий план был механическим.

## Global Constraints

- **Слой 1–2 — TDD обязателен.** Каждая задача: сначала падающий тест, потом минимальная
  реализация. «Посмотрел код, должно работать» доказательством не является.
- Тесты гоняются из корня: `npx vitest run <путь>`; вся сюита — `npm test`; типы —
  `npm run typecheck` (все четыре, скоро пять, воркспейса).
- **Комментарии и текст интерфейса — по-русски**, как в существующем коде. Комментарий
  объясняет *почему*, а не *что*.
- **Никаких настоящих ФИО** в коде, тестах и доках: репозиторий публичный, сторож —
  `server/src/db/no-real-names.test.ts`. В фикстурах — «Аня», «Игорь», «Марк», как уже
  принято в тестах.
- **Схемы ответов — всегда `.strict()`.** `z.object` по умолчанию отбрасывает лишние поля
  и проходит; без `.strict()` контрактный тест не может упасть.
- **Поведение не меняется.** Эта работа переносит и закрепляет, а не чинит. Любая
  находка про поведение уходит в `docs/audit/ledger.md`, а не в код этого плана.
  Единственное исключение — сужение ответа `/api/templates` в задаче 2, и оно обосновано
  проверкой прямо в задаче.
- Коммитить после каждой задачи, сообщение — по-русски, в стиле истории репозитория
  (`feat(...)`, `fix(...)`, `refactor(...)`, `docs(...)`, `test(...)`).
- Ни одна задача не заканчивается красным гейтом. Если задача ломает чужой тест —
  чинится в той же задаче.

---

## Структура файлов

| Файл | Ответственность | Задача |
| --- | --- | --- |
| `client/package.json` | новый воркспейс `@planer/client` | 1 |
| `client/tsconfig.json` | типы фронтового пакета (DOM в lib) | 1 |
| `client/src/index.ts` | публичный вход пакета | 1 |
| `package.json` | `client` в списке workspaces, в `typecheck` | 1 |
| `shared/src/api/boundaries.test.ts` | **новый:** сторож границ пакетов | 1 |
| `shared/src/api/index.ts` | реэкспорт схем контракта | 2 |
| `shared/src/api/read.ts` | **новый:** схемы домена `read` | 2 |
| `shared/src/api/read.test.ts` | **новый:** схемы отвергают неверную форму | 2 |
| `shared/src/index.ts` | реэкспорт `./api` | 2 |
| `server/src/http/app.ts` | ответы через `satisfies`, затем `app.route()` | 2, 3, 8, 9 |
| `server/src/http/read.test.ts` | контрактные тесты трёх ручек | 2 |
| `server/src/http/routes/read.ts` | **новый:** роутер домена `read` | 3 |
| `client/src/core.ts` | **новый:** `TokenSource`, `apiFetch`, ошибки, `authorized*` | 4 |
| `client/src/core.test.ts` | **новый:** сетевой сбой, 401, разбор `{error}` | 4 |
| `client/src/read.ts` | **новый:** методы домена `read` | 5 |
| `client/src/mock/read.ts` | **новый:** мок домена `read` | 5 |
| `client/src/mock/delay.ts` | **новый:** задержка как параметр | 5 |
| `client/src/mock/read.test.ts` | **новый:** мок проходит схемы контракта | 5 |
| `miniapp/src/api/client.ts` | read-методы делегируются в `@planer/client` | 6 |
| `miniapp/src/api/mock.ts` | read-мок удалён, берётся из пакета | 6 |
| `admin/src/api/client.ts` | то же для админки | 7 |
| `admin/src/api/mock.ts` | то же для админки | 7 |
| `shared/src/api/employees.ts` | **новый:** схемы домена `employees` | 8 |
| `shared/src/api/employees.test.ts` | **новый** | 8 |
| `server/src/http/employees.test.ts` | контрактные тесты | 8 |
| `server/src/http/routes/employees.ts` | **новый:** роутер домена | 9 |
| `client/src/employees.ts` | **новый:** методы домена | 9 |
| `client/src/mock/employees.ts` | **новый:** мок домена | 9 |
| `docs/audit/ledger.md` | находки, вскрытые инвентаризацией | 8 |

---

## Задача 1: воркспейс `@planer/client` и сторож границ

Каркас без единого метода API — только пакет, который собирается, и тест, который
не даст границам расплыться. Отдельная задача, потому что рецензент может принять
границу и отвергнуть схемы, и наоборот.

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/src/index.ts`
- Create: `shared/src/api/boundaries.test.ts`
- Modify: `package.json` (workspaces, typecheck)

**Interfaces:**
- Consumes: ничего.
- Produces: воркспейс `@planer/client` с входом `client/src/index.ts`; оба фронта могут
  импортировать из него, сервер — нет.

- [ ] **Step 1: Написать падающий тест границ**

Создать `shared/src/api/boundaries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Границы пакетов держатся тестом, а не обещанием.
 *
 * Повод не теоретический: ровно так один и тот же тип успел стать `Category` в
 * мини-аппе и `EntryCategory` в админке — никто не запрещал, и разошлось молча.
 */
describe("границы пакетов", () => {
  it("shared не знает про браузер", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(repoRoot, "shared/src"))) {
      const text = readFileSync(file, "utf8");
      for (const banned of ["localStorage", "window.", "document.", "import.meta"]) {
        if (text.includes(banned)) offenders.push(`${file.replace(repoRoot + "/", "")}: ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("server не импортирует клиентский пакет", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(repoRoot, "server/src"))) {
      if (readFileSync(file, "utf8").includes("@planer/client")) {
        offenders.push(file.replace(repoRoot + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Прогнать — тест должен упасть на отсутствии каталога**

Run: `npx vitest run shared/src/api/boundaries.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, scandir '.../shared/src/api'`

Это честное падение: теста ещё нет там, где он должен жить.

- [ ] **Step 3: Завести воркспейс и каталог**

`client/package.json`:

```json
{
  "name": "@planer/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@planer/shared": "*"
  }
}
```

`client/tsconfig.json` — как у фронтов, потому что пакет живёт в браузере:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`client/src/index.ts` — пока только маркер, наполнится в задаче 4:

```ts
// Публичный вход пакета. Транспорт и dev-мок — здесь; контракт — в @planer/shared.
export {};
```

Создать пустой каталог `shared/src/api/` тем, что положить туда `index.ts`:

```ts
// Схемы контракта API. Наполняется по домену за раз (см. план от 2026-08-11).
export {};
```

- [ ] **Step 4: Подключить воркспейс**

В корневом `package.json` — `client` в `workspaces` (перед `miniapp`, чтобы порядок
совпадал с направлением зависимостей) и в `typecheck`:

```json
"workspaces": ["shared", "client", "server", "miniapp", "admin"],
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc -p shared/tsconfig.json && tsc -p client/tsconfig.json && tsc -p server/tsconfig.json && tsc -p admin/tsconfig.json && tsc -p miniapp/tsconfig.json"
}
```

Затем: `npm install` — npm создаст симлинк `node_modules/@planer/client`.

- [ ] **Step 5: Прогнать тест и гейт**

Run: `npx vitest run shared/src/api/boundaries.test.ts`
Expected: PASS — оба случая зелёные.

Run: `npm test && npm run typecheck`
Expected: PASS — 1425 тестов + 2 новых, типы чистые.

- [ ] **Step 6: Коммит**

```bash
git add client package.json package-lock.json shared/src/api
git commit -m "feat(client): воркспейс @planer/client и сторож границ пакетов"
```

---

## Задача 2: контракт домена `read` и сервер под ним

Три ручки: `/api/templates`, `/api/my/shifts`, `/api/team/schedule`. Домен выбран первым
потому, что он маленький — если форма среза окажется неудачной, переделывать придётся
один домен, а не девять.

**Files:**
- Create: `shared/src/api/read.ts`, `shared/src/api/read.test.ts`
- Modify: `shared/src/api/index.ts`, `shared/src/index.ts`
- Modify: `server/src/http/app.ts:320-345`
- Modify: `server/src/http/read.test.ts`

**Interfaces:**
- Consumes: воркспейс из задачи 1; существующие примитивы `dateStr`, `timeStr`,
  `entryCategorySchema` из `@planer/shared`.
- Produces: `templatesResponseSchema`, `myShiftsResponseSchema`,
  `teamScheduleResponseSchema` и типы `TemplatesResponse`, `MyShiftsResponse`,
  `TeamScheduleResponse` — их используют задачи 3, 5, 6, 7.

- [ ] **Step 1: Написать падающий тест схем**

Создать `shared/src/api/read.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { templatesResponseSchema, teamScheduleResponseSchema } from "./read";

describe("схемы домена read", () => {
  it("принимают ответ той формы, что сервер отдаёт сегодня", () => {
    const parsed = templatesResponseSchema.safeParse({
      templates: [{
        id: 1, name: "Утро", category: "shift", start: "08:00", end: "17:00",
        fridayStart: "08:00", fridayEnd: "16:00", location: null, accent: "yellow",
        isLate: false, sendReminder: true, sortOrder: 0,
      }],
    });
    expect(parsed.success).toBe(true);
  });

  it("отвергают лишнее поле, а не молча его глотают", () => {
    // Без .strict() этот случай проходил бы всегда — то есть тест не мог бы упасть.
    const parsed = templatesResponseSchema.safeParse({
      templates: [{
        id: 1, name: "Утро", category: "shift", start: "08:00", end: "17:00",
        fridayStart: "08:00", fridayEnd: "16:00", location: null, accent: "yellow",
        isLate: false, sendReminder: true, sortOrder: 0,
        coverage: "0,0,0,0,0,0,0",
      }],
    });
    expect(parsed.success).toBe(false);
  });

  it("отвергают запись графика без обязательной даты", () => {
    const parsed = teamScheduleResponseSchema.safeParse({
      employees: [],
      shifts: [{ id: 1, start: null, end: null, endDate: null, category: "shift",
                 title: null, location: null, unrecognisedCode: null,
                 templateId: null, employeeId: null }],
    });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать — тест должен упасть**

Run: `npx vitest run shared/src/api/read.test.ts`
Expected: FAIL — `Failed to resolve import "./read"`

- [ ] **Step 3: Написать схемы**

Создать `shared/src/api/read.ts`:

```ts
import { z } from "zod";
import { dateStr, timeStr } from "../time";
import { entryCategorySchema } from "../category";

/**
 * Пресет смены в том виде, в каком его читают оба фронта.
 *
 * Уже: сервер сегодня отдаёт весь ряд таблицы (`db.select()` без списка полей), то есть
 * ещё и `coverage`, `fillMode`, `rotationUnit`, `primaryEmployeeId`, `isActive`. Ни один
 * фронт их не читает — `rotationUnit` читается, но из `/api/admin/templates/:id/queue`,
 * а не отсюда. `.strict()` заставляет назвать это вслух, и ответ сужается до читаемого.
 */
export const templateSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  category: entryCategorySchema,
  start: timeStr,
  end: timeStr,
  fridayStart: timeStr.nullable(),
  fridayEnd: timeStr.nullable(),
  location: z.string().nullable(),
  accent: z.string(),
  isLate: z.boolean(),
  sendReminder: z.boolean(),
  sortOrder: z.number().int(),
}).strict();
export type TemplateDto = z.infer<typeof templateSchema>;

export const templatesResponseSchema = z.object({ templates: z.array(templateSchema) }).strict();
export type TemplatesResponse = z.infer<typeof templatesResponseSchema>;

/** Запись графика, безопасная для показа любому работнику: без `note`. */
export const scheduleEntrySchema = z.object({
  id: z.number().int(),
  date: dateStr,
  start: timeStr.nullable(),
  end: timeStr.nullable(),
  endDate: dateStr.nullable(),
  category: entryCategorySchema,
  title: z.string().nullable(),
  location: z.string().nullable(),
  unrecognisedCode: z.string().nullable(),
  templateId: z.number().int().nullable(),
  employeeId: z.number().int().nullable(),
}).strict();
export type ScheduleEntryDto = z.infer<typeof scheduleEntrySchema>;

export const myShiftsResponseSchema = z.object({
  shifts: z.array(scheduleEntrySchema),
  today: dateStr,
}).strict();
export type MyShiftsResponse = z.infer<typeof myShiftsResponseSchema>;

export const teamScheduleResponseSchema = z.object({
  employees: z.array(z.object({
    id: z.number().int(),
    displayName: z.string(),
    rosterOrder: z.number().int().nullable(),
    excludedFromSwaps: z.boolean(),
  }).strict()),
  shifts: z.array(scheduleEntrySchema),
}).strict();
export type TeamScheduleResponse = z.infer<typeof teamScheduleResponseSchema>;
```

Проверить перед написанием: точные имена примитивов и их файлы — `dateStr`, `timeStr` и
`entryCategorySchema` уже экспортируются из `@planer/shared` (их импортирует
`server/src/http/entry-schema.ts:2`). Если путь `../time` или `../category` не совпадёт —
взять фактический из `shared/src/index.ts`, а не выдумывать.

В `shared/src/api/index.ts`:

```ts
export * from "./read";
```

В `shared/src/index.ts` добавить последней строкой:

```ts
export * from "./api";
```

- [ ] **Step 4: Прогнать тест схем**

Run: `npx vitest run shared/src/api/read.test.ts`
Expected: PASS — три случая.

- [ ] **Step 5: Написать падающие контрактные тесты ручек**

Добавить в конец `server/src/http/read.test.ts` (шапка файла — `config`, `worker`,
`tokenFor`, `bearer` — уже есть, переиспользовать её):

```ts
import { templatesResponseSchema, myShiftsResponseSchema, teamScheduleResponseSchema } from "@planer/shared";

describe("контракт домена read", () => {
  it("/api/templates отдаёт ровно обещанное, без лишних полей", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request("/api/templates", bearer(await tokenFor(app, 333)));
    const parsed = templatesResponseSchema.safeParse(await res.json());
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("/api/my/shifts отдаёт ровно обещанное", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    createShift(db, { date: "2026-07-06", start: "11:00", end: "20:00", employeeId: w.id });
    const app = createApp({ db, config });
    const res = await app.request("/api/my/shifts?from=2026-07-01", bearer(await tokenFor(app, 333)));
    const parsed = myShiftsResponseSchema.safeParse(await res.json());
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("/api/team/schedule отдаёт ровно обещанное", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    createShift(db, { date: "2026-07-06", start: "11:00", end: "20:00", employeeId: w.id });
    const app = createApp({ db, config });
    const res = await app.request("/api/team/schedule?from=2026-07-01&to=2026-07-10", bearer(await tokenFor(app, 333)));
    const parsed = teamScheduleResponseSchema.safeParse(await res.json());
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });
});
```

`expect(parsed.error?.issues ?? []).toEqual([])` стоит перед `expect(parsed.success)`
намеренно: при падении он покажет, какое поле разошлось, а не голое `false`.

- [ ] **Step 6: Прогнать — `/api/templates` должен упасть, остальные пройти**

Run: `npx vitest run server/src/http/read.test.ts`
Expected: FAIL ровно на первом случае — `unrecognized_keys` со списком
`coverage`, `fillMode`, `rotationUnit`, `primaryEmployeeId`, `isActive`.

Это и есть доказательство, что ручка отдаёт лишнее. Если падают и остальные два —
записать фактические расхождения и разобраться с ними до перехода дальше: значит форма
ответа отличается от прочитанной, и схему надо править под факт, а не факт под схему.

**Два места, где схема выше намеренно расходится с типами клиентов** — если тест упадёт
на них, это ожидаемо, и правится схема под факт:

- `fridayStart` / `fridayEnd` описаны `.nullable()`, а оба клиента объявляют их
  `string` без `null` (`admin/src/api/client.ts:93-110`). Правда — на стороне базы:
  в `server/src/db/schema.ts` это `text()` без `.notNull()`.

  **Проверено на живой базе 2026-08-11:** все девять пресетов хранят обе колонки
  заполненными, `null` нет ни в одной. То есть контрактный тест на этом поле **не
  упадёт**, и клиенты врут безнаказанно — ровно до первого пресета, заведённого без
  пятничных часов. `.nullable()` ставится по тому, что колонка допускает, а не по
  тому, что в ней сегодня лежит. Перепроверить при желании:

  ```bash
  sqlite3 "file:data/planer.db?immutable=1" \
    'select name, coalesce(friday_start,"—NULL—") from shift_templates order by sort_order;'
  ```

  (Колонки в SQLite названы `friday_start`/`friday_end` — Drizzle переводит camelCase в
  snake_case. В коде и схемах — camelCase, в SQL-запросах руками — snake_case.)
- `accent` описан `z.string()`, а не перечислением цветов. Намеренно: перечисление
  здесь означало бы, что добавление нового цвета в базу роняет контракт на каждом
  ответе, — а цвет это данные, не форма. Валидность цвета проверяет тот, кто его
  рисует.

- [ ] **Step 7: Сузить ответ и типизировать через `satisfies`**

В `server/src/http/app.ts` заменить маршрут `/api/templates` (строка 320):

```ts
  // Ответ сужен до контракта: раньше сюда уезжал весь ряд таблицы, включая
  // `coverage`, `fillMode`, `rotationUnit`, `primaryEmployeeId` и `isActive`.
  // Ни один фронт их не читает (`rotationUnit` читается, но из
  // /api/admin/templates/:id/queue), а `satisfies` не даст отрастить их обратно.
  app.get("/api/templates", requireAuth(db, config.jwtSecret), (c) =>
    c.json({
      templates: listActiveTemplates(db).map((t) => ({
        id: t.id, name: t.name, category: t.category, start: t.start, end: t.end,
        fridayStart: t.fridayStart, fridayEnd: t.fridayEnd, location: t.location,
        accent: t.accent, isLate: t.isLate, sendReminder: t.sendReminder, sortOrder: t.sortOrder,
      })),
    } satisfies TemplatesResponse),
  );
```

Двум остальным маршрутам добавить `satisfies MyShiftsResponse` и
`satisfies TeamScheduleResponse` к объекту в `c.json(...)`. Импорт типов — из
`@planer/shared`, рядом с существующими импортами.

- [ ] **Step 8: Прогнать домен и весь гейт**

Run: `npx vitest run server/src/http/read.test.ts`
Expected: PASS — все случаи, включая старые.

Run: `npm test && npm run typecheck`
Expected: PASS. Если упал чужой тест на форме `/api/templates` — починить здесь же:
сужение ответа сделано осознанно, и тест, который ждал лишние поля, ждал неправды.

- [ ] **Step 9: Коммит**

```bash
git add shared/src/api shared/src/index.ts server/src/http/app.ts server/src/http/read.test.ts
git commit -m "feat(контракт): схемы домена read, ответ /api/templates сужен до читаемого"
```

---

## Задача 3: роутер домена `read`

Чистый перенос: те же три маршрута уезжают из `app.ts` в свой файл. Отдельной задачей,
потому что смешивать перенос с изменением формы — значит лишить и то и другое
доказательства.

**Files:**
- Create: `server/src/http/routes/read.ts`
- Modify: `server/src/http/app.ts`

**Interfaces:**
- Consumes: схемы из задачи 2.
- Produces: `createReadRoutes(deps): Hono<Env>` — образец, по которому пишутся остальные
  восемь роутеров.

- [ ] **Step 1: Убедиться, что тесты домена сейчас зелёные**

Run: `npx vitest run server/src/http/read.test.ts`
Expected: PASS. Это опорная точка: после переноса набор должен остаться ровно таким же
зелёным. Тесты ходят через `app.request`, то есть перенос для них невидим — именно
поэтому они и годятся в страховку.

- [ ] **Step 2: Создать роутер**

`server/src/http/routes/read.ts`:

```ts
import { Hono } from "hono";
import { dateStr, dayNumber, type MyShiftsResponse, type TeamScheduleResponse, type TemplatesResponse } from "@planer/shared";
import type { Db } from "../../db/client";
import type { Config } from "../../config";
import type { Env } from "../middleware";
import { requireAuth } from "../middleware";
import { listActiveTemplates } from "../../repo/templates";
import { listUpcomingForEmployee } from "../../repo/shifts";
import { readTeamSchedule } from "../../repo/team-schedule";

/** Чтение, доступное любому работнику: пресеты, свои смены, график команды. */
export function createReadRoutes(deps: { db: Db; config: Config }): Hono<Env> {
  const { db, config } = deps;
  const routes = new Hono<Env>();

  // тела трёх обработчиков переносятся из app.ts дословно, вместе с комментариями

  return routes;
}
```

Перенести тела дословно, вместе с комментариями — комментарий про «дату команды, а не
телефона» объясняет решение и должен уехать с кодом. Пути внутри роутера остаются
полными (`/api/templates`), а подключается он через `app.route("/", createReadRoutes(...))`:
так пути видны на месте и `grep` по маршруту продолжает находить его сразу.

- [ ] **Step 3: Подключить в `app.ts` и удалить оригиналы**

В `server/src/http/app.ts` вместо трёх маршрутов:

```ts
app.route("/", createReadRoutes({ db, config }));
```

Удалить ставшие ненужными импорты (`listActiveTemplates`, `listUpcomingForEmployee`,
`readTeamSchedule`, возможно `dayNumber`) — если они больше нигде в файле не нужны.
Проверить: `npm run typecheck` поймает и лишние, и недостающие.

- [ ] **Step 4: Прогнать домен и гейт**

Run: `npx vitest run server/src/http/read.test.ts`
Expected: PASS — тот же набор, что в шаге 1.

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Замерить и коммит**

Run: `wc -l server/src/http/app.ts`
Expected: около 1745 — на ~30 строк меньше 1775. Число записать в сообщение коммита:
по нему видно, что срез действительно уносит маршруты, а не копирует их.

```bash
git add server/src/http/routes/read.ts server/src/http/app.ts
git commit -m "refactor(http): домен read вынесен в свой роутер"
```

---

## Задача 4: ядро `@planer/client`

Транспорт без единого метода домена: путь запроса, разбор ошибок, `OFFLINE_MESSAGE`,
получение токена. Берётся из `admin/src/api/client.ts:592-710` — там он написан
подробнее, с русскими комментариями, объясняющими почему.

**Files:**
- Create: `client/src/core.ts`, `client/src/core.test.ts`
- Modify: `client/src/index.ts`

**Interfaces:**
- Consumes: воркспейс из задачи 1.
- Produces: `TokenSource`, `AuthRequiredError`, `OFFLINE_MESSAGE`, `createTransport(opts)`
  → `{ get, post, put, patch, del }`. Их используют задачи 5, 6, 7, 9.

- [ ] **Step 1: Написать падающий тест ядра**

`client/src/core.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createTransport, AuthRequiredError, OFFLINE_MESSAGE } from "./core";

const source = (token = "t") => ({ get: async () => token, clear: vi.fn() });

describe("транспорт", () => {
  it("сетевой сбой показывает по-русски, а не Failed to fetch", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const t = createTransport({ baseUrl: "", tokenSource: source(), fetchImpl });
    await expect(t.get("/api/templates")).rejects.toThrow(OFFLINE_MESSAGE);
  });

  it("401 сбрасывает токен и просит войти заново", async () => {
    const tokenSource = source();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const t = createTransport({ baseUrl: "", tokenSource, fetchImpl });
    await expect(t.get("/api/templates")).rejects.toBeInstanceOf(AuthRequiredError);
    expect(tokenSource.clear).toHaveBeenCalled();
  });

  it("показывает текст ошибки сервера, а не код", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Такого работника нет" }), { status: 400 }),
    );
    const t = createTransport({ baseUrl: "", tokenSource: source(), fetchImpl });
    await expect(t.get("/api/x")).rejects.toThrow("Такого работника нет");
  });

  it("кладёт токен в Authorization", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const t = createTransport({ baseUrl: "", tokenSource: source("abc"), fetchImpl });
    await t.get("/api/templates");
    expect(fetchImpl.mock.calls[0]![1].headers.Authorization).toBe("Bearer abc");
  });
});
```

- [ ] **Step 2: Прогнать — упадёт на отсутствии модуля**

Run: `npx vitest run client/src/core.test.ts`
Expected: FAIL — `Failed to resolve import "./core"`

- [ ] **Step 3: Написать ядро**

`client/src/core.ts` — перенести из `admin/src/api/client.ts` `apiFetch`, `errorMessage`,
`toError` и семейство `authorized*`, заменив глобальные `authToken`/`clearAuth` на
`TokenSource`, а глобальный `fetch` — на инъектируемый `fetchImpl`. Комментарий про
`OFFLINE_MESSAGE` (`admin/src/api/client.ts:585-591`) перенести дословно — он объясняет,
почему текст по-русски.

```ts
export class AuthRequiredError extends Error {}

export const OFFLINE_MESSAGE = "Нет связи с сервером — проверь интернет и попробуй ещё раз.";

/** Откуда брать токен. Мини-апп берёт его из Telegram initData, консоль — из ссылки бота. */
export interface TokenSource {
  get(): Promise<string>;
  clear(): void;
}

export interface TransportOptions {
  baseUrl: string;
  tokenSource: TokenSource;
  /** Инъекция ради тестов; в приложении — глобальный fetch. */
  fetchImpl?: typeof fetch;
}

export function createTransport(opts: TransportOptions) {
  const { baseUrl, tokenSource, fetchImpl = fetch } = opts;

  /**
   * Сетевой сбой — это не ответ сервера, а его отсутствие: `fetch` бросает
   * `TypeError: Failed to fetch` (Chrome) или «NetworkError…» (Firefox), и именно
   * эта английская строка доезжала до человека. Повод дёрнуть эту ветку будничный:
   * рестарт сервера при выкладке или лифт с плохим интернетом.
   */
  async function send(path: string, init: RequestInit): Promise<unknown> {
    const token = await tokenSource.get();
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new Error(OFFLINE_MESSAGE);
    }
    if (!res.ok) throw await toError(path, res, tokenSource);
    return await res.json();
  }

  const withJson = (method: string) => (path: string, payload: unknown) =>
    send(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  return {
    get: <T>(path: string) => send(path, {}) as Promise<T>,
    post: withJson("POST"),
    put: withJson("PUT"),
    patch: withJson("PATCH"),
    del: <T>(path: string) => send(path, { method: "DELETE" }) as Promise<T>,
  };
}

/** Маппит неуспешный ответ в ошибку; 401/403 гасит сессию и просит войти заново. */
async function toError(path: string, res: Response, tokenSource: TokenSource): Promise<Error> {
  if (res.status === 401 || res.status === 403) {
    tokenSource.clear();
    return new AuthRequiredError("Сессия истекла — войди заново");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `Request to ${path} failed with status ${res.status}`);
}
```

Сверить с оригиналом: `admin/src/api/client.ts:634-710`. Отличий от него ровно два —
токен берётся из `TokenSource`, а не из модульного `authToken`, и `fetch` инъектируется.
Всё остальное, включая тексты ошибок по-русски, переносится без изменений.

- [ ] **Step 4: Прогнать тест ядра**

Run: `npx vitest run client/src/core.test.ts`
Expected: PASS — четыре случая.

- [ ] **Step 5: Открыть наружу**

`client/src/index.ts`:

```ts
export * from "./core";
```

- [ ] **Step 6: Гейт и коммит**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add client/src
git commit -m "feat(client): ядро транспорта — токен, ошибки, сетевой сбой"
```

---

## Задача 5: методы и мок домена `read`

**Files:**
- Create: `client/src/read.ts`, `client/src/mock/delay.ts`, `client/src/mock/read.ts`,
  `client/src/mock/read.test.ts`
- Modify: `client/src/index.ts`

**Interfaces:**
- Consumes: `createTransport` (задача 4), схемы `read` (задача 2).
- Produces: `createReadApi(transport)` → `{ getTemplates, getMyShifts, getTeamSchedule }`;
  `createReadMock({ delayMs })` с той же формой. Их используют задачи 6 и 7.

- [ ] **Step 1: Написать падающий тест мока против схем контракта**

`client/src/mock/read.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { templatesResponseSchema, teamScheduleResponseSchema } from "@planer/shared";
import { createReadMock } from "./read";

/**
 * Мок обязан отвечать той же формой, что сервер. Это не ловит «правдоподобно и
 * неверно» по содержанию, но ловит расхождение формы — а именно оно и разъезжалось.
 */
describe("мок домена read", () => {
  const mock = createReadMock({ delayMs: 0 });

  it("пресеты проходят схему контракта", async () => {
    const parsed = templatesResponseSchema.safeParse({ templates: await mock.getTemplates() });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("график команды проходит схему контракта", async () => {
    const parsed = teamScheduleResponseSchema.safeParse(await mock.getTeamSchedule("2026-07-01", "2026-07-10"));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("с нулевой задержкой не спит", async () => {
    const started = Date.now();
    await mock.getTemplates();
    expect(Date.now() - started).toBeLessThan(50);
  });
});
```

Третий случай — прямое требование спеки: сегодня `miniapp/src/api/mock.test.ts` тратит
13.5 с на 19 тестов ровно из-за `await delay(200..350)`.

- [ ] **Step 2: Прогнать — упадёт**

Run: `npx vitest run client/src/mock/read.test.ts`
Expected: FAIL — `Failed to resolve import "./read"`

- [ ] **Step 3: Написать задержку, мок и методы**

`client/src/mock/delay.ts`:

```ts
/**
 * Задержка мока — параметр, а не константа.
 *
 * В `npm run dev` она делает экраны честными: видно спиннеры и гонки. В тестах она
 * ровно ноль — иначе гейт платит за сон реальными секундами (до этой правки:
 * 13.5 с на один файл).
 */
export const delay = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
```

`client/src/mock/read.ts` — данные взять из `miniapp/src/api/mock.ts` (он полнее
админского: 1466 строк против 1077), в части домена `read`. Даты по-прежнему считаются
от понедельника текущей недели, чтобы экраны не устаревали — это решение сохранить.

`client/src/read.ts` — три метода поверх транспорта.

- [ ] **Step 4: Прогнать тест мока**

Run: `npx vitest run client/src/mock/read.test.ts`
Expected: PASS — три случая, файл отрабатывает меньше секунды.

- [ ] **Step 5: Гейт и коммит**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add client/src
git commit -m "feat(client): методы и мок домена read, задержка стала параметром"
```

---

## Задача 6: мини-апп на общий клиент в части `read`

**Files:**
- Modify: `miniapp/src/api/client.ts`, `miniapp/src/api/mock.ts`
- Modify: `miniapp/package.json` (зависимость `@planer/client`)

**Interfaces:**
- Consumes: `createReadApi`, `createReadMock`, `createTransport` (задачи 4, 5).
- Produces: ничего нового наружу — экраны продолжают звать `apiClient.getTemplates()` и
  прочее теми же именами.

- [ ] **Step 1: Убедиться, что экранные тесты сейчас зелёные**

Run: `npx vitest run miniapp/src`
Expected: PASS. Опорная точка: экраны не должны заметить подмену.

- [ ] **Step 2: Добавить зависимость**

В `miniapp/package.json` в `dependencies`: `"@planer/client": "*"`. Затем `npm install`.

- [ ] **Step 3: Подменить реализацию, сохранив имена**

В `miniapp/src/api/client.ts`: собрать транспорт с `TokenSource` на базе Telegram
`initData` (логика уже есть в файле — она переезжает в реализацию `TokenSource`, а не
переписывается), и делегировать три read-метода в `createReadApi`. Типы `Shift`,
`Template`, `TeamSchedule` — реэкспортировать из `@planer/shared` вместо локальных
объявлений, чтобы у экранов не поменялись импорты.

**Расхождения этого домена — решить и записать:** локальный `Shift` мини-аппа несёт
`employeeName?`, которого нет в `scheduleEntrySchema`. Это не поле сервера: мини-апп
приклеивает его сам, соединяя записи с ростером из того же ответа
(`miniapp/src/api/client.ts:67-94`, комментарий там это и объясняет). Поэтому в контракт
оно не входит, а остаётся в мини-аппе как отдельный тип поверх DTO:

```ts
/** DTO плюс имя, которое мини-апп приклеивает сам из ростера того же ответа. */
export type ShiftWithName = ScheduleEntryDto & { employeeName?: string };
```

- [ ] **Step 4: Удалить read-часть локального мока**

Из `miniapp/src/api/mock.ts` убрать функции домена `read`, заменив их вызовами
`createReadMock({ delayMs: 200 })`. Задержку в dev оставить ненулевой — она там ради
честности экранов.

- [ ] **Step 5: Прогнать мини-апп и гейт**

Run: `npx vitest run miniapp/src`
Expected: PASS — тот же набор, что в шаге 1.

Run: `npm test && npm run typecheck && npm run build --workspace @planer/miniapp`
Expected: PASS всё три. Сборка обязательна: пятый воркспейс — новая точка сборки, и
проверить её надо на первом же срезе (риск 3 из спеки).

- [ ] **Step 6: Коммит**

```bash
git add miniapp package.json package-lock.json
git commit -m "refactor(мини-апп): домен read ходит через @planer/client"
```

---

## Задача 7: админка на общий клиент в части `read`

То же самое для браузерной консоли. Отдельной задачей, потому что `TokenSource` у неё
другой — `#token=` из ссылки бота плюс `localStorage`, — и рецензент может принять
мини-апп и отвергнуть консоль.

**Files:**
- Modify: `admin/src/api/client.ts`, `admin/src/api/mock.ts`, `admin/package.json`

**Interfaces:**
- Consumes: то же, что задача 6.
- Produces: ничего нового наружу.

- [ ] **Step 1: Убедиться, что экранные тесты админки зелёные**

Run: `npx vitest run admin/src`
Expected: PASS.

- [ ] **Step 2: Добавить зависимость**

В `admin/package.json`: `"@planer/client": "*"`, затем `npm install`.

- [ ] **Step 3: Перенести `TokenSource` консоли**

`captureHashToken`, `storedToken`, `clearAuth` (`admin/src/api/client.ts:537-580`)
становятся реализацией `TokenSource`. Комментарий про два способа входа — перенести
дословно. Поведение не меняется: токен по-прежнему снимается из хеша, кладётся в
`localStorage` и вычищается из адресной строки через `history.replaceState`.

**Расхождение этого домена:** локальный `Template` админки не знает `sortOrder`, а
контракт его несёт. Это чисто типовое — админка поле не читает, а порядок получает уже
отсортированным (`server/src/repo/templates.ts:10` — `orderBy(sortOrder)`). Поэтому
чиню сам: админка переходит на общий тип, поле просто появляется и остаётся
непрочитанным. В ledger это не идёт — поведения не меняет.

- [ ] **Step 4: Удалить read-часть локального мока**

Как в задаче 6: вызовы `createReadMock({ delayMs: 200 })` вместо своих функций.

- [ ] **Step 5: Прогнать админку и гейт**

Run: `npx vitest run admin/src`
Expected: PASS.

Run: `npm test && npm run typecheck && npm run build --workspace @planer/admin`
Expected: PASS всё три.

- [ ] **Step 6: Замерить выигрыш и коммит**

Run: `npx vitest run miniapp/src/api/mock.test.ts admin/src/api/mock.test.ts`
Записать длительность: до правки — 13.5 с и 4.0 с. Ожидание — заметно меньше в части
домена `read`; полный выигрыш придёт, когда переедут все девять доменов.

```bash
git add admin package.json package-lock.json
git commit -m "refactor(консоль): домен read ходит через @planer/client"
```

---

## Задача 8: контракт домена `employees` и сервер под ним

Второй домен. Он выбран вторым намеренно: в нём лежит известное расхождение
(`preferredName`), то есть на нём проверяется не только форма среза, но и процедура
разбора расхождений.

**Files:**
- Create: `shared/src/api/employees.ts`, `shared/src/api/employees.test.ts`
- Modify: `shared/src/api/index.ts`, `server/src/http/app.ts`,
  `server/src/http/employees.test.ts`
- Modify: `docs/audit/ledger.md` (если инвентаризация вскроет поведение)

**Interfaces:**
- Consumes: форма среза из задач 2–3.
- Produces: `employeeSchema`, `adminEmployeeSchema`, `employeesResponseSchema`,
  `adminEmployeesResponseSchema` и их типы.

- [ ] **Step 1: Инвентаризация расхождений — до единой строки кода**

Выписать все поля, где локальные типы двух клиентов расходятся по этому домену.
Известное на входе (проверено при брейншторме):

| Поле | Мини-апп | Консоль | Разбор |
| --- | --- | --- | --- |
| `preferredName` | есть | нет | типовое: консоль поле не читает — беру в контракт, чиню сам |

Проверять командой, а не памятью:

```bash
diff <(awk '/^export interface Employee \{/,/^\}/' miniapp/src/api/client.ts) \
     <(awk '/^export interface Employee \{/,/^\}/' admin/src/api/client.ts)
```

Для каждого найденного поля — решение по правилу: типовое (поле не читается, или это
разные имена одного типа) чиню сам и дописываю сюда; **меняющее поведение на экране —
несу владельцу и записываю в `docs/audit/ledger.md`, но не чиню в этой задаче**.

Заметить особо: `/api/employees` и `/api/admin/employees` отдают **разные** формы —
первая только `{id, displayName}` (`server/src/http/app.ts:346`), вторая весь ряд плюс
вычисленный `address`. Это две схемы, а не одна с необязательными полями: работнику
незачем видеть `telegramUserId` коллег.

- [ ] **Step 2: Написать падающие тесты схем**

Создать `shared/src/api/employees.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { employeeSchema, adminEmployeesResponseSchema } from "./employees";

const adminRow = {
  id: 1, displayName: "Аня", preferredName: null, address: "Аня",
  isAdmin: false, isActive: true, telegramUserId: 555, birthDate: "03-14",
  excludedFromAssignment: false, excludedFromSwaps: false,
};

describe("схемы домена employees", () => {
  it("работник видит коллегу только по имени", () => {
    expect(employeeSchema.safeParse({ id: 1, displayName: "Аня" }).success).toBe(true);
  });

  it("работнику не отдаётся телеграм коллеги", () => {
    // .strict() здесь несёт не косметику: это граница того, что видно рядовому
    // работнику. Лишнее поле в этом ответе — утечка, а не неопрятность.
    const parsed = employeeSchema.safeParse({ id: 1, displayName: "Аня", telegramUserId: 555 });
    expect(parsed.success).toBe(false);
  });

  it("админский список принимает сегодняшнюю форму", () => {
    const parsed = adminEmployeesResponseSchema.safeParse({ employees: [adminRow] });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("админский список отвергает лишнее поле", () => {
    const parsed = adminEmployeesResponseSchema.safeParse({
      employees: [{ ...adminRow, inviteToken: "inv-555" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("отвергает работника без обязательного displayName", () => {
    const { displayName, ...withoutName } = adminRow;
    expect(adminEmployeesResponseSchema.safeParse({ employees: [withoutName] }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Прогнать — упадёт**

Run: `npx vitest run shared/src/api/employees.test.ts`
Expected: FAIL — `Failed to resolve import "./employees"`

- [ ] **Step 4: Написать схемы**

`shared/src/api/employees.ts` — две схемы, обе `.strict()`:

```ts
/** Коллега глазами работника: только имя. Ни телеграма, ни дат рождения. */
export const employeeSchema = z.object({
  id: z.number().int(),
  displayName: z.string(),
}).strict();

/** Работник глазами админа. `address` вычисляется, а не хранится: карточка показывает,
 *  как бот к человеку обратится на самом деле. */
export const adminEmployeeSchema = z.object({
  id: z.number().int(),
  displayName: z.string(),
  preferredName: z.string().nullable(),
  address: z.string(),
  isAdmin: z.boolean(),
  isActive: z.boolean(),
  telegramUserId: z.number().int().nullable(),
  birthDate: z.string().nullable(),
  excludedFromAssignment: z.boolean(),
  excludedFromSwaps: z.boolean(),
}).strict();

export type EmployeeDto = z.infer<typeof employeeSchema>;
export type AdminEmployeeDto = z.infer<typeof adminEmployeeSchema>;

export const employeesResponseSchema = z.object({ employees: z.array(employeeSchema) }).strict();
export type EmployeesResponse = z.infer<typeof employeesResponseSchema>;

export const adminEmployeesResponseSchema = z.object({ employees: z.array(adminEmployeeSchema) }).strict();
export type AdminEmployeesResponse = z.infer<typeof adminEmployeesResponseSchema>;
```

Имена типов важны за пределами этой задачи: `AdminEmployeeDto` реэкспортируется фронтами
под старым именем `Employee` в задаче 10, а `adminEmployeesResponseSchema` зовётся из
тестов мока в задаче 9. Переименуешь здесь — сломаешь там.

Точный состав полей второй схемы — **сверить с фактическим ответом**, а не с типами
клиентов: `listForAdmin` спредится целиком (`server/src/http/app.ts:356`), и в нём могут
оказаться поля сверх этого списка (`rosterOrder`, `inviteToken`, `createdAt`). Каждое
такое поле — отдельное решение: взять в контракт или сузить ответ. `inviteToken`, если
он там есть, — сузить, и это идёт в ledger как находка про утечку.

- [ ] **Step 5: Написать контрактные тесты ручек, прогнать, увидеть падение**

Добавить в `server/src/http/employees.test.ts` по образцу задачи 2, шаг 5.

Run: `npx vitest run server/src/http/employees.test.ts`
Expected: FAIL со списком `unrecognized_keys` — он и есть точный ответ на вопрос из
шага 4.

- [ ] **Step 6: Привести сервер к контракту**

`satisfies` на обе ручки; лишние поля — сузить, недостающие — добавить в схему.

- [ ] **Step 7: Прогнать домен и гейт**

Run: `npx vitest run server/src/http/employees.test.ts`
Expected: PASS.

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
git add shared/src/api server/src/http docs/audit/ledger.md
git commit -m "feat(контракт): схемы домена employees, ответы сужены до контракта"
```

---

## Задача 9: роутер, методы и мок домена `employees`

**Files:**
- Create: `server/src/http/routes/employees.ts`, `client/src/employees.ts`,
  `client/src/mock/employees.ts`, `client/src/mock/employees.test.ts`
- Modify: `server/src/http/app.ts`, `client/src/index.ts`

**Interfaces:**
- Consumes: схемы из задачи 8, `createTransport` из задачи 4.
- Produces: `createEmployeesRoutes(deps)`, `createEmployeesApi(transport)`,
  `createEmployeesMock({ delayMs })`.

- [ ] **Step 1: Опорная точка**

Run: `npx vitest run server/src/http/employees.test.ts`
Expected: PASS.

- [ ] **Step 2: Вынести роутер**

По образцу задачи 3. Домен крупнее: сюда идут `/api/employees`,
`/api/admin/employees` и всё под ним — создание, правка, порядок, архивация,
восстановление, роль, приглашение (`server/src/http/app.ts:346-609`).

Заметить: `/api/admin/*` уже накрыт `requireAdmin` глобально
(`server/src/http/app.ts:178`), а per-route guard оставлен намеренно как
belt-and-suspenders — комментарий там это объясняет. При переносе **сохранить оба**.

- [ ] **Step 3: Прогнать и замерить**

Run: `npx vitest run server/src/http/employees.test.ts && npm test`
Expected: PASS.

Run: `wc -l server/src/http/app.ts`
Expected: около 1480 — минус ~265 строк домена.

- [ ] **Step 4: Написать падающий тест мока, затем методы и мок**

Создать `client/src/mock/employees.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { adminEmployeesResponseSchema } from "@planer/shared";
import { createEmployeesMock } from "./employees";

describe("мок домена employees", () => {
  const mock = createEmployeesMock({ delayMs: 0 });

  it("админский список проходит схему контракта", async () => {
    const parsed = adminEmployeesResponseSchema.safeParse({ employees: await mock.getEmployees() });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("с нулевой задержкой не спит", async () => {
    const started = Date.now();
    await mock.getEmployees();
    expect(Date.now() - started).toBeLessThan(50);
  });
});
```

Run: `npx vitest run client/src/mock/employees.test.ts`
Expected: FAIL — `Failed to resolve import "./employees"`

Затем написать `client/src/employees.ts` (методы поверх транспорта) и
`client/src/mock/employees.ts` (данные взять из `miniapp/src/api/mock.ts` — он полнее
админского), и прогнать тест до зелёного.

- [ ] **Step 5: Прогнать и коммит**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add server/src/http client/src
git commit -m "refactor(http): домен employees вынесен в роутер, клиент и мок — в пакет"
```

---

## Задача 10: оба фронта на `employees`, мёртвый код удалён

**Files:**
- Modify: `miniapp/src/api/client.ts`, `miniapp/src/api/mock.ts`,
  `admin/src/api/client.ts`, `admin/src/api/mock.ts`

**Interfaces:**
- Consumes: задача 9.
- Produces: ничего нового наружу.

- [ ] **Step 1: Опорная точка**

Run: `npx vitest run miniapp/src admin/src`
Expected: PASS.

- [ ] **Step 2: Перевести оба фронта**

В каждом из двух клиентов (`miniapp/src/api/client.ts`, `admin/src/api/client.ts`):

1. Удалить локальное `export interface Employee { … }` и поставить на его место
   реэкспорт, чтобы у экранов не поменялись импорты:

   ```ts
   export type { AdminEmployeeDto as Employee } from "@planer/shared";
   ```

2. Методы домена (`getEmployees`, `createEmployee`, `renameEmployee`, `archiveEmployee`,
   `restoreEmployee`, `setRole`, `invite`, `setOrder`) делегировать в
   `createEmployeesApi(transport)` вместо собственных `authorizedGet`/`authorizedPostJson`.
   Точный список методов свериться командой, а не памятью:

   ```bash
   grep -nE "^  async (get|create|rename|archive|restore|set|invite)" miniapp/src/api/client.ts admin/src/api/client.ts
   ```

3. В `mock.ts` каждого фронта убрать функции домена, заменив их на
   `createEmployeesMock({ delayMs: 200 })` — ненулевая задержка в dev оставляется
   намеренно, она там ради честности экранов.

Заметить: у мини-аппа и консоли наборы методов этого домена **не совпадают** — консоль
не зовёт часть админских ручек, мини-апп не зовёт часть других. Общий `createEmployeesApi`
несёт объединение; каждый фронт берёт из него то, что ему нужно, и ничего не обязан
использовать целиком.

- [ ] **Step 3: Удалить осиротевший код**

После двух доменов часть локальных моков и помощников не зовётся ниоткуда. Найти и
удалить — иначе следующий срез будет делаться в обход мёртвого кода, который выглядит
живым.

```bash
grep -rn "mockGetTemplates\|mockGetEmployees" miniapp/src admin/src
```

Ожидание: ни одного попадания вне удаляемых файлов.

- [ ] **Step 4: Полная проверка**

Run: `npm test && npm run typecheck`
Expected: PASS.

Run: `npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin`
Expected: обе сборки успешны.

- [ ] **Step 5: Замерить итог среза**

```bash
wc -l server/src/http/app.ts miniapp/src/api/client.ts miniapp/src/api/mock.ts \
      admin/src/api/client.ts admin/src/api/mock.ts
npx vitest run miniapp/src/api/mock.test.ts admin/src/api/mock.test.ts
```

Записать числа в сообщение коммита. Отправная точка, зафиксированная 2026-08-11:
`app.ts` 1775; клиенты 1164 и 998; моки 1466 и 1077; мок-тесты 13.5 с и 4.0 с.

- [ ] **Step 6: Коммит**

```bash
git add miniapp admin
git commit -m "refactor(фронты): домен employees ходит через @planer/client"
```

---

## Что этот план осознанно не делает

- **Не чинит `location`.** Находка про место дежурства (спека, раздел «Расхождения»)
  уходит в ledger к `/goal`. Чинить поведение заодно с переносом — значит лишить обе
  работы доказательства.
- **Не трогает семь остальных доменов.** Их план пишется после этого — по обкатанной
  форме и с известными граблями.
- **Не объединяет UI.** Экраны остаются в двух копиях: решение владельца от 2026-08-11.
- **Не вводит рантайм-валидацию ответов в проде.** Решение 2 спеки.

## Что проверить перед следующим планом

1. Форма среза выдержала два домена без правок? Если задачи 8–10 пришлось делать иначе,
   чем 2–3 и 5–7, — записать, чем именно, и следующий план строить по новой форме.
2. Сколько расхождений вскрыла инвентаризация на двух доменах? Если больше двух-трёх —
   для остальных семи домен инвентаризации стоит вынести в отдельную задачу-разведку до
   написания следующего плана.
3. Насколько похудел `app.ts` и ускорились мок-тесты. Если выигрыш заметно меньше
   ожидаемого — понять почему до того, как повторять это семь раз.
