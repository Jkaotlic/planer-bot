# Ближайшие смены и подробный журнал — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вкладка «Мои смены» показывает только сегодня и дальше, с честными заголовками; журнал в обоих консолях читается словами вместо JSON и знает о девяти действиях, которые сейчас не записывает.

**Architecture:** Логика «payload → человеческая фраза» переезжает в `shared/src/audit.ts` как чистая функция `describeAuditEvent`, а тип `AuditType` оттуда же типизирует `recordAudit` на сервере — компилятор не даёт добавить событие без описания. Оба консоля становятся тонкими: берут `{icon, title, lines}` и рисуют. Разбиение списка смен по неделям — чистая функция в `miniapp/src/lib/upcoming.ts`, экран только рисует.

**Tech Stack:** TypeScript, npm workspaces (`shared` / `server` / `miniapp` / `admin`), Hono + Drizzle + better-sqlite3 на сервере, React + `@telegram-apps/telegram-ui` в мини-аппе, React + свой CSS в вебе, vitest везде.

**Спека:** `docs/superpowers/specs/2026-08-07-upcoming-shifts-and-journal-detail-design.md`

## Global Constraints

- **Слой 1 — TDD обязателен.** Каждая задача: сначала падающий тест, потом минимальная реализация. Тест, который не падал, ничего не доказывает.
- **Репозиторий публичный.** Ни одного настоящего ФИО, хендла или telegram id ни в одном файле под git. В примерах и тестах — только вымышленный ростер, уже живущий в моках: `Аня Смирнова`, `Игорь Петров`, `Марк Волков`, `Даша Кузнецова`, `Олег Соколов`, `Света Орлова`. Страж: `npx vitest run server/src/db/no-real-names.test.ts` — он читает файлы с диска по `git ls-files`, поэтому новый файл надо сначала `git add`.
- **`inviteToken` не попадает в журнал никогда** — это действующий ключ к учётной записи.
- Прогон всех тестов: `npx vitest run`. Типы: `npm run typecheck`.
- **Тесты рендера пишутся без `@testing-library`** — его в проекте нет. `vitest.config.ts` задаёт окружение `node`, поэтому каждый тест с DOM начинается с прагмы `// @vitest-environment jsdom` и рендерит через `createRoot` + `act` из `react-dom/client`, проверяя `host.textContent`. Компоненты мини-аппа дополнительно оборачиваются в `AppRoot` из telegram-ui: `Cell` и `Section` читают платформу из её контекста и без неё бросают. Образцы: `miniapp/src/components/shift-row-today.test.tsx`, `admin/src/screens/journal-error.test.tsx`.
- Язык интерфейса и сообщений — русский. Комментарии в коде — как в окружающем файле.
- Коммиты частые, по одному на задачу, сообщение на русском в стиле репозитория (`feat(scope): …`, `fix(scope): …`).

---

## File Structure

**Создаются:**

| Файл | Ответственность |
|---|---|
| `miniapp/src/lib/upcoming.ts` | Разбиение будущих смен по неделям и подсчёт остатка текущей недели. Чистые функции, ноль React. |
| `miniapp/src/lib/upcoming.test.ts` | Тесты к нему. |
| `shared/src/audit.ts` | `AuditType`, `AuditView`, `describeAuditEvent` + вспомогательные форматтеры даты/времени журнала. Чистый модуль. |
| `shared/src/audit.test.ts` | Тесты к нему — по одному на тип события. |

**Меняются:**

| Файл | Что именно |
|---|---|
| `server/src/repo/shifts.ts` | `listUpcomingForEmployee` перестаёт терять многодневные записи. |
| `server/src/http/app.ts` | `/api/my/shifts` возвращает `today`; обогащение четырёх payload'ов; девять новых `recordAudit`. |
| `server/src/repo/audit.ts` | `recordAudit` принимает `AuditType`, а не `string`. |
| `server/src/reminders/reminder-service.ts` | `reminders_dispatched` в конце тика; `displayName` в `reminder_undeliverable`. |
| `miniapp/src/api/client.ts` | `getMyShifts()` без аргумента, возвращает `{ shifts, today }`. |
| `miniapp/src/api/mock.ts` | То же в моке. |
| `miniapp/src/App.tsx` | Убрать вычисление понедельника для «моих смен» (два места), прокинуть `today`. |
| `miniapp/src/screens/MyShiftsScreen.tsx` | Секции по неделям, честные заголовок и сводка. |
| `miniapp/src/screens/admin/AdminJournal.tsx` | Рендер через `describeAuditEvent`; удалить `TYPE_LABELS`, `formatMoment`, `monthRangeOf`. |
| `admin/src/screens/JournalScreen.tsx` | То же. |
| `admin/src/index.css` | `.journal-row` из четырёхколоночной сетки становится карточкой с подстроками. |
| `shared/src/index.ts` | Экспорт `./audit`. |

**Удаляются:** `miniapp/src/screens/admin/journal-labels.test.ts`, `admin/src/screens/journal-labels.test.ts` — их роль (сторожить дубль) забирает компилятор.

---

## Часть 1. Ближайшие смены

### Task 1: `/api/my/shifts` — окно от сегодня и многодневные записи

Сейчас роут по умолчанию берёт сегодняшнюю дату в `teamTz`, но клиент всегда передаёт `from`, так что дефолт не работает. И `listUpcomingForEmployee` фильтрует по `gte(shifts.date, from)` — отпуск, начавшийся до `from` и идущий через него, из выдачи выпадает. Пока `from` был понедельником, это било редко; со сдвигом на «сегодня» отпуск с понедельника по пятницу пропадёт с экрана уже во вторник.

Рядом в том же файле лежит `listShiftsOverlapping` с готовым образцом — `coalesce(endDate, date)`.

**Files:**
- Modify: `server/src/repo/shifts.ts:33-40` (`listUpcomingForEmployee`)
- Modify: `server/src/http/app.ts:309-312` (роут `/api/my/shifts`)
- Test: `server/src/http/read.test.ts`

**Interfaces:**
- Consumes: ничего из предыдущих задач.
- Produces: `GET /api/my/shifts` отвечает `{ shifts: Shift[], today: string }`, где `today` — `YYYY-MM-DD` в `config.teamTz`. Task 3 на это опирается.

- [ ] **Step 1: Написать падающие тесты**

В `server/src/http/read.test.ts`, рядом с существующим `it("returns the caller's own upcoming shifts")`:

```ts
  it("без from отдаёт смены от сегодняшнего дня команды и называет эту дату", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(new Date());
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayIso = yesterday.toISOString().slice(0, 10);

    createShift(db, { date: today, start: "09:00", end: "18:00", employeeId: w.id });
    createShift(db, { date: yesterdayIso, start: "09:00", end: "18:00", employeeId: w.id });

    const app = createApp({ db, config });
    const res = await app.request("/api/my/shifts", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.today).toBe(today);
    expect(body.shifts.map((s: { date: string }) => s.date)).toEqual([today]);
  });

  it("не теряет многодневную запись, начавшуюся раньше окна", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    // Отпуск с 1 по 20 июля; смотрим с 7-го — он идёт прямо сейчас.
    createShift(db, { date: "2026-07-01", endDate: "2026-07-20", category: "vacation", employeeId: w.id });

    const app = createApp({ db, config });
    const res = await app.request("/api/my/shifts?from=2026-07-07", bearer(await tokenFor(app, 333)));
    const body = await res.json();
    expect(body.shifts.map((s: { date: string }) => s.date)).toEqual(["2026-07-01"]);
  });
```

- [ ] **Step 2: Прогнать — убедиться, что падают**

Run: `npx vitest run server/src/http/read.test.ts`
Expected: FAIL. Первый — `expected undefined to be "2026-…"` (поля `today` нет). Второй — `expected [] to equal [ '2026-07-01' ]`.

- [ ] **Step 3: Починить выборку**

`server/src/repo/shifts.ts`, заменить тело `listUpcomingForEmployee`:

```ts
/**
 * Записи работника, которые ещё не кончились на `fromDate`.
 *
 * Граница по концу записи, а не по началу: отпуск с 1 по 20 июля идёт прямо
 * сейчас, если смотреть седьмого, и человек должен видеть его во «Ближайших
 * сменах». Тот же `coalesce`, что и в `listShiftsOverlapping` двумя функциями выше.
 */
export function listUpcomingForEmployee(db: Db, employeeId: number, fromDate: string): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(eq(shifts.employeeId, employeeId), gte(sql`coalesce(${shifts.endDate}, ${shifts.date})`, fromDate)))
    .orderBy(shifts.date, shifts.start)
    .all();
}
```

`sql`, `and`, `gte`, `eq` уже импортированы в этом файле — трогать импорты не нужно.

- [ ] **Step 4: Вернуть `today` из роута**

`server/src/http/app.ts`, заменить роут целиком:

```ts
  app.get("/api/my/shifts", requireAuth(db, config.jwtSecret), (c) => {
    // Дата команды, а не телефона: мини-апп больше не присылает `from`, потому
    // что граница дня не должна зависеть от того, где физически человек.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(new Date());
    const from = c.req.query("from") ?? today;
    return c.json({ shifts: listUpcomingForEmployee(db, c.get("auth").employeeId, from), today });
  });
```

- [ ] **Step 5: Прогнать — убедиться, что проходят**

Run: `npx vitest run server/src/http/read.test.ts`
Expected: PASS, включая прежний тест `returns the caller's own upcoming shifts`.

- [ ] **Step 6: Коммит**

```bash
git add server/src/repo/shifts.ts server/src/http/app.ts server/src/http/read.test.ts
git commit -m "feat(api): /api/my/shifts знает сегодняшний день команды и не теряет отпуск

Граница окна — по концу записи, а не по началу: отпуск с 1 по 20 июля идёт
прямо сейчас, если смотреть седьмого, а выборка по date его выбрасывала."
```

---

### Task 2: `groupUpcomingByWeek` и `remainingThisWeek`

Чистые функции, на которых стоит вся вторая часть экрана. Ни React, ни часов внутри — `today` приходит аргументом.

**Files:**
- Create: `miniapp/src/lib/upcoming.ts`
- Test: `miniapp/src/lib/upcoming.test.ts`

**Interfaces:**
- Consumes: `Shift` из `miniapp/src/api/client`, `mondayOfIso`, `addDaysIso`, `formatWeekRangeLabelIso` из `@planer/shared` (все три уже существуют в `shared/src/week-dates.ts`).
- Produces:
  ```ts
  export interface UpcomingWeek { key: string; label: string; shifts: Shift[] }
  export function groupUpcomingByWeek(shifts: readonly Shift[], today: string): UpcomingWeek[]
  export function remainingThisWeek(shifts: readonly Shift[], today: string): { count: number; hours: number }
  ```
  Task 3 рисует ровно это.

- [ ] **Step 1: Написать падающие тесты**

