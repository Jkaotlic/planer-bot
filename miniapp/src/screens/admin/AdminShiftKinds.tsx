import { useEffect, useState } from "react";
import {
  exactSchedulePalette,
  filterPeople,
  rolesOfPerson,
  toggleAllowed,
  togglePreference,
  type PersonKindRole,
} from "@planer/shared";
import { Button, Placeholder, Section, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee, type TemplateRolesView } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { PersonSearch } from "../../components/PersonSearch";
import { initialsOf, personPalette } from "../../lib/people";
import { useEntryPalette } from "../../categories";
import { withError, withoutError } from "../../lib/error-map";

/**
 * «допущен к 1 из 2 · любит: 1» — строка под именем человека.
 *
 * Пустой список допущенных считается ДОПУСКОМ, а не пустотой: у большинства
 * видов смен он не настроен, и сводка «допущен к 0 из 9» была бы прямой ложью.
 */
export function personSummary(roles: readonly PersonKindRole[]): string {
  if (roles.length === 0) return "видов смен пока нет";
  const allowed = roles.filter((role) => role.allowed).length;
  const preferred = roles.filter((role) => role.preferred).length;
  const head = allowed === roles.length ? `допущен ко всем (${roles.length})` : `допущен к ${allowed} из ${roles.length}`;
  return preferred > 0 ? `${head} · любит: ${preferred}` : head;
}

/**
 * «Кто что может» (admin, mobile): список ЛЮДЕЙ, у каждого — виды смен с двумя
 * галочками.
 *
 * Раньше экран был перевёрнут: карточка вида смены, внутри — двадцать восемь
 * человек. Вопрос, который задают на самом деле, звучит «что может Игорь», а не
 * «кто может Утро», и на прежнем экране ответ на него собирался обходом всех
 * девяти карточек.
 *
 * Один человек открыт за раз — девять строк по две галочки это уже экран.
 * Свойства самого вида смены (чек-лист, очередь) живут на «Видах смен»: в
 * карточке каждого человека они повторялись бы двадцать восемь раз.
 */
