# Роль «Наблюдатель» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ввести роль «Наблюдатель» — человек в графике, вне командной механики, с правом вести свой график и рассылать объявления.

**Architecture:** два булевых поля в `employees` (`isObserver`, `selfScheduleEnabled`) и единственный модуль `shared/src/access.ts`, который превращает их в разрешения. Все места, читающие `excludedFrom*` напрямую, спрашивают его. Рассылка переезжает из-под сплошного `requireAdmin` на собственный маршрут с гейтом `canAnnounce`.

**Tech Stack:** TypeScript, Hono, drizzle-orm + better-sqlite3 (SQLite/WAL), grammy, React + `@telegram-apps/telegram-ui`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-observer-role-design.md`

## Global Constraints

- Ветка `feature/observer-role`, коммиты по-русски в стиле истории (`feat(...)`, `fix(...)`, `test(...)`).
- Гейт после каждой задачи: `npm test`, `npm run typecheck`, `npm run lint`. Ничего не считается готовым без прогнанной команды с показанным выводом.
- Слои `shared/` и `server/` — TDD обязателен: сперва падающий тест, потом код. `miniapp/` — логика по TDD, вёрстка нет.
- **Настоящих ФИО в репозитории быть не может.** В тестах только «Аня», «Игорь», «Марк», «Даша». Сторож — `server/src/db/no-real-names.test.ts`.
- Комментарий объясняет «почему», а не «что».
- Текст, который читает человек, — по-русски. Английский только в именах кода.
- Дата — командная: `teamNow(config.teamTz)`, никогда `new Date()`.
- Тест должен **исключать**, а не подтверждать уже истинное: наблюдатель в тестах раздачи и обменов заводится с `excludedFromAssignment: false` и `excludedFromSwaps: false`.

---

### Task 1: Колонки `isObserver` и `selfScheduleEnabled`

**Files:**
- Modify: `server/src/db/schema.ts:16-47` (таблица `employees`)
- Create: `server/drizzle/00XX_observer_role.sql` (генерируется, потом переименовывается)
- Modify: `server/drizzle/meta/_journal.json` (тег переименованной миграции)
- Modify: `server/src/repo/employees.ts` (новые сеттеры рядом с `setEmployeeAdmin:243`)
- Test: `server/src/db/schema.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: поля `Employee.isObserver: boolean`, `Employee.selfScheduleEnabled: boolean`; `setEmployeeObserver(db: Db, id: number, isObserver: boolean): Employee | undefined`; `setSelfScheduleEnabled(db: Db, id: number, enabled: boolean): Employee | undefined`.

- [ ] **Step 1: Написать падающий тест**

В `server/src/db/schema.test.ts` дописать:

```ts
import { setEmployeeObserver, setSelfScheduleEnabled } from "../repo/employees";

describe("роль наблюдателя", () => {
  it("новый работник наблюдателем не становится", () => {
    const db = makeTestDb();
    const person = createEmployee(db, { displayName: "Аня" });
    expect(person.isObserver).toBe(false);
    expect(person.selfScheduleEnabled).toBe(false);
  });

  it("тумблер своего графика живёт отдельно от роли", () => {
    const db = makeTestDb();
    const person = createEmployee(db, { displayName: "Игорь" });
    const observer = setEmployeeObserver(db, person.id, true)!;
    expect(observer.isObserver).toBe(true);
    // Роль сама по себе график вести не разрешает — это второе, личное решение.
    expect(observer.selfScheduleEnabled).toBe(false);
    expect(setSelfScheduleEnabled(db, person.id, true)!.selfScheduleEnabled).toBe(true);
  });

  it("снятие роли не трогает исключения, которые ставил админ", () => {
    const db = makeTestDb();
    const person = createEmployee(db, { displayName: "Марк" });
    setEmployeeRestrictions(db, person.id, { excludedFromSwaps: true });
    setEmployeeObserver(db, person.id, true);
    const back = setEmployeeObserver(db, person.id, false)!;
    expect(back.excludedFromSwaps).toBe(true);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run server/src/db/schema.test.ts`
Expected: FAIL — `setEmployeeObserver` не экспортируется.

- [ ] **Step 3: Колонки в схеме**

В `server/src/db/schema.ts`, в таблице `employees`, после `excludedFromSwaps`:

```ts
  /** Человек в графике, но вне командной механики: раздачи, обменов, передачи
   *  смены и сбора выходных. Не «архив» и не «исключён» — он смотрит график и
   *  рассылает объявления. Что именно из этого следует, решает `shared/src/access.ts`,
   *  а не двадцать проверок по коду. */
  isObserver: integer({ mode: "boolean" }).notNull().default(false),
  /** Наблюдатель сам решил вести свой график. Выключено по умолчанию: пока он
   *  этого не захотел, его интерфейс остаётся смотровым. Ставит его он сам,
   *  а не админ, — поэтому поле не в `setEmployeeRestrictions`. */
  selfScheduleEnabled: integer({ mode: "boolean" }).notNull().default(false),
```

- [ ] **Step 4: Сгенерировать миграцию и переименовать**

```bash
npm run db:generate -w @planer/server
```

Файл получит случайное имя вида `0023_<два слова>.sql`. Переименовать его в `0023_observer_role.sql` и поправить `tag` последней записи в `server/drizzle/meta/_journal.json` на `0023_observer_role` — так сделаны `0016_swap_survives_shift_delete` и `0022_indexes_for_hot_reads`.

Проверить, что внутри ровно два `ALTER TABLE ... ADD ... NOT NULL DEFAULT false` и ничего больше: пересборки таблицы здесь быть не должно.

- [ ] **Step 5: Сеттеры в репозитории**

В `server/src/repo/employees.ts` рядом с `setEmployeeAdmin`:

```ts
/**
 * Роль наблюдателя. Отдельно от `setEmployeeRestrictions` намеренно: та пишет
 * галочки, которые ставит админ по случаю, а это — утверждение о человеке,
 * из которого поведение следует само. Исключения при этом НЕ переписываются:
 * снятие роли должно вернуть человека туда, где он был до неё.
 */
export function setEmployeeObserver(db: Db, id: number, isObserver: boolean): Employee | undefined {
  return db.update(employees).set({ isObserver }).where(eq(employees.id, id)).returning().all()[0];
}

/** Тумблер «веду свой график сам» — его ставит сам наблюдатель, не админ. */
export function setSelfScheduleEnabled(db: Db, id: number, enabled: boolean): Employee | undefined {
  return db.update(employees).set({ selfScheduleEnabled: enabled }).where(eq(employees.id, id)).returning().all()[0];
}
```

- [ ] **Step 6: Прогнать тесты**

Run: `npx vitest run server/src/db/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add server/src/db/schema.ts server/src/repo/employees.ts server/src/db/schema.test.ts server/drizzle
git commit -m "feat(бд): роль наблюдателя и личный тумблер своего графика"
```

---

### Task 2: `shared/src/access.ts` — единственное место, где роль становится правами

**Files:**
- Create: `shared/src/access.ts`
- Create: `shared/src/access.test.ts`
- Modify: `shared/src/index.ts` (добавить `export * from "./access";`)

