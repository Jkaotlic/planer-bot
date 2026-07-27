# Stage 2B Team Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить текущий экран «Команда» на утверждённые read-only режимы «Сегодня» и «Неделя» с точными рабочими цветами, полным активным ростером, корректной обработкой многодневных записей и безопасной навигацией по диапазонам.

**Architecture:** Сервер отдаёт одним запросом отсортированных активных сотрудников и все пересекающие диапазон записи. Общий пакет хранит точную цветовую семантику, mini-app строит чистую presentation-модель отдельно от JSX, а `TeamScreen` управляет диапазоном, loading/error-состояниями и защитой от устаревших ответов.

**Tech Stack:** TypeScript 5.6, React 18, Telegram UI, Hono, Drizzle ORM, SQLite, Vitest 2, Vite.

## Global Constraints

- При каждом новом mount экрана выбран режим `today`; выбранный режим нигде персистентно не сохраняется.
- Неделя всегда содержит ровно семь дней, начинается в понедельник и помещается на ширину 320 px без горизонтального скролла.
- Порядок сотрудников: `rosterOrder` по возрастанию, затем `employee.id`; `null` в `rosterOrder` идёт после импортированных строк.
- Timed-группы режима «Сегодня» сортируются по `start`, затем `shift_templates.sort_order`, затем названию; безвременные записи выводятся после них.
- Цвета точны и одинаковы в mini-app и admin: `#EAF0F0`, `#FEFF01`, `#08AFF3`, `#20497C`, `#F2B07E`, `#FFBE00`, `#FE87FF`, `#CBC04D`, `#FD0100`.
- Цвет не является единственным носителем смысла: утверждённые типы показывают коды `С`, `У`, `В`, `Н`, `Т`, `ВА`, `П`, `07`, `О`.
- Неопределённые пользователем категории сохраняют существующие theme-aware category-палитры и полные подписи в Today/details.
- Пресет с id `6` переименовывается на месте из `Открытие` в `Дежурство с 07:00`; id, времена и ссылки исторических записей сохраняются.
- `GET /api/team/schedule` принимает только валидный диапазон до 31 календарного дня включительно и использует пересечение интервалов.
- Уже показанные данные не исчезают при обновлении; устаревший запрос не может перезаписать более свежий.
- В Stage 2B нет редактирования, фильтров, поиска, persistent storage и изменений нижней навигации.

---

## File map

- `server/drizzle/0008_team_schedule_identity.sql` — data-only исправление пресета `07:00` и сохранённых заголовков.
- `server/src/db/team-schedule-migration.test.ts` — доказательство сохранения id и внешней ссылки.
- `shared/src/schedule-palette.ts` — единая точная карта кодов/цветов.
- `server/src/repo/employees.ts` — активный ростер в стабильном порядке.
- `server/src/http/app.ts` — единый контракт `{ employees, shifts }` и валидация диапазона.
- `miniapp/src/api/client.ts` — типизированный `TeamSchedule`, без отдельного `/api/employees`.
- `miniapp/src/lib/team-schedule.ts` — покрытие дат, группировка, сортировка, week cells, счётчики и защита latest-request.
- `miniapp/src/screens/team/*.tsx` — небольшие presentation-компоненты Today/Week/details.
- `miniapp/src/screens/team/team-schedule.css` — responsive-сетка и визуальное разделение ячеек.
- `miniapp/src/screens/TeamScreen.tsx` — только состояние режима, диапазона, загрузки и orchestration.

### Task 1: Исправить пресет `07:00` без потери ссылок

**Files:**
- Create: `server/drizzle/0008_team_schedule_identity.sql`
- Modify: `server/drizzle/meta/_journal.json`
- Create: `server/src/db/team-schedule-migration.test.ts`
- Modify: `server/src/db/presets.test.ts`
- Modify: `server/src/http/read.test.ts`

**Interfaces:**
- Consumes: SQLite tables `shift_templates(id, name, category, is_active)` and `shifts(template_id, title)`.
- Produces: существующий preset id `6` с `name = "Дежурство с 07:00"` и `category = "duty"`; связанные строки `shifts` сохраняют `template_id = 6`.

- [ ] **Step 1: Написать failing regression test миграции**

Создать `server/src/db/team-schedule-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0008_team_schedule_identity.sql", import.meta.url),
  "utf8",
);

describe("0008_team_schedule_identity", () => {
  it("renames preset 6 and its stored titles without breaking template references", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE shift_templates (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        is_active INTEGER NOT NULL
      );
      CREATE TABLE shifts (
        id INTEGER PRIMARY KEY,
        template_id INTEGER REFERENCES shift_templates(id),
        title TEXT
      );
      INSERT INTO shift_templates VALUES (6, 'Открытие', 'shift', 1);
      INSERT INTO shifts VALUES (41, 6, 'Открытие');
      INSERT INTO shifts VALUES (42, 6, 'Своё название');
    `);

    sqlite.exec(migration);

    expect(
      sqlite.prepare("SELECT id, name, category, is_active FROM shift_templates WHERE id = 6").get(),
    ).toEqual({
      id: 6,
      name: "Дежурство с 07:00",
      category: "duty",
      is_active: 1,
    });
    expect(sqlite.prepare("SELECT id, template_id, title FROM shifts ORDER BY id").all()).toEqual([
      { id: 41, template_id: 6, title: "Дежурство с 07:00" },
      { id: 42, template_id: 6, title: "Своё название" },
    ]);
  });
});
```

- [ ] **Step 2: Запустить тест и подтвердить ожидаемое падение**

Run:

```bash
npx vitest run server/src/db/team-schedule-migration.test.ts
```

Expected: FAIL с `ENOENT` для `0008_team_schedule_identity.sql`.

- [ ] **Step 3: Добавить data-only миграцию и journal entry**

Создать `server/drizzle/0008_team_schedule_identity.sql`:

```sql
UPDATE `shifts`
SET `title` = 'Дежурство с 07:00'
WHERE `template_id` IN (
  SELECT `id` FROM `shift_templates` WHERE `name` = 'Открытие'
)
AND `title` = 'Открытие';

UPDATE `shift_templates`
SET `name` = 'Дежурство с 07:00',
    `category` = 'duty',
    `is_active` = 1
WHERE `name` = 'Открытие';
```

В `server/drizzle/meta/_journal.json` добавить после idx `7`:

```json
{
  "idx": 8,
  "version": "6",
  "when": 1785146400000,
  "tag": "0008_team_schedule_identity",
  "breakpoints": true
}
```

В `server/src/db/presets.test.ts` заменить ожидаемую строку id `6`:

```ts
{ id: 6, name: "Дежурство с 07:00", category: "duty", accent: "amber", location: null, start: "07:00", end: "16:00", fridayStart: "07:00", fridayEnd: "14:45", isLate: false, sendReminder: true },
```

В `server/src/http/read.test.ts` заменить имя шестого пресета в ожидаемом массиве:

```ts
"Дежурство с 07:00",
```

- [ ] **Step 4: Запустить миграционные и preset-тесты**

Run:

```bash
npx vitest run server/src/db/team-schedule-migration.test.ts server/src/db/presets.test.ts server/src/http/read.test.ts
```

Expected: PASS; id `6`, времена и внешний ключ остаются прежними, строка `Открытие` больше не возвращается endpoint-ом шаблонов.

- [ ] **Step 5: Зафиксировать атомарный commit**

```bash
git add server/drizzle/0008_team_schedule_identity.sql server/drizzle/meta/_journal.json server/src/db/team-schedule-migration.test.ts server/src/db/presets.test.ts server/src/http/read.test.ts
git commit -m "fix(schedule): rename opening duty preset"
```

### Task 2: Вынести точную цветовую семантику в shared

**Files:**
- Create: `shared/src/schedule-palette.ts`
- Create: `shared/src/schedule-palette.test.ts`
- Modify: `shared/src/index.ts`
- Modify: `miniapp/src/categories.tsx`
- Modify: `admin/src/categories.tsx`

**Interfaces:**
- Consumes: `TemplateAccent` и `EntryCategory` из `shared/src/category.ts`.
- Produces: `SchedulePalette`, `SCHEDULE_ACCENT_PALETTES`, `VACATION_SCHEDULE_PALETTE`, `exactSchedulePalette(accent, category)`.

- [ ] **Step 1: Написать failing test для всех утверждённых кодов и цветов**

Создать `shared/src/schedule-palette.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SCHEDULE_ACCENT_PALETTES,
  VACATION_SCHEDULE_PALETTE,
  exactSchedulePalette,
} from "./schedule-palette";