Создать `miniapp/src/lib/upcoming.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupUpcomingByWeek, remainingThisWeek } from "./upcoming";
import type { Shift } from "../api/client";

/** Минимальная запись: тестам важны только дата, категория и время. */
let nextId = 1;
function entry(over: Partial<Shift> & { date: string }): Shift {
  return {
    id: nextId++, start: "09:00", end: "18:00", endDate: null, category: "shift",
    title: "День", location: null, note: null, unrecognisedCode: null, templateId: 1, employeeId: 7,
    ...over,
  } as Shift;
}

// Среда 5 августа 2026. Понедельник её недели — 3 августа, воскресенье — 9-е.
const WEDNESDAY = "2026-08-05";

describe("groupUpcomingByWeek", () => {
  it("кладёт текущую неделю первой и называет её от сегодня, а не от понедельника", () => {
    const weeks = groupUpcomingByWeek([entry({ date: "2026-08-06" })], WEDNESDAY);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.label).toBe("Эта неделя · 5–9 авг.");
  });

  it("называет вторую неделю следующей, а дальние — просто диапазоном", () => {
    const weeks = groupUpcomingByWeek(
      [entry({ date: "2026-08-06" }), entry({ date: "2026-08-11" }), entry({ date: "2026-08-25" })],
      WEDNESDAY,
    );
    expect(weeks.map((w) => w.label)).toEqual([
      "Эта неделя · 5–9 авг.",
      "Следующая неделя · 10–16 авг.",
      "17–23 авг.",
    ]);
  });

  it("не выдумывает пустых недель между занятыми", () => {
    const weeks = groupUpcomingByWeek([entry({ date: "2026-08-06" }), entry({ date: "2026-08-25" })], WEDNESDAY);
    expect(weeks).toHaveLength(2);
  });

  it("в воскресенье текущая неделя — один день", () => {
    const sunday = "2026-08-09";
    const weeks = groupUpcomingByWeek([entry({ date: sunday })], sunday);
    expect(weeks[0]!.label).toBe("Эта неделя · 9 авг.");
  });

  it("на пустом входе возвращает пусто, а не неделю без смен", () => {
    expect(groupUpcomingByWeek([], WEDNESDAY)).toEqual([]);
  });

  it("многодневную запись кладёт в неделю её начала, а не в обе", () => {
    const weeks = groupUpcomingByWeek(
      [entry({ date: "2026-08-06", endDate: "2026-08-14", category: "vacation", start: null, end: null, title: null })],
      WEDNESDAY,
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.label).toBe("Эта неделя · 5–9 авг.");
  });

  it("держит смены внутри недели в порядке дат", () => {
    const weeks = groupUpcomingByWeek(
      [entry({ date: "2026-08-08" }), entry({ date: "2026-08-06" })],
      WEDNESDAY,
    );
    expect(weeks[0]!.shifts.map((s) => s.date)).toEqual(["2026-08-06", "2026-08-08"]);
  });
});

describe("remainingThisWeek", () => {
  it("считает только остаток текущей недели", () => {
    const res = remainingThisWeek(
      [entry({ date: "2026-08-06" }), entry({ date: "2026-08-11" })],
      WEDNESDAY,
    );
    expect(res).toEqual({ count: 1, hours: 9 });
  });

  it("отпуск не добавляет ни смен, ни часов", () => {
    const res = remainingThisWeek(
      [entry({ date: "2026-08-06", category: "vacation", start: null, end: null, title: null })],
      WEDNESDAY,
    );
    expect(res).toEqual({ count: 0, hours: 0 });
  });

  it("на пустой неделе даёт нули, а не NaN", () => {
    expect(remainingThisWeek([], WEDNESDAY)).toEqual({ count: 0, hours: 0 });
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падают**

Run: `npx vitest run miniapp/src/lib/upcoming.test.ts`
Expected: FAIL — `Failed to resolve import "./upcoming"`.

- [ ] **Step 3: Написать модуль**

Создать `miniapp/src/lib/upcoming.ts`:

```ts
import { addDaysIso, formatWeekRangeLabelIso, mondayOfIso } from "@planer/shared";
import type { Shift } from "../api/client";
import { durationHours } from "./shift";

export interface UpcomingWeek {
  /** Понедельник недели, "YYYY-MM-DD" — стабильный React-ключ. */
  key: string;
  /** «Эта неделя · 5–9 авг.» / «Следующая неделя · 10–16 авг.» / «17–23 авг.» */
  label: string;
  shifts: Shift[];
}

/**
 * Режет список будущих записей на недельные секции.
 *
 * Диапазон текущей недели начинается с `today`, а не с понедельника: прошедших
 * дней в секции нет, и заголовок не должен обещать того, чего в ней не лежит.
 *
 * Многодневная запись живёт в неделе своего начала и только там — отпуск через
 * границу недели не должен появиться дважды и посчитаться дважды.
 *
 * Пустых недель между занятыми не бывает: секция существует, только если в неё
 * что-то попало.
 */
export function groupUpcomingByWeek(shifts: readonly Shift[], today: string): UpcomingWeek[] {
  const thisMonday = mondayOfIso(today);
  const nextMonday = addDaysIso(thisMonday, 7);

  const byMonday = new Map<string, Shift[]>();
  for (const shift of [...shifts].sort((a, b) => a.date.localeCompare(b.date))) {
    const monday = mondayOfIso(shift.date);
    const bucket = byMonday.get(monday);
    if (bucket) bucket.push(shift);
    else byMonday.set(monday, [shift]);
  }

  return [...byMonday.keys()]
    .sort()
    .map((monday) => {
      // У текущей недели показываем остаток, а не всю неделю целиком.
      const from = monday === thisMonday ? today : monday;
      const range = formatWeekRangeLabelIso(from, addDaysIso(monday, 6));
      const prefix = monday === thisMonday ? "Эта неделя · " : monday === nextMonday ? "Следующая неделя · " : "";
      return { key: monday, label: `${prefix}${range}`, shifts: byMonday.get(monday)! };
    });
}

/**
 * Сколько рабочих смен и часов осталось до конца текущей недели.
 *
 * Только `category === "shift"`: отпуск — это не смена и не часы, а сводка
 * отвечает на вопрос «сколько мне ещё работать».
 */
export function remainingThisWeek(shifts: readonly Shift[], today: string): { count: number; hours: number } {
  const sunday = addDaysIso(mondayOfIso(today), 6);
  const mine = shifts.filter((s) => s.category === "shift" && s.date >= today && s.date <= sunday);
  return { count: mine.length, hours: mine.reduce((sum, s) => sum + durationHours(s), 0) };
}
```

- [ ] **Step 4: Прогнать — убедиться, что проходят**

Run: `npx vitest run miniapp/src/lib/upcoming.test.ts`
Expected: PASS, 10 тестов.

Если ярлыки диапазона разошлись с ожидаемыми (`Intl.formatRange` в разных версиях ICU ставит то `авг.`, то `августа`) — исправляй **ожидание в тесте** под реальный вывод `formatWeekRangeLabelIso`, а не пиши своё форматирование: этот же форматтер рисует шапки во всех остальных экранах, и расходиться им нельзя.

- [ ] **Step 5: Коммит**

```bash
git add miniapp/src/lib/upcoming.ts miniapp/src/lib/upcoming.test.ts
git commit -m "feat(miniapp): недельные секции и остаток недели отдельной чистой функцией"
```

---

### Task 3: экран «Мои смены»

**Files:**
- Modify: `miniapp/src/api/client.ts:435` (тип), `:740-743` (реализация), `:971` (мок-ветка)
- Modify: `miniapp/src/api/mock.ts:227-230`
- Modify: `miniapp/src/App.tsx:64-93` и `:161-184`
- Modify: `miniapp/src/screens/MyShiftsScreen.tsx`
- Test: `miniapp/src/screens/my-shifts-upcoming.test.tsx` (создать)

**Interfaces:**
- Consumes: `{ shifts, today }` из Task 1; `groupUpcomingByWeek`, `remainingThisWeek`, `UpcomingWeek` из Task 2.
- Produces: `MyShiftsScreenProps` получает обязательное поле `today: string`.

- [ ] **Step 1: Написать падающий тест экрана**

Создать `miniapp/src/screens/my-shifts-upcoming.test.tsx`.

**Важно:** `@testing-library/react` в проекте нет, а `vitest.config.ts` задаёт окружение `node`. Тесты рендера здесь пишутся прагмой `// @vitest-environment jsdom` и голым `createRoot` — образец в `miniapp/src/components/shift-row-today.test.tsx`. Обёртка `AppRoot` обязательна: `Cell` и `Section` из telegram-ui читают платформу из её контекста и без неё бросают.

```tsx
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MyShiftsScreen } from "./MyShiftsScreen";
import type { Me, Shift } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

const me = {
  id: 7, displayName: "Игорь Петров", address: "Игорь", preferredName: null,
  isAdmin: false, remindersEnabled: true,
} as Me;

let nextId = 1;
function entry(date: string, title: string): Shift {
  return {
    id: nextId++, date, start: "09:00", end: "18:00", endDate: null, category: "shift",
    title, location: null, note: null, unrecognisedCode: null, templateId: 1, employeeId: 7,
  } as Shift;
}

const WEDNESDAY = "2026-08-05";

async function renderScreen(shifts: Shift[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const screen = createElement(MyShiftsScreen, {
    me, today: WEDNESDAY, shifts, templates: [],
    onProposeSwap: () => {}, onRemindersChanged: () => {}, onAddressChanged: () => {},
  });
  await act(async () => root!.render(createElement(AppRoot, null, screen)));
  return host.textContent ?? "";
}

describe("MyShiftsScreen", () => {
  it("рисует секции по неделям и не обещает диапазон, которого нет", async () => {
    const text = await renderScreen([entry("2026-08-06", "День"), entry("2026-08-11", "Утро")]);
    expect(text).toContain("Ближайшие смены");
    expect(text).toContain("Эта неделя");
    expect(text).toContain("Следующая неделя");
  });

  it("говорит, что на этой неделе больше нет смен, но следующие показывает", async () => {
    const text = await renderScreen([entry("2026-08-11", "Утро")]);
    expect(text).toContain("На этой неделе смен больше нет");
    expect(text).toContain("Следующая неделя");
  });

  it("считает сводку по остатку недели, а не по всему будущему", async () => {
    const text = await renderScreen([
      entry("2026-08-06", "День"), entry("2026-08-11", "Утро"), entry("2026-08-12", "Утро"),
    ]);
    expect(text).toContain("Осталось на этой неделе — 1 смена · 9 ч");
  });

  it("прошедших дней не рисует вовсе", async () => {
    const text = await renderScreen([entry("2026-08-06", "День")]);
    // 3 и 4 августа — понедельник и вторник той же недели, они позади.
    expect(text).not.toContain("3 авг");
    expect(text).not.toContain("4 авг");
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run miniapp/src/screens/my-shifts-upcoming.test.tsx`
Expected: FAIL — экран не знает пропа `today`, а в тексте нет ни «Ближайшие смены», ни «Эта неделя».

- [ ] **Step 3: Переписать экран**

`miniapp/src/screens/MyShiftsScreen.tsx` — заменить импорты, пропсы и тело до блока «Уведомления»:

```tsx
import { List, Placeholder, Section } from "@telegram-apps/telegram-ui";
import type { Me, Shift, Template } from "../api/client";
import { AddressField } from "../components/AddressField";
import { GreetingHero } from "../components/GreetingHero";
import { ScreenScroll } from "../components/ScreenScroll";
import { ShiftRow } from "../components/ShiftRow";
import { RemindersSwitch } from "../components/RemindersSwitch";
import { groupUpcomingByWeek, remainingThisWeek } from "../lib/upcoming";
import { pluralizeRu } from "../lib/shift";

export interface MyShiftsScreenProps {
  me: Me;
  /** Сегодняшняя дата в часовом поясе команды — приходит с сервера вместе со
   *  сменами. Не `new Date()`: граница дня не должна зависеть от того, где
   *  физически находится телефон. */
  today: string;
  /** Ближайшие записи: сегодня и дальше, без верхней границы. */
  shifts: Shift[];
  /** Presets, to colour each row by the one its entry came from. */
  templates: readonly Template[];
  /** Opens the "Предложить обмен" flow for the tapped shift. */
  onProposeSwap: (shift: Shift) => void;
  /** Keeps `me` in step when the reminders switch is flipped. */
  onRemindersChanged: (enabled: boolean) => void;
  /** Keeps `me` in step when the greeting name is saved. */
  onAddressChanged: (next: { preferredName: string | null; address: string }) => void;
}

/** «Мои смены»: приветствие с остатком недели, ближайшие записи секциями по
 *  неделям, и переключатель напоминаний. Прошедших дней здесь нет. */
export function MyShiftsScreen({ me, today, shifts, templates, onProposeSwap, onRemindersChanged, onAddressChanged }: MyShiftsScreenProps) {
  const weeks = groupUpcomingByWeek(shifts, today);
  const rest = remainingThisWeek(shifts, today);
  const summary =
    rest.count > 0
      ? `Осталось на этой неделе — ${rest.count} ${pluralizeRu(rest.count, "смена", "смены", "смен")} · ${Math.round(rest.hours)} ч`
      : "На этой неделе смен больше нет";

  return (
    <ScreenScroll>
      <div style={{ margin: "4px 4px 20px" }}>
        {/* `me.address` comes from the server, which knows the person's Telegram
            first name. Splitting `displayName` here gave «Привет, Петров» — the
            roster is written «Фамилия Имя». See `addressOf` in @planer/shared. */}
        <GreetingHero name={me.address} summary={summary} />
      </div>

      {weeks.length === 0 ? (
        <Placeholder header="Пока нет смен" description="Здесь появятся ваши ближайшие смены и отпуска." />
      ) : (
        <List>
          <Section header="Ближайшие смены">
            {weeks.map((week) => (
              <Section key={week.key} header={week.label}>
                {week.shifts.map((shift) => (
                  <ShiftRow key={shift.id} shift={shift} templates={templates} onSwap={onProposeSwap} isToday={shift.date === today} />
                ))}
              </Section>
            ))}
          </Section>
        </List>
      )}
```

Остальная часть файла (блоки «Уведомления» и «Обращение», закрывающий `ScreenScroll`) — без изменений.

- [ ] **Step 4: Прогнать тест экрана**

Run: `npx vitest run miniapp/src/screens/my-shifts-upcoming.test.tsx`
Expected: PASS, 3 теста.

Если `telegram-ui` не даёт вложить `Section` в `Section` без визуального мусора — замени внешний `Section` на обычный заголовок `<div>` со стилем `Section`-хедера, а недельные `Section` оставь как есть. Тест на `getByText("Ближайшие смены")` при этом продолжает работать.

- [ ] **Step 5: Провести `today` через клиент и мок**

`miniapp/src/api/client.ts` — тип на строке 435:

```ts
  getMyShifts(): Promise<{ shifts: Shift[]; today: string }>;
```

Интерфейс ответа на строке 545:

```ts
interface ShiftsResponse {
  shifts: Shift[];
  /** Сегодняшняя дата в часовом поясе команды — её считает сервер. */
  today: string;
}
```

Реализация на строке 740:

```ts
  // `from` не передаётся намеренно: сервер сам возьмёт сегодняшний день команды.
  getMyShifts: () => authorizedGet<ShiftsResponse>("/api/my/shifts"),
```

Мок-ветка на строке 971:

```ts
  getMyShifts: () => mockGetMyShifts(),
```

`miniapp/src/api/mock.ts`, строка 227:

```ts
export async function mockGetMyShifts(): Promise<{ shifts: Shift[]; today: string }> {
  await delay(300);
  const today = new Date().toISOString().slice(0, 10);
  return {
    shifts: ALL_ENTRIES.filter((s) => s.employeeId === MOCK_ME.id && endOf(s) >= today).sort(byDateThenStart),
    today,
  };
}
```

- [ ] **Step 6: Убрать понедельник из App.tsx**

`miniapp/src/App.tsx` — в `AppData` добавить поле:

```ts
interface AppData {
  me: Me;
  myShifts: Shift[];
  /** Сегодня в часовом поясе команды — пришло вместе с «моими сменами». */
  today: string;
  teamShifts: Shift[];
  templates: Template[];
  swaps: SwapRequest[];
  weekendSlots: WeekendSlotView[];
  weekendOffers: WeekendOffer[];
}
```

В первом `useEffect` (строки 64–93) `from`/`to` остаются — их всё ещё требует `getTeamSchedule`. Меняется только вызов и разбор:

```ts
          apiClient.getMyShifts(),
```

```ts
      .then(([me, myShifts, teamShifts, templates, swaps, weekendSlots, weekendOffers]) => {
        if (!cancelled) {
          setData({ me, myShifts: myShifts.shifts, today: myShifts.today, teamShifts, templates, swaps, weekendSlots, weekendOffers });
        }
      })
```

В `reloadData` (строки 161–184) — то же самое:

```ts
        apiClient.getMyShifts(),
```

```ts
      setData((prev) =>
        prev
          ? { ...prev, myShifts: myShifts.shifts, today: myShifts.today, teamShifts, templates, swaps, weekendSlots, weekendOffers }
          : prev,
      );
```

И прокинуть в экран (строка 264):

```tsx
        <MyShiftsScreen
          me={data.me}
          today={data.today}
          shifts={data.myShifts}
```

- [ ] **Step 7: Прогнать всё и проверить типы**

Run: `npx vitest run && npm run typecheck`
Expected: PASS. Если какой-то другой тест звал `getMyShifts("2026-…")` — поправь вызов, аргумента больше нет.

- [ ] **Step 8: Коммит**

```bash
git add miniapp/src
git commit -m "feat(miniapp): «Мои смены» — только сегодня и дальше, секциями по неделям

Заголовок и сводка перестали врать: раньше «Эта неделя — 12 смен · 96 ч»
считалось по всему будущему на месяц вперёд."
```

---

## Часть 2. Журнал

### Task 4: `shared/src/audit.ts` — каркас, запасной вариант, записи и обмены

Модуль заводится сразу с полным списком `AuditType` (33 значения), но описатели пишутся в две задачи: сначала самые частые и самые нечитаемые сегодня — `entry_*` и `swap_*`.

Чтобы неописанные типы не ломали сборку на полпути, таблица объявляется как `Partial<Record<AuditType, Describer>>`, а в Task 5 у неё снимается `Partial`. Это единственный момент, когда полнота не под охраной компилятора, и он длится ровно одну задачу.

**Files:**
- Create: `shared/src/audit.ts`
- Create: `shared/src/audit.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `categoryLabel` из `./category`, `weekdayShort`, `parseISODate` из `./week-dates`.
- Produces:
  ```ts
  export type AuditType = /* 33 строковых литерала */;
  export interface AuditView { icon: string; title: string; lines: string[] }
  export function describeAuditEvent(event: { type: string; payload: unknown }): AuditView
  export function formatAuditMoment(iso: string): string
  export function auditMonthRange(today: string): { from: string; to: string }
  ```
  На это опираются Tasks 5–12.

- [ ] **Step 1: Написать падающие тесты**

Создать `shared/src/audit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeAuditEvent, formatAuditMoment } from "./audit";

describe("describeAuditEvent — записи", () => {
  it("рассказывает, кому и на какой день поставили смену", () => {
    const view = describeAuditEvent({
      type: "entry_created",
      payload: {
        entryId: 979, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
        endDate: null, category: "shift", title: "День", start: "09:00", end: "18:00",
      },
    });
    expect(view.title).toBe("Добавлена смена");
    expect(view.lines).toEqual(["Марк Волков · ср 12 августа", "День 09:00–18:00"]);
  });

  it("называет отпуск отпуском и показывает его размах", () => {
    const view = describeAuditEvent({
      type: "entry_created",
      payload: {
        entryId: 980, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
        endDate: "2026-08-20", category: "vacation", title: null, start: null, end: null,
      },
    });
    expect(view.title).toBe("Добавлен отпуск");
    expect(view.lines).toEqual(["Марк Волков · ср 12 августа — чт 20 августа", "Весь день"]);
  });

  it("согласует род с категорией, а не с последней буквой", () => {
    const base = {
      entryId: 981, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
      endDate: null, title: null, start: null, end: null,
    };
    const titleFor = (category: string) =>
      describeAuditEvent({ type: "entry_created", payload: { ...base, category } }).title;
    expect(titleFor("shift")).toBe("Добавлена смена");
    expect(titleFor("vacation")).toBe("Добавлен отпуск");
    expect(titleFor("duty")).toBe("Добавлено дежурство");
    expect(titleFor("weekend_work")).toBe("Добавлена работа в выходной");
    expect(titleFor("offsite")).toBe("Добавлено выездное мероприятие");
  });

  it("на правке показывает только то, что действительно изменилось", () => {
    const before = {
      entryId: 979, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
      endDate: null, category: "shift", title: null, start: null, end: null,
    };
    const view = describeAuditEvent({
      type: "entry_updated",
      payload: { before, after: { ...before, title: "День", start: "09:00", end: "18:00" } },
    });
    expect(view.title).toBe("Изменена смена");
    expect(view.lines).toEqual([
      "Марк Волков · ср 12 августа",
      "было: Весь день",
      "стало: День 09:00–18:00",
    ]);
  });

  it("на смене работника называет обоих", () => {
    const before = {
      entryId: 979, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
      endDate: null, category: "shift", title: "День", start: "09:00", end: "18:00",
    };
    const view = describeAuditEvent({
      type: "entry_updated",
      payload: { before, after: { ...before, employeeId: 25, employeeName: "Олег Соколов" } },
    });
    expect(view.lines).toContain("работник: Марк Волков → Олег Соколов");
  });

  it("удаление показывает, что именно исчезло", () => {
    const view = describeAuditEvent({
      type: "entry_deleted",
      payload: {
        entryId: 979, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
        endDate: null, category: "shift", title: "День", start: "09:00", end: "18:00",
      },
    });
    expect(view.title).toBe("Удалена смена");
    expect(view.lines).toEqual(["Марк Волков · ср 12 августа", "День 09:00–18:00"]);
  });
});

describe("describeAuditEvent — обмены", () => {
  const swap = {
    requestId: 12,
    fromEmployeeId: 2, fromName: "Аня Смирнова", fromShift: "пн 10 авг · Утро 09:00–18:00",
    toEmployeeId: 3, toName: "Марк Волков", toShift: "ср 12 авг · День 09:00–18:00",
  };

  it("показывает обе стороны обмена", () => {
    const view = describeAuditEvent({ type: "swap_accepted", payload: swap });
    expect(view.title).toBe("Обмен состоялся");
    expect(view.lines).toEqual([
      "Аня Смирнова отдаёт: пн 10 авг · Утро 09:00–18:00",
      "Марк Волков отдаёт: ср 12 авг · День 09:00–18:00",
    ]);
  });

  it("у каждого исхода обмена своя формулировка", () => {
    const titles = (["swap_proposed", "swap_declined", "swap_cancelled", "swap_expired", "swap_auto_cancelled"] as const)
      .map((type) => describeAuditEvent({ type, payload: swap }).title);
    expect(new Set(titles).size).toBe(5);
  });
});

describe("describeAuditEvent — незнакомое и битое", () => {
  it("не прячет событие, которого не знает", () => {
    const view = describeAuditEvent({ type: "something_added_later", payload: { a: 1 } });
    expect(view.title).toBe("something_added_later");
    expect(view.lines.join("")).toContain("\"a\": 1");
  });

  it("переживает payload не той формы, без undefined в тексте", () => {
    const view = describeAuditEvent({ type: "entry_created", payload: null });
    expect(view.lines.join(" ")).not.toContain("undefined");
  });

  it("на старой записи без имени называет работника номером", () => {
    const view = describeAuditEvent({
      type: "entry_created",
      payload: { entryId: 1, employeeId: 24, date: "2026-08-12", endDate: null, category: "shift", title: "День", start: "09:00", end: "18:00" },
    });
    expect(view.lines[0]).toBe("работник #24 · ср 12 августа");
  });
});