**Interfaces:**
- Consumes: поля из Task 1.
- Produces:
  - `interface AccessSubject { isAdmin: boolean; isObserver: boolean; selfScheduleEnabled: boolean; excludedFromAssignment: boolean; excludedFromSwaps: boolean }`
  - `canAnnounce(e: Pick<AccessSubject, "isAdmin" | "isObserver">): boolean`
  - `takesPartInAssignment(e: Pick<AccessSubject, "isObserver" | "excludedFromAssignment">): boolean`
  - `canSwap(e: Pick<AccessSubject, "isObserver" | "excludedFromSwaps">): boolean`
  - `canAddOwnShifts(e: Pick<AccessSubject, "isObserver" | "selfScheduleEnabled">): boolean`

- [ ] **Step 1: Написать падающий тест**

`shared/src/access.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canAnnounce, takesPartInAssignment, canSwap, canAddOwnShifts } from "./access";

/** Обычный работник без единого ограничения — состояние, в котором все
 *  запреты обязаны быть ложными, чтобы тест ловил именно новое правило. */
const worker = {
  isAdmin: false,
  isObserver: false,
  selfScheduleEnabled: false,
  excludedFromAssignment: false,
  excludedFromSwaps: false,
};
const admin = { ...worker, isAdmin: true };
const observer = { ...worker, isObserver: true };

describe("canAnnounce", () => {
  it("админ и наблюдатель — да, работник — нет", () => {
    expect(canAnnounce(admin)).toBe(true);
    expect(canAnnounce(observer)).toBe(true);
    expect(canAnnounce(worker)).toBe(false);
  });
});

describe("takesPartInAssignment", () => {
  it("наблюдатель вне раздачи ДАЖЕ со снятыми галочками", () => {
    // Ровно та проверка, ради которой заводится роль: галочки сняты, значит
    // тест зелёный только если исключает сама роль.
    expect(observer.excludedFromAssignment).toBe(false);
    expect(takesPartInAssignment(observer)).toBe(false);
  });

  it("работник со снятой галочкой в раздаче, с поднятой — нет", () => {
    expect(takesPartInAssignment(worker)).toBe(true);
    expect(takesPartInAssignment({ ...worker, excludedFromAssignment: true })).toBe(false);
  });
});

describe("canSwap", () => {
  it("наблюдатель вне обменов ДАЖЕ со снятой галочкой", () => {
    expect(observer.excludedFromSwaps).toBe(false);
    expect(canSwap(observer)).toBe(false);
  });

  it("работник меняется, пока его не исключили", () => {
    expect(canSwap(worker)).toBe(true);
    expect(canSwap({ ...worker, excludedFromSwaps: true })).toBe(false);
  });
});

describe("canAddOwnShifts", () => {
  it("нужны оба условия — роль и личный тумблер", () => {
    expect(canAddOwnShifts(observer)).toBe(false);
    expect(canAddOwnShifts({ ...observer, selfScheduleEnabled: true })).toBe(true);
    // Работнику тумблер не помогает: свой график ведёт наблюдатель, а смены
    // остальным ставит админ.
    expect(canAddOwnShifts({ ...worker, selfScheduleEnabled: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run shared/src/access.test.ts`
Expected: FAIL — `Cannot find module './access'`.

- [ ] **Step 3: Написать модуль**

`shared/src/access.ts`:

```ts
/**
 * Что человеку можно, исходя из его роли.
 *
 * Единственное место, где `isObserver` превращается в поведение. До него
 * «вне раздачи» и «вне обменов» были двумя независимыми галочками, которые
 * ставил админ по случаю, и роль, собранная из галочек, разъезжается: снятая
 * по невнимательности одна из них молча возвращает человека в раздачу смен.
 *
 * Функции принимают `Pick<...>`, а не строку работника целиком: их зовут и с
 * рядом из базы, и с DTO мини-аппа, и с литералом в тесте, и ни одному из них
 * не нужно знать про телефоны и инвайт-токены.
 */
export interface AccessSubject {
  isAdmin: boolean;
  isObserver: boolean;
  selfScheduleEnabled: boolean;
  excludedFromAssignment: boolean;
  excludedFromSwaps: boolean;
}

/**
 * Кто может разослать объявление.
 *
 * Право узкое не по привычке: объявление — единственный поток в системе,
 * проходящий сквозь ВСЕ настройки тишины, и отписаться от него нельзя
 * (см. `announcement-service.ts`). Наблюдатель получает его потому, что ради
 * его сообщений роль и заводилась.
 */
export function canAnnounce(e: Pick<AccessSubject, "isAdmin" | "isObserver">): boolean {
  return e.isAdmin || e.isObserver;
}

/** Берёт ли его «Распределить честно», ★-очередь и назначение выходных. */
export function takesPartInAssignment(e: Pick<AccessSubject, "isObserver" | "excludedFromAssignment">): boolean {
  return !e.isObserver && !e.excludedFromAssignment;
}

/** Может ли он участвовать в обмене и быть кандидатом на чужую смену — обе стороны. */
export function canSwap(e: Pick<AccessSubject, "isObserver" | "excludedFromSwaps">): boolean {
  return !e.isObserver && !e.excludedFromSwaps;
}

/** Может ли он поставить себе смену сам. Роль плюс личное решение — не одно вместо другого. */
export function canAddOwnShifts(e: Pick<AccessSubject, "isObserver" | "selfScheduleEnabled">): boolean {
  return e.isObserver && e.selfScheduleEnabled;
}
```

- [ ] **Step 4: Экспорт и прогон**

Дописать `export * from "./access";` в `shared/src/index.ts`.

Run: `npx vitest run shared/src/access.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add shared/src/access.ts shared/src/access.test.ts shared/src/index.ts
git commit -m "feat(права): один модуль решает, что можно наблюдателю"
```

---

### Task 3: Наблюдатель вне командной механики

**Files:**
- Modify: `server/src/schedule/distribute-service.ts:220`
- Modify: `server/src/weekend/weekend-service.ts:98,132,163,330`
- Modify: `server/src/swap/swap-service.ts:34-35`
- Modify: `server/src/handover/candidates.ts:50`
- Modify: `server/src/repo/template-roles.ts:84`
- Modify: `server/src/bot/notify.ts:229`
- Modify: `server/src/http/app.ts:1461`
- Test: `server/src/schedule/observer-excluded.test.ts` (создать)

**Interfaces:**
- Consumes: `takesPartInAssignment`, `canSwap` из Task 2.
- Produces: ничего нового наружу — меняется поведение существующих функций.

- [ ] **Step 1: Написать падающий тест**

