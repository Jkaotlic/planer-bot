# Уведомления об изменении графика — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** работник получает в личку сообщение, когда админ ставит, снимает, переносит или переименовывает его запись в графике — поштучно при ручной правке и одним сводным письмом при массовой.

**Architecture:** чистый диф расписания (`schedule-diff.ts`) + строители текстов и два входа отправки (`change-notice.ts`). Одиночные роуты записей зовут вход напрямую, имея на руках «было» и «стало»; массовые пути оборачиваются в `withScheduleDiff`, которая снимает расписание диапазона до и после операции и сравнивает — так уведомление не может разойтись с тем, что реально легло в базу.

**Tech Stack:** TypeScript, Hono, drizzle + better-sqlite3 (синхронный), grammY, vitest, React 18.

## Состояние (обновлять после каждой задачи)

| Задача | Статус | Коммит |
|---|---|---|
| 1. `categoryLabel` в shared | ✅ сделана | `5b35986` |
| 2. `entryLineOf` | ✅ сделана | `79da1ea` |
| 3. `diffSchedules` | ✅ сделана | `1493485` |
| 4. тексты и `notifyEntryChange` | ✅ сделана | `7d41fd0` |
| 5. роуты создания / правки / удаления | ✅ сделана | `280bcf2` |
| 6. сводное письмо и `withScheduleDiff` | ✅ сделана | `ea7c6ca` |
| 7. импорт CSV и «Распределить честно» | ✅ сделана | `b41a385` |
| 8. bulk-роут и переезд «Заполнить неделю» | ✅ сделана | `8c1c4de` |
| 9. «дошло до N из M» в обеих админках | ✅ сделана | `e665738` |

Ничего из сделанного пока не видно снаружи: четыре задачи — это фундамент
(подпись категории, строка про запись, чистый диф) и готовая отправка, которую
ещё никто не зовёт. Первое письмо человеку уходит в задаче 5.

Задача 4 разошлась с планом в одном: глаголы пишутся формой `поставил(а)`, а не
женским родом. Рода в базе нет, правит график чаще мужчина — «Антон поставила
тебе смену» ушло бы первым же письмом. Спека поправлена там же (решение 2).
И сверх плана в задаче 4 два теста на ветку «прошлое»: правка внутри прошлого
молчит, перенос из прошлого в будущее — пишет. Итог 10 тестов, а не 8.

Задача 5 — **первое письмо человеку уходит с 2026-08-03.** Реализована точно по
плану (`send` из плана — это `authedJson`, уже существующий в `entries.test.ts`
хелпер с той же сигнатурой). DELETE, которого не было в плановом «Produces» с
явным примером тела, тоже возвращает `notified` — по требованию «три роута»
из шапки задачи.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-03-schedule-change-notifications-design.md`. Расхождение с ней — ошибка плана, не повод импровизировать.
- **Значимые поля** записи ровно шесть: `employeeId`, `date`, `endDate`, `start`, `end`, `category`. Заметка, подпись, пресет, локация на решение «слать или нет» не влияют.
- **Не шлём:** про дни раньше сегодняшнего по `TEAM_TZ`; автору правки о его собственной записи; тем, у кого `telegramUserId == null` (но они считаются в `intended`).
- **Тумблер `remindersEnabled` этот канал не гасит.** Не проверять его нигде.
- Отправка — только **после** коммита транзакции. Ошибка Telegram не откатывает правку и не меняет код ответа роута.
- Обращение к человеку — только через `addressOf` из `@planer/shared`. `displayName.split(" ")[0]` запрещён.
- Реальных ФИО в тестах и доках быть не может — репозиторий публичный. Имена брать выдуманные.
- Каждый коммит зелёный по полному гейту: `npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin`.
- Один дефект/шаг = один коммит.

## File Structure

| Файл | Ответственность |
|---|---|
| `shared/src/category.ts` (M) | + `categoryLabel` — русская подпись категории, нужна серверу для текста письма |
| `server/src/util/message-lines.ts` (M) | + `entryLineOf` — одна строка про запись: «Пт 7 авг · 15:00–23:00 · Вечер» |
| `server/src/schedule/schedule-diff.ts` (C) | чистый диф двух списков записей по людям |
| `server/src/schedule/change-notice.ts` (C) | тексты писем + `notifyEntryChange` / `notifyScheduleChange` + `withScheduleDiff` |
| `server/src/http/app.ts` (M) | вызовы из роутов записей, импорта, распределения; новый bulk-роут |
| `miniapp/src/screens/admin/AdminScheduleScreen.tsx` (M) | «Заполнить неделю» переезжает на bulk-роут |
| `miniapp/src/api/client.ts`, `admin/src/api/client.ts` (M) | метод bulk + поле `notified` в ответах |

---

### Task 1: `categoryLabel` в shared

Серверу нужны русские подписи категорий для текста письма («стало Отпуск»). Сейчас они существуют только копиями в двух мордах.

**Files:**
- Modify: `shared/src/category.ts`
- Modify: `shared/src/index.ts` (реэкспорт)
- Test: `shared/src/category.test.ts`

**Interfaces:**
- Produces: `categoryLabel(category: EntryCategory): string`

- [ ] **Step 1: Написать падающий тест**

В `shared/src/category.test.ts` дописать:

```ts
import { categoryLabel } from "./category";

