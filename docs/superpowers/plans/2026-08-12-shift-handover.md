# Передача смены и эскалация — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Работник ставит себе больничный — его смена предлагается конкретному коллеге, через три часа молчания уходит веером всей свободной команде, а за 12 часов до начала, если её так и не взяли, админам приходит письмо.

**Architecture:** Лестница «кому и когда» — чистая функция в `shared`, её зовёт только тик. Своя таблица `handovers` плюс `handover_declines`; перевод «взял» идёт одной синхронной транзакцией **до** первой отправки письма, потому что гонка в этом репозитории уже дважды спамила всю команду. Тик встаёт третьим в `runTicksIndependently`, рядом с напоминаниями и днями рождения.

**Tech Stack:** TypeScript, zod, Hono, drizzle + better-sqlite3, grammy, React + @telegram-apps/telegram-ui, vitest.

**Спека:** `docs/superpowers/specs/2026-08-12-shift-handover-design.md`

## Global Constraints

- **Слои:** `shared/`, `server/` — слой 1, **TDD обязателен** (сначала падающий тест). `miniapp/` — слой 2: логика тестами, вёрстка нет.
- **Ветка:** `feature/shift-handover`. Уже создана, спека в неё закоммичена.
- **Текст, который читает человек, — по-русски.** Английский только в именах кода.
- **Комментарии в `server/src/**` — по-английски**, и в коде, и в тестах; русские доменные термины в «ёлочках» внутри английской фразы. В `shared/` и в `miniapp/` комментарии русские — действующая конвенция. Ревьюеры трижды ловили русские комментарии именно в ТЕСТОВЫХ файлах: самопроверка грепает реализацию и забывает тест рядом.
- **Идентификаторы только латиницей.** В репозитории нет ни одного кириллического имени переменной.
- **Настоящих ФИО быть не может** — репозиторий публичный. Имена в тестах: «Аня», «Игорь», «Марк». Сторож: `server/src/db/no-real-names.test.ts`.
- **Дата — командная:** `teamNow(config.teamTz)`, никогда `new Date()`.
- **Барьер `shared/src/index.ts`.** Новый файл в `shared` обязан попасть в barrel-реэкспорт. Typecheck этого НЕ ловит — файл компилируется, просто не реэкспортируется, и падает рантайм чужого теста. Стоило захода 2.
- **Гейт после каждой задачи:**
  ```bash
  npm test
  npm run typecheck
  npm run lint
  ```
  Ничего не готово без прогнанной команды с показанным выводом.
- **Коммиты по-русски**, в стиле истории: `feat(...)`, `refactor(...)`, `test(...)`, `docs(...)`.

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `shared/src/handover.ts` (**создать**) | Лестница: что должно случиться с передачей в этот момент. Чистое, без базы |
| `shared/src/audit.ts` (**править**) | Шесть новых типов события и их описатели |
| `server/src/db/schema.ts` (**править**) | Таблицы `handovers`, `handover_declines` |
| `server/drizzle/00NN_*.sql` (**сгенерировать**) | Миграция |
| `server/src/repo/handovers.ts` (**создать**) | Чтение и запись обеих таблиц. Ни писем, ни правил |
| `server/src/handover/candidates.ts` (**создать**) | Кому можно предложить и в каком порядке |
| `server/src/handover/handover-notice.ts` (**создать**) | Пять текстов писем |
| `server/src/handover/handover-service.ts` (**создать**) | Предложить / отказать / взять / погасить. Транзакция и гонка |
| `server/src/handover/handover-tick.ts` (**создать**) | Прогон лестницы по всем живым передачам |
| `server/src/bot/notify.ts` (**править**) | Две отправки с кнопками |
| `server/src/bot/bot.ts` (**править**) | Обработчики `handover:take` и `handover:decline` |
| `server/src/config.ts` (**править**) | Два порога |
| `server/src/index.ts` (**править**) | Тик третьим в `runTicksIndependently` |
| `server/src/http/routes/my-entries.ts` (**править**) | Рождение передач при больничном, гашение при снятии |
| `server/src/http/routes/my-handovers.ts` (**создать**) | Кому предложить / пропустить |
| `miniapp/src/screens/SelfEntryScreen.tsx` (**править**) | Второй шаг формы |

Порядок задач продиктован зависимостями: правило и таблицы нужны репозиторию, репозиторий — сервису, сервис — тику и кнопкам, и только потом мини-апп. Кнопка, ведущая в несуществующий сервис, — та же ложь, что кнопка в ненаписанный экран.

---

### Task 1: Лестница — что должно случиться с передачей

**Files:**
- Create: `shared/src/handover.ts`, `shared/src/handover.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces:
  - `export type HandoverStatus = "offered" | "fanned" | "taken" | "cancelled" | "expired"`
  - `export type HandoverAction = "fan" | "escalate" | "expire"`
  - `export interface HandoverThresholds { fanAfterHours: number; escalateBeforeHours: number }`
  - `export interface HandoverState { status: HandoverStatus; offeredAt: number; escalatedAt: number | null; shiftStartsAt: number }` — все моменты в epoch-миллисекундах
  - `export function handoverActions(state: HandoverState, nowMs: number, t: HandoverThresholds): HandoverAction[]`
  - `export function shiftStartMs(entry: { date: string; start: string | null }, teamTz: string): number`

- [ ] **Step 1: Написать падающий тест**

Создать `shared/src/handover.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { handoverActions, shiftStartMs, type HandoverState } from "./handover";

const T = { fanAfterHours: 3, escalateBeforeHours: 12 };
const HOUR = 60 * 60 * 1000;

/** Момент «сейчас» фиксирован — лестница обязана быть функцией, а не поведением часов. */
const NOW = Date.UTC(2026, 7, 12, 9, 0); // 12 авг, 09:00 UTC

function state(patch: Partial<HandoverState> = {}): HandoverState {
  return {
    status: "offered",
    offeredAt: NOW - HOUR,
    escalatedAt: null,
    shiftStartsAt: NOW + 48 * HOUR,
    ...patch,
  };
}

describe("лестница передачи", () => {
  it("молчание 2:59 не даёт веера, 3:01 даёт", () => {
    expect(handoverActions(state({ offeredAt: NOW - (3 * HOUR - 60_000) }), NOW, T)).toEqual([]);
    expect(handoverActions(state({ offeredAt: NOW - (3 * HOUR + 60_000) }), NOW, T)).toEqual(["fan"]);
  });

  it("до смены остались те же три часа — веер, даже если молчали минуту", () => {
    const s = state({ offeredAt: NOW - 60_000, shiftStartsAt: NOW + 2 * HOUR });
    expect(handoverActions(s, NOW, T)).toContain("fan");
  });

  it("веер уже разослан — второй раз не рассылаем", () => {
    expect(handoverActions(state({ status: "fanned", offeredAt: NOW - 10 * HOUR }), NOW, T)).toEqual([]);
  });

  it("до смены 11:59 — эскалация; с отметкой — молчим", () => {
    const near = { status: "fanned" as const, offeredAt: NOW - 10 * HOUR, shiftStartsAt: NOW + 11 * HOUR };
    expect(handoverActions({ ...near, escalatedAt: null }, NOW, T)).toEqual(["escalate"]);
    expect(handoverActions({ ...near, escalatedAt: NOW - HOUR }, NOW, T)).toEqual([]);
  });

  it("оба действия сразу, и веер идёт первым", () => {
    // Предложено два часа назад, до смены два часа: просрочено и молчание, и
    // окно эскалации. Одно действие за тик отложило бы второе на пять минут —
    // там, где времени и так осталось два часа.
    const s = state({ offeredAt: NOW - 2 * HOUR, shiftStartsAt: NOW + 2 * HOUR });
    expect(handoverActions(s, NOW, T)).toEqual(["fan", "escalate"]);
  });

  it("смена началась — только expire, чем бы всё ни было до того", () => {
    for (const status of ["offered", "fanned"] as const) {
      expect(handoverActions(state({ status, shiftStartsAt: NOW - 60_000 }), NOW, T)).toEqual(["expire"]);
    }
  });

  it("решённой передаче лестница ничего не делает", () => {
    for (const status of ["taken", "cancelled", "expired"] as const) {
      expect(handoverActions(state({ status, shiftStartsAt: NOW - 10 * HOUR }), NOW, T)).toEqual([]);
    }
  });
});