describe("formatAuditMoment", () => {
  it("ставит дату вперёд времени — журнал читают по «когда»", () => {
    expect(formatAuditMoment("2026-08-05T14:32:00.000Z")).toMatch(/5 августа/);
  });

  it("возвращает вход как есть, если это не дата", () => {
    expect(formatAuditMoment("не дата")).toBe("не дата");
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падают**

Run: `npx vitest run shared/src/audit.test.ts`
Expected: FAIL — `Failed to resolve import "./audit"`.

- [ ] **Step 3: Написать модуль**

Создать `shared/src/audit.ts`:

```ts
import { categoryLabel, type EntryCategory } from "./category";
import { parseISODate, weekdayShort } from "./week-dates";

/**
 * Каждый тип события, который сервер умеет записывать в `audit_log`.
 *
 * Единственный список на весь проект: сервер типизирует им `recordAudit`, оба
 * консоля — таблицу описателей. Добавил тип сюда, но не добавил описание — `tsc`
 * красный. Раньше эту роль исполняли два зеркальных теста и два дубля
 * `TYPE_LABELS`, и консоли всё равно разъезжались.
 */
export type AuditType =
  | "entry_created" | "entry_updated" | "entry_deleted"
  | "swap_proposed" | "swap_accepted" | "swap_declined"
  | "swap_cancelled" | "swap_expired" | "swap_auto_cancelled"
  | "distribution_applied" | "roster_import"
  | "employee_created" | "employee_updated" | "employee_reordered"
  | "employee_archived" | "employee_restored" | "employee_admin_changed"
  | "employee_invite_issued" | "settings_changed"
  | "template_roles_changed" | "template_rotation_changed"
  | "weekend_slot_created" | "weekend_assigned" | "weekend_unassigned"
  | "weekend_interest" | "weekend_offer_confirmed" | "weekend_offer_declined"
  | "birthday_sent" | "birthday_admin_notice" | "birthday_schedule_notice"
  | "birthday_campaign_updated"
  | "reminder_undeliverable" | "reminders_dispatched";

export interface AuditView {
  /** Одиночный символ — опознавательный знак строки в ленте. */
  icon: string;
  /** «Изменена смена» — что произошло, одной фразой. */
  title: string;
  /** Подробности, по строке на факт. Может быть пустым. */
  lines: string[];
}

type Describer = (payload: Record<string, unknown>) => Omit<AuditView, "icon"> & { icon?: string };

const monthDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const moment = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** «5 августа, 14:32» — журнал читают по «когда», поэтому дата ведёт. */
export function formatAuditMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return moment.format(date);
}

/** Месяц вокруг `today` — период, на котором открывается отчёт «кто сколько». */
export function auditMonthRange(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

// ——— мелкие форматтеры, общие для описателей ———

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** «ср 12 августа». Некорректную дату отдаёт как есть — врать не о чем. */
function dayLabel(iso: unknown): string {
  const s = str(iso);
  if (!s) return "без даты";
  const date = parseISODate(s);
  if (Number.isNaN(date.getTime())) return s;
  return `${weekdayShort(s).toLowerCase()} ${monthDay.format(date)}`;
}

/**
 * Имя работника из payload'а, а если его там нет — номер.
 *
 * Старые записи имени не несут (его начали писать позже), и достраивать его
 * текущим состоянием базы нельзя: человека могли переименовать, и журнал начал
 * бы рассказывать про прошлое сегодняшними словами.
 */
function personLabel(payload: Record<string, unknown>, nameKey = "employeeName", idKey = "employeeId"): string {
  return str(payload[nameKey]) ?? (num(payload[idKey]) != null ? `работник #${num(payload[idKey])}` : "неизвестно кто");
}

/** «День 09:00–18:00» или «Весь день» — как запись выглядит человеку. */
function entryLabel(entry: Record<string, unknown>): string {
  const title = str(entry.title);
  const start = str(entry.start);
  const end = str(entry.end);
  const time = start && end ? `${start}–${end}` : "Весь день";
  return title ? `${title} ${time}` : time;
}

/** «ср 12 августа» или «ср 12 августа — чт 20 августа» для многодневной записи. */
function spanLabel(entry: Record<string, unknown>): string {
  const end = str(entry.endDate);
  return end ? `${dayLabel(entry.date)} — ${dayLabel(end)}` : dayLabel(entry.date);
}

/** «смена» / «отпуск» / … — чтобы заголовок назывался тем, что произошло. */
function categoryWord(entry: Record<string, unknown>): string {
  const category = str(entry.category);
  if (!category || !(category in CATEGORY_GENDER)) return "запись";
  return categoryLabel(category as EntryCategory).toLowerCase();
}

/**
 * Род главного слова каждой категории — для согласования «Добавлена смена», но
 * «Добавлено дежурство».
 *
 * Таблицей, а не по последней букве: «Дежурство» и «Выездное мероприятие»
 * средние, а «Работа в выходной» женского рода при мужском окончании — любая
 * эвристика по хвосту строки ошибается как минимум трижды из семи.
 */
const CATEGORY_GENDER: Record<EntryCategory, "m" | "f" | "n"> = {
  shift: "f", vacation: "m", sick_leave: "m", duty: "n",
  offsite: "n", business_trip: "f", weekend_work: "f",
};

const VERB = {
  created: { m: "Добавлен", f: "Добавлена", n: "Добавлено" },
  updated: { m: "Изменён", f: "Изменена", n: "Изменено" },
  deleted: { m: "Удалён", f: "Удалена", n: "Удалено" },
} as const;

/** «Изменена смена» / «Изменено дежурство» / «Изменён отпуск». */
function entryTitle(verb: keyof typeof VERB, entry: Record<string, unknown>): string {
  const category = str(entry.category);
  const gender = category && category in CATEGORY_GENDER ? CATEGORY_GENDER[category as EntryCategory] : "f";
  return `${VERB[verb][gender]} ${categoryWord(entry)}`;
}

function entryView(entry: Record<string, unknown>): string[] {
  return [`${personLabel(entry)} · ${spanLabel(entry)}`, entryLabel(entry)];
}

function swapLines(p: Record<string, unknown>): string[] {
  return [
    `${str(p.fromName) ?? personLabel(p, "fromName", "fromEmployeeId")} отдаёт: ${str(p.fromShift) ?? "—"}`,
    `${str(p.toName) ?? personLabel(p, "toName", "toEmployeeId")} отдаёт: ${str(p.toShift) ?? "—"}`,
  ];
}

// ——— таблица описателей ———
// В Task 5 `Partial` снимается: с этого момента полноту стережёт компилятор.
const DESCRIBERS: Partial<Record<AuditType, Describer>> = {
  entry_created: (p) => ({ icon: "＋", title: entryTitle("created", p), lines: entryView(p) }),
  entry_deleted: (p) => ({ icon: "🗑", title: entryTitle("deleted", p), lines: entryView(p) }),
  entry_updated: (p) => {
    const before = obj(p.before);
    const after = obj(p.after);
    const lines = [`${personLabel(after)} · ${spanLabel(after)}`];
    if (num(before.employeeId) !== num(after.employeeId)) {
      lines.push(`работник: ${personLabel(before)} → ${personLabel(after)}`);
    }
    if (spanLabel(before) !== spanLabel(after)) {
      lines.push(`день: ${spanLabel(before)} → ${spanLabel(after)}`);
    }
    if (entryLabel(before) !== entryLabel(after)) {
      lines.push(`было: ${entryLabel(before)}`, `стало: ${entryLabel(after)}`);
    }
    return { icon: "✎", title: entryTitle("updated", after), lines };
  },

  swap_proposed: (p) => ({ icon: "🔁", title: "Предложен обмен", lines: swapLines(p) }),
  swap_accepted: (p) => ({ icon: "🔁", title: "Обмен состоялся", lines: swapLines(p) }),
  swap_declined: (p) => ({ icon: "🔁", title: "Обмен отклонён", lines: swapLines(p) }),
  swap_cancelled: (p) => ({ icon: "🔁", title: "Обмен отменён", lines: swapLines(p) }),
  swap_expired: (p) => ({ icon: "🔁", title: "Обмен стал неактуален", lines: swapLines(p) }),
  swap_auto_cancelled: (p) => ({ icon: "🔁", title: "Обмен отменён автоматически", lines: swapLines(p) }),
};

/**
 * Событие журнала словами.
 *
 * Тип, которого нет в таблице (строка из старой базы, событие из будущей
 * версии), не прячется: заголовком становится сырой тип, а телом —
 * форматированный payload. Потерять запись хуже, чем показать её некрасиво.
 */
export function describeAuditEvent(event: { type: string; payload: unknown }): AuditView {
  const describe = DESCRIBERS[event.type as AuditType];
  if (!describe) {
    return { icon: "•", title: event.type, lines: [JSON.stringify(event.payload, null, 2)] };
  }
  const view = describe(obj(event.payload));
  return { icon: view.icon ?? "•", title: view.title, lines: view.lines };
}
```

Добавить в `shared/src/index.ts` строкой после `export * from "./category";`:

```ts
export * from "./audit";
```

- [ ] **Step 4: Прогнать — убедиться, что проходят**

Run: `npx vitest run shared/src/audit.test.ts`
Expected: PASS.

Род в заголовке берётся из `CATEGORY_GENDER` — явной таблицы на семь категорий, а не из хвоста строки. Эвристика по последней букве здесь ошибается трижды: «Дежурство» и «Выездное мероприятие» среднего рода, а «Работа в выходной» женского при мужском окончании. Если `EntryCategory` когда-нибудь пополнится, `Record<EntryCategory, …>` не даст забыть новую категорию.

- [ ] **Step 5: Коммит**

```bash
git add shared/src/audit.ts shared/src/audit.test.ts shared/src/index.ts
git commit -m "feat(shared): журнал говорит словами — записи и обмены

Первая половина описателей. Логика payload → фраза живёт в одном месте на
оба консоля, а не дублируется в каждом."
```

---

### Task 5: остальные описатели и снятие `Partial`

**Files:**
- Modify: `shared/src/audit.ts`
- Modify: `shared/src/audit.test.ts`

**Interfaces:**
- Consumes: всё из Task 4.
- Produces: `DESCRIBERS` становится полным `Record<AuditType, Describer>` — с этого момента новый `AuditType` без описателя ломает `tsc`. На это опирается Task 6.

- [ ] **Step 1: Дописать падающие тесты**

Добавить в `shared/src/audit.test.ts`:

```ts
describe("describeAuditEvent — остальные события", () => {
  const cases: { type: string; payload: unknown; title: string; contains: string }[] = [
    {
      type: "distribution_applied",
      payload: { from: "2026-08-03", to: "2026-08-09", count: 37 },
      title: "Смены распределены честно",
      contains: "37",
    },
    {
      type: "roster_import",
      payload: { employeesRenamed: 5, employeesCreated: 21, entriesInserted: 482, unknowns: 1 },
      title: "Загружен график из CSV",
      contains: "482",
    },
    {
      type: "employee_created",
      payload: { employeeId: 9, displayName: "Света Орлова" },
      title: "Добавлен работник",
      contains: "Света Орлова",
    },
    {
      type: "employee_updated",
      payload: {
        employeeId: 9,
        before: { displayName: "Света Орлов", birthDate: null },
        after: { displayName: "Света Орлова", birthDate: "05-08" },
      },
      title: "Изменены данные работника",
      contains: "Света Орлов → Света Орлова",
    },
    {
      type: "employee_reordered",
      payload: { employeeId: 9, displayName: "Света Орлова", from: 3, to: 1 },
      title: "Изменён порядок людей",
      contains: "3 → 1",
    },
    {
      type: "employee_archived",
      payload: { employeeId: 9, displayName: "Света Орлова" },
      title: "Работник архивирован",
      contains: "Света Орлова",
    },
    {
      type: "employee_restored",
      payload: { employeeId: 9, displayName: "Света Орлова" },
      title: "Работник восстановлен",
      contains: "Света Орлова",
    },
    {
      type: "employee_admin_changed",
      payload: { employeeId: 9, displayName: "Света Орлова", isAdmin: true },
      title: "Изменены права админа",
      contains: "теперь админ",
    },
    {
      type: "employee_invite_issued",
      payload: { employeeId: 9, displayName: "Света Орлова", regenerated: true },
      title: "Перевыпущена ссылка-приглашение",
      contains: "Света Орлова",
    },
    {
      type: "settings_changed",
      payload: { employeeId: 9, displayName: "Света Орлова", remindersEnabled: false },
      title: "Работник изменил настройки",
      contains: "напоминания выключены",
    },
    {
      type: "template_roles_changed",
      payload: { templateId: 3, templateName: "Ночь", poolSize: 7, preferred: 2 },
      title: "Изменено «кто что может»",
      contains: "Ночь",
    },
    {
      type: "template_rotation_changed",
      payload: { templateId: 3, templateName: "Ночь", rotationUnit: "week" },
      title: "Изменена очередь",
      contains: "Ночь",
    },
    {
      type: "weekend_slot_created",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", delivered: 12, intended: 14 },
      title: "Открыта смена на выходной",
      contains: "12 из 14",
    },
    {
      type: "weekend_assigned",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
      title: "Выходная смена назначена",
      contains: "Марк Волков",
    },
    {
      type: "weekend_unassigned",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
      title: "Назначение на выходной снято",
      contains: "Марк Волков",
    },
    {
      type: "weekend_interest",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
      title: "Отклик на выходную смену",
      contains: "Марк Волков",
    },
    {
      type: "weekend_offer_confirmed",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
      title: "Выходная смена подтверждена",
      contains: "Марк Волков",
    },
    {
      type: "weekend_offer_declined",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
      title: "От выходной смены отказались",
      contains: "Марк Волков",
    },
    {
      type: "birthday_sent",
      payload: { employeeId: 2, displayName: "Игорь Петров", delivered: 5, intended: 5 },
      title: "Разослан сбор на день рождения",
      contains: "5 из 5",
    },
    {
      type: "birthday_admin_notice",
      payload: { employeeId: 2, displayName: "Игорь Петров", daysUntil: 7, delivered: 2 },
      title: "Напоминание админам о дне рождения",
      contains: "Игорь Петров",
    },
    {
      type: "birthday_schedule_notice",
      payload: { employeeId: 2, displayName: "Игорь Петров", scheduledSendOn: "2026-08-04", delivered: 2 },
      title: "Напоминание админам о сборе",
      contains: "Игорь Петров",
    },
    {
      type: "birthday_campaign_updated",
      payload: { employeeId: 2, displayName: "Игорь Петров", scheduledSendOn: "2026-08-04" },
      title: "Изменён сбор на день рождения",
      contains: "Игорь Петров",
    },
    {
      type: "reminder_undeliverable",
      payload: { employeeId: 3, displayName: "Марк Волков", shiftId: 88, errorCode: 403 },
      title: "Напоминание не дошло — бот заблокирован",
      contains: "Марк Волков",
    },
    {
      type: "reminders_dispatched",
      payload: { forDate: "2026-08-07", sent: 12, considered: 13 },
      title: "Разосланы напоминания на завтра",
      contains: "12",
    },
  ];

  it.each(cases)("$type говорит «$title»", ({ type, payload, title, contains }) => {
    const view = describeAuditEvent({ type, payload });
    expect(view.title).toBe(title);
    expect(view.lines.join(" · ")).toContain(contains);
    expect(view.lines.join(" ")).not.toContain("undefined");
  });

  it("описан каждый тип, который сервер умеет писать", () => {
    const described = new Set(cases.map((c) => c.type));
    // Типы из Task 4 проверены выше своими тестами.
    for (const type of ["entry_created", "entry_updated", "entry_deleted", "swap_proposed", "swap_accepted",
      "swap_declined", "swap_cancelled", "swap_expired", "swap_auto_cancelled"]) described.add(type);
    expect(described.size).toBe(33);
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падают**

Run: `npx vitest run shared/src/audit.test.ts`
Expected: FAIL — у неописанных типов `view.title` равен сырому типу, а не ожидаемой фразе.

- [ ] **Step 3: Дописать описатели и снять `Partial`**

В `shared/src/audit.ts` заменить объявление таблицы на `const DESCRIBERS: Record<AuditType, Describer> = {` и дописать в неё, после блока обменов:

```ts
  distribution_applied: (p) => ({
    icon: "⚖",
    title: "Смены распределены честно",
    lines: [`${dayLabel(p.from)} — ${dayLabel(p.to)}`, `${num(p.count) ?? 0} смен расставлено`],
  }),
  roster_import: (p) => ({
    icon: "📥",
    title: "Загружен график из CSV",
    lines: [
      [
        `${num(p.entriesInserted) ?? 0} записей`,
        num(p.employeesCreated) ? `${num(p.employeesCreated)} человек добавлено` : null,
        num(p.employeesRenamed) ? `${num(p.employeesRenamed)} переименовано` : null,
      ].filter(Boolean).join(" · "),
      ...(num(p.unknowns) ? [`${num(p.unknowns)} имён не опознано`] : []),
    ],
  }),

  employee_created: (p) => ({ icon: "👤", title: "Добавлен работник", lines: [personLabel(p, "displayName")] }),
  employee_archived: (p) => ({ icon: "📦", title: "Работник архивирован", lines: [personLabel(p, "displayName")] }),
  employee_restored: (p) => ({
    icon: "📦",
    title: "Работник восстановлен",
    lines: [personLabel(p, "displayName"), ...(str(p.via) ? ["через список админов"] : [])],
  }),
  employee_admin_changed: (p) => ({
    icon: "🔑",
    title: "Изменены права админа",
    lines: [`${personLabel(p, "displayName")} — ${p.isAdmin === true ? "теперь админ" : "больше не админ"}`],
  }),
  employee_reordered: (p) => ({
    icon: "↕",
    title: "Изменён порядок людей",
    lines: [personLabel(p, "displayName"), `${num(p.from) ?? "—"} → ${num(p.to) ?? "—"}`],
  }),
  employee_invite_issued: (p) => ({
    icon: "🔗",
    title: p.regenerated === true ? "Перевыпущена ссылка-приглашение" : "Выдана ссылка-приглашение",
    // Самой ссылки здесь нет и быть не должно: это действующий ключ к учётной записи.
    lines: [personLabel(p, "displayName"), ...(p.regenerated === true ? ["прежняя ссылка больше не работает"] : [])],
  }),
  employee_updated: (p) => {
    const before = obj(p.before);
    const after = obj(p.after);
    const lines: string[] = [];
    if (str(before.displayName) !== str(after.displayName)) {
      lines.push(`имя: ${str(before.displayName) ?? "—"} → ${str(after.displayName) ?? "—"}`);
    }
    if (str(before.birthDate) !== str(after.birthDate)) {
      lines.push(`день рождения: ${str(before.birthDate) ?? "не указан"} → ${str(after.birthDate) ?? "не указан"}`);
    }
    if (str(before.preferredName) !== str(after.preferredName)) {
      lines.push(`обращение: ${str(before.preferredName) ?? "по умолчанию"} → ${str(after.preferredName) ?? "по умолчанию"}`);
    }
    // Старые записи несут только состояние «после» — их и показываем.
    if (lines.length === 0) lines.push(personLabel(p, "displayName"));
    else lines.unshift(str(after.displayName) ?? personLabel(p, "displayName"));
    return { icon: "👤", title: "Изменены данные работника", lines };
  },
  settings_changed: (p) => {
    const lines = [personLabel(p, "displayName")];
    if (typeof p.remindersEnabled === "boolean") {
      lines.push(p.remindersEnabled ? "напоминания включены" : "напоминания выключены");
    }
    if (p.preferredName !== undefined) {
      lines.push(`обращение: ${str(p.preferredName) ?? "по умолчанию"}`);
    }
    return { icon: "⚙", title: "Работник изменил настройки", lines };
  },

  template_roles_changed: (p) => ({
    icon: "🎚",
    title: "Изменено «кто что может»",
    lines: [
      str(p.templateName) ?? `пресет #${num(p.templateId) ?? "?"}`,
      `${num(p.poolSize) ?? 0} допущено · ${num(p.preferred) ?? 0} с приоритетом`,
    ],
  }),
  template_rotation_changed: (p) => ({
    icon: "🎚",
    title: "Изменена очередь",
    lines: [str(p.templateName) ?? `пресет #${num(p.templateId) ?? "?"}`, `шаг: ${str(p.rotationUnit) ?? "—"}`],
  }),

  weekend_slot_created: (p) => ({
    icon: "📣",
    title: "Открыта смена на выходной",
    lines: [str(p.slot) ?? `слот #${num(p.slotId) ?? "?"}`, `предложено ${num(p.delivered) ?? 0} из ${num(p.intended) ?? 0}`],
  }),
  weekend_assigned: (p) => weekendView(p, "🎯", "Выходная смена назначена"),
  weekend_unassigned: (p) => weekendView(p, "↩", "Назначение на выходной снято"),
  weekend_interest: (p) => weekendView(p, "🙋", "Отклик на выходную смену"),
  weekend_offer_confirmed: (p) => weekendView(p, "✅", "Выходная смена подтверждена"),
  weekend_offer_declined: (p) => weekendView(p, "🚫", "От выходной смены отказались"),

  birthday_sent: (p) => ({
    icon: "🎂",
    title: "Разослан сбор на день рождения",
    lines: [personLabel(p, "displayName"), `доставлено ${num(p.delivered) ?? 0} из ${num(p.intended) ?? 0}`],
  }),
  birthday_admin_notice: (p) => ({
    icon: "🎂",
    title: "Напоминание админам о дне рождения",
    lines: [personLabel(p, "displayName"), `через ${num(p.daysUntil) ?? 0} дн. · дошло до ${num(p.delivered) ?? 0}`],
  }),
  birthday_schedule_notice: (p) => ({
    icon: "🎂",
    title: "Напоминание админам о сборе",
    lines: [personLabel(p, "displayName"), `сбор на ${dayLabel(p.scheduledSendOn)} · дошло до ${num(p.delivered) ?? 0}`],
  }),
  birthday_campaign_updated: (p) => {
    const lines = [personLabel(p, "displayName")];
    if (p.scheduledSendOn !== undefined) lines.push(`напомнить: ${str(p.scheduledSendOn) ? dayLabel(p.scheduledSendOn) : "не напоминать"}`);
    if (p.collectUrl !== undefined) lines.push(str(p.collectUrl) ? "ссылка на сбор изменена" : "ссылка на сбор убрана");
    // Сам текст поздравления в журнал не копируется — здесь только факт правки.
    if (p.messageText !== undefined) lines.push(str(p.messageText) ? "текст изменён" : "текст сброшен на стандартный");
    return { icon: "🎂", title: "Изменён сбор на день рождения", lines };
  },

  reminder_undeliverable: (p) => ({
    icon: "🚫",
    title: "Напоминание не дошло — бот заблокирован",
    lines: [personLabel(p, "displayName"), `код ответа ${num(p.errorCode) ?? "—"}`],
  }),
  reminders_dispatched: (p) => ({
    icon: "🔔",
    title: "Разосланы напоминания на завтра",
    lines: [`на ${dayLabel(p.forDate)}`, `${num(p.sent) ?? 0} из ${num(p.considered) ?? 0} человек`],
  }),
```

И рядом с остальными форматтерами:

```ts
/** Пять выходных событий отличаются только заголовком и значком. */
function weekendView(p: Record<string, unknown>, icon: string, title: string) {
  return { icon, title, lines: [personLabel(p), str(p.slot) ?? `слот #${num(p.slotId) ?? "?"}`] };
}
```

- [ ] **Step 4: Прогнать — убедиться, что проходят**

Run: `npx vitest run shared/src/audit.test.ts && npm run typecheck`
Expected: PASS. `tsc` подтверждает, что `Record<AuditType, Describer>` заполнен целиком.

- [ ] **Step 5: Коммит**

```bash
git add shared/src/audit.ts shared/src/audit.test.ts
git commit -m "feat(shared): описан каждый тип события журнала

Таблица больше не Partial — пропущенный описатель теперь ловит компилятор,
а не зеркальный тест в каждом консоле."
```

---

### Task 6: `recordAudit` принимает только известный тип

**Files:**
- Modify: `server/src/repo/audit.ts:8`
- Test: существующие тесты сервера — они и есть проверка (компиляция + поведение не изменилось)

**Interfaces:**
- Consumes: `AuditType` из Task 5.
- Produces: `recordAudit(db: Db, type: AuditType, actorEmployeeId: number | null, payload: unknown): void`. Tasks 9–12 пишут события только через него.

- [ ] **Step 1: Сузить тип**

`server/src/repo/audit.ts`:

```ts
import { and, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { AuditType } from "@planer/shared";
import type { Db } from "../db/client";
import { auditLog, employees, type AuditLog } from "../db/schema";

/** Records one thing that happened, for the «кто когда что менял» feed. Never let a
 *  bookkeeping failure take down the action it describes — the write already
 *  succeeded by the time we get here.
 *
 *  `type` — не `string`: каждое событие обязано иметь человеческое описание в
 *  `@planer/shared/audit`, и это единственное место, где такое требование можно
 *  предъявить один раз на весь сервер. */
export function recordAudit(db: Db, type: AuditType, actorEmployeeId: number | null, payload: unknown): void {
```

Остальное тело — без изменений.

- [ ] **Step 2: Прогнать типы — убедиться, что сервер уже согласован**

Run: `npm run typecheck`
Expected: PASS. Все 24 существующих `recordAudit` пишут типы, которые есть в `AuditType`. Если `tsc` ругается на какой-то литерал — значит, при составлении списка тип пропустили: добавь его в `AuditType` **и** описатель к нему в `DESCRIBERS` (иначе таблица перестанет быть полной), с тестом по образцу Task 5.

- [ ] **Step 3: Прогнать все тесты**

Run: `npx vitest run`
Expected: PASS — поведение не менялось, менялся только тип.

- [ ] **Step 4: Коммит**

```bash
git add server/src/repo/audit.ts
git commit -m "refactor(server): recordAudit принимает только описанный тип события"
```

---

### Task 7: веб-консоль рисует словами

**Files:**
- Modify: `admin/src/screens/JournalScreen.tsx`
- Modify: `admin/src/index.css:1660-1688`
- Delete: `admin/src/screens/journal-labels.test.ts`
- Test: `admin/src/screens/journal-row.test.tsx` (создать)

**Interfaces:**
- Consumes: `describeAuditEvent`, `formatAuditMoment`, `auditMonthRange` из Task 5.
- Produces: ничего для последующих задач.

- [ ] **Step 1: Написать падающий тест**

Создать `admin/src/screens/journal-row.test.tsx`. Харнес — тот же, что в соседнем `admin/src/screens/journal-error.test.tsx`: прагма jsdom и голый `createRoot`. `AppRoot` здесь не нужен — веб-консоль на своём CSS, а не на telegram-ui.

```tsx
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { JournalEventRow } from "./JournalScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function renderRow(event: Parameters<typeof JournalEventRow>[0]["event"]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(JournalEventRow, { event })));
  return host.textContent ?? "";
}

const entry = (over: Record<string, unknown>) => ({
  entryId: 9, employeeId: 3, employeeName: "Марк Волков", date: "2026-08-12",
  endDate: null, category: "shift", title: null, start: null, end: null, ...over,
});

describe("строка журнала", () => {
  it("показывает фразу и подробности вместо JSON", async () => {
    const text = await renderRow({
      id: 1,
      type: "entry_updated",
      createdAt: "2026-08-05T14:32:00.000Z",
      actorName: "Игорь Петров",
      payload: { before: entry({}), after: entry({ title: "День", start: "09:00", end: "18:00" }) },
    });
    expect(text).toContain("Изменена смена");
    expect(text).toContain("стало: День 09:00–18:00");
    expect(text).toContain("Игорь Петров");
    // Ровно то, ради чего задача: ключей payload'а на экране больше нет.
    expect(text).not.toContain("entryId");
  });

  it("вместо актора-человека пишет «система», когда его нет", async () => {
    const text = await renderRow({
      id: 2, type: "reminders_dispatched", createdAt: "2026-08-06T20:05:00.000Z",
      actorName: null, payload: { forDate: "2026-08-07", sent: 12, considered: 13 },
    });
    expect(text).toContain("система");
    expect(text).toContain("Разосланы напоминания на завтра");
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run admin/src/screens/journal-row.test.tsx`
Expected: FAIL — `JournalEventRow` не экспортируется.

- [ ] **Step 3: Переписать экран**

`admin/src/screens/JournalScreen.tsx` — удалить `TYPE_LABELS`, `typeLabel`, `formatMoment`, `monthRangeOf` целиком (строки 5–53) и заменить шапку файла на:

```tsx
import { useEffect, useState } from "react";
import { describeAuditEvent, formatAuditMoment, auditMonthRange } from "@planer/shared";
import { apiClient, AuthRequiredError, type JournalPage, type ShiftCountsReport } from "../api/client";
import { initialsOf, personPalette } from "../lib/people";

/** Одна строка ленты «кто что менял»: значок, фраза, кто и когда, подробности.
 *  Текст целиком приходит из `describeAuditEvent` — тот же, что видит мини-апп. */
export function JournalEventRow({ event }: { event: JournalPage["events"][number] }) {
  const view = describeAuditEvent(event);
  return (
    <div className="journal-row">
      <span className="journal-icon" aria-hidden>{view.icon}</span>
      <div className="journal-body">
        <div className="journal-head">
          <span className="journal-type">{view.title}</span>
          <span className="journal-meta">
            {event.actorName ?? "система"} · {formatAuditMoment(event.createdAt)}
          </span>
        </div>
        {view.lines.map((line, i) => (
          <div className="journal-line" key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
```

В `ShiftCounts` заменить `monthRangeOf(new Date())` на:

```ts
  const initial = auditMonthRange(new Date().toISOString().slice(0, 10));
```

В `History` — фильтр по типам и сам список:

```tsx
          {page.availableTypes.map((type) => (
            <option value={type} key={type}>
              {describeAuditEvent({ type, payload: {} }).title}
            </option>
          ))}
```

```tsx
        <div className="employees-list">
          {page.events.map((event) => (
            <JournalEventRow event={event} key={event.id} />
          ))}
        </div>
```

Удалить файл:

```bash
git rm admin/src/screens/journal-labels.test.ts
```

- [ ] **Step 4: Переверстать строку**

`admin/src/index.css` — заменить блок `.journal-row` … `.journal-payload` (строки 1660–1688) на:

```css
.journal-row {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 10px;
  align-items: start;
  padding: 10px 14px;
  border: 1px solid var(--separator);
  border-radius: 10px;
  background: var(--surface-section);
  font-size: 13.5px;
}

.journal-icon {
  font-size: 16px;
  line-height: 1.35;
  text-align: center;
}

.journal-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.journal-type {
  font-weight: 600;
}

.journal-meta {
  margin-left: auto;
  color: var(--hint);
  font-size: 12.5px;
}

/* Подробности — то, ради чего строка и нужна: они не обрезаются и переносятся. */
.journal-line {
  margin-top: 2px;
  color: var(--hint);
  line-height: 1.45;
}
```

- [ ] **Step 5: Прогнать тесты веба**

Run: `npx vitest run admin && npm run typecheck`
Expected: PASS. Если `admin/src/App.test.ts` или другой тест импортировал `typeLabel` из `JournalScreen` — переведи его на `describeAuditEvent(...).title`.

- [ ] **Step 6: Коммит**

```bash
git add admin/src docs
git commit -m "feat(admin): журнал читается словами, а не JSON'ом

Сырой JSON.stringify(payload) в <code> заменён подробностями из общего
описателя. Дубль TYPE_LABELS и зеркальный тест к нему уехали."
```

---

### Task 8: мини-апп рисует теми же словами

**Files:**
- Modify: `miniapp/src/screens/admin/AdminJournal.tsx`
- Delete: `miniapp/src/screens/admin/journal-labels.test.ts`
- Test: `miniapp/src/screens/admin/journal-card.test.tsx` (создать)

**Interfaces:**
- Consumes: `describeAuditEvent`, `formatAuditMoment`, `auditMonthRange` из Task 5.
- Produces: ничего для последующих задач.

- [ ] **Step 1: Написать падающий тест**

Создать `miniapp/src/screens/admin/journal-card.test.tsx` — тот же харнес, что в Task 3, с обёрткой `AppRoot`.

```tsx
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { JournalEventCard } from "./AdminJournal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function renderCard(event: Parameters<typeof JournalEventCard>[0]["event"]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(AppRoot, null, createElement(JournalEventCard, { event }))));
  return host.textContent ?? "";
}

describe("карточка журнала", () => {
  it("показывает подробности, а не только заголовок", async () => {
    const text = await renderCard({
      id: 1, type: "weekend_interest", createdAt: "2026-08-05T14:32:00.000Z",
      actorName: "Марк Волков",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
    });
    expect(text).toContain("Отклик на выходную смену");
    // Раньше миниапп не показывал payload вовсе — вот эта строка и есть задача.
    expect(text).toContain("сб 8 авг · 10:00–19:00");
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run miniapp/src/screens/admin/journal-card.test.tsx`
Expected: FAIL — `JournalEventCard` не экспортируется.

- [ ] **Step 3: Переписать экран**

`miniapp/src/screens/admin/AdminJournal.tsx` — удалить `TYPE_LABELS`, `typeLabel`, `formatMoment`, `monthRangeOf` (строки 8–56), заменить шапку на:

```tsx
import { useEffect, useState } from "react";
import { Button, Input, Placeholder, SegmentedControl, Section, Spinner } from "@telegram-apps/telegram-ui";
import { describeAuditEvent, formatAuditMoment, auditMonthRange } from "@planer/shared";
import { apiClient, type JournalPage, type ShiftCountsReport } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";
import { initialsOf, personPalette } from "../../lib/people";

/** Событие журнала карточкой. Текст — тот же, что в вебе: общий описатель. */
export function JournalEventCard({ event }: { event: JournalPage["events"][number] }) {
  const view = describeAuditEvent(event);
  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span aria-hidden style={{ flex: "none", fontSize: 15 }}>{view.icon}</span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14.5 }}>{view.title}</span>
      </div>
      <div style={{ marginTop: 4, color: "var(--tgui--hint_color)", fontSize: 12.5 }}>
        {event.actorName ?? "система"} · {formatAuditMoment(event.createdAt)}
      </div>
      {view.lines.map((line, i) => (
        <div key={i} style={{ marginTop: 3, fontSize: 13, lineHeight: 1.45 }}>{line}</div>
      ))}
    </CardShell>
  );
}
```

В `ShiftCounts` — `const initial = auditMonthRange(today);` (аргумент уже строка `YYYY-MM-DD`, менять нечего кроме имени функции).

В `History` — фильтр типов и список:

```tsx
            {page.availableTypes.map((available) => (
              <option value={available} key={available}>
                {describeAuditEvent({ type: available, payload: {} }).title}
              </option>
            ))}
```

```tsx
          page.events.map((event) => <JournalEventCard event={event} key={event.id} />)
```

Удалить файл:

```bash
git rm miniapp/src/screens/admin/journal-labels.test.ts
```

- [ ] **Step 4: Прогнать тесты мини-аппа**

Run: `npx vitest run miniapp && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add miniapp/src
git commit -m "feat(miniapp): журнал показывает подробности события, а не одно название"
```

---

### Task 9: обогащение четырёх payload'ов

Три события сегодня несут `employeeId` без имени, а `employee_updated` — только состояние «после». Описатели уже умеют и то и другое (Tasks 4–5); осталось начать это писать.

**Files:**
- Modify: `server/src/http/app.ts` — `auditShape` (строка ~698), `employee_updated` (~384), `template_roles_changed` (~1061), `template_rotation_changed` (~1032)
- Modify: `server/src/reminders/reminder-service.ts:73`
- Test: `server/src/http/entries.test.ts`, `server/src/http/employees.test.ts`, `server/src/reminders/reminder.test.ts`

**Interfaces:**
- Consumes: `recordAudit` с типом из Task 6.
- Produces: обогащённые payload'ы. Дальше на них никто не опирается — читает их только `describeAuditEvent`.

- [ ] **Step 1: Написать падающие тесты**

В `server/src/http/entries.test.ts` — внутри `describe("schedule edits are auditable")`, где уже есть `tokenFor`, `authedJson` и `listRecentAudit`:

```ts
  it("в журнале записи есть имя работника, а не только его номер", async () => {
    const db = makeTestDb();
    const mark = createEmployee(db, { displayName: "Марк Волков" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries", authedJson(admin, {
      date: FRIDAY, start: "09:00", end: "18:00", employeeId: mark.id, category: "shift", title: "День",
    }));

    const event = listRecentAudit(db, 10).find((row) => row.type === "entry_created");
    expect((event?.payload as { employeeName: string }).employeeName).toBe("Марк Волков");
  });
```

В `server/src/http/employees.test.ts` — там есть `worker(db, name, tgId)` и `authedJson`:

```ts
  it("переименование сохраняет в журнале и старое имя, и новое", async () => {
    const db = makeTestDb();
    const sveta = worker(db, "Света Орлов", 201);
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request(`/api/admin/employees/${sveta.id}`, authedJson(admin, { displayName: "Света Орлова" }, "PATCH"));

    const event = listRecentAudit(db, 10).find((row) => row.type === "employee_updated");
    const payload = event?.payload as { before: { displayName: string }; after: { displayName: string } };
    expect(payload.before.displayName).toBe("Света Орлов");
    expect(payload.after.displayName).toBe("Света Орлова");
  });
```

В `server/src/reminders/reminder.test.ts` — **существующий** тест «gives up after Telegram refuses for good, and says so in the journal» сверяет payload через `toEqual` со строгой формой:

```ts
      expect(event?.payload).toEqual({ employeeId: anya.id, shiftId: shift.id, errorCode: 403 });
```

Добавление `displayName` его сломает — это ожидаемо, форма меняется намеренно. Заменить на:

```ts
      expect(event?.payload).toEqual({ employeeId: anya.id, displayName: "Аня", shiftId: shift.id, errorCode: 403 });
```

Это и есть падающий тест для `reminder_undeliverable` — отдельный писать не нужно.

- [ ] **Step 2: Прогнать — убедиться, что падают**

Run: `npx vitest run server/src/http/entries.test.ts server/src/http/employees.test.ts server/src/reminders/reminder.test.ts`
Expected: FAIL — `expected undefined to be "Марк Волков"` и подобное.

- [ ] **Step 3: Дописать payload'ы**

`server/src/http/app.ts`, `auditShape` (~698):

```ts
  /** The fields worth keeping in the audit feed — enough to answer «что именно поменяли»
   *  without copying the whole row into the log. Имя, а не только `employeeId`:
   *  журнал читают глазами, и «работник #24» не отвечает ни на один вопрос. */
  const auditShape = (s: Shift) => ({
    entryId: s.id, employeeId: s.employeeId,
    employeeName: s.employeeId != null ? nameOf(s.employeeId) : null,
    date: s.date, endDate: s.endDate,
    category: s.category, title: s.title, start: s.start, end: s.end,
  });
```

`employee_updated` (~384) — снять состояние до правки и записать обе стороны:

```ts
    let employee = getEmployeeById(db, id);
    if (!employee) return c.json({ error: "not_found" }, 404);
    // Снимок до правки: без него переименование не оставляет следа — в журнале
    // оказывается новое имя, а старого нет нигде.
    const beforeEdit = { displayName: employee.displayName, birthDate: employee.birthDate, preferredName: employee.preferredName };
```

и, оставив всё между ними без изменений, заменить сам вызов:

```ts
    recordAudit(db, "employee_updated", c.get("auth").employeeId, {
      employeeId: id,
      before: beforeEdit,
      after: { displayName: employee.displayName, birthDate: employee.birthDate, preferredName: employee.preferredName },
    });
```

`template_rotation_changed` (~1032) и `template_roles_changed` (~1061) — добавить название пресета:

```ts
    recordAudit(db, "template_rotation_changed", c.get("auth").employeeId, {
      templateId, templateName: getTemplate(db, templateId)?.name ?? null, rotationUnit: body.rotationUnit,
    });
```

```ts
      recordAudit(db, "template_roles_changed", c.get("auth").employeeId, {
        templateId,
        templateName: getTemplate(db, templateId)?.name ?? null,
        poolSize: saved.pool.length,
        preferred: Object.keys(saved.preference).length,
      });
```

Если `getTemplate` в этом файле не импортирован — возьми его из `../repo/templates` (там же, откуда `listActiveTemplates`); если функции с таким именем нет, найди в `server/src/repo/templates.ts` ту, что отдаёт пресет по id, и используй её.

`server/src/reminders/reminder-service.ts:73`:

```ts
      recordAudit(db, "reminder_undeliverable", null, {
        employeeId: owner.id,
        displayName: owner.displayName,
        shiftId: shift.id,
        errorCode: outcome.errorCode,
      });
```

- [ ] **Step 4: Прогнать — убедиться, что проходят**

Run: `npx vitest run server && npm run typecheck`
Expected: PASS. Если какой-то старый тест сверял `employee_updated` со старой плоской формой — приведи его к новой: форма изменилась намеренно.

- [ ] **Step 5: Коммит**

```bash
git add server/src
git commit -m "feat(server): журнал записывает имена и обе стороны правки

Раньше «Изменены данные работника» несло только состояние после — после
переименования старое имя не оставалось нигде."
```

---

### Task 10: четыре админских события

**Files:**
- Modify: `server/src/http/app.ts` — роуты на строках ~339 (создание), ~478 (приглашение), ~534 (сбор на ДР), ~1270 (снятие назначения)
- Test: `server/src/http/employees.test.ts`, `server/src/http/birthdays-route.test.ts`, `server/src/http/weekend.test.ts`

**Interfaces:**
- Consumes: `recordAudit` из Task 6, `AuditType` уже содержит все четыре.
- Produces: события `employee_created`, `employee_invite_issued`, `birthday_campaign_updated`, `weekend_unassigned`.

- [ ] **Step 1: Написать падающие тесты**

В `server/src/http/employees.test.ts`:

```ts
  it("создание работника попадает в журнал", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/employees", authedJson(admin, { displayName: "Света Орлова" }));

    const event = listRecentAudit(db, 10).find((row) => row.type === "employee_created");
    expect((event?.payload as { displayName: string }).displayName).toBe("Света Орлова");
  });

  it("выдача приглашения попадает в журнал, но без самого токена", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config: configWithBotUsername });
    const admin = await tokenFor(app, 111);
    const created = await (await app.request("/api/admin/employees", authedJson(admin, { displayName: "Света Орлова" }))).json();

    const res = await app.request(`/api/admin/employees/${created.employee.id}/invite`, authedJson(admin, { regenerate: true }));
    const { inviteToken } = await res.json();

    const event = listRecentAudit(db, 10).find((row) => row.type === "employee_invite_issued");
    expect((event?.payload as { regenerated: boolean }).regenerated).toBe(true);
    // Ключ к учётной записи в журнал не попадает — его видят все админы.
    expect(JSON.stringify(event?.payload)).not.toContain(inviteToken);
  });
```

В `server/src/http/weekend.test.ts` — поток слот → отклик → назначение → снятие, как в соседнем тесте «unassign notifies the worker»:

```ts
  it("снятие назначения попадает в журнал с именем и слотом", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const mark = await worker(db, app, "Марк Волков", 201);

    const date = nextSaturday();
    const slotId = (await (await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }))).json()).slot.id as number;
    await app.request(`/api/weekend/slots/${slotId}/interest`, authed(mark.token));
    const assignmentId = (await (await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: mark.w.id }))).json()).assignment.id as number;

    expect((await app.request(`/api/admin/weekend/assignments/${assignmentId}/unassign`, authed(admin))).status).toBe(200);

    const event = listRecentAudit(db, 10).find((row) => row.type === "weekend_unassigned");
    const payload = event?.payload as { employeeName: string; slot: string };
    expect(payload.employeeName).toBe("Марк Волков");
    expect(payload.slot).toContain("Ярмарка");
  });
```

В `server/src/http/birthdays-route.test.ts` — там есть `person(db, name, tg, birthDate)`, `send(token, body, method)` и `ASOF`:

```ts
  it("правка сбора попадает в журнал фактом, а не текстом поздравления", async () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь Петров", 201, "08-05");
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request(`/api/admin/birthdays/${igor}?${ASOF}`, send(admin, { messageText: "Скидываемся Игорю" }, "PUT"));
    expect(res.status).toBe(200);

    const event = listRecentAudit(db, 10).find((row) => row.type === "birthday_campaign_updated");
    expect((event?.payload as { displayName: string }).displayName).toBe("Игорь Петров");
    // Текст поздравления в журнал не копируется — только факт правки.
    expect(JSON.stringify(event?.payload)).not.toContain("Скидываемся");
  });
```

- [ ] **Step 2: Прогнать — убедиться, что падают**

Run: `npx vitest run server/src/http/employees.test.ts server/src/http/weekend.test.ts server/src/http/birthdays-route.test.ts`
Expected: FAIL — последняя строка журнала не того типа (или журнал пуст).

- [ ] **Step 3: Дописать четыре вызова**

Создание работника (~348, сразу после `createEmployee`):

```ts
    const employee = createEmployee(db, { displayName: body.displayName, inviteToken });
    recordAudit(db, "employee_created", c.get("auth").employeeId, {
      employeeId: employee.id, displayName: employee.displayName,
    });
```

Приглашение (~493, перед `return`):

```ts
    const inviteLink = config.botUsername ? `https://t.me/${config.botUsername}?start=${inviteToken}` : null;
    // Токен сюда не попадает намеренно: это действующий ключ к учётной записи, а
    // журнал открыт всем админам. Важен факт выдачи и то, что прежняя ссылка умерла.
    recordAudit(db, "employee_invite_issued", c.get("auth").employeeId, {
      employeeId: id, displayName: emp.displayName, regenerated: body.regenerate === true,
    });
    return c.json({ inviteToken, inviteLink });
```

Правка сбора (~586, после успешного `updateCampaign`):

```ts
    const campaign = updateCampaign(db, Number(c.req.param("id")), asOf, patch);
    if (!campaign) return c.json({ error: "not_found" }, 404);
    // Пишем, ЧТО тронули, а не что написали: текст поздравления в журнал не копируется.
    recordAudit(db, "birthday_campaign_updated", c.get("auth").employeeId, {
      employeeId: Number(c.req.param("id")),
      displayName: getEmployeeById(db, Number(c.req.param("id")))?.displayName ?? null,
      ...(patch.collectUrl !== undefined ? { collectUrl: patch.collectUrl } : {}),
      ...(patch.messageText !== undefined ? { messageText: patch.messageText ? "изменён" : null } : {}),
      ...(patch.scheduledSendOn !== undefined ? { scheduledSendOn: patch.scheduledSendOn } : {}),
    });
    return c.json({ campaign });
```

Снятие назначения (~1272, сразу после проверки `res.ok`):

```ts
    const res = unassign(db, Number(c.req.param("id")));
    if (!res.ok) return c.json({ error: res.reason }, 400);
    const removedSlot = getVacantSlot(db, res.slotId);
    recordAudit(db, "weekend_unassigned", c.get("auth").employeeId, {
      slotId: res.slotId,
      slot: removedSlot ? slotLineOf(removedSlot) : null,
      employeeId: res.employeeId,
      employeeName: nameOf(res.employeeId) ?? null,
    });
```

Ниже по коду уже есть `const slot = getVacantSlot(db, res.slotId);` внутри `if (bot)` — замени его на использование `removedSlot`, чтобы не читать одно и то же дважды.

- [ ] **Step 4: Прогнать — убедиться, что проходят**

Run: `npx vitest run server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/src
git commit -m "feat(server): в журнал попадают создание работника, приглашение, правка сбора и снятие с выходной

Четыре админских действия не оставляли следа вообще. Токен приглашения в
журнал не пишется — это ключ к учётной записи."
```

---

### Task 11: четыре события работников

**Files:**
- Modify: `server/src/http/app.ts` — роуты ~280 (настройки), ~1131 (отклик), ~1143 (подтверждение), ~1155 (отказ)
- Test: `server/src/http/app.test.ts`, `server/src/http/weekend.test.ts`

**Interfaces:**
- Consumes: `recordAudit` из Task 6.
- Produces: события `settings_changed`, `weekend_interest`, `weekend_offer_confirmed`, `weekend_offer_declined`.

- [ ] **Step 1: Написать падающие тесты**

В `server/src/http/employees.test.ts` (а не в `app.test.ts`: там нет ни `listRecentAudit`, ни хелпера для PATCH, а здесь есть оба):

```ts
  it("работник выключил напоминания — это видно в журнале", async () => {
    const db = makeTestDb();
    const mark = worker(db, "Марк Волков", 201);
    const app = createApp({ db, config });

    await app.request("/api/me/settings", authedJson(await tokenFor(app, 201), { remindersEnabled: false }, "PATCH"));

    const event = listRecentAudit(db, 10).find((row) => row.type === "settings_changed");
    expect(event?.actorEmployeeId).toBe(mark.id);
    expect((event?.payload as { remindersEnabled: boolean }).remindersEnabled).toBe(false);
  });
```

В `server/src/http/weekend.test.ts` — один тест на весь путь работника, по образцу соседнего «declining an offer»:

```ts
  it("весь путь выходной смены виден в журнале, а не только её назначение", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const mark = await worker(db, app, "Марк Волков", 201);

    const date = nextSaturday();
    const slotId = (await (await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }))).json()).slot.id as number;

    await app.request(`/api/weekend/slots/${slotId}/interest`, authed(mark.token));
    const assignmentId = (await (await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: mark.w.id }))).json()).assignment.id as number;
    await app.request(`/api/weekend/offers/${assignmentId}/confirm`, authed(mark.token));
    await app.request(`/api/weekend/offers/${assignmentId}/decline`, authed(mark.token));

    const journal = listRecentAudit(db, 20);
    for (const type of ["weekend_interest", "weekend_offer_confirmed", "weekend_offer_declined"]) {
      const event = journal.find((row) => row.type === type);
      expect(event, type).toBeDefined();
      expect((event!.payload as { employeeName: string }).employeeName).toBe("Марк Волков");
      expect((event!.payload as { slot: string }).slot).toContain("Ярмарка");
      expect(event!.actorEmployeeId).toBe(mark.w.id);
    }
  });