export function AdminShiftKinds({
  employees,
  onClose,
}: {
  employees: Employee[];
  /** Back to the day view — without it this screen is a dead end. */
  onClose: () => void;
}) {
  const [kinds, setKinds] = useState<TemplateRolesView[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /**
   * Отказ по id ЧЕЛОВЕКА, а не один на экран. Экран выше окна даже свёрнутым
   * (замер на 390×844: высота 970, последняя карточка на y=747), а развёрнутая
   * карточка добавляет по строке на каждый вид смены — отказ, нарисованный
   * родителем над `ScreenScroll`, для нажавшего в такой карточке невидим.
   */
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map());
  /** Упавшая начальная загрузка: без неё показывать нечего, и «Повторить» — единственный выход. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const active = employees.filter((employee) => employee.isActive);
  const activeIds = active.map((employee) => employee.id);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    apiClient
      .getTemplateRoles()
      .then((next) => {
        if (!cancelled) setKinds(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Не удалось загрузить виды смен");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /**
   * Сохранение по-прежнему идёт ВИДОМ смены: галочка «Игорь · Утро» шлёт роли
   * пресета «Утро» целиком. Экран перевернули, модель — нет, и это намеренно:
   * `PUT /api/admin/templates/:id/roles` остаётся единственным способом их
   * записать.
   */
  async function save(kind: TemplateRolesView, patch: Partial<TemplateRolesView>, employeeId: number) {
    const next = { ...kind, ...patch };
    setKinds((current) => current?.map((item) => (item.templateId === kind.templateId ? next : item)) ?? current);
    setBusyId(employeeId);
    setErrors((prev) => withoutError(prev, employeeId));
    try {
      await apiClient.saveTemplateRoles(next.templateId, next.pool, next.preference);
    } catch (err) {
      // Put the server's version back rather than leaving a lie on screen.
      setKinds(await apiClient.getTemplateRoles().catch(() => null));
      setErrors((prev) => withError(prev, employeeId, err instanceof Error ? err.message : "Не удалось сохранить"));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleAllowedFor(kind: TemplateRolesView, employeeId: number) {
    const pool = toggleAllowed(kind.pool, employeeId, activeIds);
    if (pool === null) {
      setErrors((prev) =>
        withError(prev, employeeId, `«${kind.name}»: последнего допущенного снять нельзя — пустой список значит «могут все».`),
      );
      return;
    }
    await save(kind, { pool }, employeeId);
  }

  async function togglePreferredFor(kind: TemplateRolesView, employeeId: number) {
    await save(kind, { preference: togglePreference(kind.preference, employeeId) }, employeeId);
  }

  if (loadError) {
    return (
      <Section header="Кто что может">
        <CardStack>
          <CardShell>
            <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{loadError}</div>
            <Button size="s" mode="gray" stretched style={{ marginTop: 8 }} onClick={() => setAttempt((n) => n + 1)}>
              Повторить
            </Button>
          </CardShell>
        </CardStack>
      </Section>
    );
  }

  if (!kinds) {
    return (
      <Section header="Кто что может">
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spinner size="m" />
        </div>
      </Section>
    );
  }

  const visiblePeople = filterPeople(active, query);

  return (
    <Section header="Кто что может">
      <CardStack>
        <CardShell>
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
            Галочка «допущен» стоит у всех, пока у вида смены никого не отметили: пустой список значит «могут все».
            Снимешь первую — список зафиксируется по остальным. «Любит» не перебивает очередь, а решает ничью.
          </div>
        </CardShell>

        <CardShell>
          <PersonSearch value={query} onChange={setQuery} count={active.length} disabled={busyId !== null} />
        </CardShell>

        {visiblePeople.map((employee) => (
          <PersonCard
            key={employee.id}
            employee={employee}
            kinds={kinds}
            open={openId === employee.id}
            busy={busyId === employee.id}
            error={errors.get(employee.id)}
            onToggleOpen={() => setOpenId((current) => (current === employee.id ? null : employee.id))}
            onToggleAllowed={(kind) => void toggleAllowedFor(kind, employee.id)}
            onTogglePreferred={(kind) => void togglePreferredFor(kind, employee.id)}
          />
        ))}

        {visiblePeople.length === 0 && active.length > 0 && (
          <CardShell>
            <div style={{ color: "var(--tgui--hint_color)", fontSize: 13.5 }}>Никого с таким именем нет.</div>
          </CardShell>
        )}
        {active.length === 0 && <Placeholder description="Сначала добавь работников." />}

        <CardShell>
          <Button size="s" mode="gray" stretched onClick={onClose}>
            ← Назад к расписанию
          </Button>
        </CardShell>
      </CardStack>
    </Section>
  );
}

function PersonCard({
  employee,
  kinds,
  open,
  busy,
  error,
  onToggleOpen,
  onToggleAllowed,
  onTogglePreferred,
}: {
  employee: Employee;
  kinds: readonly TemplateRolesView[];
  open: boolean;
  busy: boolean;
  /** Отказ на последнее действие именно в этой карточке. */
  error?: string;
  onToggleOpen: () => void;
  onToggleAllowed: (kind: TemplateRolesView) => void;
  onTogglePreferred: (kind: TemplateRolesView) => void;
}) {
  const colours = personPalette(employee.id);
  const roles = rolesOfPerson(kinds, employee.id);

  return (
    <CardShell>
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          background: "transparent", border: "none", padding: 0, font: "inherit",
          color: "var(--tgui--text_color)", textAlign: "left", cursor: "pointer",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            flex: "none", display: "grid", placeContent: "center", width: 30, height: 30,
            borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: colours.bg, color: colours.fg,
          }}
        >
          {initialsOf(employee.displayName)}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 600, fontSize: 15 }}>{employee.displayName}</span>
          <span style={{ display: "block", color: "var(--tgui--hint_color)", fontSize: 12.5 }}>
            {personSummary(roles)}
          </span>
        </span>
        <span style={{ flex: "none", color: "var(--tgui--hint_color)" }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--tgui--outline)" }}>
          <div
            style={{
              display: "grid", gridTemplateColumns: "1fr 64px 56px", gap: 6, padding: "10px 0 6px",
              color: "var(--tgui--hint_color)", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase",
            }}
          >
            <span>Вид смены</span>
            <span style={{ justifySelf: "center" }}>Допущен</span>
            <span style={{ justifySelf: "center" }}>Любит</span>
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
      {/* Свёрнутую карточку отказ тоже касается: сохранение могло не дойти уже
          после того, как её закрыли. */}
      {error && (
        <div style={{ marginTop: 8, color: "var(--tgui--destructive_text_color)", fontSize: 13.5, lineHeight: 1.35 }}>
          {error}
        </div>
      )}
    </CardShell>
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
  // Та самая буква, которой вид смены нарисован в сетке недели, а не первая буква
  // имени — иначе все дежурства читаются здесь «Д», а там «Т»/«П»/«ВА»/«07».
  const code = exactSchedulePalette(kind.accent, kind.category)?.code ?? kind.name.slice(0, 1);

  return (
    <label
      style={{
        display: "grid", gridTemplateColumns: "1fr 64px 56px", gap: 6, alignItems: "center",
        padding: "7px 0", borderTop: "1px solid var(--tgui--outline)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: 14 }}>
        <span
          aria-hidden="true"
          style={{
            flex: "none", display: "grid", placeContent: "center", width: 26, height: 26,
            borderRadius: 8, fontSize: 10.5, fontWeight: 700, background: palette.bg, color: palette.fg,
          }}
        >
          {code}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kind.name}</span>
      </span>
      <input
        type="checkbox"
        checked={role.allowed}
        disabled={busy}
        style={{ justifySelf: "center", width: 20, height: 20 }}
        aria-label={`${employeeName}: допущен к «${kind.name}»`}
        onChange={onToggleAllowed}
      />
      <input
        type="checkbox"
        checked={role.preferred}
        disabled={busy}
        style={{ justifySelf: "center", width: 20, height: 20 }}
        aria-label={`${employeeName}: любит «${kind.name}»`}
        onChange={onTogglePreferred}
      />
    </label>
  );
}