`server/src/schedule/observer-excluded.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { addDaysIso } from "@planer/shared";
import { makeTestDb } from "../db/testdb";
import type { Db } from "../db/client";
import { createEmployee, setEmployeeObserver, listActive } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { buildDistribution } from "./distribute-service";
import { handoverCandidates } from "../handover/candidates";
import { teamNow } from "../util/team-time";
import { testConfig } from "../test-config";

const config = testConfig({ adminTelegramIds: [] });
/** Дата командная, не машинная: граница дня не должна зависеть от раннера. */
const day = (offset: number) => addDaysIso(teamNow(config.teamTz).date, offset);

/** Наблюдатель, у которого обе галочки-исключения СНЯТЫ: если тест зелёный,
 *  исключает именно роль, а не старое ограничение. */
function observer(db: Db, displayName: string) {
  const person = createEmployee(db, { displayName });
  const withRole = setEmployeeObserver(db, person.id, true)!;
  expect(withRole.excludedFromAssignment).toBe(false);
  expect(withRole.excludedFromSwaps).toBe(false);
  return withRole;
}

describe("наблюдатель вне командной механики", () => {
  it("не попадает в честную раздачу", () => {
    const db = makeTestDb();
    // Наблюдатель заводится ПЕРВЫМ, и это не косметика: при равной загрузке
    // раздача разрешает ничью по возрастанию `employeeId`. На обратном порядке
    // смену забирала бы Аня в любом случае, и тест зеленел бы без правила —
    // то есть не проверял бы ничего.
    const watcher = observer(db, "Игорь");
    createEmployee(db, { displayName: "Аня" });
    // Пустая смена, которую раздача обязана кому-то отдать.
    createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", employeeId: null });

    const { assignments } = buildDistribution(db, day(1), day(7));

    // Без этой строки пустая раздача (например, смена не создалась) дала бы
    // зелёный тест на любой реализации.
    expect(assignments).not.toHaveLength(0);
    expect(assignments.map((a) => a.employeeId)).not.toContain(watcher.id);
  });

  it("не предлагается как кандидат на чужую смену", () => {
    const db = makeTestDb();
    const owner = createEmployee(db, { displayName: "Аня" });
    const watcher = observer(db, "Марк");
    const shift = createShift(db, { date: day(2), start: "09:00", end: "18:00", employeeId: owner.id, category: "shift" });

    expect(handoverCandidates(db, shift).map((e) => e.id)).not.toContain(watcher.id);
  });

  it("остаётся в `listActive` — он не в архиве, он просто не работает по графику", () => {
    const db = makeTestDb();
    const watcher = observer(db, "Даша");
    expect(listActive(db).map((e) => e.id)).toContain(watcher.id);
  });
});
```

Порядок создания в первом тесте обязателен, и красный прогон обязан быть показан до реализации: раздача разрешает ничью по возрастанию `employeeId`, поэтому наблюдатель должен быть тем, кто выиграл бы смену, не будь правила.



- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run server/src/schedule/observer-excluded.test.ts`
Expected: FAIL — наблюдатель есть и в раздаче, и среди кандидатов.

- [ ] **Step 3: Перевести места на `access`**

Замены один в один:

```ts
// distribute-service.ts:220 — внутри buildDistribution
.filter((employee) => takesPartInAssignment(employee))

// template-roles.ts:84
(employee) => takesPartInAssignment(employee) && (pool.size === 0 || pool.has(employee.id)),

// bot/notify.ts:229 и http/app.ts:1461
listActive(db).filter((employee) => takesPartInAssignment(employee))

// weekend-service.ts:98,163,330 — каждое место вида
//   getEmployeeById(db, employeeId)?.excludedFromAssignment === true
// становится
const person = getEmployeeById(db, employeeId);
if (!person || !takesPartInAssignment(person)) return { ok: false, reason: "excluded" };
// (в строке 330 — `return []`, как было)

// weekend-service.ts:132
.filter((employeeId) => {
  const person = getEmployeeById(db, employeeId);
  return isOnStaff(db, employeeId) && person != null && takesPartInAssignment(person);
})

// swap-service.ts:34-35 — отсутствующий работник по-прежнему считается НЕ
// исключённым: его ловит отдельная проверка валидации, и подменять её здесь
// значило бы менять текст отказа заодно с ролью.
fromExcluded: isBlocked(db, fromEmployeeId),
toExcluded: isBlocked(db, toEmployeeId),
// рядом в том же файле:
/** «Этому обмен закрыт» — роль или галочка, для обеих сторон одинаково. */
function isBlocked(db: Db, employeeId: number): boolean {
  const person = getEmployeeById(db, employeeId);
  return person != null && !canSwap(person);
}

// handover/candidates.ts:50
.filter((employee) => employee.id !== shift.employeeId && !excluded.has(employee.id) && canSwap(employee))
```

Импорт в каждом файле: `import { takesPartInAssignment, canSwap } from "@planer/shared";`

- [ ] **Step 4: Прогнать весь серверный набор**

Run: `npm test`
Expected: PASS, включая новый файл. Старые тесты раздачи и обменов не должны измениться — работник с поднятой галочкой исключается ровно как раньше.

- [ ] **Step 5: Коммит**

```bash
git add server/src shared/src
git commit -m "feat(роль): наблюдателя не берут раздача, выходные, обмены и передача смены"
```

---

### Task 4: Наблюдатель ставит себе смену

**Files:**
- Modify: `shared/src/self-entry.ts:56,87` (`selfEntryRefusal`, `selfEntryEditRefusal`)
- Modify: `shared/src/self-entry.test.ts`
- Modify: `server/src/http/routes/my-entries.ts:50-93,115-141` (схема тела, `rowFor`, гейт, лестница)
- Test: `server/src/http/routes/my-entries.test.ts`

**Interfaces:**
- Consumes: `canAddOwnShifts` из Task 2.
- Produces:
  - `selfEntryRefusal(draft, today, opts?: { ownShifts?: boolean }): string | null`
  - `selfEntryEditRefusal(entry, today, opts?: { ownShifts?: boolean }): string | null`
  - Третья форма тела `POST/PATCH /api/my/entries`: `{ category: "shift", date, start, end, location? }`.

- [ ] **Step 1: Написать падающие тесты в shared**

В `shared/src/self-entry.test.ts`:

```ts
it("смену работник себе не ставит, а наблюдатель с включённым графиком — ставит", () => {
  const draft = { category: "shift" as const, date: "2026-09-01" };
  const today = "2026-08-20";
  expect(selfEntryRefusal(draft, today)).toBe("Такую запись ставит админ");
  expect(selfEntryRefusal(draft, today, { ownShifts: true })).toBeNull();
});

it("своя смена ставится на сегодня или вперёд — задним числом только больничный", () => {
  expect(selfEntryRefusal({ category: "shift", date: "2026-08-19" }, "2026-08-20", { ownShifts: true }))
    .toBe("Смену можно поставить на сегодня или вперёд");
});