```

Если `decline` после `confirm` отвергается доменом (подтверждённое назначение уже не отклонить) — раздели тест на два: в первом `confirm`, во втором `decline` сразу после `assign`, без подтверждения. Проверять надо три события, а не один сценарий.

- [ ] **Step 2: Прогнать — убедиться, что падают**

Run: `npx vitest run server/src/http/app.test.ts server/src/http/weekend.test.ts`
Expected: FAIL.

- [ ] **Step 3: Дописать четыре вызова**

Настройки (~299, перед `return c.json`):

```ts
    // Одно действие человека — одна строка журнала: маршрут принимает оба поля
    // разом, и делить его на два события значило бы врать о том, что он сделал.
    recordAudit(db, "settings_changed", id, {
      employeeId: id,
      displayName: employee.displayName,
      ...(hasReminders ? { remindersEnabled: employee.remindersEnabled } : {}),
      ...(preferred?.ok ? { preferredName: employee.preferredName } : {}),
    });
```

Отклик (~1131):

```ts
  app.post("/api/weekend/slots/:id/interest", requireAuth(db, config.jwtSecret), (c) => {
    const slotId = Number(c.req.param("id"));
    const res = expressInterest(db, slotId, c.get("auth").employeeId, teamNow(config.teamTz).date);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    const slot = getVacantSlot(db, slotId);
    recordAudit(db, "weekend_interest", c.get("auth").employeeId, {
      slotId,
      slot: slot ? slotLineOf(slot) : null,
      employeeId: c.get("auth").employeeId,
      employeeName: nameOf(c.get("auth").employeeId) ?? null,
    });
    return c.json({ ok: true }, 201);
  });
