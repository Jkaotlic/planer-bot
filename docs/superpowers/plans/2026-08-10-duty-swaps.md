# Обмен дежурствами и подсветка дежурства — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** работники могут меняться дежурствами так же, как сменами, и всюду, где виден обмен, вид записи назван словами.

**Architecture:** знание «чем можно меняться» сводится к одной функции `isSwappable` в `@planer/shared` (сегодня оно записано трижды — в shared и двумя рукописными копиями в мини-аппе). Подпись записи («Дежурство · Поклонка») даёт `entryLineOf`, который уже есть; `shiftLineOf` начинает через него строиться, и это одной правкой чинит все тексты бота и журнал, потому что все они собираются из `swapAuditPayload`. Пул дежурства ничего не запрещает (решение владельца) — он только добавляет строку в сообщение берущему и в рассылку админам.

**Tech Stack:** TypeScript (ESM, workspaces), vitest 2.1, Drizzle + better-sqlite3, Hono, grammY, React 19 + @telegram-apps/telegram-ui.

**Спека:** `docs/superpowers/specs/2026-08-10-duty-swaps-design.md`
**Ветка:** `feature/duty-swaps` (уже создана, спека на ней закоммичена)

## Global Constraints

- **Слой 1 — TDD обязателен.** Каждая задача: сначала падающий тест, потом минимальная реализация. Никаких «посмотрел код, должно работать».
- Тесты гоняются из корня: `npx vitest run <путь>`; вся сюита — `npm test`; типы — `npm run typecheck`.
- **Комментарии и текст интерфейса — по-русски**, как в существующем коде. Комментарий объясняет *почему*, а не *что*.
- **Никаких настоящих ФИО** в коде, тестах и доках: репозиторий публичный, сторож — `server/src/db/no-real-names.test.ts`. В фикстурах использовать «Аня», «Игорь», «Марк» — те же, что уже в тестах.
- Названия дежурств брать из уже существующих в репозитории: «Дежурство · Поклонка», «Дежурство · Вавилова 19», «Дежурство · Телефон» (`server/src/roster/roster-codec.ts:112-123`).
- **Ни одной новой причины отказа**: `SWAP_REJECT_REASONS` не растёт. Пул не запрещает.
- **Метка — словом**, цвет только вдобавок (правило проекта, зафиксировано на `TodayChip`).
- Коммитить после каждой задачи, сообщение — по-русски, в стиле истории репозитория (`feat(...)`, `fix(...)`, `refactor(...)`, `docs(...)`).

---

## Структура файлов

| Файл | Ответственность | Задача |
|---|---|---|
| `shared/src/category.ts` | единственный источник правды «чем можно меняться» | 1 |
| `shared/src/category.test.ts` | полнота: перебор всех категорий | 1 |
| `server/src/swap/swap-service.test.ts` | правила обмена на дежурствах, сторожа на закрытые категории | 1 |
| `README.md` | одна строка описания фичи | 1 |
| `server/src/util/message-lines.ts` | `shiftLineOf` называет вид записи через `entryLineOf` | 2 |
| `server/src/util/message-lines.test.ts` | подпись строки про запись графика | 2 |
| `server/src/bot/notify.ts` | все тексты про обмен, включая новый `swapProposalText` | 3, 4 |
| `server/src/bot/notify.test.ts` | тексты | 3, 4 |
| `server/src/swap/duty-notice.ts` | **новый:** факт «берущий вне пула дежурства» | 4 |
| `server/src/swap/duty-notice.test.ts` | **новый** | 4 |
| `server/src/http/app.ts` | предложение → билдер, уведомления админам, `category` в сводке | 3, 4, 5 |
| `server/src/bot/bot.ts` | тот же хвост админам на пути кнопки «Принять» | 4 |
| `miniapp/src/api/client.ts` | `category` в `SwapShiftSummary` | 5 |
| `miniapp/src/api/mock.ts` | сводка в моке | 5 |
| `miniapp/src/lib/swap-candidates.ts` | копия правила → `isSwappable` | 6 |
| `miniapp/src/components/ShiftRow.tsx` | копия правила → `isSwappable` | 6 |
| `miniapp/src/lib/swap-candidates-parity.test.ts` | **новый:** сторож против четвёртой копии правила | 6 |
| `miniapp/src/screens/ProposeSwapScreen.tsx` | `EntryChip` вместо текстовой подписи | 7 |
| `miniapp/src/App.tsx` | передаёт `templates` на экран предложения | 7 |
| `miniapp/src/components/SwapRequestCard.tsx` | подпись и метка дежурства в карточках | 7 |

---

### Task 1: Дежурство становится обменным

**Files:**
- Modify: `shared/src/category.ts:31-34`
- Modify: `shared/src/category.test.ts:21-23`
- Test: `server/src/swap/swap-service.test.ts` (дописать в конец файла новый `describe`)
- Modify: `README.md:18`

**Interfaces:**
- Consumes: ничего (первая задача).
- Produces: `isSwappable(category: EntryCategory): boolean` из `@planer/shared` — теперь `true` для `"shift"` и `"duty"`. Задачи 6 и 7 зовут её из мини-аппа.

- [ ] **Step 1: Написать падающие тесты про дежурство в свап-сервисе**

Дописать в конец `server/src/swap/swap-service.test.ts`. Файл уже импортирует `makeTestDb`, `createEmployee`, `createShift`, `getShift`, `createSwap`, `acceptSwap`, `setSwapsLocked`. **Добавить** в его импорты:
- `shiftTemplates` — в уже существующий импорт `{ employees }` из `../db/schema`;
- `setEmployeeRestrictions` — в уже существующий импорт из `../repo/employees` (сигнатура: `setEmployeeRestrictions(db, id, { excludedFromSwaps?: boolean, excludedFromAssignment?: boolean })`).

```ts
/**
 * Дежурство обменивается как смена — его решение от 2026-08-10.
 *
 * Пул дежурства при этом ничего не запрещает: он остаётся правилом автораздачи.
 * Поэтому здесь нет ни одного теста «отказал из-за пула» — отказывать нечем.
 */
describe("обмен дежурствами", () => {
  function dutySetup() {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    const pokl = db
      .insert(shiftTemplates)
      .values({ name: "Дежурство · Поклонка", category: "duty", start: "09:00", end: "18:00", location: "Поклонка" })
      .returning()
      .all()[0]!;
    const duty = createShift(db, {
      date: "2026-07-10", start: "09:00", end: "18:00", category: "duty",
      templateId: pokl.id, title: pokl.name, employeeId: anya.id,
    });
    const shift = createShift(db, { date: "2026-07-10", start: "11:00", end: "20:00", employeeId: igor.id });
    return { db, anya, igor, pokl, duty, shift };
  }

  it("дежурство меняется на обычную смену того же дня и исполняется", () => {
    const { db, anya, igor, duty, shift } = dutySetup();
    const proposed = createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: shift.id }, NOW);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    const accepted = acceptSwap(db, proposed.request.id, igor.id, NOW);
    expect(accepted.ok).toBe(true);
    expect(getShift(db, duty.id)!.employeeId).toBe(igor.id);
    expect(getShift(db, shift.id)!.employeeId).toBe(anya.id);
  });

  it("два разных дежурства в один день — настоящий обмен", () => {
    const { db, anya, igor, duty } = dutySetup();
    const v19 = db
      .insert(shiftTemplates)
      .values({ name: "Дежурство · Вавилова 19", category: "duty", start: "10:00", end: "19:00", location: "Вавилова 19" })
      .returning()
      .all()[0]!;
    const his = createShift(db, {
      date: duty.date, start: "10:00", end: "19:00", category: "duty",
      templateId: v19.id, title: v19.name, employeeId: igor.id,
    });
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: his.id }, NOW).ok).toBe(true);
  });

  it("одно и то же дежурство у обоих — обмен ничего не изменит", () => {
    const { db, anya, igor, pokl, duty } = dutySetup();
    const his = createShift(db, {
      date: duty.date, start: "09:00", end: "18:00", category: "duty",
      templateId: pokl.id, title: pokl.name, employeeId: igor.id,
    });
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: his.id }, NOW))
      .toEqual({ ok: false, reason: "identical-shift" });
  });

  // Сторож: открыли ровно дежурство и ничего больше.
  it.each(["offsite", "weekend_work", "vacation", "sick_leave", "business_trip"] as const)(
    "%s обменять по-прежнему нельзя",
    (category) => {
      const { db, anya, igor, duty } = dutySetup();
      const theirs = createShift(db, { date: duty.date, start: "11:00", end: "20:00", category, employeeId: igor.id });
      expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: theirs.id }, NOW))
        .toEqual({ ok: false, reason: "not_swappable" });
    },
  );

  // Сторож: дежурство без часов — это нечитаемая клетка импорта, отдавать нечего.
  it("дежурство без часов обменять нельзя", () => {
    const { db, anya, igor, shift } = dutySetup();
    const timeless = createShift(db, { date: shift.date, category: "duty", employeeId: anya.id });
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: timeless.id, toShiftId: shift.id }, NOW))
      .toEqual({ ok: false, reason: "not_swappable" });
    void igor;
  });

  // Сторож: общие запреты действуют на дежурство ровно так же.
  it("лок обменов закрывает и дежурства", () => {
    const { db, anya, duty, shift } = dutySetup();
    setSwapsLocked(db, true, anya.id);
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: shift.id }, NOW))
      .toEqual({ ok: false, reason: "swaps-locked" });
  });

  it("исключённый из обменов не отдаёт и не берёт дежурство", () => {
    const { db, anya, igor, duty, shift } = dutySetup();
    setEmployeeRestrictions(db, anya.id, { excludedFromSwaps: true });
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: shift.id }, NOW))
      .toEqual({ ok: false, reason: "from-excluded" });

    setEmployeeRestrictions(db, anya.id, { excludedFromSwaps: false });
    setEmployeeRestrictions(db, igor.id, { excludedFromSwaps: true });
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: shift.id }, NOW))
      .toEqual({ ok: false, reason: "to-excluded" });
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run server/src/swap/swap-service.test.ts`
Expected: FAIL — «дежурство меняется на обычную смену» и «два разных дежурства» получают `{ ok: false, reason: "not_swappable" }`; «одно и то же дежурство» тоже падает (`not_swappable` вместо `identical-shift`). Сторожа проходят уже сейчас.