it("свою смену можно править, пока она не кончилась", () => {
  const entry = { category: "shift" as const, date: "2026-08-25", endDate: null };
  expect(selfEntryEditRefusal(entry, "2026-08-20")).toBe("Такую запись правит админ");
  expect(selfEntryEditRefusal(entry, "2026-08-20", { ownShifts: true })).toBeNull();
  expect(selfEntryEditRefusal({ ...entry, date: "2026-08-01" }, "2026-08-20", { ownShifts: true }))
    .toBe("Запись уже кончилась — если что-то не так, напиши админу");
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `npx vitest run shared/src/self-entry.test.ts`
Expected: FAIL — третий аргумент не принимается, «смену» отбивает `isSelfWritable`.

- [ ] **Step 3: Расширить правила в shared**

В `shared/src/self-entry.ts`. `SELF_WRITABLE` **не трогать** — множество «что может работник» остаётся из двух, и тест на его полноту остаётся верным. Добавить рядом:

```ts
/**
 * Что может завести себе наблюдатель.
 *
 * Отдельное множество, а не третий элемент в `SELF_WRITABLE`: то отвечает на
 * вопрос «что работник ставит себе сам», и ответ на него по-прежнему «ровно
 * два». Смена здесь появляется не потому, что стала самозаписываемой вообще,
 * а потому, что у наблюдателя её больше некому поставить — в раздаче его нет.
 */
const OBSERVER_SELF_WRITABLE: ReadonlySet<EntryCategory> = new Set([...SELF_WRITABLE, "shift"]);

export interface SelfEntryAccess {
  /** `canAddOwnShifts` вызывающей стороны. */
  ownShifts?: boolean;
}

function writableFor(access: SelfEntryAccess): ReadonlySet<EntryCategory> {
  return access.ownShifts ? OBSERVER_SELF_WRITABLE : SELF_WRITABLE;
}
```

`selfEntryRefusal(draft, today, access: SelfEntryAccess = {})`: первую строку заменить на `if (!writableFor(access).has(draft.category)) return "Такую запись ставит админ";`, а вычисление `earliest` — на:

```ts
  // Задним числом — только больничный: он сообщает о факте, который уже
  // случился. Смена и мероприятие — это план, и «поставить себе вчерашнюю
  // смену» переписывает отчётность, а не планирует.
  const earliest = draft.category === "sick_leave" ? -SICK_BACKDATE_DAYS : 0;
```

(правило то же, но ветка сообщения теперь трёхчленная):

```ts
  if (offset < earliest) {
    if (draft.category === "sick_leave") {
      return `Больничный можно поставить не раньше чем за ${SICK_BACKDATE_DAYS} дней до сегодня — если нужно раньше, попроси админа`;
    }
    return draft.category === "shift"
      ? "Смену можно поставить на сегодня или вперёд"
      : "Мероприятие ставится на сегодня или вперёд";
  }
```

`selfEntryEditRefusal(entry, today, access: SelfEntryAccess = {})`: первая строка — `if (!writableFor(access).has(entry.category)) return "Такую запись правит админ";`.

- [ ] **Step 4: Прогнать shared**

Run: `npx vitest run shared/src/self-entry.test.ts`
Expected: PASS.

- [ ] **Step 5: Написать падающие тесты маршрута**

В `server/src/http/routes/my-entries.test.ts` дописать (используя тамошние хелперы `worker`, `tokenFor`, `authed`, `day`):

```ts
/** Наблюдатель с телеграмом — как `worker`, но с ролью. */
function observerWorker(db: Db, tgId: number, displayName: string, ownShifts: boolean) {
  const person = worker(db, tgId, displayName);
  setEmployeeObserver(db, person.id, true);
  if (ownShifts) setSelfScheduleEnabled(db, person.id, true);
  return person;
}

describe("своя смена наблюдателя", () => {
  it("с выключенным тумблером — 403 и ни одной записи", async () => {
    const db = makeTestDb();
    const me = observerWorker(db, 601, "Аня", false);
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 601);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "shift", date: day(1), start: "09:00", end: "18:00",
    })));

    expect(res.status).toBe(403);
    expect(listShiftsInRange(db, day(1), day(1)).filter((s) => s.employeeId === me.id)).toHaveLength(0);
  });

  it("с включённым — записывает смену на себя", async () => {
    const db = makeTestDb();
    const me = observerWorker(db, 602, "Игорь", true);
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 602);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "shift", date: day(1), start: "09:00", end: "18:00", location: "Поклонка",
    })));

    expect(res.status).toBe(201);
    const mine = listShiftsInRange(db, day(1), day(1)).filter((s) => s.employeeId === me.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.category).toBe("shift");
    expect(mine[0]!.start).toBe("09:00");
    // Пресеты — инструмент админа: своя смена не привязана к шаблону.
    expect(mine[0]!.templateId).toBeNull();
  });

  it("чужую смену наблюдатель поставить не может — «кому» в теле нет", async () => {
    const db = makeTestDb();
    observerWorker(db, 603, "Марк", true);
    const other = worker(db, 604, "Даша");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 603);

    await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "shift", date: day(1), start: "09:00", end: "18:00", employeeId: other.id,
    })));

    expect(listShiftsInRange(db, day(1), day(1)).filter((s) => s.employeeId === other.id)).toHaveLength(0);
  });

  it("больничный наблюдателя не поднимает лестницу передачи смены", async () => {
    const db = makeTestDb();
    observerWorker(db, 605, "Аня", true);
    worker(db, 606, "Игорь");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 605);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(1),
    })));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.handovers).toEqual([]);
    // И в базе тоже пусто: пустой ответ маршрута мог бы означать «создали, но не
    // показали». `listHandoversForEntry` ищет по `sickEntryId` — это тот самый id.
    expect(listHandoversForEntry(db, body.entry.id)).toHaveLength(0);
  });

  it("больничный обычного работника лестницу поднимает — правило про роль, а не про маршрут", async () => {
    const db = makeTestDb();
    const me = worker(db, 607, "Аня");
    const mate = worker(db, 608, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", employeeId: me.id, category: "shift" });
    expect(mate.id).toBeDefined();
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 607);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(1),
    })));

    expect(listHandoversForEntry(db, (await res.json()).entry.id)).not.toHaveLength(0);
  });
});
```

Импорт: `import { listHandoversForEntry } from "../../repo/handovers";`

- [ ] **Step 6: Убедиться, что падает**

Run: `npx vitest run server/src/http/routes/my-entries.test.ts`
Expected: FAIL — тело со `category: "shift"` не проходит zod, ответ 400.

- [ ] **Step 7: Реализовать в маршруте**

В `server/src/http/routes/my-entries.ts`:

```ts
const shiftBody = z.object({
  category: z.literal("shift"),
  date: dateStr,
  start: timeStr,
  end: timeStr,
  location: z.string().trim().max(200).nullish(),
});

const selfEntryBody = z.discriminatedUnion("category", [sickBody, eventBody, shiftBody]);
```

В `rowFor` — третья ветка:

```ts
  if (body.category === "shift") {
    return {
      category: "shift" as const,
      date: body.date,
      endDate: null,
      start: body.start,
      end: body.end,
      title: null,
      location: body.location ?? null,
    };
  }
```

В обработчиках `POST` и `PATCH`, сразу после разбора тела и до правил записи:

```ts
    const me = getEmployeeById(db, employeeId);
    if (!me) return c.json({ error: "not_found" }, 404);
    const ownShifts = canAddOwnShifts(me);
    // 403, а не 400: тумблер выключен — значит, право есть, но спит, и экран
    // должен предложить его включить, а не сказать «так нельзя вообще».
    // Работник сюда не попадает: у него нет роли, и его отобьёт `selfEntryRefusal`
    // словами «Такую запись ставит админ» — тем же 400, что и до этой правки.
    if (body.category === "shift" && me.isObserver && !ownShifts) {
      return c.json({ error: "Свой график выключен — включи его в настройках" }, 403);
    }
```

и передать `{ ownShifts }` третьим аргументом во все вызовы `selfEntryRefusal` и `selfEntryEditRefusal` в этом файле.

Лестницу передачи оставить только работникам — в `POST`:

```ts
    // Наблюдатель выведен из передачи смен целиком: предлагать его смену
    // команде некому и незачем, а его больничный никакой чужой работы не
    // освобождает.
    const handovers =
      entry.category === "sick_leave" && !me.isObserver
        ? await startHandovers(handoverDeps(), { sickEntry: entry, employeeId })
        : [];
```

и тем же условием обернуть блок `cancelHandoversForEntry` / `startHandovers` в `PATCH` и `cancelHandoversForEntry` / `detachHandoversFromEntry` в `DELETE`.

- [ ] **Step 8: Прогнать**

Run: `npm test`
Expected: PASS. Существующий тест «refuses a category the worker does not own» обязан остаться зелёным со своим 400 — если он позеленел через 403, гейт стоит не там.

- [ ] **Step 9: Коммит**

```bash
git add shared/src server/src
git commit -m "feat(график): наблюдатель ставит себе смену сам, если включил это у себя"
```

---

### Task 5: Письмо админам про правки наблюдателя

**Files:**
- Modify: `shared/src/notifications.ts:11-18,22-30`
- Modify: `server/src/http/routes/my-entries.ts` (три вызова `notifyAdmins`)
- Test: `server/src/http/routes/my-entries.test.ts`
- Test: `shared/src/notifications.test.ts` (перебирает виды — новый обязан быть подписан), `server/src/bot/notice-kinds-have-senders.test.ts` (сторож «у каждого вида есть отправитель» — он обязан позеленеть сам, без правок)

**Interfaces:**
- Consumes: `Employee.isObserver`.
- Produces: вид `"observer_entries"` в `ADMIN_NOTICE_KINDS`.

- [ ] **Step 1: Написать падающий тест**

```ts
it("правку наблюдателя админам шлёт отдельный вид письма, и его можно выключить", async () => {
  const db = makeTestDb();
  observerWorker(db, 611, "Аня", true);
  const boss = worker(db, 612, "Игорь");
  setEmployeeAdmin(db, boss.id, true);
  const quiet = worker(db, 613, "Марк");
  setEmployeeAdmin(db, quiet.id, true);
  setNoticeMuted(db, quiet.id, "observer_entries", true);

  const { bot, sent } = fakeBot();
  const app = createApp({ db, config, bot });
  const token = await tokenFor(app, 611);

  await app.request(new Request("http://x/api/my/entries", authed(token, {
    category: "shift", date: day(1), start: "09:00", end: "18:00",
  })));

  expect(sent.map((m) => m.to)).toEqual([612]);
  expect(sent[0]!.text).toContain("поставил(а) себе смену");
});

it("больничный обычного работника по-прежнему идёт видом self_entries", async () => {
  const db = makeTestDb();
  worker(db, 614, "Даша");
  const boss = worker(db, 615, "Игорь");
  setEmployeeAdmin(db, boss.id, true);
  setNoticeMuted(db, boss.id, "observer_entries", true);

  const { bot, sent } = fakeBot();
  const app = createApp({ db, config, bot });
  const token = await tokenFor(app, 614);

  await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })));

  // Мьют «наблюдателей» не должен глушить письма про команду.
  expect(sent.map((m) => m.to)).toContain(615);
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `npx vitest run server/src/http/routes/my-entries.test.ts`
Expected: FAIL — `"observer_entries"` не входит в `AdminNoticeKind`.

- [ ] **Step 3: Новый вид**

В `shared/src/notifications.ts` добавить `"observer_entries"` в массив и подпись:

```ts
  observer_entries: {
    title: "Смены наблюдателей",
    hint: "Наблюдатель поставил, поправил или снял себе запись.",
  },
```

Вид отдельный, а не общий с `self_entries`, — записать это причиной в комментарии над массивом: админ, которому не нужны больничные всей команды, может при этом хотеть видеть график наблюдателя, и наоборот.

- [ ] **Step 4: Выбор вида в маршруте**

В `my-entries.ts` во всех трёх вызовах `notifyAdmins` вместо литерала `"self_entries"`:

```ts
    // Один и тот же поступок, но разные потоки: у наблюдателя это «человек
    // ведёт свой график», у работника — «работник выпал из смены».
    const noticeKind = me.isObserver ? "observer_entries" : "self_entries";
```

В `POST` для смены наблюдателя `riskLines` не считать: смена ничего не освобождает, и строка «а на этот день оставалось…» там означала бы неправду.

```ts
    const lines = entry.category === "shift" ? [] : riskLines(employeeId, entry);
```

- [ ] **Step 5: Прогнать**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add shared/src server/src
git commit -m "feat(уведомления): правки наблюдателя — отдельный выключаемый вид письма"
```

---

### Task 6: `/api/me` и личный тумблер

**Files:**
- Modify: `server/src/http/app.ts:329-352` (`GET /api/me`), `:353-390` (`PATCH /api/me/settings`)
- Modify: `server/src/repo/team-schedule.ts:48`
- Не трогать: `shared/src/api/read.ts:73` — там `excludedFromSwaps: z.boolean()`, тип поля не меняется, меняется только значение, которое кладёт сервер
- Test: `server/src/http/app.test.ts` (там уже живут проверки `/api/me`), `server/src/http/settings-route.test.ts` (там — `/api/me/settings`)

**Interfaces:**
- Consumes: `canSwap`, `canAnnounce`, `canAddOwnShifts`.
- Produces: `GET /api/me` дополнительно отдаёт `isObserver: boolean`, `selfScheduleEnabled: boolean`, `canAnnounce: boolean`; `excludedFromSwaps` становится **эффективным** (`!canSwap(me)`). `PATCH /api/me/settings` принимает `selfScheduleEnabled?: boolean`.

- [ ] **Step 1: Написать падающий тест**

```ts
it("наблюдателю /api/me говорит роль и что обмены ему закрыты", async () => {
  const db = makeTestDb();
  const me = observerWorker(db, 621, "Аня", false);
  const app = createApp({ db, config, bot: undefined });
  const token = await tokenFor(app, 621);

  const body = await (await app.request(new Request("http://x/api/me", { headers: { Authorization: `Bearer ${token}` } }))).json();

  expect(body.isObserver).toBe(true);
  expect(body.canAnnounce).toBe(true);
  expect(body.selfScheduleEnabled).toBe(false);
  // Галочка в базе снята — экран всё равно обязан погасить «Обменять».
  expect(getEmployeeById(db, me.id)!.excludedFromSwaps).toBe(false);
  expect(body.excludedFromSwaps).toBe(true);
});

it("тумблер своего графика ставит наблюдатель, работнику — 403", async () => {
  const db = makeTestDb();
  observerWorker(db, 622, "Игорь", false);
  worker(db, 623, "Марк");
  const app = createApp({ db, config, bot: undefined });

  const observerToken = await tokenFor(app, 622);
  const ok = await app.request(new Request("http://x/api/me/settings", authed(observerToken, { selfScheduleEnabled: true }, "PATCH")));
  expect(ok.status).toBe(200);

  const workerToken = await tokenFor(app, 623);
  const denied = await app.request(new Request("http://x/api/me/settings", authed(workerToken, { selfScheduleEnabled: true }, "PATCH")));
  expect(denied.status).toBe(403);
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `npx vitest run server/src/http/app.test.ts server/src/http/settings-route.test.ts`
Expected: FAIL — полей нет, `PATCH` отвечает «нечего сохранять».

- [ ] **Step 3: Реализовать**

В `GET /api/me`:

```ts
      isObserver: me.isObserver,
      selfScheduleEnabled: me.selfScheduleEnabled,
      canAnnounce: canAnnounce(me),
      /** Эффективное, а не то, что лежит в строке: единственный потребитель —
       *  гейт кнопки «Обменять», и ему нужен ответ «можно ли», а не «какую
       *  галочку поставил админ». Роль наблюдателя перекрывает галочку. */
      excludedFromSwaps: !canSwap(me),
```

В `PATCH /api/me/settings` — третье поле, тем же узором, что и два существующих:

```ts
    const hasSelfSchedule = body.selfScheduleEnabled !== undefined;
    if (hasSelfSchedule && typeof body.selfScheduleEnabled !== "boolean") {
      return c.json({ error: "selfScheduleEnabled должен быть true или false" }, 400);
    }
    if (hasSelfSchedule) {
      // Не 400: поле существует и понято — его просто некому применить.
      // Иначе тумблер стал бы способом обойти роль.
      if (!me.isObserver) return c.json({ error: "forbidden" }, 403);
      setSelfScheduleEnabled(db, me.id, body.selfScheduleEnabled as boolean);
    }
```

и добавить `hasSelfSchedule` в проверку «нечего сохранять».

В `server/src/repo/team-schedule.ts:48` — `excludedFromSwaps: !canSwap(employee)`, по той же причине: сетка гасит «Обменять» на чужой смене этим полем.

- [ ] **Step 4: Прогнать**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/src shared/src
git commit -m "feat(api): /api/me знает про роль, а «обмены закрыты» стало эффективным"
```

---

### Task 7: Рассылка — свой маршрут и свой гейт

**Files:**
- Modify: `server/src/http/middleware.ts` (добавить `requireAnnouncer`)
- Modify: `server/src/http/app.ts:707-741` (перенести маршрут), добавить `GET /api/announcements/recipients`
- Modify: `miniapp/src/api/client.ts:1193` (путь), добавить `getAnnouncementRecipients`
- Modify: `miniapp/src/api/mock.ts`
- Test: `server/src/http/announcements.test.ts` (существует — дописать туда), `server/src/http/admin-guard.test.ts` (сверить: он проверяет, что всё под `/api/admin/*` закрыто, и уехавший маршрут мог там упоминаться)

**Interfaces:**
- Consumes: `canAnnounce`.
- Produces:
  - `requireAnnouncer(db: Db, secret: string): MiddlewareHandler<Env>`
  - `POST /api/announcements` — тело и ответ как у прежнего `/api/admin/announcements`.
  - `GET /api/announcements/recipients` → `{ recipients: { id: number; displayName: string; reachable: boolean }[] }` — активные, кроме самого отправителя.

- [ ] **Step 1: Написать падающий тест**

```ts
describe("POST /api/announcements", () => {
  it("наблюдатель рассылает, работник — нет", async () => {
    const db = makeTestDb();
    observerWorker(db, 631, "Аня", false);
    worker(db, 632, "Игорь");
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });

    const okRes = await app.request(new Request("http://x/api/announcements",
      authed(await tokenFor(app, 631), { text: "Завтра планёрка в 10", audience: "all" })));
    expect(okRes.status).toBe(200);
    expect(sent.map((m) => m.to)).toEqual([632]);

    const denied = await app.request(new Request("http://x/api/announcements",
      authed(await tokenFor(app, 632), { text: "И мне можно?", audience: "all" })));
    expect(denied.status).toBe(403);
    expect(sent).toHaveLength(1);
  });

  it("рассылка наблюдателя оставляет след в журнале", async () => {
    const db = makeTestDb();
    const me = observerWorker(db, 633, "Марк", false);
    worker(db, 634, "Даша");
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });

    await app.request(new Request("http://x/api/announcements",
      authed(await tokenFor(app, 633), { text: "Тест", audience: "all" })));

    const entry = listRecentAudit(db, 10).find((a) => a.type === "announcement_sent");
    expect(entry?.actorEmployeeId).toBe(me.id);
  });
});

describe("GET /api/announcements/recipients", () => {
  it("отдаёт имена без телефонов и токенов, и без самого отправителя", async () => {
    const db = makeTestDb();
    const me = observerWorker(db, 635, "Аня", false);
    const mate = worker(db, 636, "Игорь");
    const app = createApp({ db, config, bot: undefined });

    const body = await (await app.request(new Request("http://x/api/announcements/recipients",
      { headers: { Authorization: `Bearer ${await tokenFor(app, 635)}` } }))).json();

    expect(body.recipients).toEqual([{ id: mate.id, displayName: "Игорь", reachable: true }]);
    expect(body.recipients.map((r: { id: number }) => r.id)).not.toContain(me.id);
  });

  it("работнику список не показывают", async () => {
    const db = makeTestDb();
    worker(db, 637, "Марк");
    const app = createApp({ db, config, bot: undefined });
    const res = await app.request(new Request("http://x/api/announcements/recipients",
      { headers: { Authorization: `Bearer ${await tokenFor(app, 637)}` } }));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `npx vitest run server/src/http/announcements.test.ts`
Expected: FAIL — 404 на обоих путях.

- [ ] **Step 3: Мидлвар**

В `server/src/http/middleware.ts`, рядом с `requireAdmin`:

```ts
/**
 * Кто может разослать объявление: админ или наблюдатель.
 *
 * Отдельный мидлвар, а не флаг у `requireAdmin`: над всем `/api/admin/*` висит
 * сплошной `requireAdmin` как защита от роута, забывшего свой гейт, и снимать
 * её нельзя. Поэтому рассылка живёт вне этого префикса — и ей нужен свой
 * привратник. Роль читается из строки БД, а не из токена: снятая админом, она
 * должна переставать действовать сразу, а не когда истечёт токен.
 */
export function requireAnnouncer(db: Db, secret: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const token = bearer(c.req.header("Authorization"));
    if (!token) return c.json({ error: "unauthorized" }, 401);
    let claims: AuthClaims;
    try {
      claims = await verifyToken(token, secret);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    const employee = getEmployeeById(db, claims.employeeId);
    if (!employee?.isActive) return c.json({ error: "unauthorized" }, 401);
    if (!canAnnounce(employee)) return c.json({ error: "forbidden" }, 403);
    c.set("auth", { employeeId: employee.id, isAdmin: employee.isAdmin });
    await next();
  };
}
```

- [ ] **Step 4: Переезд маршрута и новый список**

В `server/src/http/app.ts` заменить `app.post("/api/admin/announcements", requireAdmin(...)` на `app.post("/api/announcements", requireAnnouncer(db, config.jwtSecret)` — тело обработчика не трогать. Старый путь не оставлять: клиент в репозитории один, а мёртвый алиас пришлось бы гейтить вторым правилом.

Рядом:

```ts
  /**
   * Кому уйдёт объявление — глазами того, кто его пишет.
   *
   * Узкий список вместо админского `GET /api/admin/employees`: наблюдателю
   * незачем видеть телефоны и инвайт-токены, а экрану нужны ровно имя и
   * «дойдёт ли». Заодно это снимает копию правила достижимости, которую
   * экран «Анонс» считал у себя: теперь и список, и отправка отвечают на
   * вопрос одним и тем же кодом — `announcementRecipients`.
   */
  app.get("/api/announcements/recipients", requireAnnouncer(db, config.jwtSecret), (c) => {
    const senderId = c.get("auth").employeeId;
    const { reachable, unreachable } = announcementRecipients(db, { kind: "all" }, senderId);
    const recipients = [
      ...reachable.map((e) => ({ id: e.id, displayName: e.displayName, reachable: true })),
      ...listActive(db)
        .filter((e) => e.id !== senderId && unreachable.includes(e.displayName))
        .map((e) => ({ id: e.id, displayName: e.displayName, reachable: false })),
    ].sort((a, b) => a.id - b.id);
    return c.json({ recipients });
  });
```

- [ ] **Step 5: Клиент мини-аппа**

В `miniapp/src/api/client.ts` поправить путь на `/api/announcements`, добавить в интерфейс клиента `getAnnouncementRecipients(): Promise<{ id: number; displayName: string; reachable: boolean }[]>` и его реализацию через `authorizedGetJson`. Обновить `miniapp/src/api/mock.ts` тем же контрактом.

- [ ] **Step 6: Прогнать**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add server/src miniapp/src
git commit -m "feat(анонсы): свой маршрут с гейтом canAnnounce и узкий список адресатов"
```

---

### Task 8: Админ назначает наблюдателя

**Files:**
- Modify: `server/src/http/routes/employees.ts:60-75` (DTO), `:125-235` (`PATCH`)
- Modify: `shared/src/api/employees.ts:33-46` — `adminEmployeeSchema` объявлена `.strict()`, поэтому новые поля обязаны быть добавлены и в неё, иначе контрактный тест отвергнет ответ
- Modify: `miniapp/src/api/client.ts:97,122` (тип `Employee`), `miniapp/src/api/mock.ts`
- Modify: `miniapp/src/screens/admin/AdminEmployeesScreen.tsx:430-465`
- Test: `server/src/http/employees.test.ts`

**Interfaces:**
- Consumes: `setEmployeeObserver` из Task 1.
- Produces: DTO работника получает `isObserver: boolean` и `selfScheduleEnabled: boolean`; `PATCH /api/admin/employees/:id` принимает `isObserver?: boolean`.

- [ ] **Step 1: Написать падающий тест**

```ts
it("админ включает и снимает роль наблюдателя", async () => {
  const db = makeTestDb();
  const boss = worker(db, 641, "Аня");
  setEmployeeAdmin(db, boss.id, true);
  const target = worker(db, 642, "Игорь");
  const app = createApp({ db, config, bot: undefined });
  const token = await tokenFor(app, 641);

  const on = await app.request(new Request(`http://x/api/admin/employees/${target.id}`,
    authed(token, { isObserver: true }, "PATCH")));
  expect(on.status).toBe(200);
  expect(getEmployeeById(db, target.id)!.isObserver).toBe(true);

  await app.request(new Request(`http://x/api/admin/employees/${target.id}`,
    authed(token, { isObserver: false }, "PATCH")));
  expect(getEmployeeById(db, target.id)!.isObserver).toBe(false);
});

