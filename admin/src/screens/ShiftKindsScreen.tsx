import { useEffect, useState } from "react";
import { apiClient, AuthRequiredError, type Checklist, type Employee, type TemplateQueue, type TemplateRolesView } from "../api/client";
import {
  coverageSummary,
  previewReminderText,
  REMINDER_PLACEHOLDERS,
  exactSchedulePalette,
  filterPeople,
  rolesOfPerson,
  toggleAllowed,
  togglePreference,
  type PersonKindRole,
} from "@planer/shared";
import { useEntryPalette } from "../categories";
import { PersonSearch } from "../components/PersonSearch";
import { initialsOf, personPalette } from "../lib/people";

/**
 * «допущен к 1 из 9 · любит: 2» — строка под именем человека.
 *
 * Пустой список допущенных считается ДОПУСКОМ: у большинства видов смен он не
 * настроен, и «допущен к 0 из 9» было бы прямой ложью. Зеркало
 * `personSummary` в мини-аппе — фраза на двух фронтах одна.
 */
export function personSummary(roles: readonly PersonKindRole[]): string {
  if (roles.length === 0) return "видов смен пока нет";
  const allowed = roles.filter((role) => role.allowed).length;
  const preferred = roles.filter((role) => role.preferred).length;
  const head = allowed === roles.length ? `допущен ко всем (${roles.length})` : `допущен к ${allowed} из ${roles.length}`;
  return preferred > 0 ? `${head} · любит: ${preferred}` : head;
}

/**
 * Экран «Виды смен»: сверху свойства самих видов (чек-лист, очередь), снизу
 * «Кто что может» — список ЛЮДЕЙ с галочками по видам.
 *
 * Раньше обе половины были одной: карточка вида смены, внутри — двадцать восемь
 * человек. Вопрос, который задают на самом деле, звучит «что может Игорь», и
 * ответ на него собирался обходом девяти карточек.
 */