```

Подтверждение (~1143) — после `if (!res.ok)`, рядом с уже читаемым там слотом:

```ts
    const slot = getVacantSlot(db, res.slotId);
    const name = nameOf(c.get("auth").employeeId) ?? "Работник";
    recordAudit(db, "weekend_offer_confirmed", c.get("auth").employeeId, {
      slotId: res.slotId, slot: slot ? slotLineOf(slot) : null,
      employeeId: c.get("auth").employeeId, employeeName: name,
    });
    if (bot) {
      await notifyAdmins(bot, db, weekendConfirmedAdminText(name, slot ? slotLineOf(slot) : "выходную смену"));
    }
```

Отказ (~1155) — тем же образом, с типом `weekend_offer_declined` и `weekendDeclinedAdminText`.

Обрати внимание: в обоих роутах `slot` и `name` сейчас читаются **внутри** `if (bot)`. Их надо поднять выше — журнал не должен зависеть от того, поднят ли бот.

- [ ] **Step 4: Прогнать — убедиться, что проходят**

Run: `npx vitest run server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/src
git commit -m "feat(server): в журнал попадают настройки работника и весь путь выходной смены

Раньше было видно только финальное «назначена» — кто откликнулся и кто
отказался, не знал никто."
```

---

### Task 12: свёрнутая строка о напоминаниях

**Files:**
- Modify: `server/src/reminders/reminder-service.ts:16-38` (`runReminderTick`)
- Test: `server/src/reminders/reminder.test.ts`

**Interfaces:**
- Consumes: `recordAudit` из Task 6.
- Produces: событие `reminders_dispatched`. Последняя задача плана.

- [ ] **Step 1: Написать падающие тесты**

В `server/src/reminders/reminder.test.ts`, внутри `describe("runReminderTick")` — там уже есть `linkedEmployee`, `testBot`, `TODAY`, `TOMORROW`, `listRecentAudit`:

```ts
  it("пишет одну строку на прогон, когда напоминания ушли", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    const mark = linkedEmployee(db, "Марк", 112);
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: mark.id });

    const { bot } = testBot();
    expect(await runReminderTick(db, bot, { date: TODAY, time: "20:05" })).toBe(2);

    const rows = listRecentAudit(db, 20).filter((row) => row.type === "reminders_dispatched");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ forDate: TOMORROW, sent: 2 });
    expect(rows[0]!.actorEmployeeId).toBeNull();
  });

  it("молчит, когда отправлять было нечего", async () => {
    const db = makeTestDb();
    const { bot } = testBot();
    await runReminderTick(db, bot, { date: TODAY, time: "20:05" });
    expect(listRecentAudit(db, 20).filter((row) => row.type === "reminders_dispatched")).toEqual([]);
  });

  it("на повторном тике в тот же вечер второй строки не появляется", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });

    const { bot } = testBot();
    await runReminderTick(db, bot, { date: TODAY, time: "20:05" });
    // `hasReminder` дедуплицирует отправку, так что второй тик шлёт ноль — и молчит.
    await runReminderTick(db, bot, { date: TODAY, time: "20:10" });

    expect(listRecentAudit(db, 20).filter((row) => row.type === "reminders_dispatched")).toHaveLength(1);
  });