it("работник роль себе выдать не может", async () => {
  const db = makeTestDb();
  const me = worker(db, 643, "Марк");
  const app = createApp({ db, config, bot: undefined });
  const res = await app.request(new Request(`http://x/api/admin/employees/${me.id}`,
    authed(await tokenFor(app, 643), { isObserver: true }, "PATCH")));
  expect(res.status).toBe(403);
  expect(getEmployeeById(db, me.id)!.isObserver).toBe(false);
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `npx vitest run server/src/http/employees.test.ts`
Expected: FAIL — поле игнорируется, роль не меняется.

- [ ] **Step 3: Реализовать в маршруте**

В DTO работника (`employees.ts:60-75`) добавить `isObserver: employee.isObserver` и `selfScheduleEnabled: employee.selfScheduleEnabled`, зеркально поправить `shared/src/api/employees.ts`.

В `PATCH` — по узору соседних полей: `hasObserver`, проверка `typeof … !== "boolean"` с русским текстом ошибки, вызов `setEmployeeObserver` внутри той же транзакции, что и остальные правки, и запись в аудит рядом с `restrictionsChanged`.

- [ ] **Step 4: Карточка в админке**

В `AdminEmployeesScreen.tsx` — переключатель «Наблюдатель» над двумя существующими галочками, с подписью «Смотрит график, ведёт свой, шлёт анонсы. Вне раздачи, обменов и передачи смен.»

Галочки «вне назначений» и «вне обменов» у наблюдателя — `disabled` с подписью «управляется ролью». Значение показывать то, что лежит в базе (`employee.excludedFromAssignment`), а не эффективное: админ должен видеть, куда человек вернётся, когда роль снимут.

- [ ] **Step 5: Прогнать**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add server/src shared/src miniapp/src
git commit -m "feat(админка): переключатель «Наблюдатель» в карточке работника"
```

---

### Task 9: Мини-апп глазами наблюдателя

**Files:**
- Modify: `miniapp/src/App.tsx:116-123,380-435`
- Modify: `miniapp/src/components/TabBar.tsx:9-35`
- Modify: `miniapp/src/screens/SelfEntryScreen.tsx`
- Modify: `miniapp/src/components/RemindersSwitch.tsx` или экран настроек — место тумблера
- Modify: `miniapp/src/screens/admin/AdminAnnounce.tsx:23-50` (перевести на `getAnnouncementRecipients`)
- Test: `miniapp/src/screens/observer-view.test.tsx` (создать)

**Interfaces:**
- Consumes: поля `/api/me` из Task 6, `getAnnouncementRecipients` из Task 7.
- Produces: вкладка «Анонс» для наблюдателя; форма «Поставить себе смену»; тумблер «Веду свой график сам».

- [ ] **Step 1: Написать падающий тест**

Мини-апп тестируется без testing-library: `react-dom/client` + `act`, узор — в
`miniapp/src/screens/worker-action-error.test.tsx`. Оттуда берутся `mount()`,
`settle()` и поиск вкладки по тексту внутри `.tab-bar-fit`; `App` грузится одним
`apiClient.getBootstrap`, его и подменяем.

```tsx
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";
import { App } from "../App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Тот же ответ, что отдаёт `/api/bootstrap`, с подменённым «кто я». */
function bootstrapAs(me: Partial<{ isObserver: boolean; canAnnounce: boolean; selfScheduleEnabled: boolean }>) {
  return {
    me: {
      id: 1, displayName: "Аня", address: "Аня", preferredName: null,
      isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
      isObserver: false, selfScheduleEnabled: false, canAnnounce: false, ...me,
    },
    myShifts: { shifts: [], today: "2026-08-20" },
    teamSchedule: { shifts: [], employees: [] },
    templates: [], swaps: [], weekendSlots: [], weekendOffers: [],
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

async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

async function mountAs(me: Parameters<typeof bootstrapAs>[0]) {
  vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapAs(me) as never);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(App))); });
  await settle();
  return host;
}