export function ShiftKindsScreen({ employees }: { employees: Employee[] }) {
  const [kinds, setKinds] = useState<TemplateRolesView[] | null>(null);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [openKindId, setOpenKindId] = useState<number | null>(null);
  const [openPersonId, setOpenPersonId] = useState<number | null>(null);
  const [busyKindId, setBusyKindId] = useState<number | null>(null);
  const [busyPersonId, setBusyPersonId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const active = employees.filter((employee) => employee.isActive);
  const activeIds = active.map((employee) => employee.id);

  useEffect(() => {
    // Чек-листы — рядом с видами: без их имён выпадающий список показывать нечем.
    // Молча при отказе: экран про виды смен, и его беда важнее.
    apiClient.getChecklists().then(setChecklists).catch(() => setChecklists([]));
    apiClient
      .getTemplateRoles()
      .then(setKinds)
      .catch((err: unknown) => {
        if (!(err instanceof AuthRequiredError)) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить виды смен");
        }
      });
  }, []);

  /**
   * Сохранение идёт ВИДОМ смены и после переворота экрана: галочка «Игорь ·
   * Утро» шлёт роли пресета «Утро» целиком. Экран перевернули, модель — нет.
   */
  async function save(kind: TemplateRolesView, patch: Partial<TemplateRolesView>, employeeId: number) {
    const next = { ...kind, ...patch };
    setKinds((current) => current?.map((item) => (item.templateId === kind.templateId ? next : item)) ?? current);
    setBusyPersonId(employeeId);
    setError(null);
    try {
      await apiClient.saveTemplateRoles(next.templateId, next.pool, next.preference);
    } catch (err) {
      // Put the server's version back rather than leaving a lie on screen.
      setKinds(await apiClient.getTemplateRoles().catch(() => null));
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusyPersonId(null);
    }
  }

  async function toggleAllowedFor(kind: TemplateRolesView, employeeId: number) {
    const pool = toggleAllowed(kind.pool, employeeId, activeIds);
    if (pool === null) {
      setError(`«${kind.name}»: последнего допущенного снять нельзя — пустой список значит «могут все».`);
      return;
    }
    await save(kind, { pool }, employeeId);
  }

  async function saveRotation(kind: TemplateRolesView, unit: "day" | "week") {
    setBusyKindId(kind.templateId);
    setError(null);
    try {
      await apiClient.setRotationUnit(kind.templateId, unit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить очередь");
    } finally {
      setBusyKindId(null);
    }
  }

  async function saveCoverage(kind: TemplateRolesView, coverage: number[]) {
    setKinds((current) =>
      current?.map((item) => (item.templateId === kind.templateId ? { ...item, coverage } : item)) ?? current,
    );
    setBusyKindId(kind.templateId);
    setError(null);
    try {
      await apiClient.setTemplateCoverage(kind.templateId, coverage);
    } catch (err) {
      setKinds(await apiClient.getTemplateRoles().catch(() => null));
      setError(err instanceof Error ? err.message : "Не удалось сохранить норму");
    } finally {
      setBusyKindId(null);
    }
  }

  /** Напоминание вида смены: галочка и свой текст сохраняются одним запросом. */
  async function saveReminder(kind: TemplateRolesView, sendReminder: boolean, reminderText: string | null) {
    setKinds((current) =>
      current?.map((item) => (item.templateId === kind.templateId ? { ...item, sendReminder, reminderText } : item)) ??
      current,
    );
    setBusyKindId(kind.templateId);
    setError(null);
    try {
      await apiClient.setTemplateReminder(kind.templateId, sendReminder, reminderText);
    } catch (err) {
      setKinds(await apiClient.getTemplateRoles().catch(() => null));
      setError(err instanceof Error ? err.message : "Не удалось сохранить напоминание");
    } finally {
      setBusyKindId(null);
    }
  }

  async function saveChecklist(kind: TemplateRolesView, checklistId: number | null) {
    // Оптимистично: выбор обязан отзываться сразу, иначе на медленной сети его
    // меняют второй раз.
    setKinds((current) =>
      current?.map((item) => (item.templateId === kind.templateId ? { ...item, checklistId } : item)) ?? current,
    );
    setBusyKindId(kind.templateId);
    setError(null);
    try {
      await apiClient.setTemplateChecklist(kind.templateId, checklistId);
    } catch (err) {
      setKinds(await apiClient.getTemplateRoles().catch(() => null));
      setError(err instanceof Error ? err.message : "Не удалось сохранить чек-лист");
    } finally {
      setBusyKindId(null);
    }
  }

  if (error && !kinds) return <div className="centered-fill">{error}</div>;
  if (!kinds) return <div className="centered-fill">Загрузка…</div>;

  const visiblePeople = filterPeople(active, query);

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Виды смен</h2>
      </div>
      {error && <div className="employees-error">{error}</div>}

      <p className="kinds-intro">
        Сверху — свойства самого вида смены: какой чек-лист получает дежурный и как идёт очередь.
      </p>
      <div className="employees-list">
        {kinds.map((kind) => (
          <KindCard
            key={kind.templateId}
            kind={kind}
            open={openKindId === kind.templateId}
            busy={busyKindId === kind.templateId}
            onToggleOpen={() => setOpenKindId((current) => (current === kind.templateId ? null : kind.templateId))}
            onRotationUnit={(unit) => saveRotation(kind, unit)}
            checklists={checklists}
            onChecklist={(checklistId) => saveChecklist(kind, checklistId)}
            onCoverage={(coverage) => saveCoverage(kind, coverage)}
            onReminder={(sendReminder, reminderText) => saveReminder(kind, sendReminder, reminderText)}
          />
        ))}
      </div>

      <div className="employees-header">
        <h2 className="employees-title">Кто что может</h2>
      </div>
      <p className="kinds-intro">
        Галочка «допущен» стоит у всех, пока у вида смены никого не отметили: пустой список значит «могут все».
        Снимешь первую — список зафиксируется по остальным. «Любит» не перебивает очередь, а решает ничью.
      </p>
      <PersonSearch value={query} onChange={setQuery} count={active.length} disabled={busyPersonId !== null} />
      <div className="employees-list">
        {visiblePeople.map((employee) => (
          <PersonCard
            key={employee.id}
            employee={employee}
            kinds={kinds}
            open={openPersonId === employee.id}
            busy={busyPersonId === employee.id}
            onToggleOpen={() => setOpenPersonId((current) => (current === employee.id ? null : employee.id))}
            onToggleAllowed={(kind) => void toggleAllowedFor(kind, employee.id)}
            onTogglePreferred={(kind) => void save(kind, { preference: togglePreference(kind.preference, employee.id) }, employee.id)}
          />
        ))}
        {visiblePeople.length === 0 && active.length > 0 && (
          <div className="employees-empty">Никого с таким именем нет.</div>
        )}
      </div>
    </div>
  );
}