```

- [ ] **Step 2: Прогнать — убедиться, что падают**

Run: `npx vitest run server/src/reminders/reminder.test.ts`
Expected: FAIL — `expected [] to have length 1`.

- [ ] **Step 3: Записать итог прогона**

`server/src/reminders/reminder-service.ts`, конец `runReminderTick`:

```ts
  // Одна строка на прогон, а не на человека: тик крутится каждые пять минут весь
  // вечер, и поштучные записи утопили бы всё остальное в журнале. Молчим, когда
  // ушло ноль — «ничего не произошло» не событие, а `hasReminder` дедуплицирует
  // отправку, так что второй тик за вечер сюда уже не дойдёт.
  if (count > 0) {
    recordAudit(db, "reminders_dispatched", null, { forDate: tomorrow, sent: count, considered: shifts.length });
  }
  return count;
}
```

- [ ] **Step 4: Прогнать — убедиться, что проходят**

Run: `npx vitest run server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Полная проверка перед финальным коммитом**

Run: `npx vitest run && npm run typecheck && npx vitest run server/src/db/no-real-names.test.ts`
Expected: всё зелёное. Третья команда — страж приватности; он читает файлы с диска по `git ls-files`, поэтому новые файлы должны быть уже под `git add`.

- [ ] **Step 6: Коммит**

```bash
git add server/src
git commit -m "feat(server): одна строка журнала на вечерний прогон напоминаний

Видно, что бот жив и до скольких людей дошло, без потопа из строки на
каждого человека каждые пять минут."
```

---

## Проверка готовности

Работа закончена, когда:

- [ ] `npx vitest run` — всё зелёное
- [ ] `npm run typecheck` — чисто во всех четырёх пакетах
- [ ] `npx vitest run server/src/db/no-real-names.test.ts` — страж приватности прошёл
- [ ] Во вкладке «Мои смены» нет прошедших дней, есть секции по неделям, а сводка говорит про остаток недели
- [ ] В журнале обоих консолей нет ни одного `{"` на экране
- [ ] `git grep -n "TYPE_LABELS"` — пусто
- [ ] `git grep -n "journal-labels.test"` — пусто