/** Вкладка нижней панели: telegram-ui рисует `Tabbar.Item` не кнопкой. */
function hasTab(el: HTMLElement, label: string): boolean {
  return [...el.querySelectorAll(".tab-bar-fit *")].some((n) => (n.textContent ?? "").trim() === label);
}

describe("мини-апп глазами наблюдателя", () => {
  it("вкладок обменов и выходных нет, вкладка анонса есть", async () => {
    const el = await mountAs({ isObserver: true, canAnnounce: true });
    expect(hasTab(el, "Анонс")).toBe(true);
    expect(hasTab(el, "Обмены")).toBe(false);
    expect(hasTab(el, "Выходные")).toBe(false);
  });

  it("у обычного работника всё наоборот — правило про роль, а не про то, что вкладки исчезли у всех", async () => {
    const el = await mountAs({});
    expect(hasTab(el, "Анонс")).toBe(false);
    expect(hasTab(el, "Обмены")).toBe(true);
    expect(hasTab(el, "Выходные")).toBe(true);
  });

  // Обе проверки — на вкладке «Смены», которая открыта по умолчанию: иначе
  // «текста нет» означало бы «мы на другой вкладке», и тест не смог бы упасть.
  it("с выключенным тумблером кнопки своей смены нет", async () => {
    const el = await mountAs({ isObserver: true, selfScheduleEnabled: false });
    expect(el.textContent ?? "").not.toContain("Поставить себе смену");
  });

  it("с включённым — кнопка есть", async () => {
    const el = await mountAs({ isObserver: true, selfScheduleEnabled: true });
    expect(el.textContent ?? "").toContain("Поставить себе смену");
  });
});
```

Подписи вкладок в `TabBar.tsx` на сегодня — «Смены», «Команда», «Обмены», «Выходные», «Админ»; тест ищет по точному тексту, и разошедшаяся подпись даст ложно-зелёный `false`. Вкладка наблюдателя добавляет шестой ключ в `TabKey` — `"announce"`.



- [ ] **Step 2: Убедиться, что падает**

Run: `npx vitest run miniapp/src/screens/observer-view.test.tsx`
Expected: FAIL — вкладки и формы нет.

- [ ] **Step 3: Вкладки**

`TabBar` получает `canAnnounce: boolean` и `isObserver: boolean` рядом с `isAdmin`; в `TabKey` добавляется `"announce"`. Вкладки «Обмены» и «Выходные» не попадают в массив `items` при `isObserver`, вкладка «Анонс» попадает при `canAnnounce && !isAdmin` — у админа она уже внутри админки, и вторая копия сбивала бы. Массив собирается через `push`, а не через `&&` внутри JSX: `Tabbar` типизирует детей как массив элементов и отвергает `false`, который оставило бы короткое замыкание (причина записана в самом файле).

В `App.tsx` поправку `useEffect` на `?screen=announce` расширить: наблюдателя не сбрасывать на «mine» — у него эта вкладка законная.

- [ ] **Step 4: Форма своей смены**

`SelfEntryScreen` получает третий вид записи «Смена»: дата, начало, конец, место. Показывается только при `me.selfScheduleEnabled`. Отправка — `apiClient.createMyEntry({ category: "shift", … })`, ошибку сервера показывать текстом как есть: она уже по-русски.

- [ ] **Step 5: Тумблер**

Рядом с переключателем напоминаний — «Веду свой график сам», виден только наблюдателю, шлёт `PATCH /api/me/settings { selfScheduleEnabled }`.

- [ ] **Step 6: `AdminAnnounce` на новый список**

Заменить `Promise.all([getMe(), getAdminEmployees()])` на один `getAnnouncementRecipients()`. Фильтры `e.isActive && e.id !== viewerId` и `telegramUserId != null` уходят: сервер уже ответил ровно на этот вопрос. Комментарий у экрана поправить — он сейчас объясняет, почему список считается на клиенте.

- [ ] **Step 7: Прогнать**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
git add miniapp/src
git commit -m "feat(мини-апп): экран наблюдателя — анонс, свой график, без обменов и выходных"
```