/**
 * Напоминание накануне: слать ли про этот вид смены и каким текстом.
 *
 * Текст сохраняется кнопкой, а не на каждый символ: иначе на середине фразы
 * ушёл бы отказ про несуществующую подстановку, которую человек ещё дописывает.
 * Галочка — сразу: у неё нет незаконченного состояния.
 *
 * Предпросмотр не украшение. Текст уходит двадцати шести людям и увидеть его до
 * отправки больше негде; та же проверка, что откажет на сервере, показывает
 * причину прямо под полем.
 * ЗЕРКАЛО `ReminderRow` в мини-аппе (`AdminKindSettings.tsx`).
 */
function ReminderRow({
  kind,
  busy,
  onReminder,
}: {
  kind: TemplateRolesView;
  busy: boolean;
  onReminder: (sendReminder: boolean, reminderText: string | null) => Promise<void>;
}) {
  const [text, setText] = useState(kind.reminderText ?? "");
  const trimmed = text.trim();
  const preview = trimmed ? previewReminderText(trimmed) : null;
  const hint = `Подстановки: ${REMINDER_PLACEHOLDERS.map((name) => `{${name}}`).join(", ")}. Пустое поле — уйдёт стандартный текст.`;

  return (
    <div className="kind-reminder">
      <label className="kind-reminder-switch">
        <input
          type="checkbox"
          className="kind-reminder-toggle"
          checked={kind.sendReminder}
          disabled={busy}
          onChange={(e) => void onReminder(e.target.checked, trimmed || null)}
        />
        Напоминать накануне
      </label>
      <textarea
        className="kind-reminder-text"
        rows={3}
        value={text}
        disabled={busy}
        placeholder="Стандартный текст по типу смены"
        onChange={(e) => setText(e.target.value)}
      />
      <span className="kind-rotation-note">{hint}</span>
      {preview?.ok && <p className="kind-reminder-preview">Уйдёт так: {preview.text}</p>}
      {preview && !preview.ok && <p className="employees-error">{preview.error}</p>}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy || (preview !== null && !preview.ok)}
        onClick={() => void onReminder(kind.sendReminder, trimmed || null)}
      >
        Сохранить текст
      </button>
    </div>
  );
}