describe("categoryLabel", () => {
  it("называет каждую категорию по-русски", () => {
    expect(categoryLabel("shift")).toBe("Смена");
    expect(categoryLabel("vacation")).toBe("Отпуск");
    expect(categoryLabel("sick_leave")).toBe("Больничный");
    expect(categoryLabel("duty")).toBe("Дежурство");
    expect(categoryLabel("offsite")).toBe("Выездное мероприятие");
    expect(categoryLabel("business_trip")).toBe("Командировка");
    expect(categoryLabel("weekend_work")).toBe("Работа в выходной");
  });
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run shared/src/category.test.ts`
Expected: FAIL — `categoryLabel is not a function` / ошибка импорта.

- [ ] **Step 3: Реализовать**

В `shared/src/category.ts`:

```ts
/**
 * Русская подпись категории. Живёт здесь, потому что её просит сервер — текст
 * письма об изменении графика называет вид записи словами.
 *
 * Мини-апп продолжает держать свою копию (`miniapp/src/categories.tsx`): он
 * намеренно не зависит от `@planer/shared`. Копия сторожится тестом ниже.
 */
const CATEGORY_LABELS: Record<EntryCategory, string> = {
  shift: "Смена",
  vacation: "Отпуск",
  sick_leave: "Больничный",
  duty: "Дежурство",
  offsite: "Выездное мероприятие",
  business_trip: "Командировка",
  weekend_work: "Работа в выходной",
};

export function categoryLabel(category: EntryCategory): string {
  return CATEGORY_LABELS[category];
}
```

В `shared/src/index.ts` добавить `categoryLabel` в существующий реэкспорт из `./category`.

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run shared/src/category.test.ts`
Expected: PASS

- [ ] **Step 5: Сторож зеркала мини-аппа**

Создать `miniapp/src/category-labels.test.ts` (мини-апп от shared не зависит, поэтому сторож живёт у него и импортирует shared **только в тесте**):

```ts
import { describe, expect, it } from "vitest";
import { categoryLabel as sharedLabel } from "@planer/shared";
import { categoryLabel } from "./categories";

/** Мини-апп намеренно не зависит от shared в рантайме — но расходиться копии не должны. */
describe("подписи категорий", () => {
  it("совпадают с shared", () => {
    for (const c of ["shift", "vacation", "sick_leave", "duty", "offsite", "business_trip", "weekend_work"] as const) {
      expect(categoryLabel(c), c).toBe(sharedLabel(c));
    }
  });
});
```

- [ ] **Step 6: Прогнать полный гейт и закоммитить**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add shared/src/category.ts shared/src/index.ts shared/src/category.test.ts miniapp/src/category-labels.test.ts
git commit -m "feat(shared): categoryLabel — подпись категории словами, для текста уведомлений"
```

---

### Task 2: `entryLineOf` — одна строка про запись

**Files:**
- Modify: `server/src/util/message-lines.ts`
- Test: `server/src/util/message-lines.test.ts`

**Interfaces:**
- Consumes: `categoryLabel` (Task 1)
- Produces: `entryLineOf(entry: { date: string; endDate: string | null; start: string | null; end: string | null; category: EntryCategory; title: string | null }): string`

- [ ] **Step 1: Написать падающий тест**

```ts
import { entryLineOf } from "./message-lines";

describe("entryLineOf", () => {
  const base = { date: "2026-08-07", endDate: null, start: "15:00", end: "23:00", category: "shift" as const, title: "Вечер" };

  it("смена: день, часы и как она называется", () => {
    expect(entryLineOf(base)).toBe("Пт 7 авг · 15:00–23:00 · Вечер");
  });

  it("без подписи называет категорию", () => {
    expect(entryLineOf({ ...base, title: null })).toBe("Пт 7 авг · 15:00–23:00 · Смена");
  });

  it("отсутствие без часов — «весь день»", () => {
    expect(entryLineOf({ ...base, start: null, end: null, category: "vacation", title: null }))
      .toBe("Пт 7 авг · весь день · Отпуск");
  });

  it("многодневное отсутствие называет обе даты", () => {
    expect(entryLineOf({ date: "2026-08-06", endDate: "2026-08-07", start: null, end: null, category: "vacation", title: null }))
      .toBe("Чт 6 авг – Пт 7 авг · весь день · Отпуск");
  });
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run message-lines`
Expected: FAIL — `entryLineOf is not a function`.

- [ ] **Step 3: Реализовать**

В `server/src/util/message-lines.ts` (рядом с `slotLineOf`, тем же форматтером):

```ts
import { categoryLabel, type EntryCategory } from "@planer/shared";

/** «Пт 7 авг» — день записи, как его пишут все остальные сообщения. */
function dayLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .formatToParts(new Date(`${iso}T00:00:00Z`));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${get("day")} ${get("month").replace(/\.$/, "")}`;
}

/**
 * «Пт 7 авг · 15:00–23:00 · Вечер» — строка про одну запись графика.
 *
 * Подпись записи важнее категории ровно там же, где и в сетке: клетка
 * подписана `title ?? categoryLabel(category)`, и письмо должно называть смену
 * теми же словами, что человек увидит, открыв мини-апп.
 */
export function entryLineOf(entry: {
  date: string;
  endDate: string | null;
  start: string | null;
  end: string | null;
  category: EntryCategory;
  title: string | null;
}): string {
  const days = entry.endDate && entry.endDate !== entry.date
    ? `${dayLabel(entry.date)} – ${dayLabel(entry.endDate)}`
    : dayLabel(entry.date);
  const time = entry.start != null && entry.end != null ? `${entry.start}–${entry.end}` : "весь день";
  return `${days} · ${time} · ${entry.title ?? categoryLabel(entry.category)}`;
}
```

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run message-lines`
Expected: PASS

- [ ] **Step 5: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add server/src/util/message-lines.ts server/src/util/message-lines.test.ts
git commit -m "feat(server): entryLineOf — строка про запись графика для писем"
```

---

### Task 3: `diffSchedules` — что именно произошло

**Files:**
- Create: `server/src/schedule/schedule-diff.ts`
- Test: `server/src/schedule/schedule-diff.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EmployeeDiff {
    added: Shift[];
    removed: Shift[];
    changed: { before: Shift; after: Shift }[];
  }
  export function diffSchedules(before: readonly Shift[], after: readonly Shift[]): Map<number, EmployeeDiff>
  ```

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { diffSchedules } from "./schedule-diff";
import type { Shift } from "../db/schema";

const entry = (over: Partial<Shift> & { id: number }): Shift => ({
  id: over.id, employeeId: 1, date: "2026-09-01", endDate: null, start: "08:00", end: "17:00",
  category: "shift", title: "Утро", templateId: 1, note: null, location: null, unrecognisedCode: null,
  ...over,
} as Shift);

describe("diffSchedules", () => {
  it("новая запись — added у её владельца", () => {
    const d = diffSchedules([], [entry({ id: 1 })]);
    expect(d.get(1)!.added.map((s) => s.id)).toEqual([1]);
  });

  it("исчезнувшая запись — removed", () => {
    const d = diffSchedules([entry({ id: 1 })], []);
    expect(d.get(1)!.removed.map((s) => s.id)).toEqual([1]);
  });

  it("сдвинутое время — changed, и только у него", () => {
    const d = diffSchedules([entry({ id: 1 })], [entry({ id: 1, start: "15:00", end: "23:00" })]);
    expect(d.get(1)!.changed).toHaveLength(1);
    expect(d.get(1)!.added).toEqual([]);
    expect(d.get(1)!.removed).toEqual([]);
  });

  it("правка заметки изменением не считается", () => {
    const d = diffSchedules([entry({ id: 1 })], [entry({ id: 1, note: "привёз ключи" })]);
    expect(d.size).toBe(0);
  });

  it("смена владельца — снято одному, поставлено другому", () => {
    const d = diffSchedules([entry({ id: 1, employeeId: 1 })], [entry({ id: 1, employeeId: 2 })]);
    expect(d.get(1)!.removed.map((s) => s.id)).toEqual([1]);
    expect(d.get(2)!.added.map((s) => s.id)).toEqual([1]);
  });

  it("вакантная запись ничья — в дифе её нет", () => {
    const d = diffSchedules([], [entry({ id: 1, employeeId: null })]);
    expect(d.size).toBe(0);
  });

  it("человек без единого изменения в диф не попадает", () => {
    const d = diffSchedules([entry({ id: 1 })], [entry({ id: 1 })]);
    expect(d.size).toBe(0);
  });
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run schedule-diff`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
import type { Shift } from "../db/schema";

export interface EmployeeDiff {
  added: Shift[];
  removed: Shift[];
  changed: { before: Shift; after: Shift }[];
}

/** Поля, ради которых человека вообще стоит будить. Заметка, подпись, пресет и
 *  локация сюда не входят — см. спеку. */
const SIGNIFICANT = ["employeeId", "date", "endDate", "start", "end", "category"] as const;

function differs(a: Shift, b: Shift): boolean {
  return SIGNIFICANT.some((field) => a[field] !== b[field]);
}

/**
 * Что изменилось в расписании, по людям.
 *
 * Сравнение по `id`, поэтому запись, сменившую владельца, видно как снятие у
 * прежнего и постановку новому — для человека это ровно два разных факта.
 * Записи без сотрудника (вакантные) не принадлежат никому и в диф не попадают.
 */
export function diffSchedules(before: readonly Shift[], after: readonly Shift[]): Map<number, EmployeeDiff> {
  const result = new Map<number, EmployeeDiff>();
  const bucket = (employeeId: number): EmployeeDiff => {
    let d = result.get(employeeId);
    if (!d) { d = { added: [], removed: [], changed: [] }; result.set(employeeId, d); }
    return d;
  };

  const beforeById = new Map(before.map((s) => [s.id, s]));
  const afterById = new Map(after.map((s) => [s.id, s]));

  for (const now of after) {
    const was = beforeById.get(now.id);
    if (!was) {
      if (now.employeeId != null) bucket(now.employeeId).added.push(now);
      continue;
    }
    if (!differs(was, now)) continue;
    if (was.employeeId !== now.employeeId) {
      if (was.employeeId != null) bucket(was.employeeId).removed.push(was);
      if (now.employeeId != null) bucket(now.employeeId).added.push(now);
      continue;
    }
    if (now.employeeId != null) bucket(now.employeeId).changed.push({ before: was, after: now });
  }

  for (const was of before) {
    if (afterById.has(was.id)) continue;
    if (was.employeeId != null) bucket(was.employeeId).removed.push(was);
  }

  return result;
}
```

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run schedule-diff`
Expected: PASS (7 тестов)

- [ ] **Step 5: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add server/src/schedule/schedule-diff.ts server/src/schedule/schedule-diff.test.ts
git commit -m "feat(server): diffSchedules — что изменилось в расписании, по людям"
```

---

### Task 4: тексты писем и отправка одиночной правки

**Files:**
- Create: `server/src/schedule/change-notice.ts`
- Test: `server/src/schedule/change-notice.test.ts`

**Interfaces:**
- Consumes: `entryLineOf` (Task 2), `EmployeeDiff` (Task 3), `notifyUser` из `../bot/notify`, `addressOf` из `@planer/shared`, `getEmployeeById` из `../repo/employees`
- Produces:
  ```ts
  export function entryAddedText(actorName: string, line: string): string
  export function entryRemovedText(actorName: string, line: string): string
  export function entryChangedText(actorName: string, before: string, after: string): string
  export function scheduleSummaryText(actorName: string, cause: ChangeCause, diff: EmployeeDiff): string
  export type ChangeCause = "file" | "distribute" | "fill_week"
  export interface NotifyReach { delivered: number; intended: number }
  export async function notifyEntryChange(db, bot, opts): Promise<NotifyReach>
  ```

- [ ] **Step 1: Написать падающий тест на тексты**

```ts
import { describe, expect, it } from "vitest";
import { entryAddedText, entryRemovedText, entryChangedText } from "./change-notice";

describe("тексты одиночной правки", () => {
  it("поставили", () => {
    expect(entryAddedText("Аня", "Пт 7 авг · 15:00–23:00 · Вечер"))
      .toBe("Аня поставил(а) тебе смену: Пт 7 авг · 15:00–23:00 · Вечер.");
  });
  it("сняли", () => {
    expect(entryRemovedText("Аня", "Ср 5 авг · 08:00–17:00 · Утро"))
      .toBe("Аня снял(а) с тебя смену: Ср 5 авг · 08:00–17:00 · Утро.");
  });
  it("изменили — называет и было, и стало", () => {
    expect(entryChangedText("Аня", "Ср 5 авг · 08:00–17:00 · Утро", "Пт 7 авг · 15:00–23:00 · Вечер"))
      .toBe("Аня изменил(а) твою смену: было Ср 5 авг · 08:00–17:00 · Утро → стало Пт 7 авг · 15:00–23:00 · Вечер.");
  });
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run change-notice`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать тексты**

```ts
export function entryAddedText(actorName: string, line: string): string {
  return `${actorName} поставил(а) тебе смену: ${line}.`;
}
export function entryRemovedText(actorName: string, line: string): string {
  return `${actorName} снял(а) с тебя смену: ${line}.`;
}
export function entryChangedText(actorName: string, before: string, after: string): string {
  return `${actorName} изменил(а) твою смену: было ${before} → стало ${after}.`;
}
```

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run change-notice`
Expected: PASS

- [ ] **Step 5: Написать падающий тест на `notifyEntryChange`**

```ts
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { notifyEntryChange } from "./change-notice";
import type { Bot } from "grammy";

function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  return { sent, bot: { api: { sendMessage: async (to: number, text: string) => { sent.push({ to, text }); } } } as unknown as Bot };
}
const shift = (over: object = {}) => ({
  id: 1, employeeId: 2, date: "2026-09-10", endDate: null, start: "08:00", end: "17:00",
  category: "shift", title: "Утро", templateId: 1, note: null, location: null, unrecognisedCode: null, ...over,
} as never);

describe("notifyEntryChange", () => {
  const setup = () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Админ", inviteToken: "inv-a" });
    const worker = createEmployee(db, { displayName: "Работник", inviteToken: "inv-w" });
    linkTelegramAccount(db, "inv-w", 555);
    return { db, adminId: admin.id, workerId: worker.id };
  };
  const now = { date: "2026-09-01", time: "10:00" };

  it("о новой записи пишет её владельцу", async () => {
    const { db, adminId, workerId } = setup();
    const { bot, sent } = fakeBot();
    const reach = await notifyEntryChange(db, bot, { actorEmployeeId: adminId, before: null, after: shift({ employeeId: workerId }), now });
    expect(reach).toEqual({ delivered: 1, intended: 1 });
    expect(sent[0]!.to).toBe(555);
    expect(sent[0]!.text).toContain("поставил(а) тебе смену");
  });

  it("молчит про день, который уже прошёл", async () => {
    const { db, adminId, workerId } = setup();
    const { bot, sent } = fakeBot();
    const reach = await notifyEntryChange(db, bot, {
      actorEmployeeId: adminId, before: null, after: shift({ employeeId: workerId, date: "2026-08-20" }), now,
    });
    expect(reach).toEqual({ delivered: 0, intended: 0 });
    expect(sent).toEqual([]);
  });

  it("не пишет админу про его собственную запись", async () => {
    const { db, adminId } = setup();
    linkTelegramAccount(db, "inv-a", 111);
    const { bot, sent } = fakeBot();
    const reach = await notifyEntryChange(db, bot, { actorEmployeeId: adminId, before: null, after: shift({ employeeId: adminId }), now });
    expect(reach).toEqual({ delivered: 0, intended: 0 });
    expect(sent).toEqual([]);
  });

  it("непривязанный считается в intended, но не в delivered", async () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Админ", inviteToken: "inv-a" });
    const worker = createEmployee(db, { displayName: "Работник", inviteToken: "inv-w" });
    const { bot, sent } = fakeBot();
    const reach = await notifyEntryChange(db, bot, { actorEmployeeId: admin.id, before: null, after: shift({ employeeId: worker.id }), now });
    expect(reach).toEqual({ delivered: 0, intended: 1 });
    expect(sent).toEqual([]);
  });

  it("смена владельца — снято прежнему, поставлено новому", async () => {
    const { db, adminId, workerId } = setup();
    const other = createEmployee(db, { displayName: "Второй", inviteToken: "inv-2" });
    linkTelegramAccount(db, "inv-2", 777);
    const { bot, sent } = fakeBot();
    await notifyEntryChange(db, bot, {
      actorEmployeeId: adminId, before: shift({ employeeId: workerId }), after: shift({ employeeId: other.id }), now,
    });
    expect(sent.find((m) => m.to === 555)!.text).toContain("снял(а) с тебя смену");
    expect(sent.find((m) => m.to === 777)!.text).toContain("поставил(а) тебе смену");
  });
});
```

- [ ] **Step 6: Прогнать, убедиться что падает**

Run: `npx vitest run change-notice`
Expected: FAIL — `notifyEntryChange is not a function`.

- [ ] **Step 7: Реализовать `notifyEntryChange`**

```ts
import { addressOf } from "@planer/shared";
import type { Bot } from "grammy";
import type { Db } from "../db/client";
import type { Shift } from "../db/schema";
import { getEmployeeById } from "../repo/employees";
import { notifyUser } from "../bot/notify";
import { entryLineOf } from "../util/message-lines";
import { diffSchedules } from "./schedule-diff";

export interface NotifyReach { delivered: number; intended: number }

interface EntryChangeOpts {
  actorEmployeeId: number;
  before: Shift | null;
  after: Shift | null;
  now: { date: string; time: string };
}

/**
 * Пишет человеку, что с его записью сделали.
 *
 * Зовётся ПОСЛЕ коммита: упавший Telegram не должен откатывать правку графика,
 * поэтому функция ничего не бросает и отвечает только тем, до скольких дошло.
 * Тумблер `remindersEnabled` здесь намеренно не спрашивается — это отдельный
 * канал (решение Антона, см. спеку): выключив шум напоминаний, человек не
 * отказывался узнавать, что его смену перенесли.
 */
export async function notifyEntryChange(db: Db, bot: Bot | undefined, opts: EntryChangeOpts): Promise<NotifyReach> {
  if (!bot) return { delivered: 0, intended: 0 };
  const diff = diffSchedules(opts.before ? [opts.before] : [], opts.after ? [opts.after] : []);
  let delivered = 0;
  let intended = 0;

  for (const [employeeId, d] of diff) {
    if (employeeId === opts.actorEmployeeId) continue; // себе не пишем
    const texts: string[] = [];
    const actor = getEmployeeById(db, opts.actorEmployeeId);
    const actorName = actor ? addressOf(actor) : "Админ";
    for (const s of d.added) if (!isPast(s, opts.now.date)) texts.push(entryAddedText(actorName, entryLineOf(s)));
    for (const s of d.removed) if (!isPast(s, opts.now.date)) texts.push(entryRemovedText(actorName, entryLineOf(s)));
    for (const c of d.changed) {
      // Перенос ИЗ прошлого в будущее — это про будущее, о нём сказать надо.
      if (isPast(c.before, opts.now.date) && isPast(c.after, opts.now.date)) continue;
      texts.push(entryChangedText(actorName, entryLineOf(c.before), entryLineOf(c.after)));
    }
    if (texts.length === 0) continue;

    intended += 1;
    const target = getEmployeeById(db, employeeId);
    if (target?.telegramUserId == null) continue;
    let ok = true;
    for (const text of texts) ok = (await notifyUser(bot, target.telegramUserId, text)) && ok;
    if (ok) delivered += 1;
  }
  return { delivered, intended };
}

/** Запись целиком в прошлом: даже её последний день раньше сегодняшнего. */
function isPast(s: Shift, today: string): boolean {
  return (s.endDate ?? s.date) < today;
}
```

- [ ] **Step 8: Прогнать — зелено**

Run: `npx vitest run change-notice`
Expected: PASS (10 тестов — 8 по плану плюс два на ветку «прошлое»)

- [ ] **Step 9: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add server/src/schedule/change-notice.ts server/src/schedule/change-notice.test.ts
git commit -m "feat(server): письмо работнику о правке его записи — тексты и отправка"
```

---

### Task 5: подключить роуты создания, правки и удаления записи

**Files:**
- Modify: `server/src/http/app.ts:718-830` (три роута записей)
- Test: `server/src/http/entries.test.ts`

**Interfaces:**
- Consumes: `notifyEntryChange` (Task 4)
- Produces: три роута возвращают дополнительное поле `notified: { delivered, intended }`

- [ ] **Step 1: Написать падающий тест**

Дописать в `server/src/http/entries.test.ts`. Хелперы `fakeBot`, `tokenFor`, `send`, `auth` уже есть в `birthdays-route.test.ts` — скопировать их шапку, если в `entries.test.ts` их нет.

```ts
describe("уведомление о правке записи", () => {
  /** Админ (allowlisted, id 111) и привязанный работник. Возвращает всё, что нужно роутам. */
  async function stage() {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const worker = createEmployee(db, { displayName: "Работник", inviteToken: "inv-w" });
    linkTelegramAccount(db, "inv-w", 555);
    return { db, app, token, sent, workerId: worker.id, bot };
  }
  const entryBody = (over: object = {}) => ({
    employeeId: 0, date: "2099-09-10", start: "08:00", end: "17:00", category: "shift", title: "Утро", ...over,
  });

  it("создание записи пишет её владельцу", async () => {
    const { app, token, sent, workerId } = await stage();
    const res = await app.request("/api/admin/entries", send(token, entryBody({ employeeId: workerId }), "POST"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ notified: { delivered: 1, intended: 1 } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(555);
    expect(sent[0]!.text).toContain("поставил(а) тебе смену");
  });

  it("перенос даты пишет «было → стало»", async () => {
    const { app, token, sent, workerId } = await stage();
    const created = await (await app.request("/api/admin/entries", send(token, entryBody({ employeeId: workerId }), "POST"))).json();
    sent.length = 0;
    await app.request(`/api/admin/entries/${created.entry.id}`, send(token, { date: "2099-09-12" }, "PATCH"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("было");
    expect(sent[0]!.text).toContain("стало");
  });

  it("удаление пишет «снял(а) с тебя смену»", async () => {
    const { app, token, sent, workerId } = await stage();
    const created = await (await app.request("/api/admin/entries", send(token, entryBody({ employeeId: workerId }), "POST"))).json();
    sent.length = 0;
    await app.request(`/api/admin/entries/${created.entry.id}`, send(token, {}, "DELETE"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("снял(а) с тебя смену");
  });

  it("правка только заметки никого не будит", async () => {
    const { app, token, sent, workerId } = await stage();
    const created = await (await app.request("/api/admin/entries", send(token, entryBody({ employeeId: workerId }), "POST"))).json();
    sent.length = 0;
    const res = await app.request(`/api/admin/entries/${created.entry.id}`, send(token, { note: "привёз ключи" }, "PATCH"));
    expect(await res.json()).toMatchObject({ notified: { delivered: 0, intended: 0 } });
    expect(sent).toEqual([]);
  });

  it("упавший Telegram не отменяет правку", async () => {
    const { db, app, token, workerId, bot } = await stage();
    const created = await (await app.request("/api/admin/entries", send(token, entryBody({ employeeId: workerId }), "POST"))).json();
    (bot.api.sendMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("429: Too Many Requests"));
    const res = await app.request(`/api/admin/entries/${created.entry.id}`, send(token, { date: "2099-09-12" }, "PATCH"));
    expect(res.status, "правка графика не зависит от Telegram").toBe(200);
    expect(getShift(db, created.entry.id)!.date).toBe("2099-09-12");
  });
});
```

Даты намеренно в 2099 году: правило «про прошедшие дни молчим» иначе погасило бы письмо, и тест бы врал.

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run entries`
Expected: FAIL — `body.notified` undefined, `sent` пуст.

- [ ] **Step 3: Реализовать**

В `POST /api/admin/entries` после `recordAudit`:

```ts
const notified = await notifyEntryChange(db, bot, {
  actorEmployeeId: c.get("auth").employeeId, before: null, after: entry, now: teamNow(config.teamTz),
});
return c.json({ entry, notified }, 201);
```

В `PATCH` — `before: existing, after: entry`; в `DELETE` — `before: existing, after: null`.
Во всех трёх вызов идёт **после** записи в базу и в журнал, и его результат никогда не меняет код ответа.

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run entries`
Expected: PASS

- [ ] **Step 5: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add server/src/http/app.ts server/src/http/entries.test.ts
git commit -m "feat(api): правка записи пишет её владельцу"
```

---

### Task 6: сводное письмо и `withScheduleDiff`

**Files:**
- Modify: `server/src/schedule/change-notice.ts`
- Test: `server/src/schedule/change-notice.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ChangeCause = "file" | "distribute" | "fill_week";
  export function scheduleSummaryText(actorName: string, cause: ChangeCause, diff: EmployeeDiff): string
  export async function notifyScheduleChange(db, bot, opts: { actorEmployeeId: number; diffs: Map<number, EmployeeDiff>; cause: ChangeCause; now: { date: string; time: string } }): Promise<NotifyReach>
  export function withScheduleDiff<T>(db: Db, range: { from: string; to: string }, work: () => T): { result: T; diffs: Map<number, EmployeeDiff> }
  ```

- [ ] **Step 1: Написать падающий тест**

```ts
describe("сводное письмо", () => {
  const diff = { added: [a1, a2, a3], removed: [r1], changed: [{ before: c1, after: c2 }] };

  it("считает и перечисляет", () => {
    const text = scheduleSummaryText("Аня", "file", diff);
    expect(text).toContain("Аня обновил(а) твой график (загрузка файла)");
    expect(text).toContain("+3 смены");
    expect(text).toContain("−1");
    expect(text).toContain("изменено 2");
  });

  it("обрезает список на десяти строках", () => {
    const many = { added: Array.from({ length: 14 }, (_, i) => entryAt(i)), removed: [], changed: [] };
    const text = scheduleSummaryText("Аня", "distribute", many);
    expect(text.split("\n• ").length - 1).toBe(10);
    expect(text).toContain("…и ещё 4");
  });

  it("одна запись — не сводка, а обычный одиночный текст", () => {
    const one = { added: [a1], removed: [], changed: [] };
    expect(scheduleSummaryText("Аня", "fill_week", one)).toBe(entryAddedText("Аня", entryLineOf(a1)));
  });
});

describe("withScheduleDiff", () => {
  it("видит то, что операция реально сделала с базой", () => {
    // создать запись внутри work(), проверить что она в diffs
  });
});

describe("notifyScheduleChange", () => {
  it("шлёт ровно одно письмо человеку, сколько бы записей ни поменялось", async () => {
    // диф из 12 добавленных у одного человека → sent.length === 1
  });
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run change-notice`
Expected: FAIL — функций нет.

- [ ] **Step 3: Реализовать**

```ts
export type ChangeCause = "file" | "distribute" | "fill_week";

const CAUSE_LABEL: Record<ChangeCause, string> = {
  file: "загрузка файла",
  distribute: "распределение смен",
  fill_week: "заполнение недели",
};

const MAX_LINES = 10;

/**
 * Одно письмо на человека вместо письма на запись.
 *
 * Импорт августа это 538 записей; поштучно это лавина в чат и гарантированный
 * 429 от Telegram. Одна запись сводкой не оформляется — там сводить нечего,
 * и обычный одиночный текст точнее.
 */
export function scheduleSummaryText(actorName: string, cause: ChangeCause, diff: EmployeeDiff): string {
  const total = diff.added.length + diff.removed.length + diff.changed.length;
  if (total === 1) {
    if (diff.added[0]) return entryAddedText(actorName, entryLineOf(diff.added[0]));
    if (diff.removed[0]) return entryRemovedText(actorName, entryLineOf(diff.removed[0]));
    const c = diff.changed[0]!;
    return entryChangedText(actorName, entryLineOf(c.before), entryLineOf(c.after));
  }
  const counts: string[] = [];
  if (diff.added.length) counts.push(`+${diff.added.length} ${plural(diff.added.length, "смена", "смены", "смен")}`);
  if (diff.removed.length) counts.push(`−${diff.removed.length}`);
  if (diff.changed.length) counts.push(`изменено ${diff.changed.length}`);

  const lines = [
    ...diff.added.map((s) => `+ ${entryLineOf(s)}`),
    ...diff.removed.map((s) => `− ${entryLineOf(s)}`),
    ...diff.changed.map((c) => `→ ${entryLineOf(c.before)} → ${entryLineOf(c.after)}`),
  ];
  const shown = lines.slice(0, MAX_LINES).map((l) => `\n• ${l}`).join("");
  const rest = lines.length > MAX_LINES ? `\n…и ещё ${lines.length - MAX_LINES}` : "";
  return `${actorName} обновил(а) твой график (${CAUSE_LABEL[cause]}): ${counts.join(", ")}.${shown}${rest}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100, mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Снимок расписания диапазона до и после операции.
 *
 * Считаем изменение по базе, а не по отчёту сервиса о самом себе: одна механика
 * на импорт, распределение и заполнение недели, и она не может разойтись с тем,
 * что реально легло в базу. `listShiftsOverlapping`, а не `listShiftsInRange` —
 * иначе многодневное отсутствие, начавшееся до `from`, в снимке отсутствует и
 * его удаление выглядит как «ничего не менялось».
 */
export function withScheduleDiff<T>(db: Db, range: { from: string; to: string }, work: () => T): { result: T; diffs: Map<number, EmployeeDiff> } {
  const before = listShiftsOverlapping(db, range.from, range.to);
  const result = work();
  const after = listShiftsOverlapping(db, range.from, range.to);
  return { result, diffs: diffSchedules(before, after) };
}
```

`notifyScheduleChange` — тот же фильтр, что в `notifyEntryChange` (себе не шлём, прошлое не шлём, `intended` считает непривязанных), но одно сообщение на человека: `scheduleSummaryText`.

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run change-notice`
Expected: PASS

- [ ] **Step 5: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add server/src/schedule/change-notice.ts server/src/schedule/change-notice.test.ts
git commit -m "feat(server): сводное письмо о массовой правке графика"
```

---

### Task 7: подключить импорт CSV и «Распределить честно»

**Files:**
- Modify: `server/src/http/app.ts` (`POST /api/admin/roster/import/apply`, `POST /api/admin/distribute`)
- Test: `server/src/http/roster-route.test.ts`, `server/src/http/distribute.test.ts`

**Interfaces:**
- Consumes: `withScheduleDiff`, `notifyScheduleChange` (Task 6)

- [ ] **Step 1: Написать падающий тест**

```ts
it("импорт месяца пишет каждому по одному письму, а не по письму на запись", async () => {
  // файл на двоих × месяц; ожидание: sent.length === 2, в каждом «обновил(а) твой график»
  expect(sent).toHaveLength(2);
  expect(sent[0]!.text).toContain("обновил(а) твой график (загрузка файла)");
  expect(body.notified.intended).toBe(2);
});

it("«Распределить честно» пишет тем, кому достались смены", async () => {
  expect(sent[0]!.text).toContain("распределение смен");
});

it("превью распределения (apply:false) не пишет никому", async () => {
  expect(sent).toEqual([]);
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run roster-route distribute`
Expected: FAIL — `sent` пуст.

- [ ] **Step 3: Реализовать**

Импорт: обернуть `applyRosterImport` в `withScheduleDiff(db, { from: preview.from, to: preview.to }, …)`, после — `notifyScheduleChange(..., cause: "file")`, результат положить в ответ как `notified`.

Распределение: только ветка `apply === true`; диапазон — `from`/`to` запроса; `cause: "distribute"`.

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run roster-route distribute`
Expected: PASS

- [ ] **Step 5: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add server/src/http/app.ts server/src/http/roster-route.test.ts server/src/http/distribute.test.ts
git commit -m "feat(api): импорт и распределение шлют одно сводное письмо на человека"
```

---

### Task 8: bulk-роут и переезд «Заполнить неделю»

**Files:**
- Modify: `server/src/http/app.ts` (новый `POST /api/admin/entries/bulk`)
- Modify: `miniapp/src/api/client.ts`, `miniapp/src/api/mock.ts`
- Modify: `miniapp/src/screens/admin/AdminScheduleScreen.tsx` (цикл `createEntry` → один вызов)
- Test: `server/src/http/entries.test.ts`, `miniapp/src/screens/admin/AdminScheduleScreen.test.ts`

**Interfaces:**
- Produces: `POST /api/admin/entries/bulk` — тело `{ entries: CreateEntryInput[] }`, ответ `{ created: number; entries: Shift[]; notified: NotifyReach }`
- Produces: `apiClient.createEntries(inputs): Promise<{ created: number; notified: NotifyReach }>`

- [ ] **Step 1: Написать падающий тест**

```ts
it("bulk пишет все записи в одной транзакции", async () => {
  // 7 входов, один из которых ссылается на архивного → 400 и в базе НИ ОДНОЙ записи
});

it("bulk шлёт одно письмо на человека, а не семь", async () => {
  // 7 дней одному человеку → sent.length === 1, текст содержит «заполнение недели»
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run entries`
Expected: FAIL — 404 на роут.

- [ ] **Step 3: Реализовать роут**

```ts
app.post("/api/admin/entries/bulk", requireAdmin(db, config.jwtSecret), async (c) => {
  const parsed = z.object({ entries: z.array(createEntrySchema).min(1).max(200) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  for (const input of parsed.data.entries) {
    const archived = archivedTargetError(input.employeeId);
    if (archived) return c.json({ error: archived }, 400);
  }
  const dates = parsed.data.entries.map((e) => e.date).sort();
  const { result: entries, diffs } = withScheduleDiff(db, { from: dates[0]!, to: dates.at(-1)! }, () =>
    db.transaction(() => parsed.data.entries.map((input) => createShift(db, input))),
  );
  for (const entry of entries) recordAudit(db, "entry_created", c.get("auth").employeeId, auditShape(entry));
  const notified = await notifyScheduleChange(db, bot, {
    actorEmployeeId: c.get("auth").employeeId, diffs, cause: "fill_week", now: teamNow(config.teamTz),
  });
  return c.json({ created: entries.length, entries, notified }, 201);
});
```

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run entries`
Expected: PASS

- [ ] **Step 5: Переключить «Заполнить неделю» на bulk**

В `AdminScheduleScreen.tsx` заменить цикл (`for (const iso of chosenDays) { … await apiClient.createEntry(input); }`) на сборку массива и один `await apiClient.createEntries(inputs)`. Добавить метод в оба клиента и в DEV-мок мини-аппа.

- [ ] **Step 6: Прогнать экранный тест и полный гейт, закоммитить**

```bash
npx vitest run AdminScheduleScreen
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add server/src/http/app.ts server/src/http/entries.test.ts miniapp/src
git commit -m "feat(api): bulk-запись — «Заполнить неделю» одной транзакцией и одним письмом"
```

---

### Task 9: обе админки говорят, до скольких дошло

**Files:**
- Modify: `miniapp/src/screens/admin/AdminScheduleScreen.tsx`, `admin/src/App.tsx`
- Modify: `miniapp/src/api/client.ts`, `admin/src/api/client.ts` (типы ответов)
- Test: `miniapp/src/screens/admin/AdminScheduleScreen.test.ts`, `admin/src/*.test.tsx`

**Interfaces:**
- Consumes: поле `notified: { delivered, intended }` из Task 5, 7, 8

- [ ] **Step 1: Написать падающий тест**

```ts
describe("notifyNotice", () => {
  it("молчит, когда дошло до всех", () => expect(notifyNotice({ delivered: 3, intended: 3 })).toBeNull());
  it("говорит, когда дошло не до всех", () =>
    expect(notifyNotice({ delivered: 1, intended: 3 })).toBe("Уведомление дошло до 1 из 3: остальные не подключили телеграм."));
  it("молчит, когда уведомлять было некого", () => expect(notifyNotice({ delivered: 0, intended: 0 })).toBeNull());
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run AdminScheduleScreen`
Expected: FAIL — `notifyNotice is not a function`.

- [ ] **Step 3: Реализовать и подцепить к существующим `notice`**

Правило то же, что у `reachNotice` (`c1d03cd`): молчим, когда дошло до всех, и говорим вслух, когда нет. Строку приписывать к уже существующему сообщению об успехе (сохранение записи, импорт, распределение, заполнение недели) — отдельного места для неё заводить не надо.

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run AdminScheduleScreen`
Expected: PASS

- [ ] **Step 5: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add miniapp/src admin/src
git commit -m "feat(ui): админ видит, до скольких дошло уведомление о правке графика"
```

---

## Проверка после всех задач

- [x] Полный гейт зелёный — 1005 тестов, typecheck, оба билда.
- [x] `npx vitest run no-real-names` — сторож приватности зелёный.
- [x] Живая проверка в Chromium на DEV-моке: правка записи без телеграма у адресата даёт
      «Уведомление дошло до 0 из 1: остальные не подключили телеграм»; с телеграмом —
      молчит. «Заполнить неделю» на три дня — один запрос: 665мс (мок делает ОДНУ
      задержку `delay(300)` независимо от числа дней), «Заполнено дней: 3.» без хвоста
      `notifyNotice`. Вкладку Network проверить не на чем — DEV-мок вызывается
      in-process, а не через `fetch`; таймингом и кодом (`apiClient.createEntries` —
      единственный оставшийся вызов создания в `FillWeekPanel`, цикла нет) доказано,
      что запрос ровно один.
- [x] Обновить `docs/audit/ledger.md`: фича закрывает дыру канала, который линза
      `notify` не проверяла (та смотрела на глухих получателей, а тут не было
      отправителя вовсе).