---

### Task 10: Бот

**Files:**
- Modify: `server/src/bot/bot.ts:171-180,440-455`
- Modify: `server/src/bot/keyboard.ts:28-55`
- Test: `server/src/bot/mini-app-keyboard.test.ts` (кнопка «📣 Анонс»), `server/src/bot/keyboard.test.ts` (обычная клавиатура)

**Interfaces:**
- Consumes: `canAnnounce` из Task 2.
- Produces: `mainKeyboard(opts: { isAdmin: boolean; isObserver: boolean })`, `miniAppKeyboard(publicUrl, opts: { isAdmin: boolean; canAnnounce: boolean })`.

- [ ] **Step 1: Написать падающий тест**

```ts
it("наблюдателю бот показывает анонс и не показывает обмены", () => {
  const kb = miniAppKeyboard("https://x", { isAdmin: false, canAnnounce: true });
  expect(JSON.stringify(kb)).toContain("Анонс");
});

it("обычному работнику кнопки анонса нет", () => {
  const kb = miniAppKeyboard("https://x", { isAdmin: false, canAnnounce: false });
  expect(JSON.stringify(kb)).not.toContain("Анонс");
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `npx vitest run server/src/bot/`
Expected: FAIL — параметра нет, кнопка привязана к `isAdmin`.

- [ ] **Step 3: Реализовать**

`bot.ts:177` — `if (opts.canAnnounce) kb.row().webApp("📣 Анонс", …)`. В месте вызова (`:450`) считать `canAnnounce(who.me) || actsAsAdmin(who.me, from.id)`: аллоулист `ADMIN_TELEGRAM_IDS` даёт права до того, как строка в базе о них узнает, и потерять это здесь нельзя.

`keyboard.ts:50` — `mainKeyboard` перестаёт показывать наблюдателю кнопки обменов и выходных.

- [ ] **Step 4: Прогнать полный гейт**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS — все три команды с показанным выводом.

- [ ] **Step 5: Коммит**

```bash
git add server/src
git commit -m "feat(бот): клавиатура наблюдателя — анонс есть, обменов нет"
```

---

## Проверка перед сдачей

- [ ] `npm test` — зелёный, число тестов выросло относительно 1791.
- [ ] `npm run typecheck` — все воркспейсы.
- [ ] `npm run lint`.
- [ ] Ручная проверка постусловия на копии базы: `sqlite3 .backup` (не `cp` — база в WAL), прогнать миграцию, убедиться, что у всех существующих строк `is_observer = 0` и `self_schedule_enabled = 0`, и что права никого не изменились.
- [ ] `docs/audit/ledger.md` — если по пути всплыла находка про поведение, она уходит туда, а не чинится заодно.