describe("начало смены", () => {
  it("считается по дате И времени, а не по дате", () => {
    const night = shiftStartMs({ date: "2026-08-12", start: "23:00" }, "Europe/Moscow");
    const morning = shiftStartMs({ date: "2026-08-12", start: "09:00" }, "Europe/Moscow");
    expect(night - morning).toBe(14 * HOUR);
  });

  it("у записи без времени начало — полночь того дня", () => {
    const allDay = shiftStartMs({ date: "2026-08-12", start: null }, "Europe/Moscow");
    const morning = shiftStartMs({ date: "2026-08-12", start: "09:00" }, "Europe/Moscow");
    expect(morning - allDay).toBe(9 * HOUR);
  });

  it("часовой пояс команды, а не машины", () => {
    // Москва — UTC+3 круглый год. 09:00 по команде это 06:00 UTC.
    expect(shiftStartMs({ date: "2026-08-12", start: "09:00" }, "Europe/Moscow")).toBe(Date.UTC(2026, 7, 12, 6, 0));
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run shared/src/handover.test.ts`
Expected: FAIL — `Failed to resolve import "./handover"`.

- [ ] **Step 3: Реализация**

Создать `shared/src/handover.ts`:

```ts
import { zonedOffsetMs } from "./time";

export type HandoverStatus = "offered" | "fanned" | "taken" | "cancelled" | "expired";

/** Что тик обязан сделать с передачей прямо сейчас. */
export type HandoverAction = "fan" | "escalate" | "expire";

export interface HandoverThresholds {
  /** Сколько часов ждём молчания адресата, прежде чем звать всех. */
  fanAfterHours: number;
  /** За сколько часов до начала смены зовём админов. */
  escalateBeforeHours: number;
}

export interface HandoverState {
  status: HandoverStatus;
  offeredAt: number;
  escalatedAt: number | null;
  shiftStartsAt: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Лестница целиком: статус, два порога и три отметки времени — на выходе список
 * действий.
 *
 * Список, а не одно действие, и это не запас на будущее. Передача, предложенная
 * за два часа до смены и провисевшая два часа, одновременно просрочила молчание
 * и вошла в окно эскалации. Функция с одним ответом отложила бы второе действие
 * до следующего тика, то есть на пять минут — там, где времени осталось два часа.
 *
 * Порядок фиксирован: `fan` перед `escalate`, чтобы письмо админам называло уже
 * разосланный веер, а не собиралось его разослать.
 */
export function handoverActions(state: HandoverState, nowMs: number, t: HandoverThresholds): HandoverAction[] {
  // Решённая передача не оживает ничем: взятая, погашенная и просроченная —
  // конечные состояния, и тик обязан пройти мимо них молча.
  if (state.status !== "offered" && state.status !== "fanned") return [];

  // Смена началась — дальше лестницы нет. Проверяется первым: и веер, и письмо
  // админам о смене, которая уже идёт, — это шум про то, чего не изменить.
  if (nowMs >= state.shiftStartsAt) return ["expire"];

  const actions: HandoverAction[] = [];

  const silentTooLong = nowMs - state.offeredAt >= t.fanAfterHours * HOUR_MS;
  const shiftTooClose = state.shiftStartsAt - nowMs <= t.fanAfterHours * HOUR_MS;
  if (state.status === "offered" && (silentTooLong || shiftTooClose)) actions.push("fan");

  if (state.escalatedAt == null && state.shiftStartsAt - nowMs <= t.escalateBeforeHours * HOUR_MS) {
    actions.push("escalate");
  }

  return actions;
}

/**
 * Момент начала смены в миллисекундах.
 *
 * По дате И времени, а не по дате: ночная смена в 23:00 обязана эскалироваться в
 * 11:00 того же дня, а не в полночь. У записи без времени (отсутствие, «весь
 * день») начало — полночь: иначе «весь день» пришлось бы либо считать
 * начавшимся, либо не считать вовсе.
 *
 * Пояс — командный, как и везде в этом проекте: граница дня не должна зависеть
 * от того, где физически находится машина.
 */
export function shiftStartMs(entry: { date: string; start: string | null }, teamTz: string): number {
  const [y, m, d] = entry.date.split("-").map(Number);
  const [hh, mm] = (entry.start ?? "00:00").split(":").map(Number);
  const asUtc = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  return asUtc - zonedOffsetMs(asUtc, teamTz);
}
```

**Если `zonedOffsetMs` в `shared/src/time.ts` нет** — посмотреть, как `teamNow` (`server/src/util/team-time.ts`) получает смещение пояса, и вынести ту же механику в `shared/src/time.ts` под этим именем, с тестом на «Europe/Moscow даёт +3 часа». Второй способ считать пояс в проекте заводить нельзя.

- [ ] **Step 4: Добавить в barrel**

В `shared/src/index.ts` дописать: `export * from "./handover";`

**Не пропустить.** Typecheck этого не ловит, падает рантайм чужого теста.

- [ ] **Step 5: Прогнать**

Run: `npx vitest run shared/src/handover.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 6: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add shared/src/handover.ts shared/src/handover.test.ts shared/src/index.ts
git commit -m "feat(правила): лестница передачи смены

Статус, два порога и три отметки времени на входе — список действий на выходе.
Список, а не одно действие: передача, предложенная за два часа до смены и
провисевшая два часа, просрочила и молчание, и окно эскалации, а функция с
одним ответом отложила бы второе на пять минут там, где времени и так два часа.

Начало смены считается по дате И времени: ночная смена в 23:00 эскалируется в
11:00 того же дня, а не в полночь."
```

---

### Task 2: Таблицы и миграция

**Files:**
- Modify: `server/src/db/schema.ts`
- Create: `server/drizzle/00NN_*.sql` (генерируется)
- Create: `server/src/db/handover-schema.test.ts`

**Interfaces:**
- Produces: таблицы `handovers` и `handover_declines`; типы `Handover`, `NewHandover` из `schema.ts`.

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/db/handover-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "./test-db";
import { handovers, handoverDeclines } from "./schema";

describe("handover tables", () => {
  it("keeps a handover after its shift is gone", () => {
    // `shiftId` is nullable on purpose: the row has to outlive the entry it
    // pointed at, exactly like `swap_requests.fromShiftId`. History stays history.
    const db = makeTestDb();
    const row = db.insert(handovers).values({
      shiftId: null, fromEmployeeId: 1, sickEntryId: null,
      status: "expired", offeredAt: new Date(), offeredToEmployeeId: null,
    }).returning().get();
    expect(row.shiftId).toBeNull();
  });

  it("refuses the same person declining one handover twice", () => {
    const db = makeTestDb();
    const h = db.insert(handovers).values({
      shiftId: null, fromEmployeeId: 1, status: "fanned", offeredAt: new Date(),
    }).returning().get();
    db.insert(handoverDeclines).values({ handoverId: h.id, employeeId: 2 }).run();
    expect(() => db.insert(handoverDeclines).values({ handoverId: h.id, employeeId: 2 }).run()).toThrow();
  });
});
```

Форму `makeTestDb` взять из соседнего теста в `server/src/db/` — она там уже есть; если импорт называется иначе, использовать местное имя, а не заводить второй хелпер.

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run server/src/db/handover-schema.test.ts`
Expected: FAIL — `handovers` не экспортируется из `schema.ts`.

- [ ] **Step 3: Реализация схемы**

В `server/src/db/schema.ts` рядом с `swapRequests`:

```ts
export const handovers = sqliteTable("handovers", {
  id: integer().primaryKey({ autoIncrement: true }),
  /**
   * Nullable for the same reason as `swap_requests.fromShiftId`: the row must
   * outlive the entry it points at. A handover whose shift was deleted is still
   * a thing that happened, and the journal row written beside it carries the
   * date and time.
   */
  shiftId: integer().references(() => shifts.id),
  fromEmployeeId: integer().notNull().references(() => employees.id),
  /**
   * The «больничный» that spawned this. Nullable — the sick leave can be removed
   * while the handover stays as history. Live rows are matched by it when the
   * sick leave is cancelled or shortened.
   */
  sickEntryId: integer().references(() => shifts.id),
  status: text().$type<HandoverStatus>().notNull().default("offered"),
  /** Null means «веер»: the offer is open to everyone free. */
  offeredToEmployeeId: integer().references(() => employees.id),
  offeredAt: createdAt(),
  /**
   * When the admins were told. NOT a status: escalation does not replace the
   * stage, it is added to it — the fan-out stays open, and somebody can still
   * take the shift an hour before it starts. Without this mark the tick would
   * write to the admins every five minutes.
   */
  escalatedAt: integer({ mode: "timestamp" }),
  takenByEmployeeId: integer().references(() => employees.id),
  resolvedAt: integer({ mode: "timestamp" }),
});

export const handoverDeclines = sqliteTable(
  "handover_declines",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    handoverId: integer().notNull().references(() => handovers.id),
    employeeId: integer().notNull().references(() => employees.id),
    declinedAt: createdAt(),
  },
  // A separate table rather than a field on `handovers`, because the refusals do
  // two jobs: the fan-out must not write to them again, and the escalation letter
  // names them one by one. A comma-joined text column would have to be parsed
  // back, and the first test about «кому не писать» would read a string instead
  // of rows.
  (t) => [uniqueIndex("handover_decline_unique").on(t.handoverId, t.employeeId)],
);

export type Handover = typeof handovers.$inferSelect;
export type NewHandover = typeof handovers.$inferInsert;
```

`HandoverStatus` импортировать из `@planer/shared` — тем же способом, каким `shifts.category` берёт `EntryCategory`.

- [ ] **Step 4: Сгенерировать миграцию**

Run: `npx drizzle-kit generate`
Expected: новый файл в `server/drizzle/`, содержащий два `CREATE TABLE` и один `CREATE UNIQUE INDEX`, и **ни одного `DROP`**. Прочитать его глазами: миграция, которая пересобирает существующую таблицу, в этой работе не нужна — если она там появилась, остановиться и разобраться.

- [ ] **Step 5: Прогнать**

Run: `npx vitest run server/src/db/handover-schema.test.ts`
Expected: PASS, 2 теста.

- [ ] **Step 6: Постусловие на копии живой базы**

```bash
sqlite3 data/planer.db ".backup /tmp/handover-precheck.db"
sqlite3 /tmp/handover-precheck.db "select count(*) from employees where is_active=1; select count(*) from shifts;"
DATABASE_URL=/tmp/handover-precheck.db ./node_modules/.bin/tsx -e "import {openDb,runMigrations} from './server/src/db/client.ts'; const {db,sqlite}=openDb(process.env.DATABASE_URL!); runMigrations(db,sqlite);"
sqlite3 /tmp/handover-precheck.db "select count(*) from handovers; select count(*) from handover_declines; select count(*) from employees where is_active=1; select count(*) from shifts;"
```

Expected: обе новые таблицы существуют и содержат **0** строк; число работников и записей **совпадает** с тем, что было до миграции. Это и есть доказательство вместо теста — слой 3 в чистом виде.

- [ ] **Step 7: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add server/src/db/schema.ts server/drizzle server/src/db/handover-schema.test.ts
git commit -m "feat(база): таблицы передачи смены

handovers плюс handover_declines. Ссылка на смену обнуляемая — строка обязана
пережить удаление записи, ровно как в swap_requests: история остаётся историей.

Отказы отдельной таблицей, а не полем: они делают два дела — веер им больше не
пишет, и письмо админам называет их поимённо. Список в текстовом поле пришлось
бы разбирать обратно.

escalatedAt — отметка, а не статус: эскалация не сменяет стадию, а добавляется
к ней, веер после письма админам остаётся открытым.

Постусловие проверено на копии живой базы: обе таблицы созданы и пусты, число
работников и записей не изменилось."
```

---

### Task 3: Шесть типов события в журнале

**Files:**
- Modify: `shared/src/audit.ts`, `shared/src/audit.test.ts`

**Interfaces:**
- Produces: `handover_offered`, `handover_declined`, `handover_fanned`, `handover_taken`, `handover_escalated`, `handover_cancelled` в `AuditType` и их описатели.

- [ ] **Step 1: Написать падающий тест**

Дописать в `shared/src/audit.test.ts`:

```ts
describe("передача смены в журнале", () => {
  const payload = {
    handoverId: 3, shiftId: 7, shiftLine: "Ср 12 авг · 09:00–18:00 · День",
    fromEmployeeId: 1, fromName: "Аня",
    toEmployeeId: 2, toName: "Игорь",
  };

  it("называет обе стороны и смену", () => {
    const view = describeAuditEvent("handover_offered", payload);
    expect(view.lines.join(" ")).toContain("Аня");
    expect(view.lines.join(" ")).toContain("Игорь");
    expect(view.lines.join(" ")).toContain("09:00–18:00");
  });

  it("веер адресата не называет — его нет", () => {
    const view = describeAuditEvent("handover_fanned", { ...payload, toEmployeeId: null, toName: null });
    expect(view.lines.join(" ")).toContain("Аня");
    expect(view.lines.join(" ")).not.toContain("Игорь");
  });

  it("взятие и эскалация читаются по-разному", () => {
    expect(describeAuditEvent("handover_taken", payload).title).not.toBe(
      describeAuditEvent("handover_escalated", payload).title,
    );
  });

  it("все шесть типов описаны, а не падают на неизвестном", () => {
    for (const type of ["handover_offered", "handover_declined", "handover_fanned", "handover_taken", "handover_escalated", "handover_cancelled"] as const) {
      expect(describeAuditEvent(type, payload).lines.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run shared/src/audit.test.ts`
Expected: FAIL — типов нет в `AuditType`, TypeScript ругается до прогона.

- [ ] **Step 3: Реализация**

В `shared/src/audit.ts` дописать шесть строк в `AUDIT_TYPES` рядом с `swap_*`, и в таблицу `DESCRIBERS`:

```ts
/** Строки передачи: чья смена, какая и кому. Веер адресата не имеет — его и не пишем. */
function handoverView(p: Record<string, unknown>): string[] {
  const lines = [`${personLabel(p, "fromName", "fromEmployeeId")} · ${str(p.shiftLine) ?? "—"}`];
  const to = str(p.toName);
  if (to) lines.push(`кому: ${to}`);
  return lines;
}
```

```ts
  handover_offered: (p) => ({ icon: "🤝", title: "Смена предложена коллеге", lines: handoverView(p) }),
  handover_declined: (p) => ({ icon: "✖", title: "Коллега не может выйти", lines: handoverView(p) }),
  handover_fanned: (p) => ({ icon: "📣", title: "Смена предложена всем свободным", lines: handoverView(p) }),
  handover_taken: (p) => ({ icon: "✅", title: "Смену забрали", lines: handoverView(p) }),
  handover_escalated: (p) => ({ icon: "⚠️", title: "Смена без человека — нужно решение", lines: handoverView(p) }),
  handover_cancelled: (p) => ({ icon: "↩", title: "Передача больше не нужна", lines: handoverView(p) }),
```

Если в файле есть тест на полноту таблицы — он обязан пройти; красный означает, что описатель для какого-то типа не дописан.

- [ ] **Step 4: Прогнать, гейт и коммит**

```bash
npx vitest run shared/src/audit.test.ts
npm test && npm run typecheck && npm run lint
git add shared/src/audit.ts shared/src/audit.test.ts
git commit -m "feat(журнал): шесть событий передачи смены

Отдельно от swap_*: обмен — это сделка двух людей, а передача — смена, которая
осталась без человека. Один тип на оба случая не отвечал бы на первый вопрос,
который к строке возникает.

Веер адресата не имеет, и строка про него не пишется вовсе — пустое «кому: —»
читалось бы как потерянные данные."
```

---

### Task 4: Репозиторий передач

**Files:**
- Create: `server/src/repo/handovers.ts`, `server/src/repo/handovers.test.ts`

**Interfaces:**
- Produces:
  - `createHandover(db, data: NewHandover): Handover`
  - `getHandover(db, id: number): Handover | undefined`
  - `listLiveHandovers(db): Handover[]` — только `offered` и `fanned`
  - `listHandoversForEntry(db, sickEntryId: number): Handover[]`
  - `updateHandover(db, id: number, patch: Partial<NewHandover>): Handover | undefined`
  - `addDecline(db, handoverId: number, employeeId: number): void`
  - `listDeclines(db, handoverId: number): number[]` — id отказавшихся

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/repo/handovers.test.ts` с четырьмя проверками, каждая — про наблюдаемое поведение, а не про «функция позвала функцию»:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/test-db";
import { createHandover, getHandover, listLiveHandovers, listHandoversForEntry, updateHandover, addDecline, listDeclines } from "./handovers";

describe("handover repo", () => {
  it("lists only the ones the tick still has to look at", () => {
    const db = makeTestDb();
    const live = createHandover(db, { fromEmployeeId: 1, status: "offered", shiftId: null });
    createHandover(db, { fromEmployeeId: 1, status: "taken", shiftId: null });
    createHandover(db, { fromEmployeeId: 1, status: "cancelled", shiftId: null });
    expect(listLiveHandovers(db).map((h) => h.id)).toEqual([live.id]);
  });

  it("finds every handover a sick leave spawned", () => {
    const db = makeTestDb();
    const a = createHandover(db, { fromEmployeeId: 1, sickEntryId: 42, shiftId: null });
    const b = createHandover(db, { fromEmployeeId: 1, sickEntryId: 42, shiftId: null });
    createHandover(db, { fromEmployeeId: 1, sickEntryId: 99, shiftId: null });
    expect(listHandoversForEntry(db, 42).map((h) => h.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("keeps refusals per handover, not per person", () => {
    const db = makeTestDb();
    const a = createHandover(db, { fromEmployeeId: 1, shiftId: null });
    const b = createHandover(db, { fromEmployeeId: 1, shiftId: null });
    addDecline(db, a.id, 2);
    addDecline(db, b.id, 3);
    expect(listDeclines(db, a.id)).toEqual([2]);
  });

  it("a second refusal from the same person is not an error the caller must handle", () => {
    // The fan-out writes to several people at once and one of them may tap twice.
    // A throw here would abort a broadcast halfway through.
    const db = makeTestDb();
    const h = createHandover(db, { fromEmployeeId: 1, shiftId: null });
    addDecline(db, h.id, 2);
    expect(() => addDecline(db, h.id, 2)).not.toThrow();
    expect(listDeclines(db, h.id)).toEqual([2]);
  });

  it("updates what the tick writes back", () => {
    const db = makeTestDb();
    const h = createHandover(db, { fromEmployeeId: 1, shiftId: null });
    const at = new Date();
    updateHandover(db, h.id, { status: "fanned", offeredToEmployeeId: null, escalatedAt: at });
    const after = getHandover(db, h.id);
    expect(after?.status).toBe("fanned");
    expect(after?.escalatedAt?.getTime()).toBe(at.getTime());
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run server/src/repo/handovers.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализация**

Создать `server/src/repo/handovers.ts` по образцу `server/src/repo/swaps.ts` (тот же стиль drizzle-запросов, те же `.get()`/`.all()`). Ключевые места:

```ts
/** Only the ones the tick still has to look at. Resolved rows are history. */
export function listLiveHandovers(db: Db): Handover[] {
  return db.select().from(handovers).where(inArray(handovers.status, ["offered", "fanned"])).all();
}

/**
 * A repeated refusal is a no-op, not an error.
 *
 * The fan-out writes to a dozen people and any of them may tap twice — a throw
 * here would abort a broadcast halfway through, leaving half the team told and
 * the other half not, with nothing saying which half.
 */
export function addDecline(db: Db, handoverId: number, employeeId: number): void {
  db.insert(handoverDeclines).values({ handoverId, employeeId }).onConflictDoNothing().run();
}
```

- [ ] **Step 4: Прогнать, гейт и коммит**

```bash
npx vitest run server/src/repo/handovers.test.ts
npm test && npm run typecheck && npm run lint
git add server/src/repo/handovers.ts server/src/repo/handovers.test.ts
git commit -m "feat(база): репозиторий передач

Ни писем, ни правил — только чтение и запись двух таблиц, как в соседних репо.

Повторный отказ — не ошибка: веер пишет дюжине людей, любой может нажать
дважды, и бросок здесь оборвал бы рассылку на середине, оставив половину
команды в курсе, а половину нет."
```

---

### Task 5: Кому можно предложить и в каком порядке

**Files:**
- Create: `server/src/handover/candidates.ts`, `server/src/handover/candidates.test.ts`

**Interfaces:**
- Consumes: `listActive` (`../repo/employees`), `listShiftsOverlapping` (`../repo/shifts`), `shiftsOverlap` (`@planer/shared`), `listPoolFor` — если функции пула нет под этим именем, взять ту, что читает `template_pool` в `server/src/repo/templates.ts`, и назвать её в коде её настоящим именем.
- Produces: `handoverCandidates(db, shift: Shift, opts: { excludeIds?: readonly number[] }): Employee[]`

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/handover/candidates.test.ts`:

```ts
describe("who can be offered a shift", () => {
  it("leaves out the person who is giving it away", () => { /* Аня не в списке */ });

  it("leaves out anybody whose own entry overlaps those hours", () => {
    // Игорь работает 15:00–23:00 в тот же день — он занят,
    // Марк свободен. В списке только Марк.
  });

  it("leaves out people an admin took out of swaps", () => {
    // Это решение владельца из захода 1, и оно проверяется здесь, а не
    // подразумевается: «выведенные из обменов не участвуют».
  });

  it("leaves out archived people", () => { /* архивный не в списке */ });

  it("leaves out everybody already asked", () => {
    // opts.excludeIds — те, кто уже отказался; веер не пишет им второй раз.
  });

  it("puts the duty pool first without shutting anybody out", () => {
    // Смена дежурная; Марк в пуле, Игорь нет, оба свободны.
    // Ожидание: [Марк, Игорь] — пул наверху, но Игорь В СПИСКЕ.
    // Пул — приоритет, а не забор: это решение владельца от 2026-08-10,
    // и тест, проверяющий только порядок, пропустил бы его нарушение.
  });

  it("says nobody when nobody is free", () => { /* пустой массив, не бросок */ });
});
```

Фикстуры писать полностью, с `createEmployee` и `createShift`, как в соседних тестах сервисов; имена — «Аня», «Игорь», «Марк».

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run server/src/handover/candidates.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализация**

```ts
/**
 * Who can be offered this shift, best first.
 *
 * «Free» means the day holds nothing of theirs that overlaps these hours —
 * measured with the same `shiftsOverlap` the swap validator uses, so the two
 * surfaces cannot drift on what «занят» means.
 *
 * The duty pool sorts to the top and shuts nobody out. That is the owner's
 * decision from 2026-08-10, made with the risk named out loud: a duty can be
 * taken by anyone, the pool is the rule for automatic distribution.
 */
export function handoverCandidates(db: Db, shift: Shift, opts: { excludeIds?: readonly number[] } = {}): Employee[] {
  const excluded = new Set(opts.excludeIds ?? []);
  const sameDay = listShiftsOverlapping(db, shift.date, shift.endDate ?? shift.date);
  const pool = poolIdsFor(db, shift.templateId);

  return listActive(db)
    .filter((e) => e.id !== shift.employeeId && !excluded.has(e.id) && !e.excludedFromSwaps)
    .filter((e) => !sameDay.some((s) => s.employeeId === e.id && shiftsOverlap(s, shift)))
    .sort((a, b) => Number(pool.has(b.id)) - Number(pool.has(a.id)) || a.id - b.id);
}
```

`poolIdsFor` — маленький локальный хелпер над `template_pool`; для смены без `templateId` возвращает пустое множество.

- [ ] **Step 4: Прогнать, гейт и коммит**

```bash
npx vitest run server/src/handover/candidates.test.ts
npm test && npm run typecheck && npm run lint
git add server/src/handover/
git commit -m "feat(передача): кому можно предложить смену

«Занят» считается той же shiftsOverlap, что и в валидаторе обменов: две
поверхности не должны расходиться в том, что это слово значит.

Пул дежурства сортирует наверх и никого не отсекает — решение владельца от
2026-08-10, принятое с названным вслух риском. Тест проверяет и порядок, и то,
что человек вне пула ОСТАЛСЯ в списке: проверка одного порядка пропустила бы
превращение приоритета в забор."
```

---

### Task 6: Тексты писем

**Files:**
- Create: `server/src/handover/handover-notice.ts`, `server/src/handover/handover-notice.test.ts`

**Interfaces:**
- Consumes: `entryLineOf` (`../util/message-lines`).
- Produces:
  - `handoverOfferText(fromName: string, shiftLine: string): string`
  - `handoverFanText(fromName: string, shiftLine: string): string`
  - `handoverTakenTextForGiver(takerName: string, shiftLine: string): string`
  - `handoverTakenTextForAdmins(takerName: string, fromName: string, shiftLine: string): string`
  - `handoverEscalationText(fromName: string, shiftLine: string, declined: readonly string[], silentCount: number): string`
  - `handoverCancelledText(fromName: string, shiftLine: string): string`

- [ ] **Step 1: Написать падающий тест**

```ts
describe("what people read about a handover", () => {
  const LINE = "Ср 12 авг · 09:00–18:00 · День";

  it("the offer names who fell out and what the shift is", () => {
    const text = handoverOfferText("Аня", LINE);
    expect(text).toContain("Аня");
    expect(text).toContain("09:00–18:00");
  });

  it("the escalation letter names the refusals one by one", () => {
    const text = handoverEscalationText("Аня", LINE, ["Игорь", "Марк"], 5);
    expect(text).toContain("Игорь");
    expect(text).toContain("Марк");
    expect(text).toContain("5");
  });

  it("an escalation with nobody asked does not pretend there were refusals", () => {
    // «Отдать некому» — тот случай, когда свободных не было вовсе.
    const text = handoverEscalationText("Аня", LINE, [], 0);
    expect(text).not.toContain("Отказались");
    expect(text).toContain("некому");
  });

  it("uses the genderless verb form the rest of the bot uses", () => {
    expect(handoverTakenTextForGiver("Игорь", LINE)).toContain("(а)");
  });

  it("the cancellation says the tap is no longer needed, not that something failed", () => {
    const text = handoverCancelledText("Аня", LINE);
    expect(text).not.toContain("ошибк");
  });
});
```

- [ ] **Step 2: Прогнать — падает.** Run: `npx vitest run server/src/handover/handover-notice.test.ts`

- [ ] **Step 3: Реализация**

Шесть функций, склеивающих строки. Ключевое место — эскалация:

```ts
/**
 * The letter that exists for the whole feature: a shift nobody took.
 *
 * Refusals are named one by one because «двое отказались» sends the admin back
 * to the console to find out who; the silent ones are a number because their
 * names answer nothing — they simply have not tapped.
 */
export function handoverEscalationText(
  fromName: string,
  shiftLine: string,
  declined: readonly string[],
  silentCount: number,
): string {
  const lines = [`⚠️ ${shiftLine} — без человека.`, `${fromName} на больничном.`];
  if (declined.length > 0) lines.push(`Отказались: ${declined.join(", ")}.`);
  if (silentCount > 0) lines.push(`Молчат: ещё ${silentCount}.`);
  if (declined.length === 0 && silentCount === 0) lines.push("Предложить было некому — все заняты.");
  return lines.join("\n");
}
```

- [ ] **Step 4: Прогнать, гейт и коммит** (`feat(передача): тексты писем`).

---

### Task 7: Сервис — предложить, отказать, взять, погасить

**Files:**
- Create: `server/src/handover/handover-service.ts`, `server/src/handover/handover-service.test.ts`

**Interfaces:**
- Produces:
  - `startHandovers(deps, { sickEntry, employeeId }): Handover[]` — по одной на каждую смену, попавшую под больничный; статус `fanned` + `escalatedAt`, если свободных нет
  - `offerTo(deps, handoverId: number, toEmployeeId: number): Promise<void>`
  - `fanOut(deps, handoverId: number): Promise<void>`
  - `declineHandover(deps, handoverId: number, employeeId: number): Promise<{ ok: boolean; reason?: string }>`
  - `takeHandover(deps, handoverId: number, employeeId: number): Promise<{ ok: boolean; reason?: string }>`
  - `cancelHandoversForEntry(deps, sickEntryId: number, stillCoveredDates: readonly string[]): Promise<number>`
- `deps` — `{ db: Db; config: Config; bot: Bot | null }`. **`bot?: Bot`, а не `Bot | null`, если тип берётся из `createApp`** — в заходе 2 это стоило двух ошибок типов; здесь сервис объявляет свой тип сам и допускает `null`.

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/handover/handover-service.test.ts`. **Каждый тест обязан проверять состояние базы, а не только возвращённое значение.**

```ts
describe("taking a shift", () => {
  it("moves the entry to the taker and closes the handover", async () => {
    // после takeHandover: shift.employeeId === Игорь, handover.status === "taken",
    // takenByEmployeeId === Игорь, resolvedAt проставлен
  });

  it("gives the shift to exactly one of two simultaneous takers", async () => {
    // Два takeHandover подряд без await между ними на общей базе.
    // Ожидание: один { ok: true }, один { ok: false }, у смены ОДИН владелец,
    // и в журнале ровно одна строка handover_taken.
    //
    // Это тот класс, что дважды спамил команду: гонка живёт там, где статус
    // пишется ПОСЛЕ await. Тест обязан падать на реализации, которая шлёт
    // письмо до записи статуса.
  });

  it("refuses somebody who has picked up their own shift meanwhile", async () => {
    // Игорю за эти три часа поставили смену 15:00–23:00, передача про 09:00–18:00
    // — пересечения нет, берёт. А про 12:00–20:00 — есть, отказ, смена не переехала.
  });

  it("refuses a handover that is already taken, cancelled or expired", async () => {
    // по одному прогону на каждый статус; смена не меняет владельца
  });
});

describe("declining", () => {
  it("records the refusal and fans out immediately", async () => {
    // status === "fanned", в handover_declines строка Игоря,
    // и Игорю второго письма не ушло
  });
});

describe("starting handovers for a sick leave", () => {
  it("makes one per shift the sick leave covers", async () => {
    // больничный 12–14, смены 12 и 13 → две передачи, у каждой свой shiftId
  });

  it("makes none when the days hold no shifts", async () => { /* пустой массив */ });

  it("escalates at birth when nobody is free", async () => {
    // status === "fanned", escalatedAt проставлен, админам ушло «некому»
  });
});

describe("cancelling", () => {
  it("kills the handovers a removed sick leave spawned and tells the people asked", async () => {
    // status === "cancelled" у обеих, письмо ушло Игорю
  });

  it("keeps the ones still covered when the sick leave is shortened", async () => {
    // больничный 12–14 укорочен до 12–13: передача на 14-е cancelled,
    // передача на 12-е остаётся offered
  });
});
```

- [ ] **Step 2: Прогнать — падает.** Run: `npx vitest run server/src/handover/handover-service.test.ts`

- [ ] **Step 3: Реализация**

Ключевое место всей задачи — `takeHandover`. Порядок операций в нём не стилистический:

```ts
/**
 * Somebody tapped «Беру».
 *
 * The claim and the move are ONE synchronous transaction, and it runs BEFORE a
 * single message is sent. This repository has already paid twice for the other
 * order — the birthday broadcast and the vacant-slot double post both spammed
 * the whole team, and both had the same shape: a status guard written AFTER an
 * await. better-sqlite3 is synchronous and this is one process, so a claim that
 * completes before the first await cannot be raced.
 *
 * The double-booking check is inside the transaction too: three hours passed
 * since the offer went out, and «свободен» stops being true without warning.
 */
export async function takeHandover(deps: Deps, handoverId: number, employeeId: number) {
  const { db, config, bot } = deps;
  const claimed = db.transaction(() => {
    const handover = getHandover(db, handoverId);
    if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
      return { ok: false as const, reason: "Уже забрали или предложение отменили" };
    }
    const shift = handover.shiftId != null ? getShift(db, handover.shiftId) : undefined;
    if (!shift) return { ok: false as const, reason: "Смены больше нет — её изменил админ" };

    const mine = listShiftsOverlapping(db, shift.date, shift.endDate ?? shift.date)
      .filter((s) => s.employeeId === employeeId && s.id !== shift.id);
    if (mine.some((s) => shiftsOverlap(s, shift))) {
      return { ok: false as const, reason: "У тебя в это время уже стоит своя смена" };
    }

    updateShift(db, shift.id, { employeeId });
    updateHandover(db, handoverId, {
      status: "taken", takenByEmployeeId: employeeId, resolvedAt: new Date(),
    });
    return { ok: true as const, shift, handover };
  });

  if (!claimed.ok) return claimed;
  // Everything below is I/O and may fail; the shift has already moved, which is
  // the part that must not depend on Telegram being reachable.
  recordAudit(db, "handover_taken", employeeId, handoverAuditPayload(db, claimed.handover, employeeId));
  if (bot) { /* письма взявшему, выбывшему и админам */ }
  return { ok: true as const };
}
```

Остальные функции — прямая работа с репозиторием плюс отправка; `handoverAuditPayload` — маленький локальный шейпер, отдающий ровно те поля, что читает `handoverView` из Task 3 (`handoverId`, `shiftId`, `shiftLine`, `fromEmployeeId`, `fromName`, `toEmployeeId`, `toName`).

- [ ] **Step 4: Прогнать, гейт и коммит**

```bash
npx vitest run server/src/handover/handover-service.test.ts
npm test && npm run typecheck && npm run lint
git add server/src/handover/
git commit -m "feat(передача): предложить, отказать, взять, погасить

Захват смены и её переезд — одна синхронная транзакция, и она выполняется ДО
первой отправки письма. Этот репозиторий уже дважды заплатил за обратный
порядок: двойная рассылка дней рождения и дубль вакантного слота — обе гонки
одной формы, статус-guard после await.

Двойное бронирование проверяется в момент нажатия, а не в момент предложения:
за три часа у человека могла появиться своя смена, и «свободен» перестаёт быть
правдой без предупреждения."
```

---

### Task 8: Тик и пороги в конфиге

**Files:**
- Create: `server/src/handover/handover-tick.ts`, `server/src/handover/handover-tick.test.ts`
- Modify: `server/src/config.ts`, `server/src/index.ts`

**Interfaces:**
- Produces: `runHandoverTick(deps, nowMs: number): Promise<number>` — сколько передач тронул; `config.handoverFanHours`, `config.handoverEscalateHours`.

- [ ] **Step 1: Написать падающий тест**

```ts
describe("handover tick", () => {
  it("fans out a handover nobody answered in three hours", async () => {
    // offeredAt = now - 4ч → status "fanned", письма всем свободным
  });

  it("writes to the admins once, not on every tick", async () => {
    // два прогона подряд на одной базе → ровно одно письмо админам
    // и ровно одна строка handover_escalated в журнале
  });

  it("does both when both are due, fan first", async () => {
    // offeredAt = now - 2ч, смена через 2ч → status "fanned" И escalatedAt,
    // и в журнале handover_fanned стоит РАНЬШЕ handover_escalated
  });

  it("expires a handover whose shift has started, silently", async () => {
    // status "expired", админам НИЧЕГО не ушло: им уже писали на эскалации
  });

  it("leaves resolved handovers alone", async () => {
    // taken/cancelled/expired не трогаются и в счётчик не попадают
  });
});
```

- [ ] **Step 2: Прогнать — падает.** Run: `npx vitest run server/src/handover/handover-tick.test.ts`

- [ ] **Step 3: Реализация тика**

```ts
/**
 * One pass of the ladder over every live handover.
 *
 * The rule itself lives in `@planer/shared` and knows nothing about the database
 * — this function only reads rows, asks it what to do, and does it. Keeping the
 * decision pure is what makes «2:59 is silence, 3:01 is a fan-out» testable
 * without a clock.
 *
 * One handover going wrong must not silence the rest: the same lesson the
 * reminder tick learned when a deleted shift threw and twenty people got nothing.
 */
export async function runHandoverTick(deps: Deps, nowMs: number): Promise<number> {
  let touched = 0;
  for (const handover of listLiveHandovers(deps.db)) {
    try {
      const shift = handover.shiftId != null ? getShift(deps.db, handover.shiftId) : undefined;
      if (!shift) { /* смены нет — гасим передачу как expired и идём дальше */ continue; }
      const actions = handoverActions(
        {
          status: handover.status,
          offeredAt: handover.offeredAt.getTime(),
          escalatedAt: handover.escalatedAt?.getTime() ?? null,
          shiftStartsAt: shiftStartMs(shift, deps.config.teamTz),
        },
        nowMs,
        { fanAfterHours: deps.config.handoverFanHours, escalateBeforeHours: deps.config.handoverEscalateHours },
      );
      for (const action of actions) {
        if (action === "fan") await fanOut(deps, handover.id);
        if (action === "escalate") await escalate(deps, handover.id);
        if (action === "expire") expire(deps, handover.id);
      }
      if (actions.length > 0) touched += 1;
    } catch (err) {
      console.error(`runHandoverTick: handover ${handover.id} skipped:`, safeErrorMessage(err));
    }
  }
  return touched;
}
```

- [ ] **Step 4: Пороги в конфиг**

В `server/src/config.ts` добавить в схему:

```ts
  // Пороги лестницы передачи. Со значениями по умолчанию — иначе деплой
  // потребовал бы править server/.env на живой машине ради двух чисел,
  // которые почти никогда не меняются.
  HANDOVER_FAN_HOURS: z.coerce.number().positive().default(3),
  HANDOVER_ESCALATE_HOURS: z.coerce.number().positive().default(12),
```

и два поля в `Config` и в возвращаемый объект: `handoverFanHours`, `handoverEscalateHours`.

- [ ] **Step 5: Подключить тик**

В `server/src/index.ts` третьим элементом в `runTicksIndependently`:

```ts
    { name: "handover", run: () => runHandoverTick({ db, config, bot }, Date.now()) },
```

Именно третьим в тот же массив, а не отдельным `setInterval`: `runTicksIndependently` существует ровно для того, чтобы падение одного тика не гасило соседей — это уже стоило пропущенного тика дней рождения.

- [ ] **Step 6: Прогнать, гейт и коммит**

```bash
npx vitest run server/src/handover/handover-tick.test.ts
npm test && npm run typecheck && npm run lint
git add server/src/handover/ server/src/config.ts server/src/index.ts
git commit -m "feat(передача): тик лестницы

Правило живёт в shared и про базу ничего не знает — тик только читает строки,
спрашивает его и исполняет. Чистое решение и делает проверяемым «2:59 — молчание,
3:01 — веер» без единого обращения к часам.

Третьим в runTicksIndependently, а не своим setInterval: эта функция и написана
затем, чтобы падение одного тика не гасило соседей.

Пороги со значениями по умолчанию — деплой не должен требовать правки .env на
живой машине ради двух чисел."
```

---

### Task 9: Кнопки в чате

**Files:**
- Modify: `server/src/bot/notify.ts`, `server/src/bot/bot.ts`
- Create: `server/src/bot/handover-bot.test.ts`

**Interfaces:**
- Produces: `notifyHandoverOffer(bot, telegramUserId, handoverId, text)` (кнопки `Беру`/`Не могу`), `notifyHandoverFan(bot, db, handoverId, text, recipientIds)` (одна кнопка `Беру`); обработчики `handover:take:<id>` и `handover:decline:<id>`.

- [ ] **Step 1: Написать падающий тест**

По образцу `server/src/bot/weekend-bot.test.ts` — перехват исходящих через `bot.api.config.use`:

```ts
describe("handover buttons", () => {
  it("offers with two buttons routed to this handover", async () => {
    // payload sendMessage несёт reply_markup с callback_data
    // "handover:take:<id>" и "handover:decline:<id>"
  });

  it("the fan-out carries one button and reaches everybody free", async () => {
    // одна кнопка «Беру»; число sendMessage равно числу свободных
  });

  it("«Беру» moves the shift and answers the tapper", async () => {
    // после нажатия у смены новый владелец, и ответ содержит подтверждение
  });

  it("a second «Беру» is answered «уже забрали» and changes nothing", async () => {
    // владелец смены не меняется со второго нажатия
  });

  it("«Не могу» fans out and does not write to the person who refused", async () => {
    // среди адресатов веера нет отказавшегося
  });

  it("a tap from somebody the bot does not know does nothing", async () => {
    // тот же guard `acting()`, что закрыл дыру cf33022: кнопки бота были
    // вторым входом без проверки, и архивный человек мог ими пользоваться
  });
});
```

- [ ] **Step 2: Прогнать — падает.** Run: `npx vitest run server/src/bot/handover-bot.test.ts`

- [ ] **Step 3: Реализация**

В `notify.ts` — две функции по образцу `notifyWeekendOffer` и `notifyVacantSlot`, включая `try/catch` вокруг каждой отправки: одна недоступная личка не должна обрывать веер.

В `bot.ts` — два обработчика рядом с `weekend:` и `swap:`:

```ts
  bot.callbackQuery(/^handover:(take|decline):(\d+)$/, async (ctx) => {
    const actor = acting(ctx);           // тот же guard, что у остальных кнопок
    if (!actor) return ctx.answerCallbackQuery("Сначала отправь /start");
    const [, action, rawId] = ctx.match;
    const result = action === "take"
      ? await takeHandover({ db, config, bot }, Number(rawId), actor.id)
      : await declineHandover({ db, config, bot }, Number(rawId), actor.id);
    await ctx.answerCallbackQuery(result.ok ? "Готово" : (result.reason ?? "Не получилось"));
    await safeEdit(ctx, /* убрать кнопки у отвеченного сообщения */);
  });
```

Имя guard'а взять из `bot.ts` по факту (`acting` закрывал дыру `cf33022`); `safeEdit` там же — снимать кнопки надо им, а не голым `editMessageReplyMarkup`: это уже чинилось линзой `errors`.

- [ ] **Step 4: Прогнать, гейт и коммит** (`feat(бот): кнопки «Беру» и «Не могу»`).

---

### Task 10: Маршруты и врезка в самозапись

**Files:**
- Create: `server/src/http/routes/my-handovers.ts`, `server/src/http/routes/my-handovers.test.ts`
- Modify: `server/src/http/routes/my-entries.ts`

**Interfaces:**
- Produces:
  - `POST /api/my/entries` дополнительно отдаёт `handovers: { id, shiftLine, candidates: { id, displayName }[] }[]`
  - `POST /api/my/handovers/:id/offer` — тело `{ toEmployeeId }`
  - `POST /api/my/handovers/:id/skip` — сразу веер
  - `PATCH`/`DELETE /api/my/entries/:id` гасят передачи, оставшиеся без покрытия

- [ ] **Step 1: Написать падающий тест**

```ts
describe("POST /api/my/entries — больничный", () => {
  it("returns a handover per shift the sick leave covers, with candidates", async () => {
    // 201, в теле handovers.length === 2, у каждой непустой candidates
  });

  it("creates none for an event", async () => {
    // мероприятие смену не освобождает — handovers пуст
  });
});

describe("POST /api/my/handovers/:id/offer", () => {
  it("refuses to offer somebody else's handover and changes nothing", async () => {
    // 404, статус передачи прежний
  });

  it("refuses a candidate who is busy at those hours", async () => {
    // 400, статус прежний — экран не должен быть единственной защитой
  });

  it("offers and remembers the addressee", async () => {
    // 200, offeredToEmployeeId === Игорь, status "offered"
  });
});

describe("DELETE /api/my/entries/:id", () => {
  it("cancels the handovers that sick leave spawned", async () => {
    // обе передачи cancelled
  });
});

describe("PATCH /api/my/entries/:id", () => {
  it("cancels only the days the shortened sick leave no longer covers", async () => {
    // 12–14 → 12–13: передача на 14-е cancelled, на 12-е нетронута
  });
});
```

- [ ] **Step 2: Прогнать — падает.** Run: `npx vitest run server/src/http/routes/my-handovers.test.ts`

- [ ] **Step 3: Реализация**

Роутер по образцу `my-entries.ts` (тот же `requireAuth`, тот же `Env`). Врезка в `my-entries.ts`: после `createShift` при `category === "sick_leave"` позвать `startHandovers`, а в `PATCH`/`DELETE` — `cancelHandoversForEntry`, передав список дат, которые больничный ещё покрывает (`eachDayIso` из Task 1 захода 2).

**`employeeId` берётся из токена и в схему тела не входит** — как и во всём роутере самозаписи.

- [ ] **Step 4: Смонтировать роутер** в `app.ts` рядом с `createMyEntryRoutes`.

- [ ] **Step 5: Прогнать, гейт и коммит** (`feat(api): передача смены из формы больничного`).

---

### Task 11: Второй шаг формы в мини-аппе

**Files:**
- Modify: `miniapp/src/screens/SelfEntryScreen.tsx`, `miniapp/src/api/client.ts`, `miniapp/src/api/mock.ts`
- Create: `miniapp/src/screens/self-entry-handover.test.tsx`

Слой 2: логика — тестами, вёрстка — нет.

- [ ] **Step 1: Написать падающий тест**

DOM-тест по образцу `self-entry-deeplink.test.tsx` (тот же `jsdom`, те же spy на `apiClient`):

```ts
describe("второй шаг формы", () => {
  it("после больничного показывает смену и кандидатов, а не закрывает форму", async () => {
    // createSelfEntry отвечает handovers с одним элементом и двумя кандидатами
    // → на экране строка смены и обе фамилии
  });

  it("«Потом» не оставляет смену молча на больном", async () => {
    // нажатие зовёт skipHandover, форма закрывается
  });

  it("больничный без смен закрывает форму сразу, как раньше", async () => {
    // handovers пуст → второго шага нет
  });
});
```

- [ ] **Step 2: Прогнать — падает.** Run: `npx vitest run miniapp/src/screens/self-entry-handover.test.tsx`

- [ ] **Step 3: Реализация**

Три метода клиента и мока: `offerHandover(id, toEmployeeId)`, `skipHandover(id)`; тип ответа `createSelfEntry` расширяется полем `handovers`. Мок отвечает той же формой.

Второй шаг — состояние внутри `SelfEntryScreen`: если ответ принёс непустой `handovers`, форма не сбрасывается, а показывает список смен и под каждой — кандидатов кнопками.

**Ошибку рисовать рядом с кнопкой, а не в шапке экрана.** Мини-апп — один длинный скролл; этот класс дефекта в репозитории ловился четырежды.

- [ ] **Step 4: Прогнать, гейт и коммит** (`feat(мини-апп): второй шаг — кому отдать смену`).

---

## Самопроверка плана

| Обещание спеки | Где |
| --- | --- |
| Лестница: 3 часа молчания, 12 часов до смены | Task 1, исполняется в Task 8 |
| Своя таблица + отказы отдельно | Task 2 |
| Шесть типов журнала | Task 3 |
| Одна передача — одна смена | Task 7 (`startHandovers`) |
| Кандидаты: свободные, не исключённые, пул наверх | Task 5 |
| Адресно, потом веер | Task 7 + Task 8 |
| Письмо админам один раз | Task 8 |
| Веер после эскалации не гаснет | Task 1 (статус остаётся `fanned`) + Task 7 |
| Гонка на «Беру» | Task 7 |
| Двойное бронирование в момент нажатия | Task 7 |
| Кнопки в чате | Task 9 |
| «Свободных нет» → сразу эскалация | Task 7 |
| «Потом» → сразу веер | Task 10 + Task 11 |
| Снятие и укорочение больничного гасят передачи | Task 7 + Task 10 |
| Постусловие миграции на копии живой базы | Task 2, шаг 6 |
| Форма в мини-аппе | Task 11 |

**Чего в спеке не было, и это добавлено сюда:**

1. **`shiftStartMs` в `shared`** (Task 1). Спека говорила «начало смены — это дата и время», не заметив, что функции, считающей этот момент в командном поясе, в `shared` нет вовсе, а `teamNow` живёт на сервере и отдаёт строки, а не миллисекунды.
2. **Повторный отказ — не ошибка** (Task 4). Спека молчала; веер пишет дюжине людей, и бросок на второй нажатой кнопке оборвал бы рассылку на середине.
3. **Передача, чья смена исчезла** (Task 8). Админ удалил запись — тик обязан погасить передачу, а не падать на `undefined`.

## Что разошлось с планом

Записано по факту исполнения 2026-08-13.

1. **Отправка спрятана за интерфейс `HandoverMessenger`, а не за `Bot`.** План писал
   `deps: { db, config, bot }`. На первом же тесте выяснилось, что через `bot` не видно
   **кому** ушло письмо — а сообщение не тому человеку это худший дефект этой фичи, и
   проверка «ушло N сообщений» слепа ровно к нему. Реальная отправка живёт в
   `handover-messenger.ts`.

2. **`escalate` и `expireHandover` оказались нужны сервису, а не тику.** План рисовал их
   внутри тика; но их зовёт и рождение передачи («свободных нет вовсе» эскалирует сразу),
   так что они в сервисе, а тик их только вызывает.

3. **`startHandovers` пришлось сделать идемпотентным.** План не заметил, что продление
   больничного — это `PATCH` той же записи, и повторный прогон переспросил бы всю команду
   про уже предложенные дни.

4. **`detachHandoversFromEntry` — целая функция, которой в плане не было.** `sickEntryId`
   это внешний ключ, и `DELETE` больничного отвечал `invalid_reference`, пока передачи на
   него ссылались. Нашлось тестом. Ссылка обнуляется, строки остаются историей — то же
   решение, что уже принято для `shiftId`.

5. **Веер получил одну кнопку вместо двух.** «Не могу» в рассылке не отвечает ни на что:
   предложение не адресовано никому лично, и ряд отказов от тех, кого не спрашивали,
   похоронил бы единственное нужное нажатие.

6. **Кандидат «свободен» потребовал своего правила поверх `shiftsOverlap`.** У отсутствия
   нет времени, и `shiftsOverlap` на отпуске против смены 09:00–18:00 отвечает «не
   пересекается» — то есть предложил бы смену человеку в отпуске. Запись без времени
   занимает свой день целиком.

7. **Два новых поля конфига сломали typecheck в 17 тестах**, каждый со своей копией
   литерала `Config`. Поля дописаны, дублирование фикстуры записано в ledger.

**Две ловушки тестов, пойманные в этом заходе:**

- Тест `DELETE` проверял статусы через `listHandoversForEntry` — а после отвязки этот
  список пуст, и цикл по нему прошёл бы при любой реализации. Переписан на конкретные id,
  взятые до удаления.
- Тест гонки проверен нарочной поломкой: перенос захвата за `await` роняет ровно его и
  ничего больше.

## Что делать после

1. `superpowers:finishing-a-development-branch`.
2. Деплой: бэкап `.backup` → **рестарт сначала**, фронты потом.
3. **В этой работе ЕСТЬ миграция** — в отличие от заходов 1 и 2. Постусловие прогнать на копии до деплоя и на живой базе после.