function KindCard({
  kind,
  open,
  busy,
  onToggleOpen,
  onRotationUnit,
  checklists,
  onChecklist,
  onCoverage,
  onReminder,
}: {
  kind: TemplateRolesView;
  open: boolean;
  busy: boolean;
  onToggleOpen: () => void;
  onRotationUnit: (unit: "day" | "week") => Promise<void>;
  checklists: readonly Checklist[];
  onChecklist: (checklistId: number | null) => Promise<void>;
  onCoverage: (coverage: number[]) => Promise<void>;
  onReminder: (sendReminder: boolean, reminderText: string | null) => Promise<void>;
}) {
  const palette = useEntryPalette({ templateId: kind.templateId, category: kind.category }, [
    { id: kind.templateId, accent: kind.accent },
  ]);
  // The very letter the week grid draws for this kind, not the first letter of its
  // name — otherwise all four duties read «Д» here and «Т»/«П»/«ВА»/«07» there.
  const code = exactSchedulePalette(kind.accent, kind.category)?.code ?? kind.name.slice(0, 1);
  const [queue, setQueue] = useState<TemplateQueue | null>(null);
  const checklistName = checklists.find((list) => list.id === kind.checklistId)?.name;

  // The queue is history, not settings — fetched only when the card is opened.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiClient
      .getTemplateQueue(kind.templateId)
      .then((next) => {
        if (!cancelled) setQueue(next);
      })
      .catch(() => {
        if (!cancelled) setQueue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind.templateId]);

  /**
   * The select is controlled off `queue`, and `queue` is only re-read when the
   * card opens — so saving alone left React putting the old value straight back:
   * the admin picked «по неделям», the control snapped to «по дням», and the
   * setting looked like it hadn't taken even though the server had already
   * written it. Show the choice at once, then re-read the queue: the «Следующие:
   * …» labels are folded into words server-side by this very unit, so they are
   * stale until the whole queue comes back.
   * MIRRORS `changeUnit` in the Mini App's AdminKindSettings.
   */
  async function changeUnit(unit: "day" | "week") {
    setQueue((prev) => (prev ? { ...prev, rotationUnit: unit } : prev));
    await onRotationUnit(unit);
    const fresh = await apiClient.getTemplateQueue(kind.templateId).catch(() => null);
    if (fresh) setQueue(fresh);
  }

  return (
    <section className="kind-card">
      <button type="button" className="kind-card-head" onClick={onToggleOpen} aria-expanded={open}>
        <span className="kind-swatch" style={{ background: palette.bg, color: palette.fg }} aria-hidden="true">
          {code}
        </span>
        <span className="kind-name">{kind.name}</span>
        <span className="kind-meta">
          {coverageSummary(kind.coverage)}
          {checklistName ? <> · чек-лист: <b>{checklistName}</b></> : ""}
        </span>
        <span className="kind-chevron">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="kind-people">
          <CoverageRow kind={kind} busy={busy} onCoverage={onCoverage} />
          <div className="kind-rotation">
            <label className="kind-rotation-unit">
              Очередь идёт
              <select
                value={queue?.rotationUnit ?? "day"}
                disabled={busy || !queue}
                onChange={(e) => void changeUnit(e.target.value as "day" | "week")}
              >
                <option value="day">по дням</option>
                <option value="week">по неделям</option>
              </select>
            </label>
            {queue && queue.queue.length > 0 ? (
              <p className="kind-rotation-hint">
                Следующие: {queue.queue.slice(0, 3).map((turn) => turn.label).join(" → ")}
                <br />
                <span className="kind-rotation-note">Бот только подсказывает — ставишь смену ты сам.</span>
              </p>
            ) : (
              <p className="kind-rotation-hint">Очередь появится, когда в допущенных кто-нибудь будет.</p>
            )}
          </div>

          <ReminderRow kind={kind} busy={busy} onReminder={onReminder} />

          {/* Выбор стоит здесь, а не только на «Чек-листах»: «какой чек-лист у
              этого вида смены» — свойство самого вида, ровно как очередь рядом.
              Ту же привязку можно править и со стороны списка — там отвечают на
              обратный вопрос, «кто его проходит». */}
          <label className="kind-checklist">
            Чек-лист
            <select
              value={kind.checklistId ?? ""}
              disabled={busy || checklists.length === 0}
              onChange={(e) => void onChecklist(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— не нужен —</option>
              {checklists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
            <span className="kind-rotation-note">
              {checklists.length === 0
                ? "— сначала заведи чек-лист на экране «Чек-листы»"
                : "— дежурному придёт список проверок с началом смены"}
            </span>
          </label>
        </div>
      )}
    </section>
  );
}

function PersonCard({
  employee,
  kinds,
  open,
  busy,
  onToggleOpen,
  onToggleAllowed,
  onTogglePreferred,
}: {
  employee: Employee;
  kinds: readonly TemplateRolesView[];
  open: boolean;
  busy: boolean;
  onToggleOpen: () => void;
  onToggleAllowed: (kind: TemplateRolesView) => void;
  onTogglePreferred: (kind: TemplateRolesView) => void;
}) {
  const colours = personPalette(employee.id);
  const roles = rolesOfPerson(kinds, employee.id);

  return (
    <section className="kind-card">
      <button type="button" className="kind-card-head" onClick={onToggleOpen} aria-expanded={open}>
        <span className="avatar avatar-sm" style={{ background: colours.bg, color: colours.fg }} aria-hidden="true">
          {initialsOf(employee.displayName)}
        </span>
        <span className="kind-name">{employee.displayName}</span>
        <span className="kind-meta">{personSummary(roles)}</span>
        <span className="kind-chevron">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="kind-people">
          <div className="kind-people-head">
            <span>Вид смены</span>
            <span title="Может брать этот вид смены">Допущен</span>
            <span title="Мягкий приоритет при равном числе таких смен">Любит</span>
          </div>
          {kinds.map((kind, index) => (
            <KindRow
              key={kind.templateId}
              kind={kind}
              role={roles[index]!}
              employeeName={employee.displayName}
              busy={busy}
              onToggleAllowed={() => onToggleAllowed(kind)}
              onTogglePreferred={() => onTogglePreferred(kind)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function KindRow({
  kind,
  role,
  employeeName,
  busy,
  onToggleAllowed,
  onTogglePreferred,
}: {
  kind: TemplateRolesView;
  role: PersonKindRole;
  employeeName: string;
  busy: boolean;
  onToggleAllowed: () => void;
  onTogglePreferred: () => void;
}) {
  const palette = useEntryPalette({ templateId: kind.templateId, category: kind.category }, [
    { id: kind.templateId, accent: kind.accent },
  ]);
  const code = exactSchedulePalette(kind.accent, kind.category)?.code ?? kind.name.slice(0, 1);

  return (
    <label className="kind-person">
      <span className="kind-person-name">
        <span className="kind-swatch kind-swatch-sm" style={{ background: palette.bg, color: palette.fg }} aria-hidden="true">
          {code}
        </span>
        {kind.name}
      </span>
      <input
        type="checkbox"
        checked={role.allowed}
        disabled={busy}
        aria-label={`${employeeName}: допущен к «${kind.name}»`}
        onChange={onToggleAllowed}
      />
      <input
        type="checkbox"
        checked={role.preferred}
        disabled={busy}
        aria-label={`${employeeName}: любит «${kind.name}»`}
        onChange={onTogglePreferred}
      />
    </label>
  );
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

/**
 * Норма дня: сколько людей нужно на этом виде смены в каждый день недели.
 *
 * Сохраняется целиком по кнопке, а не по каждому нажатию: семь полей правят
 * подряд, и запрос на каждую цифру означал бы семь запросов и семь строк в
 * журнале на одну правку. Зеркало `CoverageRow` в мини-аппе.
 */
function CoverageRow({
  kind,
  busy,
  onCoverage,
}: {
  kind: TemplateRolesView;
  busy: boolean;
  onCoverage: (coverage: number[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string[]>(() => kind.coverage.map(String));
  const dirty = draft.join(",") !== kind.coverage.join(",");

  return (
    <div className="kind-coverage">
      <span className="kind-coverage-title">Норма дня — сколько людей нужно</span>
      <div className="kind-coverage-grid">
        {WEEKDAYS.map((day, index) => (
          <label key={day} className="kind-coverage-day">
            <span>{day}</span>
            <input
              type="number"
              min={0}
              value={draft[index] ?? "0"}
              disabled={busy}
              aria-label={`${kind.name}: норма на ${day}`}
              onChange={(e) => setDraft((prev) => prev.map((value, i) => (i === index ? e.target.value : value)))}
            />
          </label>
        ))}
      </div>
      <span className="kind-rotation-note">
        Ноль значит «не считаем» — про такой день подсказка в расписании молчит.
      </span>
      {dirty && (
        <button
          type="button"
          className="btn btn-primary kind-clear"
          disabled={busy}
          onClick={() => void onCoverage(draft.map((value) => Number(value.trim()) || 0))}
        >
          Сохранить норму
        </button>
      )}
    </div>
  );
}