describe("working schedule palette", () => {
  it("matches every sampled colour and visible code", () => {
    expect(SCHEDULE_ACCENT_PALETTES).toEqual({
      blue:   { bg: "#EAF0F0", fg: "#17202A", code: "С" },
      gold:   { bg: "#FEFF01", fg: "#17202A", code: "У" },
      violet: { bg: "#08AFF3", fg: "#062C3B", code: "В" },
      indigo: { bg: "#20497C", fg: "#FFFFFF", code: "Н" },
      rose:   { bg: "#F2B07E", fg: "#17202A", code: "Т" },
      green:  { bg: "#FFBE00", fg: "#17202A", code: "ВА" },
      teal:   { bg: "#FE87FF", fg: "#39133A", code: "П" },
      amber:  { bg: "#CBC04D", fg: "#292505", code: "07" },
    });
    expect(VACATION_SCHEDULE_PALETTE).toEqual({
      bg: "#FD0100",
      fg: "#FFFFFF",
      code: "О",
    });
  });

  it("leaves unspecified categories to the existing theme palette", () => {
    expect(exactSchedulePalette(undefined, "sick_leave")).toBeNull();
    expect(exactSchedulePalette(undefined, "business_trip")).toBeNull();
    expect(exactSchedulePalette(undefined, "offsite")).toBeNull();
    expect(exactSchedulePalette(undefined, "weekend_work")).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест и увидеть отсутствующий модуль**

Run:

```bash
npx vitest run shared/src/schedule-palette.test.ts
```

Expected: FAIL с `Failed to load url ./schedule-palette`.

- [ ] **Step 3: Реализовать карту и экспорт**

Создать `shared/src/schedule-palette.ts`:

```ts
import type { EntryCategory, TemplateAccent } from "./category";

export interface SchedulePalette {
  readonly bg: string;
  readonly fg: string;
  readonly code: string;
}

export const SCHEDULE_ACCENT_PALETTES: Record<TemplateAccent, SchedulePalette> = {
  blue:   { bg: "#EAF0F0", fg: "#17202A", code: "С" },
  gold:   { bg: "#FEFF01", fg: "#17202A", code: "У" },
  violet: { bg: "#08AFF3", fg: "#062C3B", code: "В" },
  indigo: { bg: "#20497C", fg: "#FFFFFF", code: "Н" },
  rose:   { bg: "#F2B07E", fg: "#17202A", code: "Т" },
  green:  { bg: "#FFBE00", fg: "#17202A", code: "ВА" },
  teal:   { bg: "#FE87FF", fg: "#39133A", code: "П" },
  amber:  { bg: "#CBC04D", fg: "#292505", code: "07" },
};

export const VACATION_SCHEDULE_PALETTE: SchedulePalette = {
  bg: "#FD0100",
  fg: "#FFFFFF",
  code: "О",
};

export function exactSchedulePalette(
  accent: TemplateAccent | undefined,
  category: EntryCategory,
): SchedulePalette | null {
  if (accent) return SCHEDULE_ACCENT_PALETTES[accent];
  return category === "vacation" ? VACATION_SCHEDULE_PALETTE : null;
}
```

Добавить в `shared/src/index.ts`:

```ts
export * from "./schedule-palette";
```

- [ ] **Step 4: Подключить карту в обеих UI-палитрах**

В `miniapp/src/categories.tsx` удалить локальные объявления `Category` и `TemplateAccent`, сохранив существующий public type API:

```ts
import { exactSchedulePalette, type EntryCategory, type TemplateAccent } from "@planer/shared";
export type { EntryCategory as Category, TemplateAccent } from "@planer/shared";
```

В `admin/src/categories.tsx` расширить существующий shared-import:

```ts
import { exactSchedulePalette, type EntryCategory, type TemplateAccent } from "@planer/shared";
```

В обеих реализациях `useEntryPalette` сначала выбирать точную карту, затем существующий theme-aware fallback:

```ts
export function useEntryPalette(entry: ColourableEntry, templates: readonly AccentedTemplate[]): CategoryPalette {
  const isDark = useIsDark();
  const accent = entry.templateId != null
    ? templates.find((template) => template.id === entry.templateId)?.accent
    : undefined;
  const exact = exactSchedulePalette(accent, entry.category);
  if (exact) return { bg: exact.bg, fg: exact.fg };
  return (isDark ? DARK_PALETTE : LIGHT_PALETTE)[entry.category];
}
```

В `useCategoryPalette` применить красный vacation fallback, не меняя неопределённые категории:

```ts
export function useCategoryPalette(category: EntryCategory): CategoryPalette {
  const isDark = useIsDark();
  const exact = exactSchedulePalette(undefined, category);
  if (exact) return { bg: exact.bg, fg: exact.fg };
  return (isDark ? DARK_PALETTE : LIGHT_PALETTE)[category];
}
```

Удалить дублированные `LIGHT_ACCENTS` и `DARK_ACCENTS`.

- [ ] **Step 5: Проверить shared, admin и mini-app типами и тестами**

Run:

```bash
npx vitest run shared/src/schedule-palette.test.ts
npm run typecheck
```

Expected: PASS; обе UI используют одну карту, а неопределённые категории продолжают брать текущую светлую/тёмную палитру.

- [ ] **Step 6: Зафиксировать commit**

```bash
git add shared/src/schedule-palette.ts shared/src/schedule-palette.test.ts shared/src/index.ts miniapp/src/categories.tsx admin/src/categories.tsx
git commit -m "feat(schedule): share exact working colours"
```

### Task 3: Сделать team schedule единым валидируемым API

**Files:**
- Modify: `server/src/repo/employees.ts`
- Modify: `server/src/http/app.ts`
- Modify: `server/src/http/read.test.ts`

**Interfaces:**
- Consumes: `listShiftsOverlapping(db, from, to)`, `dateStr`, `dayNumber`.
- Produces: `listActiveInRosterOrder(db): Employee[]` и JSON `{ employees: TeamEmployee[]; shifts: Shift[] }`.

- [ ] **Step 1: Расширить endpoint-тесты до полного контракта**

В `server/src/http/read.test.ts` импортировать schema:

```ts
import { employees } from "../db/schema";
import { eq } from "drizzle-orm";
```

Заменить простой тест whole-team schedule на:

```ts
it("returns the full active roster in roster order and every overlapping shift", async () => {
  const db = makeTestDb();
  const late = worker(db, "Без порядка", 333);
  const second = worker(db, "Вторая", 444);
  const first = worker(db, "Первая", 555);
  const archived = worker(db, "Архив", 666);
  db.update(employees).set({ rosterOrder: 1 }).where(eq(employees.id, second.id)).run();
  db.update(employees).set({ rosterOrder: 0 }).where(eq(employees.id, first.id)).run();
  db.update(employees).set({ isActive: false }).where(eq(employees.id, archived.id)).run();

  createShift(db, {
    date: "2026-06-28",
    endDate: "2026-07-03",
    category: "vacation",
    employeeId: first.id,
  });
  createShift(db, {
    date: "2026-07-02",
    start: "08:00",
    end: "17:00",
    employeeId: null,
  });

  const app = createApp({ db, config });
  const res = await app.request(
    "/api/team/schedule?from=2026-07-01&to=2026-07-07",
    bearer(await tokenFor(app, 333)),
  );
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.employees).toEqual([
    { id: first.id, displayName: "Первая", rosterOrder: 0 },
    { id: second.id, displayName: "Вторая", rosterOrder: 1 },
    { id: late.id, displayName: "Без порядка", rosterOrder: null },
  ]);
  expect(body.shifts).toHaveLength(2);
  expect(body.shifts.some((shift: { employeeId: number | null }) => shift.employeeId === null)).toBe(true);
  expect(body.shifts.some((shift: { date: string }) => shift.date === "2026-06-28")).toBe(true);
});
```

Добавить table-driven validation:

```ts
it.each([
  ["/api/team/schedule?from=nope&to=2026-07-07", 400],
  ["/api/team/schedule?from=2026-07-08&to=2026-07-07", 400],
  ["/api/team/schedule?from=2026-07-01&to=2026-08-01", 400],
])("rejects invalid team range %s", async (path, status) => {
  const db = makeTestDb();
  worker(db, "Игорь", 333);
  const app = createApp({ db, config });
  expect((await app.request(path, bearer(await tokenFor(app, 333)))).status).toBe(status);
});

it("accepts an inclusive 31-day team range", async () => {
  const db = makeTestDb();
  worker(db, "Игорь", 333);
  const app = createApp({ db, config });
  const res = await app.request(
    "/api/team/schedule?from=2026-07-01&to=2026-07-31",
    bearer(await tokenFor(app, 333)),
  );
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Запустить endpoint-тесты и подтвердить contract failures**

Run:

```bash
npx vitest run server/src/http/read.test.ts
```

Expected: FAIL — `employees` отсутствует, отпуск до `from` потерян, невалидные диапазоны принимаются.

- [ ] **Step 3: Реализовать стабильный порядок активного ростера**

В `server/src/repo/employees.ts` добавить:

```ts
export function listActiveInRosterOrder(db: Db): Employee[] {
  return db
    .select()
    .from(employees)
    .where(eq(employees.isActive, true))
    .orderBy(
      sql`case when ${employees.rosterOrder} is null then 1 else 0 end`,
      employees.rosterOrder,
      employees.id,
    )
    .all();
}
```

И добавить `sql` в существующий импорт `drizzle-orm`.

- [ ] **Step 4: Реализовать строгий team endpoint**

В `server/src/http/app.ts` дописать функции в уже существующие imports из соответствующих repo, не создавать второй import из того же модуля:

```ts
import { createShift, updateShift, deleteShift, getShift, listUpcomingForEmployee, listShiftsInRange, listShiftsOverlapping } from "../repo/shifts";
import { listActiveInRosterOrder } from "../repo/employees";
```

Заменить handler:

```ts
app.get("/api/team/schedule", requireAuth(db, config.jwtSecret), (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!from || !to) return c.json({ error: "from and to are required" }, 400);
  if (!dateStr.safeParse(from).success || !dateStr.safeParse(to).success) {
    return c.json({ error: "from and to must be valid YYYY-MM-DD dates" }, 400);
  }
  if (from > to) return c.json({ error: "from must not be after to" }, 400);
  if (dayNumber(to) - dayNumber(from) > 30) {
    return c.json({ error: "the range must span at most 31 days" }, 400);
  }

  const employees = listActiveInRosterOrder(db).map((employee) => ({
    id: employee.id,
    displayName: employee.displayName,
    rosterOrder: employee.rosterOrder,
  }));
  return c.json({
    employees,
    shifts: listShiftsOverlapping(db, from, to),
  });
});
```

Не менять `/api/employees` в этом commit: это публичный совместимый endpoint, его удаление не требуется Stage 2B.

- [ ] **Step 5: Запустить серверные проверки**

Run:

```bash
npx vitest run server/src/http/read.test.ts server/src/repo/repo.test.ts
npx tsc -p server/tsconfig.json
```

Expected: PASS; 31 дней включительно принимаются, 32 отклоняются, full roster и overlapping shifts возвращаются одним ответом.

- [ ] **Step 6: Зафиксировать commit**

```bash
git add server/src/repo/employees.ts server/src/http/app.ts server/src/http/read.test.ts
git commit -m "feat(api): return roster with team schedule"
```

### Task 4: Создать типизированный client contract и чистую presentation-модель

**Files:**
- Modify: `miniapp/src/api/client.ts`
- Modify: `miniapp/src/api/mock.ts`
- Modify: `miniapp/src/App.tsx`
- Modify: `miniapp/src/screens/admin/AdminScheduleScreen.tsx`
- Create: `miniapp/src/lib/team-schedule.ts`
- Create: `miniapp/src/lib/team-schedule.test.ts`

**Interfaces:**
- Consumes: `Shift`, `Template`, `SchedulePalette`, `exactSchedulePalette`, week date helpers.
- Produces:
  - `TeamEmployee { id; displayName; rosterOrder }`
  - `TeamSchedule { employees; shifts }`
  - `buildTodayModel(date, schedule, templates): TodayModel`
  - `buildWeekModel(monday, schedule, templates): WeekModel`
  - `teamRange(mode, selectedDate): { from; to }`
  - `createLatestRequestGate(): LatestRequestGate`
  - `requestLatestTeamSchedule(load, range, gate): Promise<TeamLoadResult>`.

- [ ] **Step 1: Написать failing tests чистой модели**

Создать `miniapp/src/lib/team-schedule.test.ts` с фиксированными данными:

```ts
import { describe, expect, it } from "vitest";
import type { Shift, TeamSchedule, Template } from "../api/client";
import {
  buildTodayModel,
  buildWeekModel,
  createLatestRequestGate,
  requestLatestTeamSchedule,
  splitDisplayName,
  teamRange,
} from "./team-schedule";

const templates = [
  { id: 6, name: "Дежурство с 07:00", accent: "amber", sortOrder: 0 },
  { id: 1, name: "Утро", accent: "gold", sortOrder: 1 },
  { id: 2, name: "День", accent: "blue", sortOrder: 2 },
] as const satisfies ReadonlyArray<Pick<Template, "id" | "name" | "accent" | "sortOrder">>;

const employees = [
  { id: 20, displayName: "Шилов Дмитрий", rosterOrder: 0 },
  { id: 10, displayName: "Юдин Максим", rosterOrder: 1 },
  { id: 30, displayName: "Без Смены", rosterOrder: 2 },
];

function shift(patch: Partial<Shift> & Pick<Shift, "id" | "date" | "employeeId">): Shift {
  return {
    start: "09:00",
    end: "18:00",
    endDate: null,
    category: "shift",
    title: "День",
    templateId: 2,
    location: null,
    ...patch,
  };
}

const schedule: TeamSchedule = {
  employees,
  shifts: [
    shift({ id: 1, date: "2026-07-27", start: "08:00", end: "17:00", title: "Утро", templateId: 1, employeeId: 10 }),
    shift({ id: 2, date: "2026-07-27", start: "07:00", end: "16:00", title: "Дежурство с 07:00", templateId: 6, category: "duty", employeeId: 20 }),
    shift({ id: 3, date: "2026-07-26", endDate: "2026-07-29", start: null, end: null, title: null, templateId: null, category: "vacation", employeeId: 10 }),
    shift({ id: 4, date: "2026-07-27", employeeId: null }),
    shift({ id: 5, date: "2026-07-27", start: "09:00", end: "18:00", employeeId: 20 }),
  ],
};

describe("team schedule model", () => {
  it("builds chronological today groups with no-time entries last", () => {
    const model = buildTodayModel("2026-07-27", schedule, templates);
    expect(model.groups.map((group) => group.title)).toEqual([
      "Дежурство с 07:00",
      "Утро",
      "День",
    ]);
    expect(model.noTimeGroups.map((group) => group.title)).toEqual(["Отпуск"]);
    expect(model.workingCount).toBe(2);
    expect(model.absentCount).toBe(1);
    expect(model.groups[2]?.people.map((person) => person.displayName)).toEqual([
      "Шилов Дмитрий",
      "Не назначено",
    ]);
  });

  it("keeps every employee row, seven days, unassigned work, and +N details", () => {
    const model = buildWeekModel("2026-07-27", schedule, templates);
    expect(model.days).toHaveLength(7);
    expect(model.rows.map((row) => row.displayName)).toEqual([
      "Шилов Дмитрий",
      "Юдин Максим",
      "Без Смены",
      "Не назначено",
    ]);
    expect(model.rows[2]?.cells.every((cell) => cell.entries.length === 0)).toBe(true);
    expect(model.rows[0]?.cells[0]?.entries).toHaveLength(2);
    expect(model.rows[0]?.cells[0]?.extraCount).toBe(1);
    expect(
      model.rows[1]?.cells
        .slice(0, 3)
        .every((cell) => cell.entries.some((entry) => entry.shift.category === "vacation")),
    ).toBe(true);
  });

  it("splits surname from the remaining name and calculates exact ranges", () => {
    expect(splitDisplayName("Юдин Максим Сергеевич")).toEqual({
      surname: "Юдин",
      rest: "Максим Сергеевич",
    });
    expect(teamRange("today", "2026-08-01")).toEqual({ from: "2026-08-01", to: "2026-08-01" });
    expect(teamRange("week", "2026-08-01")).toEqual({ from: "2026-07-27", to: "2026-08-02" });
  });

  it("drops an older response that finishes after the latest request", async () => {
    const gate = createLatestRequestGate();
    let resolveOld!: (value: TeamSchedule) => void;
    let resolveNew!: (value: TeamSchedule) => void;
    const oldPromise = new Promise<TeamSchedule>((resolve) => { resolveOld = resolve; });
    const newPromise = new Promise<TeamSchedule>((resolve) => { resolveNew = resolve; });
    const load = (from: string) => from === "2026-07-27" ? oldPromise : newPromise;

    const oldRequest = requestLatestTeamSchedule(
      load,
      { from: "2026-07-27", to: "2026-07-27" },
      gate,
    );
    const newRequest = requestLatestTeamSchedule(
      load,
      { from: "2026-07-28", to: "2026-07-28" },
      gate,
    );
    resolveNew(schedule);
    expect(await newRequest).toEqual({ status: "accepted", schedule });
    resolveOld(schedule);
    expect(await oldRequest).toEqual({ status: "stale" });
  });

  it("surfaces an error only when the failing request is still current", async () => {
    const gate = createLatestRequestGate();
    const error = new Error("offline");
    const result = await requestLatestTeamSchedule(
      async () => { throw error; },
      { from: "2026-07-27", to: "2026-07-27" },
      gate,
    );
    expect(result).toEqual({ status: "failed", error });
  });
});
```

- [ ] **Step 2: Запустить test и подтвердить отсутствие модели**

Run:

```bash
npx vitest run miniapp/src/lib/team-schedule.test.ts
```

Expected: FAIL с `Failed to load url ./team-schedule`.

- [ ] **Step 3: Расширить client types и убрать второй HTTP-запрос**

В `miniapp/src/api/client.ts`:

```ts
export interface Shift {
  id: number;
  date: string;
  start: string | null;
  end: string | null;
  endDate: string | null;
  category: Category;
  title: string | null;
  location: string | null;
  templateId: number | null;
  employeeId: number | null;
  employeeName?: string;
}

export interface TeamEmployee {
  id: number;
  displayName: string;
  rosterOrder: number | null;
}

export interface TeamSchedule {
  employees: TeamEmployee[];
  shifts: Shift[];
}
```

Добавить `sortOrder: number` в `Template`, изменить interface:

```ts
getTeamSchedule(from: string, to: string): Promise<TeamSchedule>;
```

Заменить real implementation:

```ts
async getTeamSchedule(from, to) {
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const schedule = await authorizedGet<TeamSchedule>(`/api/team/schedule?${query}`);
  const nameById = new Map(schedule.employees.map((employee) => [employee.id, employee.displayName]));
  return {
    employees: schedule.employees,
    shifts: schedule.shifts.map((shift) => ({
      ...shift,
      employeeName: shift.employeeId != null ? nameById.get(shift.employeeId) : undefined,
    })),
  };
},
```

Удалить `EmployeesResponse` и HTTP-вызов `/api/employees` только из `getTeamSchedule`.

- [ ] **Step 4: Адаптировать текущих потребителей к `{ employees, shifts }`**

В bootstrap/reload `miniapp/src/App.tsx` брать `.shifts`:

```ts
apiClient.getTeamSchedule(from, to).then((schedule) => schedule.shifts),
```

В обоих местах `miniapp/src/screens/admin/AdminScheduleScreen.tsx`, где результат напрямую передаётся в `setShifts`, использовать:

```ts
const schedule = await apiClient.getTeamSchedule(fromIso, toIso);
setShifts(schedule.shifts);
```

и:

```ts
apiClient
  .getTeamSchedule(from, to)
  .then((schedule) => setShifts(schedule.shifts))
```

- [ ] **Step 5: Обновить mock contract и реалистичный ростер**

В `miniapp/src/api/mock.ts`:

Добавить `TeamSchedule` в type-import из `./client`.

Сделать `location` частью mock draft и всегда материализовать поле `Shift`:

```ts
interface EntryDraft {
  templateId?: number | null;
  date: string;
  start: string | null;
  end: string | null;
  endDate: string | null;
  category: Category;
  title: string | null;
  location?: string | null;
  employeeId: number;
}

function entry(draft: EntryDraft): Shift {
  return {
    id: nextId++,
    employeeName: personName(draft.employeeId),
    templateId: draft.templateId ?? null,
    location: draft.location ?? null,
    ...draft,
  };
}
```

Добавить запись preset id `6`, чтобы рабочий olive-цвет присутствовал в dev UI:

```ts
entry({
  templateId: 6,
  date: dayIso(0),
  start: "07:00",
  end: "16:00",
  endDate: null,
  category: "duty",
  title: "Дежурство с 07:00",
  employeeId: 3,
}),
```

Заменить весь `TEMPLATES` на строки с явным `sortOrder`:

```ts
const TEMPLATES: readonly Template[] = [
  { id: 1, sortOrder: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, category: "shift", location: null },
  { id: 2, sortOrder: 2, name: "День", accent: "blue", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false, category: "shift", location: null },
  { id: 3, sortOrder: 3, name: "Вечер", accent: "violet", start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00", isLate: true, sendReminder: false, category: "shift", location: null },
  { id: 4, sortOrder: 4, name: "Ночь", accent: "indigo", start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00", isLate: true, sendReminder: true, category: "shift", location: null },
  { id: 5, sortOrder: 5, name: "Дежурство · Поклонка", accent: "teal", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: "Поклонка" },
  { id: 6, sortOrder: 0, name: "Дежурство с 07:00", accent: "amber", start: "07:00", end: "16:00", fridayStart: "07:00", fridayEnd: "14:45", isLate: false, sendReminder: true, category: "duty", location: null },
  { id: 7, sortOrder: 6, name: "Дежурство · Телефон", accent: "rose", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: null },
  { id: 8, sortOrder: 7, name: "Дежурство · Вавилова 19", accent: "green", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: "Вавилова 19" },
];
```

Точная реализация ответа:

```ts
export async function mockGetTeamSchedule(from: string, to: string): Promise<TeamSchedule> {
  await delay(350);
  return {
    employees: EMPLOYEES
      .filter((employee) => employee.isActive)
      .map((employee, rosterOrder) => ({
        id: employee.id,
        displayName: employee.displayName,
        rosterOrder,
      })),
    shifts: ALL_ENTRIES.filter((entry) => overlapsRange(entry, from, to)).sort(byDateThenStart),
  };
}
```

В `mockCreateEntry` установить:

```ts
location: input.location ?? null,
```

В `mockUpdateEntry` установить:

```ts
shift.location = input.location ?? null;
```

- [ ] **Step 6: Реализовать чистые функции модели**

Создать `miniapp/src/lib/team-schedule.ts` с экспортами:

```ts
import { exactSchedulePalette, isAbsence, type EntryCategory, type SchedulePalette } from "@planer/shared";
import type { Shift, TeamEmployee, TeamSchedule, Template } from "../api/client";
import { addDays, mondayOf, toISODate } from "./week";

export type TeamMode = "today" | "week";
export interface TeamRange { from: string; to: string }
export interface TeamPerson { employeeId: number | null; displayName: string; rosterOrder: number }
export interface TeamEntryView {
  shift: Shift;
  title: string;
  palette: SchedulePalette | null;
}
export interface TodayGroup {
  key: string;
  title: string;
  start: string | null;
  end: string | null;
  palette: SchedulePalette | null;
  people: TeamPerson[];
  entries: TeamEntryView[];
}
export interface TodayModel {
  groups: TodayGroup[];
  noTimeGroups: TodayGroup[];
  workingCount: number;
  absentCount: number;
}
export interface WeekCell {
  date: string;
  entries: TeamEntryView[];
  primary: TeamEntryView | null;
  extraCount: number;
}
export interface WeekRow {
  employeeId: number | null;
  displayName: string;
  cells: WeekCell[];
}
export interface WeekModel { days: string[]; rows: WeekRow[] }

type ScheduleTemplate = Pick<Template, "id" | "name" | "accent" | "sortOrder">;

const CATEGORY_TITLES: Record<EntryCategory, string> = {
  shift: "Смена",
  vacation: "Отпуск",
  sick_leave: "Больничный",
  duty: "Дежурство",
  offsite: "Выездное мероприятие",
  business_trip: "Командировка",
  weekend_work: "Работа в выходной",
};

export function coversDate(shift: Shift, date: string): boolean {
  return shift.date <= date && (shift.endDate ?? shift.date) >= date;
}

export function splitDisplayName(displayName: string): { surname: string; rest: string } {
  const [surname = displayName, ...rest] = displayName.trim().split(/\s+/);
  return { surname, rest: rest.join(" ") };
}

export function teamRange(mode: TeamMode, selectedDate: string): TeamRange {
  if (mode === "today") return { from: selectedDate, to: selectedDate };
  const monday = mondayOf(new Date(`${selectedDate}T12:00:00`));
  return { from: toISODate(monday), to: toISODate(addDays(monday, 6)) };
}
```

В том же файле добавить полный pipeline группировки:

```ts
function templateFor(shift: Shift, templates: readonly ScheduleTemplate[]): ScheduleTemplate | undefined {
  return shift.templateId == null
    ? undefined
    : templates.find((template) => template.id === shift.templateId);
}

function toEntryView(shift: Shift, templates: readonly ScheduleTemplate[]): TeamEntryView {
  const template = templateFor(shift, templates);
  return {
    shift,
    title: template?.name ?? shift.title ?? CATEGORY_TITLES[shift.category],
    palette: exactSchedulePalette(template?.accent, shift.category),
  };
}

function groupingKey(shift: Shift): string {
  if (shift.templateId != null) return `template:${shift.templateId}`;
  return [
    "custom",
    shift.category,
    shift.title ?? "",
    shift.start ?? "",
    shift.end ?? "",
    shift.location ?? "",
  ].join(":");
}

function compareShifts(a: Shift, b: Shift, templates: readonly ScheduleTemplate[]): number {
  const byStart = (a.start ?? "99:99").localeCompare(b.start ?? "99:99");
  if (byStart !== 0) return byStart;
  const aOrder = templateFor(a, templates)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bOrder = templateFor(b, templates)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return toEntryView(a, templates).title.localeCompare(toEntryView(b, templates).title, "ru");
}

function employeeRank(employee: TeamEmployee, index: number): number {
  return employee.rosterOrder ?? 1_000_000 + index;
}

function personFor(employeeId: number | null, employees: readonly TeamEmployee[]): TeamPerson {
  if (employeeId == null) {
    return {
      employeeId: null,
      displayName: "Не назначено",
      rosterOrder: Number.MAX_SAFE_INTEGER,
    };
  }
  const index = employees.findIndex((employee) => employee.id === employeeId);
  const employee = employees[index];
  return {
    employeeId,
    displayName: employee?.displayName ?? "Сотрудник вне активного ростера",
    rosterOrder: employee ? employeeRank(employee, index) : Number.MAX_SAFE_INTEGER - 1,
  };
}

function groupEntries(
  shifts: readonly Shift[],
  employees: readonly TeamEmployee[],
  templates: readonly ScheduleTemplate[],
): TodayGroup[] {
  const grouped = new Map<string, TodayGroup>();
  for (const shift of [...shifts].sort((a, b) => compareShifts(a, b, templates))) {
    const key = groupingKey(shift);
    const entry = toEntryView(shift, templates);
    const group = grouped.get(key) ?? {
      key,
      title: entry.title,
      start: shift.start,
      end: shift.end,
      palette: entry.palette,
      people: [],
      entries: [],
    };
    group.entries.push(entry);
    const person = personFor(shift.employeeId, employees);
    if (!group.people.some((candidate) => candidate.employeeId === person.employeeId)) {
      group.people.push(person);
      group.people.sort(
        (a, b) =>
          a.rosterOrder - b.rosterOrder
          || (a.employeeId ?? Number.MAX_SAFE_INTEGER) - (b.employeeId ?? Number.MAX_SAFE_INTEGER),
      );
    }
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

export function buildTodayModel(
  date: string,
  schedule: TeamSchedule,
  templates: readonly ScheduleTemplate[],
): TodayModel {
  const covering = schedule.shifts.filter((shift) => coversDate(shift, date));
  const timed = covering.filter((shift) => shift.start != null);
  const noTime = covering.filter((shift) => shift.start == null);
  const working = new Set(
    timed.flatMap((shift) => shift.employeeId == null ? [] : [shift.employeeId]),
  );
  const absent = new Set(
    noTime.flatMap(
      (shift) => isAbsence(shift.category) && shift.employeeId != null ? [shift.employeeId] : [],
    ),
  );
  return {
    groups: groupEntries(timed, schedule.employees, templates),
    noTimeGroups: groupEntries(noTime, schedule.employees, templates)
      .sort((a, b) => a.entries[0]!.shift.category.localeCompare(b.entries[0]!.shift.category)),
    workingCount: working.size,
    absentCount: absent.size,
  };
}

function weekCell(
  date: string,
  employeeId: number | null,
  shifts: readonly Shift[],
  templates: readonly ScheduleTemplate[],
): WeekCell {
  const entries = shifts
    .filter((shift) => shift.employeeId === employeeId && coversDate(shift, date))
    .sort((a, b) => compareShifts(a, b, templates))
    .map((shift) => toEntryView(shift, templates));
  return {
    date,
    entries,
    primary: entries[0] ?? null,
    extraCount: Math.max(0, entries.length - 1),
  };
}

export function buildWeekModel(
  mondayIso: string,
  schedule: TeamSchedule,
  templates: readonly ScheduleTemplate[],
): WeekModel {
  const monday = new Date(`${mondayIso}T12:00:00`);
  const days = Array.from({ length: 7 }, (_, index) => toISODate(addDays(monday, index)));
  const employees = [...schedule.employees].sort((a, b) => {
    const aOrder = a.rosterOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.rosterOrder ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.id - b.id;
  });
  const rows: WeekRow[] = employees.map((employee) => ({
    employeeId: employee.id,
    displayName: employee.displayName,
    cells: days.map((date) => weekCell(date, employee.id, schedule.shifts, templates)),
  }));
  if (
    schedule.shifts.some(
      (shift) => shift.employeeId == null && days.some((date) => coversDate(shift, date)),
    )
  ) {
    rows.push({
      employeeId: null,
      displayName: "Не назначено",
      cells: days.map((date) => weekCell(date, null, schedule.shifts, templates)),
    });
  }
  return { days, rows };
}
```

Добавить latest-request helper:

```ts
export interface LatestRequestGate {
  begin(): number;
  isLatest(id: number): boolean;
}

export function createLatestRequestGate(): LatestRequestGate {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (id) => id === latest,
  };
}

export type TeamLoadResult =
  | { status: "accepted"; schedule: TeamSchedule }
  | { status: "failed"; error: unknown }
  | { status: "stale" };

export async function requestLatestTeamSchedule(
  load: (from: string, to: string) => Promise<TeamSchedule>,
  range: TeamRange,
  gate: LatestRequestGate,
): Promise<TeamLoadResult> {
  const id = gate.begin();
  try {
    const schedule = await load(range.from, range.to);
    return gate.isLatest(id) ? { status: "accepted", schedule } : { status: "stale" };
  } catch (error) {
    return gate.isLatest(id) ? { status: "failed", error } : { status: "stale" };
  }
}
```

- [ ] **Step 7: Запустить model tests и typecheck**

Run:

```bash
npx vitest run miniapp/src/lib/team-schedule.test.ts
npm run typecheck
```

Expected: PASS; существующие admin/swap consumers компилируются с новым ответом.

- [ ] **Step 8: Зафиксировать commit**

```bash
git add miniapp/src/api/client.ts miniapp/src/api/mock.ts miniapp/src/App.tsx miniapp/src/screens/admin/AdminScheduleScreen.tsx miniapp/src/lib/team-schedule.ts miniapp/src/lib/team-schedule.test.ts
git commit -m "feat(team): add schedule presentation model"
```

### Task 5: Собрать экран «Сегодня» и управляемую загрузку диапазона

**Files:**
- Create: `miniapp/src/screens/team/TeamViewSwitcher.tsx`
- Create: `miniapp/src/screens/team/TeamRangeNav.tsx`
- Create: `miniapp/src/screens/team/TeamTodayView.tsx`
- Create: `miniapp/src/screens/team/team-schedule.css`
- Modify: `miniapp/src/screens/TeamScreen.tsx`
- Modify: `miniapp/src/App.tsx`

**Interfaces:**
- Consumes: `TodayModel`, `teamRange`, `buildTodayModel`, `requestLatestTeamSchedule`, `apiClient.getTeamSchedule`.
- Produces: рабочий `TeamScreen({ templates }: { templates: readonly Template[] })` для выбранного дня; созданный `TeamViewSwitcher` подключается в Task 6 одновременно с готовой week-grid.

- [ ] **Step 1: Добавить pure UI-state assertions**

В `miniapp/src/lib/team-schedule.test.ts` добавить:

```ts
it("moves Today by one day and Week by seven days through the existing date helpers", () => {
  expect(teamRange("today", "2026-07-28")).toEqual({
    from: "2026-07-28",
    to: "2026-07-28",
  });
  expect(teamRange("week", "2026-08-03")).toEqual({
    from: "2026-08-03",
    to: "2026-08-09",
  });
});
```

Run:

```bash
npx vitest run miniapp/src/lib/team-schedule.test.ts
```

Expected: PASS; этот тест фиксирует диапазоны, которые UI будет запрашивать.

- [ ] **Step 2: Создать доступный переключатель и навигацию**

`miniapp/src/screens/team/TeamViewSwitcher.tsx`:

```tsx
import type { TeamMode } from "../../lib/team-schedule";

export function TeamViewSwitcher({
  value,
  onChange,
}: {
  value: TeamMode;
  onChange: (value: TeamMode) => void;
}) {
  return (
    <div className="team-switcher" role="tablist" aria-label="Вид расписания">
      {(["today", "week"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={value === mode}
          className={value === mode ? "team-switcher__button is-active" : "team-switcher__button"}
          onClick={() => onChange(mode)}
        >
          {mode === "today" ? "Сегодня" : "Неделя"}
        </button>
      ))}
    </div>
  );
}
```

`miniapp/src/screens/team/TeamRangeNav.tsx`:

```tsx
export function TeamRangeNav({
  label,
  busy,
  onPrevious,
  onNext,
}: {
  label: string;
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="team-range-nav">
      <button type="button" aria-label="Предыдущий период" disabled={busy} onClick={onPrevious}>‹</button>
      <strong aria-live="polite">{label}</strong>
      <button type="button" aria-label="Следующий период" disabled={busy} onClick={onNext}>›</button>
    </div>
  );
}
```

- [ ] **Step 3: Создать Today presentation**

`miniapp/src/screens/team/TeamTodayView.tsx`:

```tsx
import type { TodayGroup, TodayModel } from "../../lib/team-schedule";

export function TeamTodayView({ model }: { model: TodayModel }) {
  const empty = model.groups.length === 0 && model.noTimeGroups.length === 0;
  return (
    <>
      <div className="team-summary" aria-label="Итоги дня">
        <span><b>{model.workingCount}</b> На работе</span>
        <span><b>{model.absentCount}</b> Отсутствует</span>
      </div>
      {empty ? (
        <div className="team-empty">
          <strong>На этот день записей нет</strong>
          <span>Выберите соседнюю дату стрелками.</span>
        </div>
      ) : (
        <div className="team-today">
          {model.groups.map((group) => <TodayGroupCard key={group.key} group={group} />)}
          {model.noTimeGroups.length > 0 && (
            <section className="team-no-time">
              <h3>Без времени</h3>
              {model.noTimeGroups.map((group) => <TodayGroupCard key={group.key} group={group} />)}
            </section>
          )}
        </div>
      )}
    </>
  );
}

function TodayGroupCard({ group }: { group: TodayGroup }) {
  const markerStyle = group.palette ? { background: group.palette.bg } : undefined;
  return (
    <section className="team-group">
      <span className="team-group__marker" style={markerStyle} aria-hidden="true" />
      <div className="team-group__body">
        <div className="team-group__heading">
          <strong>{group.title}</strong>
          <span>{group.start && group.end ? `${group.start}–${group.end}` : "Весь день"}</span>
        </div>
        <div className="team-group__people">
          {group.people.map((person) => (
            <span key={`${group.key}:${person.employeeId ?? "open"}`}>{person.displayName}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Переписать `TeamScreen` как stateful orchestrator**

Заменить `miniapp/src/screens/TeamScreen.tsx` на:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner, Title } from "@telegram-apps/telegram-ui";
import { apiClient, type TeamSchedule, type Template } from "../api/client";
import { ScreenScroll } from "../components/ScreenScroll";
import {
  buildTodayModel,
  createLatestRequestGate,
  requestLatestTeamSchedule,
  teamRange,
} from "../lib/team-schedule";
import { addDays, formatDayLabel, parseISODate, toISODate } from "../lib/week";
import { TeamRangeNav } from "./team/TeamRangeNav";
import { TeamTodayView } from "./team/TeamTodayView";
import "./team/team-schedule.css";

export function TeamScreen({ templates }: { templates: readonly Template[] }) {
  const [selectedDate, setSelectedDate] = useState(() => toISODate(new Date()));
  const [schedule, setSchedule] = useState<TeamSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = useRef(createLatestRequestGate());
  const range = useMemo(() => teamRange("today", selectedDate), [selectedDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await requestLatestTeamSchedule(
      apiClient.getTeamSchedule,
      range,
      gate.current,
    );
    if (result.status === "stale") return;
    if (result.status === "failed") {
      setError(
        result.error instanceof Error
          ? result.error.message
          : "Не удалось загрузить расписание",
      );
    } else {
      setSchedule(result.schedule);
    }
    setLoading(false);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  function move(days: number) {
    setSelectedDate(toISODate(addDays(parseISODate(selectedDate), days)));
  }

  return (
    <ScreenScroll style={{ padding: "8px 12px 96px" }}>
      <div className="team-screen">
        <Title level="2" weight="2">Команда</Title>
        <TeamRangeNav
          label={formatDayLabel(selectedDate)}
          busy={loading}
          onPrevious={() => move(-1)}
          onNext={() => move(1)}
        />
        {loading && <div className="team-refreshing" role="status">Обновляем…</div>}
        {error && (
          <div className="team-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void load()}>Повторить</button>
          </div>
        )}
        {!schedule && loading && <Spinner size="m" />}
        {schedule && (
          <TeamTodayView model={buildTodayModel(selectedDate, schedule, templates)} />
        )}
      </div>
    </ScreenScroll>
  );
}
```

В `miniapp/src/App.tsx` заменить:

```tsx
{tab === "team" && <TeamScreen templates={data.templates} />}
```

App продолжает хранить `teamShifts` только для существующего flow обмена; экран «Команда» загружает собственный выбранный диапазон. `TeamViewSwitcher` пока не рендерится: week-toggle подключается в Task 6 только вместе с готовым содержимым, поэтому промежуточный commit не открывает пустой экран.

- [ ] **Step 5: Добавить базовые responsive-стили Today**

В `miniapp/src/screens/team/team-schedule.css` задать:

```css
.team-screen {
  min-width: 0;
}
.team-switcher {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 3px;
  border-radius: 12px;
  background: var(--tgui--secondary_bg_color);
}
.team-switcher__button {
  min-height: 38px;
  border: 0;
  border-radius: 9px;
  color: var(--tgui--hint_color);
  background: transparent;
  font: inherit;
}
.team-switcher__button.is-active {
  color: var(--tgui--text_color);
  background: var(--tgui--bg_color);
  box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
}
.team-range-nav {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 42px;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
  text-align: center;
}
.team-range-nav button {
  min-height: 40px;
  border: 0;
  border-radius: 12px;
  color: var(--tgui--link_color);
  background: var(--tgui--secondary_bg_color);
  font-size: 28px;
}
.team-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}
.team-summary span,
.team-group {
  background: var(--tgui--secondary_bg_color);
  border-radius: 14px;
}
.team-summary span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
}
.team-group {
  display: grid;
  grid-template-columns: 6px minmax(0, 1fr);
  overflow: hidden;
  margin-bottom: 8px;
}
.team-group__body { padding: 11px 12px; min-width: 0; }
.team-group__heading { display: flex; justify-content: space-between; gap: 8px; }
.team-group__people { display: grid; gap: 5px; margin-top: 8px; }
.team-no-time { margin-top: 18px; }
.team-empty,
.team-error { display: grid; gap: 8px; padding: 18px 12px; text-align: center; }
```

- [ ] **Step 6: Проверить тесты, typecheck и build**

Run:

```bash
npx vitest run miniapp/src/lib/team-schedule.test.ts
npm run typecheck
npm run build -w @planer/miniapp
```

Expected: PASS; `TeamScreen` на каждом mount начинает с `today`, дата меняется на один день, старые данные остаются во время refresh.

- [ ] **Step 7: Зафиксировать commit**

```bash
git add miniapp/src/screens/team/TeamViewSwitcher.tsx miniapp/src/screens/team/TeamRangeNav.tsx miniapp/src/screens/team/TeamTodayView.tsx miniapp/src/screens/team/team-schedule.css miniapp/src/screens/TeamScreen.tsx miniapp/src/App.tsx miniapp/src/lib/team-schedule.test.ts
git commit -m "feat(team): add chronological today view"
```

### Task 6: Добавить недельную сетку и details modal

**Files:**
- Create: `miniapp/src/screens/team/TeamWeekGrid.tsx`
- Create: `miniapp/src/screens/team/TeamEntryDetails.tsx`
- Modify: `miniapp/src/screens/team/team-schedule.css`
- Modify: `miniapp/src/screens/TeamScreen.tsx`
- Modify: `miniapp/src/lib/team-schedule.test.ts`

**Interfaces:**
- Consumes: `WeekModel`, `WeekCell`, `TeamEntryView`, `splitDisplayName`.
- Produces: семидневная grid без horizontal overflow и `TeamEntryDetails` со всеми записями выбранной ячейки.

- [ ] **Step 1: Усилить week-model test кодами и диапазонами**

В week test добавить:

```ts
expect(model.days).toEqual([
  "2026-07-27",
  "2026-07-28",
  "2026-07-29",
  "2026-07-30",
  "2026-07-31",
  "2026-08-01",
  "2026-08-02",
]);
expect(model.rows[0]?.cells[0]?.primary?.palette?.code).toBe("07");
expect(
  model.rows[1]?.cells[0]?.entries
    .find((entry) => entry.shift.category === "vacation")
    ?.palette?.code,
).toBe("О");
```

Run:

```bash
npx vitest run miniapp/src/lib/team-schedule.test.ts
```

Expected: PASS после Task 4; assertion защищает month boundary и утверждённые коды.

- [ ] **Step 2: Реализовать details modal**

`miniapp/src/screens/team/TeamEntryDetails.tsx`:

```tsx
import { Modal } from "@telegram-apps/telegram-ui";
import type { TeamEntryView } from "../../lib/team-schedule";

export function TeamEntryDetails({
  open,
  entries,
  onOpenChange,
}: {
  open: boolean;
  entries: TeamEntryView[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} header={<Modal.Header>Смена</Modal.Header>}>
      <div className="team-details">
        {entries.map(({ shift, title }) => (
          <article key={shift.id} className="team-details__entry">
            <strong>{title}</strong>
            <span>{shift.start && shift.end ? `${shift.start}–${shift.end}` : "Весь день"}</span>
            {shift.location && <span>Место: {shift.location}</span>}
            <span>{shift.date === (shift.endDate ?? shift.date) ? shift.date : `${shift.date} — ${shift.endDate}`}</span>
          </article>
        ))}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Реализовать grid-компонент**

`miniapp/src/screens/team/TeamWeekGrid.tsx`:

```tsx
import { useState } from "react";
import type { TeamEntryView, WeekCell, WeekModel } from "../../lib/team-schedule";
import { splitDisplayName } from "../../lib/team-schedule";
import { TeamEntryDetails } from "./TeamEntryDetails";

export function TeamWeekGrid({ model, today }: { model: WeekModel; today: string }) {
  const [details, setDetails] = useState<TeamEntryView[]>([]);
  return (
    <>
      <div className="team-week">
        <div className="team-week__corner">Сотрудник</div>
        {model.days.map((day) => (
          <div
            key={day}
            className={`team-week__day${day === today ? " is-today" : ""}${isWeekend(day) ? " is-weekend" : ""}`}
          >
            <b>{new Date(`${day}T12:00:00`).toLocaleDateString("ru-RU", { weekday: "short" })}</b>
            <span>{day.slice(8, 10)}</span>
          </div>
        ))}
        {model.rows.map((row) => {
          const name = splitDisplayName(row.displayName);
          return (
            <div className="team-week__row" key={row.employeeId ?? "unassigned"}>
              <div className="team-week__name">
                <b>{name.surname}</b>
                <span>{name.rest}</span>
              </div>
              {row.cells.map((cell) => (
                <WeekCellButton
                  key={`${row.employeeId ?? "open"}:${cell.date}`}
                  cell={cell}
                  onOpen={() => setDetails(cell.entries)}
                />
              ))}
            </div>
          );
        })}
      </div>
      <TeamEntryDetails open={details.length > 0} entries={details} onOpenChange={(open) => !open && setDetails([])} />
    </>
  );
}

function WeekCellButton({ cell, onOpen }: { cell: WeekCell; onOpen: () => void }) {
  if (!cell.primary) {
    return (
      <div
        className={`team-week__cell${isWeekend(cell.date) ? " is-weekend" : ""}`}
        aria-label={`${cell.date}: нет записи`}
      />
    );
  }
  const palette = cell.primary.palette;
  return (
    <button
      type="button"
      className={`team-week__cell has-entry${isWeekend(cell.date) ? " is-weekend" : ""}`}
      style={palette ? { background: palette.bg, color: palette.fg } : undefined}
      aria-label={`${cell.date}: ${cell.entries.map((entry) => entry.title).join(", ")}`}
      onClick={onOpen}
    >
      <b>{palette?.code ?? "•"}</b>
      {cell.extraCount > 0 && <small>+{cell.extraCount}</small>}
    </button>
  );
}

function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return weekday === 0 || weekday === 6;
}
```

- [ ] **Step 4: Добавить week branch в `TeamScreen`**

Расширить imports `miniapp/src/screens/TeamScreen.tsx`:

```ts
import {
  buildTodayModel,
  buildWeekModel,
  createLatestRequestGate,
  requestLatestTeamSchedule,
  teamRange,
  type TeamMode,
} from "../lib/team-schedule";
import {
  addDays,
  formatDayLabel,
  formatWeekRangeLabel,
  parseISODate,
  toISODate,
} from "../lib/week";
import { TeamViewSwitcher } from "./team/TeamViewSwitcher";
import { TeamWeekGrid } from "./team/TeamWeekGrid";
```

Добавить mode state и сделать range зависимым от него:

```ts
const [mode, setMode] = useState<TeamMode>("today");
const range = useMemo(() => teamRange(mode, selectedDate), [mode, selectedDate]);
const label = mode === "today"
  ? formatDayLabel(selectedDate)
  : formatWeekRangeLabel(parseISODate(range.from), parseISODate(range.to));
```

Заменить `move`:

```ts
function move(direction: -1 | 1) {
  const step = mode === "today" ? direction : direction * 7;
  setSelectedDate(toISODate(addDays(parseISODate(selectedDate), step)));
}
```

Сразу после заголовка подключить switcher, не изменяя `selectedDate` при смене режима:

```tsx
<TeamViewSwitcher value={mode} onChange={setMode} />
<TeamRangeNav
  label={label}
  busy={loading}
  onPrevious={() => move(-1)}
  onNext={() => move(1)}
/>
```

Заменить Today-only branch на оба готовых экрана:

```tsx
{schedule && mode === "today" && (
  <TeamTodayView model={buildTodayModel(selectedDate, schedule, templates)} />
)}
{schedule && mode === "week" && (
  <TeamWeekGrid
    model={buildWeekModel(range.from, schedule, templates)}
    today={toISODate(new Date())}
  />
)}
```

- [ ] **Step 5: Добавить responsive grid CSS**

В `team-schedule.css`:

```css
.team-week {
  display: grid;
  grid-template-columns: minmax(82px, 1.55fr) repeat(7, minmax(0, 1fr));
  gap: 3px;
  width: 100%;
  min-width: 0;
  font-size: 10px;
}
.team-week__corner,
.team-week__day {
  min-width: 0;
  padding: 6px 1px;
  text-align: center;
  color: var(--tgui--hint_color);
}
.team-week__day {
  display: grid;
  gap: 2px;
  border-radius: 7px 7px 0 0;
}
.team-week__day.is-weekend { background: rgb(127 127 127 / 8%); }
.team-week__day.is-today { box-shadow: inset 0 3px var(--tgui--link_color); }
.team-week__row { display: contents; }
.team-week__name {
  display: flex;
  min-width: 0;
  min-height: 38px;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
  padding: 4px 5px;
  border-radius: 7px;
  background: var(--tgui--secondary_bg_color);
}
.team-week__name b,
.team-week__name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-week__cell {
  min-width: 0;
  min-height: 38px;
  border: 0;
  border-radius: 6px;
  background: rgb(127 127 127 / 5%);
}
.team-week__cell.is-weekend { box-shadow: inset 0 0 0 999px rgb(127 127 127 / 4%); }
.team-week__cell.has-entry {
  display: grid;
  place-content: center;
  padding: 1px;
  font: inherit;
}
.team-week__cell small { font-size: 8px; line-height: 1; }
.team-details { display: grid; gap: 8px; padding: 8px 16px 24px; }
.team-details__entry {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 12px;
  background: var(--tgui--secondary_bg_color);
}
@media (max-width: 340px) {
  .team-screen { padding-inline: 8px; }
  .team-week {
    grid-template-columns: minmax(76px, 1.45fr) repeat(7, minmax(0, 1fr));
    gap: 2px;
    font-size: 9px;
  }
  .team-week__name { padding-inline: 4px; }
}
```

Запрещено добавлять `overflow-x: auto`; сетка обязана сжиматься в 320 px.

- [ ] **Step 6: Прогнать model/type/build проверки**

Run:

```bash
npx vitest run miniapp/src/lib/team-schedule.test.ts
npm run typecheck
npm run build -w @planer/miniapp
```

Expected: PASS; grid всегда строит 8 колонок (ФИО + 7 дней), details перечисляет все элементы выбранной ячейки.

- [ ] **Step 7: Зафиксировать commit**

```bash
git add miniapp/src/screens/team/TeamWeekGrid.tsx miniapp/src/screens/team/TeamEntryDetails.tsx miniapp/src/screens/team/team-schedule.css miniapp/src/screens/TeamScreen.tsx miniapp/src/lib/team-schedule.test.ts
git commit -m "feat(team): add compact weekly grid"
```

### Task 7: Полная регрессия и визуальная проверка 320/360 px

**Files:**
- Modify only if a check exposes a defect: files already listed in Tasks 1–6.

**Interfaces:**
- Consumes: завершённые server/shared/miniapp реализации.
- Produces: доказанный green build и визуально проверенные Today/Week в обеих темах.

- [ ] **Step 1: Убедиться, что старое пользовательское имя исчезло**

Run:

```bash
rg -n 'Открытие' server miniapp admin shared --glob '!**/team-schedule-migration.test.ts' --glob '!**/0008_team_schedule_identity.sql'
```

Expected: команда не выводит активных preset/mock/UI-совпадений. Историческая строка допустима только внутри regression migration test и самой миграции.

Проверить отсутствие персистентного хранения режима:

```bash
if rg -n 'localStorage|sessionStorage|cloudStorage|CloudStorage' miniapp/src/screens/TeamScreen.tsx miniapp/src/screens/team; then
  exit 1
fi
```

Expected: нет вывода, exit code `0`.

- [ ] **Step 2: Запустить полный automated suite**

Run:

```bash
npm test
npm run typecheck
npm run build -w @planer/miniapp
npm run build -w @planer/admin
```

Expected: все команды завершаются с exit code `0`.

- [ ] **Step 3: Запустить mini-app локально**

Run:

```bash
npm run dev -w @planer/miniapp -- --host 127.0.0.1
```

Expected: Vite печатает локальный URL; dev mock открывает полный active roster и обе вкладки.

- [ ] **Step 4: Проверить `Сегодня` в in-app browser**

Проверить viewport 320×700 и 360×800 в light/dark:

- default tab — `Сегодня`;
- группы идут `07:00 → 08:00 → 09:00 → 11:00`;
- полные ФИО читаются и не слипаются;
- `Без времени` находится после timed-групп;
- стрелка меняет день ровно на один;
- во время refresh старые карточки остаются;
- empty и retry не скрывают навигацию.

- [ ] **Step 5: Проверить `Неделя` в in-app browser**

Проверить viewport 320×700 и 360×800 в light/dark:

- видны ФИО + все семь дней без horizontal scrollbar;
- фамилия и остальная часть имени разнесены на две строки;
- сотрудник без смен имеет пустую строку;
- пустая ячейка отличается от обычной смены `С`;
- выходные имеют нейтральный фон, сегодня — верхний акцент;
- цвета и коды совпадают с Global Constraints;
- ячейка `+N` открывает modal со всеми записями, временем, местом и диапазоном;
- стрелка меняет неделю ровно на семь дней, включая переход месяца.

- [ ] **Step 6: Проверить реальный API smoke test после штатного запуска сервиса**

Использовать существующий авторизованный способ проекта, не печатая token:

```bash
curl -sS -H "Authorization: Bearer $PLANER_SMOKE_TOKEN" "http://127.0.0.1:3000/api/team/schedule?from=2026-07-27&to=2026-08-02" | jq '{employees: (.employees | length), shifts: (.shifts | length), first_employee: .employees[0].displayName}'
```

Expected: JSON содержит числовые `employees`, `shifts` и первый displayName; секрет не попадает в вывод.

- [ ] **Step 7: Зафиксировать только реальные QA-исправления**

Если визуальная или smoke-проверка потребовала правок:

```bash
git add shared/src server/src miniapp/src admin/src
git commit -m "fix(team): resolve schedule verification findings"
```

Если правок не было, commit не создавать.

- [ ] **Step 8: Зафиксировать итоговую проверку**

Run:

```bash
git status --short
git log --oneline -7
```

Expected: worktree clean; история содержит отдельные commits для migration, palette, API, model, Today и Week.

## Definition of done

- Endpoint возвращает full active roster и overlapping shifts одним ответом с полной валидацией 31-дневного диапазона.
- Preset id `6` и его ссылки сохранены, пользовательское `Открытие` отсутствует.
- Today всегда открывается первым и стабильно сортирует команду по времени.
- Week показывает семь дней, полный ростер, no-shift и unassigned rows, multi-entry details.
- Точные цвета не меняются между темами; остальные поверхности и неопределённые категории остаются theme-aware.
- Latest-request guard, empty/loading/error/retry и background refresh проверены.
- `npm test`, `npm run typecheck`, оба production build и mobile visual QA проходят.