Если `setSwapsLocked` в файле не импортирован или его сигнатура другая — сверить с `server/src/repo/settings.ts` и позвать так, как это делают уже существующие тесты лока в этом же файле.

- [ ] **Step 3: Минимальная реализация**

`shared/src/category.ts` — заменить функцию и её комментарий:

```ts
/**
 * Чем работники могут меняться между собой: обычные смены и дежурства
 * (его решение от 2026-08-10).
 *
 * Множество — рантайм-значение, а не только объединение типов, по той же
 * причине, что `SWAP_REJECT_REASONS` и `AUDIT_TYPES`: тест на полноту может
 * перебрать все категории и проверить, что обменных ровно две, вместо сверки
 * двух списков, набранных руками в разных файлах.
 *
 * ЕДИНСТВЕННОЕ место, где живёт это знание. Мини-апп зовёт эту же функцию —
 * и в списке кандидатов, и на кнопке «Обменять»: экран, прячущий кнопку там,
 * где сервер обмен разрешает, — наблюдаемый дефект, а не расхождение вкусов.
 */
const SWAPPABLE: ReadonlySet<EntryCategory> = new Set(["shift", "duty"]);

export function isSwappable(category: EntryCategory): boolean {
  return SWAPPABLE.has(category);
}
```

`shared/src/category.test.ts:21-23` — поправить ожидание и заголовок:

```ts
  it("меняться можно сменами и дежурствами", () => {
    expect(ALL.filter(isSwappable)).toEqual(["shift", "duty"]);
  });
```

`README.md:18` — заменить строку:

```markdown
- личные смены и прямой обмен сменами и дежурствами между сотрудниками;
```

- [ ] **Step 4: Прогнать — убедиться, что прошло**

Run: `npx vitest run shared/src/category.test.ts server/src/swap/swap-service.test.ts`
Expected: PASS, все тесты в обоих файлах.

Затем — проверка, что правило нигде больше не защёлкнуто: `npx vitest run server`
Expected: PASS. Если что-то упало, читать сообщение: это либо тест, который утверждал «дежурство не обменивается» как истину о продукте (его надо переписать под новое поведение и объяснить это в комментарии), либо настоящая регрессия.

- [ ] **Step 5: Коммит**

```bash
git add shared/src/category.ts shared/src/category.test.ts server/src/swap/swap-service.test.ts README.md
git commit -m "feat(обмен): дежурствами тоже можно меняться

isSwappable пропускает shift и duty. Остальные правила обмена — один
день, обе записи с часами, не в прошлом, не двойной букинг, лок и
исключения — применяются к дежурству без единого исключения, поэтому
новых причин отказа нет. Пул дежурства не запрещает ничего: его решение.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `shiftLineOf` называет вид записи

**Files:**
- Modify: `server/src/util/message-lines.ts:41-59`
- Test: `server/src/util/message-lines.test.ts` (дописать новый `describe`)

**Interfaces:**
- Consumes: `entryLineOf` из этого же файла (уже есть), `getTemplate(db, id)` из `../repo/templates`.
- Produces: `shiftLineOf(db, shiftId)` возвращает «Пт 10 июл · 09:00–18:00 · Дежурство · Поклонка». Формат меняется для **всех** текстов бота про обмен и всех записей журнала — они строятся из `swapAuditPayload`, который зовёт эту функцию.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `server/src/util/message-lines.test.ts`. В импорты добавить `shiftLineOf`, `makeTestDb`, `createShift`, `shiftTemplates`:

```ts
import { entryLineOf, shiftLineOf } from "./message-lines";
import { makeTestDb } from "../db/testdb";
import { createShift } from "../repo/shifts";
import { shiftTemplates } from "../db/schema";
```

```ts
/**
 * Та же подпись, что в клетке графика, — теперь и в сообщениях про обмен.
 *
 * Раньше здесь была своя, третья по счёту, копия форматирования даты, и она
 * называла только день и часы. Из-за этого сообщение с кнопками
 * «Принять/Отклонить» не говорило, что в обмене дежурство: человек брал
 * Поклонку, читая «Ср 12 авг · 09:00–18:00».
 */
describe("shiftLineOf", () => {
  it("дежурство называет себя", () => {
    const db = makeTestDb();
    const tpl = db
      .insert(shiftTemplates)
      .values({ name: "Дежурство · Поклонка", category: "duty", start: "09:00", end: "18:00" })
      .returning()
      .all()[0]!;
    const duty = createShift(db, {
      date: "2026-07-10", start: "09:00", end: "18:00", category: "duty",
      templateId: tpl.id, title: tpl.name,
    });
    expect(shiftLineOf(db, duty.id)).toBe("Пт 10 июл · 09:00–18:00 · Дежурство · Поклонка");
  });

  it("без своей подписи берёт имя пресета", () => {
    const db = makeTestDb();
    const tpl = db
      .insert(shiftTemplates)
      .values({ name: "Дежурство · Телефон", category: "duty", start: "09:00", end: "18:00" })
      .returning()
      .all()[0]!;
    const duty = createShift(db, {
      date: "2026-07-10", start: "09:00", end: "18:00", category: "duty",
      templateId: tpl.id, title: null,
    });
    expect(shiftLineOf(db, duty.id)).toBe("Пт 10 июл · 09:00–18:00 · Дежурство · Телефон");
  });

  it("без пресета и без подписи называет категорию", () => {
    const db = makeTestDb();
    const shift = createShift(db, { date: "2026-07-13", start: "08:00", end: "17:00" });
    expect(shiftLineOf(db, shift.id)).toBe("Пн 13 июл · 08:00–17:00 · Смена");
  });

  it("обычная смена называется своей подписью", () => {
    const db = makeTestDb();
    const shift = createShift(db, { date: "2026-07-13", start: "08:00", end: "17:00", title: "Утро" });
    expect(shiftLineOf(db, shift.id)).toBe("Пн 13 июл · 08:00–17:00 · Утро");
  });

  it("пропавшая запись остаётся «смену» — заявка переживает свою смену", () => {
    const db = makeTestDb();
    expect(shiftLineOf(db, null)).toBe("смену");
    expect(shiftLineOf(db, 9999)).toBe("смену");
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run server/src/util/message-lines.test.ts`
Expected: FAIL — четыре первых теста получают строку без хвоста, например `"Пт 10 июл · 09:00–18:00"`. Пятый (`"смену"`) проходит уже сейчас.

- [ ] **Step 3: Минимальная реализация**

В `server/src/util/message-lines.ts` заменить `shiftLineOf` целиком (тело со своим `Intl.DateTimeFormat` уходит — эту работу делает `entryLineOf`) и добавить импорт `getTemplate`:

```ts
import { getTemplate } from "../repo/templates";
```

```ts
/**
 * «Пт 10 июл · 09:00–18:00 · Дежурство · Поклонка» — строка про смену из базы,
 * читаемая без джойна назад к `shifts`: для сообщений бота и журнала.
 *
 * Строится тем же `entryLineOf`, что и письмо об изменении графика, а не своим
 * форматированием: одна запись графика должна называться одинаково во всех
 * сообщениях, и раньше не называлась — здесь не было ни категории, ни пресета,
 * так что сообщение с кнопками «Принять/Отклонить» не сообщало, что в обмене
 * дежурство.
 *
 * Общая для HTTP-слоя и кнопок бота, чтобы обмен, закрытый любым из двух
 * путей, дал ровно один текст.
 */
export function shiftLineOf(db: Db, shiftId: number | null): string {
  const shift = shiftId == null ? undefined : getShift(db, shiftId);
  // Заявка живёт дольше смены, на которую показывала (см. `swap_requests.from_shift_id`),
  // так что «нет записи» — это нормальный случай, а не ошибка.
  if (!shift) return "смену";
  return entryLineOf({ ...shift, title: shift.title ?? templateNameOf(db, shift.templateId) });
}

/** Имя пресета — для записей, которые своей подписи не несут. Та же
 *  подстраховка, что уже стоит в `shiftKind` на сервере и в консоли: старые
 *  строки писались без `title`. */
function templateNameOf(db: Db, templateId: number | null): string | null {
  return templateId == null ? null : (getTemplate(db, templateId)?.name ?? null);
}
```

- [ ] **Step 4: Прогнать — убедиться, что прошло**

Run: `npx vitest run server/src/util/message-lines.test.ts`
Expected: PASS.

Run: `npx vitest run server`
Expected: PASS. Тесты `change-notice` и `swap-lock-notice` передают готовые строки литералами, так что смена формата их не касается; если что-то в `server/src/http/swaps.test.ts` или `server/src/bot/bot.test.ts` сверяет текст сообщения целиком — поправить ожидание на новый формат (это и есть починка, ради которой задача написана).

- [ ] **Step 5: Коммит**

```bash
git add server/src/util/message-lines.ts server/src/util/message-lines.test.ts
git commit -m "feat(обмен): строка про смену называет вид записи

shiftLineOf строится через entryLineOf вместо своей копии формата даты,
и подставляет имя пресета там, где у записи нет своей подписи. Через
swapAuditPayload это разом чинит все сообщения про обмен и журнал:
раньше сообщение с кнопками «Принять/Отклонить» не говорило, что
человек берёт дежурство.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Текст предложения — билдер рядом с остальными

**Files:**
- Modify: `server/src/bot/notify.ts:14-35`
- Modify: `server/src/http/app.ts:1147-1152`
- Test: `server/src/bot/notify.test.ts`

**Interfaces:**
- Consumes: `SwapAuditPayload` из `../util/message-lines` (уже импортирован в `notify.ts`).
- Produces:
  - `swapProposalText(p: SwapAuditPayload, notices?: readonly string[]): string`
  - `swapAcceptedAdminText(p: SwapAuditPayload, notices?: readonly string[]): string` — вторым аргументом хвост уведомлений (задача 4 его наполняет; здесь он всегда пуст).

- [ ] **Step 1: Написать падающие тесты**

Дописать в `server/src/bot/notify.test.ts` (добавить `swapProposalText` и `swapAcceptedAdminText` в импорт из `./notify`):

```ts
/**
 * Текст предложения жил литералом в `app.ts`, а не среди остальных билдеров.
 * Это ровно тот класс дефекта, про который написана шапка `notify.ts`: два
 * текста, которые «сегодня совпадают», расходятся на первой же правке. И
 * именно в это сообщение встаёт уведомление про пул, потому что именно на нём
 * висят кнопки, которыми обмен исполняется.
 */
describe("swapProposalText", () => {
  const payload = {
    requestId: 1,
    fromEmployeeId: 1, fromName: "Аня", fromShift: "Ср 12 авг · 09:00–18:00 · Дежурство · Поклонка",
    toEmployeeId: 2, toName: "Игорь", toShift: "Ср 12 авг · 10:00–19:00 · День",
  };

  it("называет обе записи", () => {
    expect(swapProposalText(payload)).toBe(
      "«Аня предлагает обмен: отдаёт Ср 12 авг · 09:00–18:00 · Дежурство · Поклонка, хочет твою Ср 12 авг · 10:00–19:00 · День»",
    );
  });

  it("уведомления идут отдельным абзацем, чтобы их не проглядели над кнопками", () => {
    const text = swapProposalText(payload, ["⚠️ Что-то важное."]);
    expect(text.startsWith("«Аня предлагает обмен")).toBe(true);
    expect(text).toContain("\n\n⚠️ Что-то важное.");
  });

  it("без уведомлений ничего не приписывает", () => {
    expect(swapProposalText(payload, [])).toBe(swapProposalText(payload));
  });
});

describe("swapAcceptedAdminText", () => {
  const payload = {
    requestId: 1,
    fromEmployeeId: 1, fromName: "Аня", fromShift: "Ср 12 авг · 09:00–18:00 · Дежурство · Поклонка",
    toEmployeeId: 2, toName: "Игорь", toShift: "Ср 12 авг · 10:00–19:00 · День",
  };

  // «Обмен сменами состоялся» рядом с дежурством в паре — просто неправда.
  it("не называет обмен обменом смен", () => {
    expect(swapAcceptedAdminText(payload)).not.toContain("сменами");
    expect(swapAcceptedAdminText(payload)).toContain("Аня");
    expect(swapAcceptedAdminText(payload)).toContain("Игорь");
  });

  it("уведомления приписывает хвостом, пустой список — нет", () => {
    expect(swapAcceptedAdminText(payload, ["⚠️ Хвост."])).toContain("⚠️ Хвост.");
    expect(swapAcceptedAdminText(payload, [])).toBe(swapAcceptedAdminText(payload));
  });
});
```

Если файла `server/src/bot/notify.test.ts` нет — создать его с шапкой `import { describe, it, expect } from "vitest";` и импортом из `./notify`.

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run server/src/bot/notify.test.ts`
Expected: FAIL — `swapProposalText is not a function`, и «не называет обмен обменом смен» падает на слове «сменами».

- [ ] **Step 3: Минимальная реализация**

В `server/src/bot/notify.ts` добавить билдер рядом с остальными свап-текстами:

```ts
/**
 * Само предложение обмена — сообщение, на котором висят «Принять/Отклонить».
 *
 * Жило литералом в `app.ts`; переехало сюда по причине из шапки этого файла.
 * `notices` — то, что человек обязан прочитать ДО нажатия (см. `duty-notice.ts`);
 * отдельным абзацем, а не в конце строки, потому что строка с двумя записями
 * графика длинная, и приписанный к ней хвост читается как её продолжение.
 */
export function swapProposalText(p: SwapAuditPayload, notices: readonly string[] = []): string {
  const head = `«${p.fromName} предлагает обмен: отдаёт ${p.fromShift}, хочет твою ${p.toShift}»`;
  return notices.length === 0 ? head : `${head}\n\n${notices.join("\n")}`;
}
```

и заменить админский билдер:

```ts
/** Admin broadcast once a swap actually goes through. Named and dated, so with
 *  30 people on the team an admin can tell which swap this was. Не «обмен
 *  сменами»: с 2026-08-10 в паре может стоять дежурство. */
export function swapAcceptedAdminText(p: SwapAuditPayload, notices: readonly string[] = []): string {
  const head = `Обмен состоялся: ${p.fromName} (${p.fromShift}) ↔ ${p.toName} (${p.toShift}).`;
  return notices.length === 0 ? head : `${head} ${notices.join(" ")}`;
}
```

В `server/src/http/app.ts` заменить литерал (около строки 1147) на билдер:

```ts
      if (tg != null) {
        await notifySwapProposal(bot, tg, res.request.id, swapProposalText(swapAuditPayload(res.request)));
      }
```

Локальные `const fromName = ...` и `const text = ...` удалить. Добавить `swapProposalText` в импорт из `../bot/notify` (он там уже есть для других билдеров).

Замечание для реализующего: у `swapAuditPayload` имя не найденного работника — «Неизвестно», а у удалённого литерала было «Коллега». Разницы на практике нет: `displayName` — `NOT NULL`, а сама заявка держит внешний ключ на работника, так что «нет имени» здесь недостижимо. Отдельный фолбэк ради недостижимой ветки — второй источник правды, и он бы разошёлся с остальными шестью текстами.

- [ ] **Step 4: Прогнать — убедиться, что прошло**

Run: `npx vitest run server/src/bot/notify.test.ts server/src/http/swaps.test.ts`
Expected: PASS. Если `swaps.test.ts` сверяет текст предложения — поправить ожидание (формат тот же, изменился только источник строки).

- [ ] **Step 5: Коммит**

```bash
git add server/src/bot/notify.ts server/src/bot/notify.test.ts server/src/http/app.ts
git commit -m "refactor(обмен): текст предложения — билдером рядом с остальными

И «Обмен сменами состоялся» → «Обмен состоялся»: с дежурством в паре
старая формулировка врёт. Оба билдера принимают список уведомлений —
следующая задача его наполняет.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Пул не запрещает — пул говорит

**Files:**
- Create: `server/src/swap/duty-notice.ts`
- Create: `server/src/swap/duty-notice.test.ts`
- Modify: `server/src/bot/notify.ts` (два текста)
- Modify: `server/src/bot/notify.test.ts`
- Modify: `server/src/http/app.ts` (предложение + рассылка админам при accept)
- Modify: `server/src/bot/bot.ts:496` (та же рассылка на пути кнопки)

**Interfaces:**
- Consumes: `getShift` (`../repo/shifts`), `getTemplateRoles` (`../repo/template-roles`), `getTemplate` (`../repo/templates`), `getEmployeeById` (`../repo/employees`), `swapProposalText` / `swapAcceptedAdminText` из задачи 3.
- Produces:
  - `interface OutsidePoolFact { dutyName: string; receiverName: string }`
  - `outsidePoolFact(db: Db, input: { shiftId: number | null; receiverId: number }): OutsidePoolFact | null`
  - `outsidePoolFacts(db: Db, request: { fromEmployeeId: number; toEmployeeId: number; fromShiftId: number | null; toShiftId: number | null }): OutsidePoolFact[]`
  - в `notify.ts`: `dutyNoticeForReceiver(f: OutsidePoolFact): string`, `dutyNoticeForAdmins(f: OutsidePoolFact): string`

- [ ] **Step 1: Написать падающий тест на факт**

Создать `server/src/swap/duty-notice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { setTemplateRoles } from "../repo/template-roles";
import { shiftTemplates } from "../db/schema";
import { outsidePoolFact, outsidePoolFacts } from "./duty-notice";

/**
 * Пул дежурства ничего не запрещает — его решение от 2026-08-10. Но раз он не
 * запрещает, он обязан хотя бы сказать: иначе на Поклонке молча окажется тот,
 * кто там никогда не был.
 *
 * Функция отдаёт ФАКТ, а не фразу: одна и та же правда звучит по-разному для
 * того, кто берёт дежурство («ты не в списке»), и для админов («Игорь не в
 * списке»). Слова живут в `notify.ts`, рядом со всеми остальными.
 */
function setup() {
  const db = makeTestDb();
  const anya = createEmployee(db, { displayName: "Аня" });
  const igor = createEmployee(db, { displayName: "Игорь" });
  const pokl = db
    .insert(shiftTemplates)
    .values({ name: "Дежурство · Поклонка", category: "duty", start: "09:00", end: "18:00" })
    .returning()
    .all()[0]!;
  const duty = createShift(db, {
    date: "2026-07-10", start: "09:00", end: "18:00", category: "duty",
    templateId: pokl.id, title: pokl.name, employeeId: anya.id,
  });
  const shift = createShift(db, { date: "2026-07-10", start: "11:00", end: "20:00", employeeId: igor.id });
  return { db, anya, igor, pokl, duty, shift };
}

describe("outsidePoolFact", () => {
  it("дежурство уходит человеку вне пула — есть что сказать", () => {
    const { db, anya, igor, pokl, duty } = setup();
    setTemplateRoles(db, pokl.id, { pool: [anya.id], preference: {} });
    expect(outsidePoolFact(db, { shiftId: duty.id, receiverId: igor.id })).toEqual({
      dutyName: "Дежурство · Поклонка",
      receiverName: "Игорь",
    });
  });

  it("берущий в пуле — говорить нечего", () => {
    const { db, anya, igor, pokl, duty } = setup();
    setTemplateRoles(db, pokl.id, { pool: [anya.id, igor.id], preference: {} });
    expect(outsidePoolFact(db, { shiftId: duty.id, receiverId: igor.id })).toBeNull();
  });

  // Пустой пул = можно всем: это правило `template_pool`, а не «пул забыли настроить».
  it("пустой пул — говорить нечего", () => {
    const { db, igor, duty } = setup();
    expect(outsidePoolFact(db, { shiftId: duty.id, receiverId: igor.id })).toBeNull();
  });

  it("обычная смена — не про пул", () => {
    const { db, anya, shift } = setup();
    expect(outsidePoolFact(db, { shiftId: shift.id, receiverId: anya.id })).toBeNull();
  });

  it("пропавшая запись — говорить нечего", () => {
    const { db, igor } = setup();
    expect(outsidePoolFact(db, { shiftId: null, receiverId: igor.id })).toBeNull();
    expect(outsidePoolFact(db, { shiftId: 9999, receiverId: igor.id })).toBeNull();
  });

  // Дежурство ↔ дежурство: вне пула могут оказаться ОБА, потому и список.
  it("обе стороны сразу", () => {
    const { db, anya, igor, duty } = setup();
    const v19 = db
      .insert(shiftTemplates)
      .values({ name: "Дежурство · Вавилова 19", category: "duty", start: "10:00", end: "19:00" })
      .returning()
      .all()[0]!;
    const his = createShift(db, {
      date: duty.date, start: "10:00", end: "19:00", category: "duty",
      templateId: v19.id, title: v19.name, employeeId: igor.id,
    });
    const outsider = createEmployee(db, { displayName: "Марк" });
    setTemplateRoles(db, duty.templateId!, { pool: [outsider.id], preference: {} });
    setTemplateRoles(db, v19.id, { pool: [outsider.id], preference: {} });

    const facts = outsidePoolFacts(db, {
      fromEmployeeId: anya.id, toEmployeeId: igor.id, fromShiftId: duty.id, toShiftId: his.id,
    });
    expect(facts).toEqual([
      { dutyName: "Дежурство · Поклонка", receiverName: "Игорь" },
      { dutyName: "Дежурство · Вавилова 19", receiverName: "Аня" },
    ]);
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run server/src/swap/duty-notice.test.ts`
Expected: FAIL — `Cannot find module './duty-notice'`.

- [ ] **Step 3: Реализация факта**

Создать `server/src/swap/duty-notice.ts`:

```ts
import type { Db } from "../db/client";
import { getShift } from "../repo/shifts";
import { getTemplate } from "../repo/templates";
import { getTemplateRoles } from "../repo/template-roles";
import { getEmployeeById } from "../repo/employees";

/**
 * «Дежурство уходит человеку вне своего пула» — факт, из которого потом делают
 * фразу (`dutyNoticeForReceiver` / `dutyNoticeForAdmins` в `notify.ts`).
 *
 * Факт, а не готовая строка: одна правда звучит по-разному тому, кто берёт
 * дежурство, и админам, которые читают про третьего человека. Две фразы из
 * одного факта — не два источника правды; две функции, каждая со своим
 * запросом к базе, были бы им.
 */
export interface OutsidePoolFact {
  /** Как называется дежурство — имя пресета: «Дежурство · Поклонка». */
  dutyName: string;
  /** Кто его получает. */
  receiverName: string;
}

/**
 * Никогда не запрет — только повод сказать словами.
 *
 * Пул дежурства остаётся правилом автораздачи: работники вправе договориться
 * между собой (его решение от 2026-08-10). Пустой пул — «можно всем», это
 * правило `template_pool`, а не недонастроенный пресет, поэтому молчим.
 */
export function outsidePoolFact(
  db: Db,
  input: { shiftId: number | null; receiverId: number },
): OutsidePoolFact | null {
  const shift = input.shiftId == null ? undefined : getShift(db, input.shiftId);
  if (!shift || shift.category !== "duty" || shift.templateId == null) return null;

  const { pool } = getTemplateRoles(db, shift.templateId);
  if (pool.length === 0 || pool.includes(input.receiverId)) return null;

  const receiver = getEmployeeById(db, input.receiverId);
  if (!receiver) return null;
  return {
    dutyName: getTemplate(db, shift.templateId)?.name ?? shift.title ?? "дежурство",
    receiverName: receiver.displayName,
  };
}

/**
 * Обе стороны разом: инициатор получает `toShift`, вторая сторона — `fromShift`.
 *
 * Порядок — «сначала то, что уходит от инициатора»: так же читается сама заявка.
 * Смотрит на переданные id, а не на владельцев записей, поэтому одинаково верна
 * и до обмена, и после того, как записи уже поменяли хозяев.
 */
export function outsidePoolFacts(
  db: Db,
  request: { fromEmployeeId: number; toEmployeeId: number; fromShiftId: number | null; toShiftId: number | null },
): OutsidePoolFact[] {
  return [
    outsidePoolFact(db, { shiftId: request.fromShiftId, receiverId: request.toEmployeeId }),
    outsidePoolFact(db, { shiftId: request.toShiftId, receiverId: request.fromEmployeeId }),
  ].filter((fact): fact is OutsidePoolFact => fact !== null);
}
```

- [ ] **Step 4: Прогнать — убедиться, что прошло**

Run: `npx vitest run server/src/swap/duty-notice.test.ts`
Expected: PASS.

- [ ] **Step 5: Написать падающий тест на две фразы**

Дописать в `server/src/bot/notify.test.ts` (добавить `dutyNoticeForReceiver`, `dutyNoticeForAdmins` в импорт):

```ts
/** Один факт, две фразы: берущему — на «ты», админам — про третье лицо. */
describe("уведомление про пул дежурства", () => {
  const fact = { dutyName: "Дежурство · Поклонка", receiverName: "Игорь" };

  it("берущему — на «ты», с названием дежурства", () => {
    const text = dutyNoticeForReceiver(fact);
    expect(text).toContain("Дежурство · Поклонка");
    expect(text).toContain("Ты не в списке");
    expect(text).not.toContain("Игорь");
  });

  it("админам — про третье лицо, по имени", () => {
    const text = dutyNoticeForAdmins(fact);
    expect(text).toContain("Игорь");
    expect(text).toContain("Дежурство · Поклонка");
    expect(text).not.toContain("Ты не");
  });
});
```

- [ ] **Step 6: Прогнать — убедиться, что падает**

Run: `npx vitest run server/src/bot/notify.test.ts`
Expected: FAIL — `dutyNoticeForReceiver is not a function`.

- [ ] **Step 7: Реализовать фразы**

В `server/src/bot/notify.ts`, рядом с остальными свап-текстами:

```ts
/**
 * Тому, кто вот-вот возьмёт чужое дежурство и не входит в его пул.
 *
 * Не запрет: пул — правило автораздачи, а не право (его решение от
 * 2026-08-10). Но человек стоит в одном нажатии от Поклонки, и он должен
 * прочитать это ДО нажатия, а не узнать из графика.
 */
export function dutyNoticeForReceiver(f: OutsidePoolFact): string {
  return `⚠️ Ты берёшь дежурство: ${f.dutyName}. Ты не в списке тех, кто обычно на него выходит — если это ошибка, спроси у админа.`;
}

/** То же самое админам: они читают про третьего человека, поэтому по имени. */
export function dutyNoticeForAdmins(f: OutsidePoolFact): string {
  return `⚠️ ${f.receiverName} не в списке тех, кто обычно выходит на «${f.dutyName}».`;
}
```

и импорт типа:

```ts
import type { OutsidePoolFact } from "../swap/duty-notice";
```

- [ ] **Step 8: Прогнать — убедиться, что прошло**

Run: `npx vitest run server/src/bot/notify.test.ts`
Expected: PASS.

- [ ] **Step 9: Написать падающий сквозной тест на роутах**

Дописать в `server/src/http/swaps.test.ts` (взять `worker`, `authed`, `testBot`, `daysFromNow` из шапки файла; добавить в импорты `shiftTemplates` из `../db/schema` и `setTemplateRoles` из `../repo/template-roles`):

```ts
  it("дежурство вне пула: предупреждение берущему до нажатия и админам после", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const anya = await worker(db, app, "Аня", 501);
    const igor = await worker(db, app, "Игорь", 502);
    // Админ существует только чтобы принять рассылку — своего токена ему не надо.
    createAdminEmployee(db, { telegramUserId: 503, displayName: "Админ" });

    const pokl = db
      .insert(shiftTemplates)
      .values({ name: "Дежурство · Поклонка", category: "duty", start: "09:00", end: "18:00" })
      .returning()
      .all()[0]!;
    // В пуле только Аня — Игорь на Поклонке не бывает.
    setTemplateRoles(db, pokl.id, { pool: [anya.w.id], preference: {} });

    const day = daysFromNow(3);
    const duty = createShift(db, {
      date: day, start: "09:00", end: "18:00", category: "duty",
      templateId: pokl.id, title: pokl.name, employeeId: anya.w.id,
    });
    const his = createShift(db, { date: day, start: "11:00", end: "20:00", employeeId: igor.w.id });

    const created = await app.request(
      new Request("http://x/api/swaps", authed(anya.token, { fromShiftId: duty.id, toShiftId: his.id })),
    );
    expect(created.status).toBe(201);
    const proposal = sent.find((m) => m.chat_id === 502);
    expect(proposal?.text).toContain("Дежурство · Поклонка");
    expect(proposal?.text).toContain("Ты не в списке");

    const requestId = (await created.json()).request.id as number;
    const accepted = await app.request(new Request(`http://x/api/swaps/${requestId}/accept`, authed(igor.token)));
    expect(accepted.status).toBe(200);

    const toAdmin = sent.filter((m) => m.chat_id === 503).map((m) => m.text).join("\n");
    expect(toAdmin).toContain("Игорь не в списке");
  });
```

- [ ] **Step 10: Прогнать — убедиться, что падает**

Run: `npx vitest run server/src/http/swaps.test.ts`
Expected: FAIL — в сообщении Игорю нет «Ты не в списке», в рассылке админу нет «Игорь не в списке».

Если тест не видит письма админу вообще — сверить с уже существующим тестом про рассылку админам в этом же файле: `createAdminEmployee(db, { telegramUserId, displayName })` создаёт админа сразу со связанным телеграмом, `linkTelegramAccount` ему не нужен.

- [ ] **Step 11: Подключить уведомления в обоих путях**

`server/src/http/app.ts`, `POST /api/swaps` — предложение:

```ts
      if (tg != null) {
        const fact = outsidePoolFact(db, { shiftId: res.request.fromShiftId, receiverId: res.counterpartyId });
        const notices = fact ? [dutyNoticeForReceiver(fact)] : [];
        await notifySwapProposal(bot, tg, res.request.id, swapProposalText(swapAuditPayload(res.request), notices));
      }
```

`server/src/http/app.ts`, `POST /api/swaps/:id/accept` — рассылка админам:

```ts
      await notifyAdmins(
        bot,
        db,
        swapAcceptedAdminText(
          swapAuditPayload(res.request),
          outsidePoolFacts(db, res.request).map(dutyNoticeForAdmins),
        ),
      );
```

`server/src/bot/bot.ts:496` — тот же вызов на пути кнопки «Принять». Без него два входа скажут админам разное, а это ровно тот дефект, из-за которого тексты вообще переехали в `notify.ts`:

```ts
    if (action === "accept") {
      await notifyAdmins(
        bot,
        db,
        swapAcceptedAdminText(
          swapAuditPayload(db, res.request),
          outsidePoolFacts(db, res.request).map(dutyNoticeForAdmins),
        ),
      );
```

Импорты: в `app.ts` и `bot.ts` добавить `outsidePoolFact`/`outsidePoolFacts` из `../swap/duty-notice` (в `app.ts` нужны оба, в `bot.ts` — только `outsidePoolFacts`) и `dutyNoticeForReceiver`/`dutyNoticeForAdmins` из `../bot/notify` / `./notify`.

- [ ] **Step 12: Прогнать — убедиться, что прошло**

Run: `npx vitest run server`
Expected: PASS, включая новый сквозной тест.

- [ ] **Step 13: Коммит**

```bash
git add server/src/swap/duty-notice.ts server/src/swap/duty-notice.test.ts server/src/bot/notify.ts server/src/bot/notify.test.ts server/src/http/app.ts server/src/http/swaps.test.ts server/src/bot/bot.ts
git commit -m "feat(обмен): пул дежурства не запрещает, но говорит

Дежурство может взять любой — его решение. Раз запрета нет, факт «берущий
вне пула» произносится словами: берущему в том же сообщении, где кнопки,
и админам после обмена. Подключено на обоих путях accept — мини-апп и
кнопка в чате, — иначе они скажут админам разное.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `category` доезжает до карточек обмена

**Files:**
- Modify: `server/src/http/app.ts` (`shiftSummaryOf`)
- Modify: `miniapp/src/api/client.ts:137-142` и `:653-655`
- Modify: `miniapp/src/api/mock.ts:296-307`
- Modify: `miniapp/src/screens/worker-action-error.test.tsx:36`
- Modify: `miniapp/src/components/SwapRequestCard.test.tsx:11-12` (фикстуры сводок)
- Test: `server/src/http/swaps.test.ts`

**Interfaces:**
- Consumes: `EntryCategory` из `@planer/shared` (в мини-аппе — локальный тип `Category` из `./client`, как у `Shift`).
- Produces: `SwapShiftSummary` с обязательным полем `category`. Задача 7 читает его в карточках.

- [ ] **Step 1: Написать падающий тест**

Дописать в `server/src/http/swaps.test.ts`:

```ts
  it("GET /api/swaps называет вид записи, а не только часы", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 511);
    const igor = await worker(db, app, "Игорь", 512);
    const day = daysFromNow(4);
    const duty = createShift(db, {
      date: day, start: "09:00", end: "18:00", category: "duty",
      title: "Дежурство · Поклонка", employeeId: anya.w.id,
    });
    const his = createShift(db, { date: day, start: "11:00", end: "20:00", employeeId: igor.w.id });
    await app.request(new Request("http://x/api/swaps", authed(anya.token, { fromShiftId: duty.id, toShiftId: his.id })));

    const mine = await (await app.request(
      new Request("http://x/api/swaps", { headers: { Authorization: `Bearer ${anya.token}` } }),
    )).json();
    expect(mine.swaps[0].yourShift.category).toBe("duty");
    expect(mine.swaps[0].theirShift.category).toBe("shift");
  });
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run server/src/http/swaps.test.ts`
Expected: FAIL — `expected undefined to be "duty"`.

- [ ] **Step 3: Минимальная реализация**

В `server/src/http/app.ts` найти `shiftSummaryOf` и добавить `category` в возвращаемый объект — рядом с `date`, `start`, `end`, `title`. Комментарий:

```ts
  // `category` — не украшение: карточка «Обменов» иначе догадывалась бы о
  // дежурстве по часам, то есть никак, а `title` у части записей пуст.
```

В `miniapp/src/api/client.ts` — в **оба** описания сводки (`SwapShiftSummary` около строки 137 и `RawEnrichedSwap` около 653, если у второго поля перечислены отдельно) добавить:

```ts
  /** Смена это или дежурство — карточка помечает дежурство словом. */
  category: Category;
```

В `miniapp/src/api/mock.ts`, в `toSummary` — прокинуть `category: shift.category`.

Дописать `category: "shift"` в литералы сводок в тестах — иначе `typecheck` упадёт на новом обязательном поле:
- `miniapp/src/screens/worker-action-error.test.tsx:36`;
- `miniapp/src/components/SwapRequestCard.test.tsx:11-12` (`yourShift`, `theirShift`).

- [ ] **Step 4: Прогнать — убедиться, что прошло**

Run: `npx vitest run server/src/http/swaps.test.ts && npm run typecheck`
Expected: PASS и типы без ошибок. Если `typecheck` покажет ещё литералы `SwapShiftSummary` в тестах — дописать `category` и в них.

- [ ] **Step 5: Коммит**

```bash
git add server/src/http/app.ts server/src/http/swaps.test.ts miniapp/src/api/client.ts miniapp/src/api/mock.ts miniapp/src/screens/worker-action-error.test.tsx
git commit -m "feat(обмен): сводка записи в API несёт категорию

Карточка «Обменов» иначе не может отличить дежурство от смены: title у
части записей пуст, а по часам это не определяется.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Мини-апп перестаёт держать своё правило свапаемости

**Files:**
- Modify: `miniapp/src/lib/swap-candidates.ts:1,40`
- Modify: `miniapp/src/components/ShiftRow.tsx:23`
- Create: `miniapp/src/lib/swap-candidates-parity.test.ts`

**Interfaces:**
- Consumes: `isSwappable` из `@planer/shared` (задача 1).
- Produces: поведение — `swapCandidates` отдаёт дежурство коллеги, `ShiftRow` рисует «Обменять» на дежурстве.

- [ ] **Step 1: Написать падающий тест-паритет**

Создать `miniapp/src/lib/swap-candidates-parity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { entryCategorySchema, isSwappable } from "@planer/shared";
import type { Shift } from "../api/client";
import { swapCandidates } from "./swap-candidates";

/**
 * У мини-аппа не должно быть СВОЕГО мнения о том, чем можно меняться.
 *
 * Правило жило здесь рукописной копией (`shift.category !== "shift"`), и пока
 * ответ был «только смены», три копии — shared, этот список и кнопка
 * «Обменять» — совпадали случайно. Стоило открыть дежурства, и расхождение
 * стало наблюдаемым дефектом: экран прячет кандидата, которого сервер
 * принимает. Тест сверяет не строки, а поведение, и перебирает ВСЕ категории,
 * поэтому следующая открытая категория не потребует правки этого файла.
 */
const NOW = new Date("2026-07-10T06:00:00Z");

const mine: Shift = {
  id: 1, date: "2026-07-10", start: "09:00", end: "18:00", endDate: null,
  category: "shift", title: "День", location: null, templateId: null,
  employeeId: 1, unrecognisedCode: null,
};

describe("свапаемость в мини-аппе = свапаемость в shared", () => {
  it.each(entryCategorySchema.options)("%s", (category) => {
    const theirs: Shift = {
      ...mine, id: 2, employeeId: 2, category,
      // Другие часы и другая подпись — чтобы единственной переменной осталась
      // категория, а не «та же самая смена».
      start: "11:00", end: "20:00", title: null,
    };
    const { candidates } = swapCandidates(mine, [theirs], 1, NOW, new Set());
    expect(candidates.length === 1).toBe(isSwappable(category));
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run miniapp/src/lib/swap-candidates-parity.test.ts`
Expected: FAIL на `duty` — `expected false to be true`: `isSwappable("duty")` уже `true`, а список кандидатов дежурство всё ещё выбрасывает.

- [ ] **Step 3: Написать падающий тест на кнопку**

Создать `miniapp/src/components/shift-row-duty.test.tsx` по образцу `shift-row-swap-lock.test.tsx` (тот же `jsdom`-заголовок, тот же `mount`/`afterEach`, `IS_REACT_ACT_ENVIRONMENT`):

```ts
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { ShiftRow } from "./ShiftRow";

/**
 * Дежурство обменивается с 2026-08-10, значит кнопка на его строке обязана
 * быть: её отсутствие — это «фича есть, но до неё не дойти».
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE: Shift = {
  id: 1, date: "2026-08-13", start: "09:00", end: "18:00", endDate: null,
  category: "shift", title: "Дежурство · Поклонка", location: "Поклонка", templateId: 2,
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

async function mount(shift: Shift) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(AppRoot, null, createElement(ShiftRow, { shift, templates: [], onSwap: vi.fn() })),
    );
  });
  return host;
}

const swapButton = (el: HTMLElement) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent === "Обменять") ?? null;

describe("ShiftRow и обмен", () => {
  it("на дежурстве кнопка «Обменять» есть", async () => {
    expect(swapButton(await mount({ ...BASE, category: "duty" }))).not.toBeNull();
  });

  it("на отпуске — нет", async () => {
    expect(swapButton(await mount({ ...BASE, category: "vacation", start: null, end: null, title: null }))).toBeNull();
  });
});
```

- [ ] **Step 4: Прогнать — убедиться, что падает**

Run: `npx vitest run miniapp/src/components/shift-row-duty.test.tsx`
Expected: FAIL — «на дежурстве кнопка есть» не находит кнопку.

- [ ] **Step 5: Минимальная реализация**

`miniapp/src/lib/swap-candidates.ts` — первая строка импорта и проверка:

```ts
import { isIdenticalShift, isSwappable } from "@planer/shared";
```

```ts
    // Правило живёт в shared: экран, который прячет кандидата там, где сервер
    // обмен принимает, — наблюдаемый дефект. Своей копии здесь больше нет.
    if (!isSwappable(shift.category)) continue;
```

`miniapp/src/components/ShiftRow.tsx` — заменить локальную константу:

```ts
import { isSwappable } from "@planer/shared";
```

```ts
  // По той же причине, что в `swap-candidates.ts`: одно правило, один источник.
  const swappable = isSwappable(shift.category);
```

и переименовать три обращения ниже (`isSwappable && onSwap` → `swappable && onSwap`) — иначе локальное имя затенит импорт.

- [ ] **Step 6: Прогнать — убедиться, что прошло**

Run: `npx vitest run miniapp && npm run typecheck`
Expected: PASS. Если упал `propose-swap.test.tsx` или `propose-swap-day.test.tsx` — читать: скорее всего фикстура с дежурством раньше ожидалась отфильтрованной, и это ожидание надо перевернуть с комментарием «дежурство обменивается с 2026-08-10».

- [ ] **Step 7: Коммит**

```bash
git add miniapp/src/lib/swap-candidates.ts miniapp/src/components/ShiftRow.tsx miniapp/src/lib/swap-candidates-parity.test.ts miniapp/src/components/shift-row-duty.test.tsx
git commit -m "feat(мини-апп): «Обменять» на дежурстве, правило — из shared

Две рукописные копии правила свапаемости заменены вызовом isSwappable.
Тест-паритет перебирает все категории и сверяет поведение списка
кандидатов с shared, а не два списка, набранных руками.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Подсветка на экранах обмена

**Files:**
- Modify: `miniapp/src/screens/ProposeSwapScreen.tsx:10-21,123-199`
- Modify: `miniapp/src/App.tsx:257-263`
- Modify: `miniapp/src/components/SwapRequestCard.tsx:8-14,71-78`
- Test: `miniapp/src/components/SwapRequestCard.test.tsx`, `miniapp/src/screens/propose-swap.test.tsx`

**Interfaces:**
- Consumes: `SwapShiftSummary.category` (задача 5), `EntryChip` (`../components/EntryChip`), `categoryLabel` (`../categories`), `Template` (`../api/client`).
- Produces: `ProposeSwapScreenProps` получает обязательное поле `templates: readonly Template[]`.

- [ ] **Step 1: Написать падающие тесты на карточки**

Дописать в `miniapp/src/components/SwapRequestCard.test.tsx`. Файл рендерит разметку строкой (`renderToStaticMarkup`), без jsdom — держаться того же способа. В импорты добавить `IncomingSwapCard`:

```ts
import { ArchivedSwapCard, IncomingSwapCard } from "./SwapRequestCard";
```

```tsx
/**
 * Карточка обязана называть дежурство словом.
 *
 * До 2026-08-10 в обмене могла быть только смена, и подпись сводки была
 * необязательной роскошью. Теперь по этой карточке человек решает, что он
 * отдаёт и что берёт, — «Ср 12 авг · 09:00–18:00» этого не говорит. Проверяем
 * входящую: именно на ней стоит кнопка «Принять».
 */
describe("карточка обмена и дежурство", () => {
  const incoming = (theirs: SwapRequest["theirShift"]): SwapRequest => ({
    id: 2,
    direction: "incoming",
    status: "pending",
    message: null,
    createdAt: "2026-08-11T10:00:00.000Z",
    counterpartyName: "Коллега Имя",
    yourShift: { date: "2026-08-12", start: "11:00", end: "20:00", title: "День", category: "shift" },
    theirShift: theirs,
  });

  const render = (theirs: SwapRequest["theirShift"]) =>
    renderToStaticMarkup(
      createElement(IncomingSwapCard, { request: incoming(theirs), onAccept: () => {}, onDecline: () => {} }),
    );

  it("дежурство названо и помечено", () => {
    const markup = render({
      date: "2026-08-12", start: "09:00", end: "18:00", title: "Дежурство · Поклонка", category: "duty",
    });
    expect(markup).toContain("Дежурство · Поклонка");
  });

  it("дежурство без своей подписи всё равно названо, а не «—»", () => {
    const markup = render({ date: "2026-08-12", start: "09:00", end: "18:00", title: null, category: "duty" });
    expect(markup).toContain("Дежурство");
  });

  it("обычная смена метки дежурства не несёт", () => {
    const markup = render({ date: "2026-08-12", start: "09:00", end: "18:00", title: "Утро", category: "shift" });
    expect(markup).toContain("Утро");
    expect(markup).not.toContain("Дежурство");
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run miniapp/src/components/SwapRequestCard.test.tsx`
Expected: FAIL на «дежурство без своей подписи всё равно названо» — при `title: null` карточка пишет только день и часы. Два других теста проходят уже сейчас (подпись приходит из `title`) — это нормально, они сторожат формат; выбрасывать их не надо.

- [ ] **Step 3: Реализовать карточки**

`miniapp/src/components/SwapRequestCard.tsx` — подпись и метка:

```ts
import { categoryLabel } from "../categories";
```

```ts
/** "Пн, 14 июля · 09:00–18:00 · День" — название важно: без него пятничное
 * «Утро» (08:00–15:45) читается как сбитый «День». А с 2026-08-10 в обмене
 * бывает дежурство, и `title` у части записей пуст — тогда называем категорию,
 * иначе строка молчит именно там, где решение и принимается. */
function formatSwapShift(shift: SwapShiftSummary | null): string {
  if (!shift || !shift.date) return "—";
  const name = shift.title ?? categoryLabel(shift.category);
  return `${formatDayLabel(shift.date)} · ${formatTimeRange(shift)} · ${name}`;
}
```

и метка в строке направления — словом, цвет вдобавок:

```tsx
function SwapDirectionLine({ label, shift }: { label: string; shift: SwapShiftSummary | null }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 14.5, flexWrap: "wrap" }}>
      <span style={{ color: "var(--tgui--hint_color)", flex: "none" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{formatSwapShift(shift)}</span>
      {shift?.category === "duty" && <DutyPill />}
    </div>
  );
}

/** Дежурство — не «смена в другое время»: человек садится на телефон или едет
 *  на точку. Отдельная пилюля, потому что название пресета в строке легко
 *  проскользить взглядом, когда рядом кнопка «Принять». */
function DutyPill() {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.2,
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
        color: "var(--tgui--button_text_color)",
        background: "var(--tgui--link_color)",
      }}
    >
      Дежурство
    </span>
  );
}
```

- [ ] **Step 4: Прогнать — убедиться, что прошло**

Run: `npx vitest run miniapp/src/components/SwapRequestCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Написать падающий тест на экран предложения**

Дописать в `miniapp/src/screens/propose-swap.test.tsx`. В файле уже есть фабрика `shift({ id, ... })` и `mount(props)`, возвращающий `host`; ими и пользоваться. В импорты добавить `Template`.

Ключевой кейс — запись **без своей подписи**: подпись из `title` экран показывает и сегодня, а вот имя пресета — нет, и именно на дежурстве из консоли это разница между «Дежурство · Вавилова 19» и «Дежурство».

```tsx
const V19: Template = {
  id: 8, sortOrder: 3, name: "Дежурство · Вавилова 19", start: "10:00", end: "19:00",
  fridayStart: "10:00", fridayEnd: "19:00", isLate: false, sendReminder: false,
  category: "duty", location: "Вавилова 19", accent: "teal",
};

it("называет вид записи и у отдаваемой, и у чужой", async () => {
  const el = await mount({
    fromShift: shift({ id: 1, employeeId: 1, employeeName: undefined, category: "duty", title: "Дежурство · Поклонка", templateId: 7 }),
    // Своей подписи нет — название обязано прийти из пресета.
    candidates: [shift({ id: 2, employeeId: 2, employeeName: "Игорь", category: "duty", title: null, templateId: V19.id, start: "10:00", end: "19:00" })],
    templates: [V19],
  });
  expect(el.textContent).toContain("Дежурство · Поклонка");
  expect(el.textContent).toContain("Дежурство · Вавилова 19");
});
```

- [ ] **Step 6: Прогнать — убедиться, что падает**

Run: `npx vitest run miniapp/src/screens/propose-swap.test.tsx`
Expected: FAIL — сначала на типах (`templates` ещё не проп экрана), после добавления пропа — на тексте: «Дежурство · Вавилова 19» на экране нет, потому что подпись сегодня берётся только из `title`, а он `null`.

Заодно дописать `templates: []` в дефолты внутри `mount` — иначе все уже существующие тесты этого файла перестанут компилироваться на новом обязательном пропе.

- [ ] **Step 7: Реализовать экран предложения**

`miniapp/src/screens/ProposeSwapScreen.tsx`:
1. в пропсы добавить `templates: readonly Template[]` с комментарием «нужны, чтобы записи назывались и раскрашивались как в остальных экранах»;
2. импортировать `EntryChip` и `Template`;
3. в блоке «Отдаёшь свою смену» убрать `subtitle={fromShift.title ?? categoryLabel(fromShift.category)}` и поставить `description={<EntryChip entry={fromShift} templates={templates} />}` — та же раскладка, что в `ShiftRow`;
4. в строке кандидата: `subtitle={formatTimeRange(shift)}`, а `description` — чип и, при выборе, слово «Выбрано»:

```tsx
                  description={
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <EntryChip entry={shift} templates={templates} />
                      {selectedHere && <span>Выбрано</span>}
                    </span>
                  }
```

Комментарий про «Выбрано» из существующего кода **сохранить**: он объясняет, почему это слово не приклеено к `subtitle` (обрезается многоточием). Если `categoryLabel` после правок в файле больше не используется — убрать его импорт.

`miniapp/src/App.tsx` — передать пресеты на экран (около строки 257):

```tsx
        templates={data.templates}
```

- [ ] **Step 8: Прогнать — убедиться, что прошло**

Run: `npx vitest run miniapp && npm run typecheck`
Expected: PASS и типы чистые.

- [ ] **Step 9: Коммит**

```bash
git add miniapp/src/screens/ProposeSwapScreen.tsx miniapp/src/App.tsx miniapp/src/components/SwapRequestCard.tsx miniapp/src/components/SwapRequestCard.test.tsx miniapp/src/screens/propose-swap.test.tsx
git commit -m "feat(мини-апп): дежурство названо словом на всех экранах обмена

Экран предложения показывает записи тем же EntryChip, что «Мои смены»:
одна запись — одна подпись и один цвет на всех экранах. Карточки обмена
называют категорию, когда своей подписи у записи нет, и метят дежурство
отдельной пилюлей рядом с кнопкой «Принять».

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Верификация целиком

**Files:** ничего не меняется, кроме — при необходимости — плана и спеки.

- [ ] **Step 1: Вся сюита**

Run: `npm test`
Expected: PASS, ноль упавших файлов. Вывод показать целиком в отчёте — «должно работать» доказательством не является.

- [ ] **Step 2: Типы**

Run: `npm run typecheck`
Expected: без ошибок во всех четырёх проектах (shared, server, admin, miniapp).

- [ ] **Step 3: Сторож приватности**

Run: `npx vitest run server/src/db/no-real-names.test.ts`
Expected: PASS (или skip, если локальной базы нет — тогда сказать об этом прямо, а не выдавать skip за проверку).

- [ ] **Step 4: Ручная проверка по спеке**

Пройти список «Тесты» в `docs/superpowers/specs/2026-08-10-duty-swaps-design.md` (20 пунктов) и отметить, каким файлом и каким `it(...)` закрыт каждый. Непокрытые — дописать здесь же, не откладывая: спека их обещает.

- [ ] **Step 5: Коммит, если что-то дописано**

```bash
git add -A
git commit -m "test(обмен): дозакрыты пункты спеки по дежурствам

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Не входит в план (из спеки)

- Выездные мероприятия, работа в выходной, отпуска — остаются необменными.
- Обмен недельным блоком дежурства целиком.
- Подтверждение обмена админом.
- Запрет на дежурство вне пула.
- Пуловая пометка инициатору в списке кандидатов: пулы не отдаются работнику ни одним эндпоинтом, а новый эндпоинт ради строчки текста — плохая сделка.
- `reminder_log` уникален по `(shiftId, kind)`: уже ушедшее напоминание новому владельцу не повторяется. Поведение сегодняшних обменов сменами, не новое.

---

## Что разошлось с планом (записано по факту исполнения, 2026-08-10)

План исполнен целиком, 8 задач из 8. Пять расхождений, все — правки на месте:

1. **Задача 1, фикстура.** Тест «два разных дежурства в один день» в плане переиспользовал
   `dutySetup`, где у Игоря в этот день уже стоит смена 11:00–20:00: взяв Поклонку
   09:00–18:00, он получал `double-booking-to` — правильный отказ, но не про то, что
   проверялось. Заменено на третьего человека, причина записана комментарием в тесте.
2. **Задача 4, тест для второго входа.** План подключал уведомление в `bot.ts`, но теста на
   этот путь не требовал — а именно расхождение двух входов эта правка и предотвращает.
   Добавлен `bot.test.ts` → «admin broadcast on accept says when a duty went to somebody
   outside its pool»: кнопка в чате зовёт `acceptSwap` напрямую, минуя HTTP.
3. **Задача 5, существующее ожидание.** `swaps.test.ts` сверял сводку целиком
   (`toEqual({date, start, end, title})`), поэтому новое поле его ломало. Ожидание
   дополнено `category: "shift"` — тест продолжает сторожить форму ответа.
4. **Задача 6, устаревший тест.** Как план и предполагал: `swap-candidates.test.ts`
   утверждал «не предлагает дежурство, отпуск и клетку без времени». Разделён на три:
   отпуск и нечитаемая клетка — по-прежнему нет, дежурство коллеги — да, дежурство без
   часов — нет.
5. **Задача 7, `EntryChip` не знал средней ступени.** План (и спека) исходили из цепочки
   «title ?? имя пресета ?? категория», но в `EntryChip` её не было: он брал только
   `title`, а `templates` читал лишь ради цвета. Запись из консоли без своего `title`
   подписывалась «Дежурство» вместо «Дежурство · Поклонка» — и не только на экране
   обмена, но и в «Моих сменах». Цепочка добавлена в сам `EntryChip`, а не на один экран.
   Тестам карточек дополнительно понадобился `AppRoot`: `IncomingSwapCard` содержит
   кнопки telegram-ui, а архивная карточка — нет.

**Верификация (задача 8, прогнано):** `npm test` — 153 файла, 1425 тестов, 0 падений;
`npm run typecheck` — чисто во всех четырёх проектах; `no-real-names.test.ts` — прошёл на
живой базе (не skip).
