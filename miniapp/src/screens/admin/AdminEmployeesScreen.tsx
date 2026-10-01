import { useEffect, useState } from "react";
import { filterPeople, MONTH_NAMES, parseBirthDate, toBirthDate } from "@planer/shared";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Avatar, Input, Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type CreateEmployeeResult, type Employee } from "../../api/client";
import { CollapsibleArchive } from "../../components/CollapsibleArchive";
import { PersonSearch } from "../../components/PersonSearch";
import { withError, withoutError } from "../../lib/error-map";
import { initialsOf, personPalette } from "../../lib/people";
import { restrictionsSummary } from "../../lib/restrictions-summary";
import { ActionButton, Card, CheckRow, Group, Hint, SelectField, StatusPill } from "../../ui";

/**
 * Причина отказа — человеческой фразой.
 *
 * Сервер отдаёт часть причин кодами (`last_admin`, `archived`, …), а клиент
 * кладёт их в `Error.message` как есть. Правило проекта давно записано в `App`:
 * код отказа — не то, что показывают человеку. Пока такой ответ рисовался за
 * верхним краем экрана, этого не было видно; теперь он в строке, и читать его
 * должен человек. Всё, что сервер уже написал по-русски (сторож тёзок, проверки
 * полей), проходит насквозь.
 */
export function refusalText(message: string): string {
  switch (message) {
    case "last_admin":
      return "Это последний админ — сначала назначь админом кого-то ещё.";
    case "archived":
      return "Работник в архиве — сначала верни его из архива.";
    case "already_linked":
      return "Телеграм уже привязан — ссылка больше не нужна.";
    case "not_found":
      return "Такой записи больше нет — обнови экран.";
    default:
      return message;
  }
}

/**
 * "Работники" (admin): active/archived rosters with archive/restore, plus an
 * inline "add worker" form that hands back a copyable invite link. Mirrors the
 * desktop `EmployeesScreen`, rebuilt as a single mobile column.
 */
export function AdminEmployeesScreen() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  /** The invite for a worker just added — the card sits under the form that made them. */
  const [invite, setInvite] = useState<CreateEmployeeResult | null>(null);
  /**
   * The invite re-shown from a row's «🔗 Ссылка», kept apart from the one above.
   *
   * They are two different moments and they belong in two different places. The
   * created one has the form right above it, so a card at the top reads correctly.
   * A row's button is somewhere down a list of thirty, and putting its answer at the
   * top of that list meant the screen changed only outside the visible area: no
   * link, no error, no sign anything had happened at all. It is the same request
   * either way — the server answers 200 with a live t.me link — so what was broken
   * was where the answer landed.
   */
  const [rowInvite, setRowInvite] = useState<{ employeeId: number; inviteToken: string; inviteLink: string | null } | null>(null);
  /**
   * A refusal earned by a row's own button, kept with that row — same reasoning
   * as `rowInvite`, and the same bug it fixes. `error` above is the whole
   * screen's, drawn under the «Новый работник» form; that is right for the form
   * and for a failed load, and wrong for everything else, because the buttons
   * that can fail are down a list of thirty. «В архив» на последнем админе,
   * «✎ Имя» в занятое ФИО, «🔗 Ссылка» у архивного — сервер отказывает всем
   * трём, и все три ответа уезжали за верхний край экрана.
   */
  const [rowError, setRowError] = useState<{ employeeId: number; message: string } | null>(null);
  /**
   * Ограничения-checkboxes' own refusals, one per row — the `withError`/
   * `withoutError` pair `AdminShiftKinds`/`App` already use for the same shape
   * of problem (several independently-actionable rows on one long scroll).
   */
  const [restrictionErrors, setRestrictionErrors] = useState<ReadonlyMap<number, string>>(new Map());
  const [query, setQuery] = useState("");

  async function reload() {
    setEmployees(await apiClient.getAdminEmployees());
  }

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getAdminEmployees()
      .then((list) => {
        if (!cancelled) setEmployees(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить работников");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function withBusy(id: number, action: () => Promise<void>) {
    setBusyId(id);
    setRowError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setRowError({ employeeId: id, message: err instanceof Error ? refusalText(err.message) : "Не удалось выполнить действие" });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Deliberately does NOT go through `withBusy`/`reload()`: a full re-fetch
   * after a successful save is unnecessary work — the response already told
   * us the new value took — and re-running it only reopens a stale-render
   * window between the PATCH resolving and the GET's response landing,
   * during which the checkbox could flash back to the pre-save value (this
   * is the exact bug the mirrored test guards). Patching the confirmed value
   * straight into local state avoids that window entirely and is simpler
   * besides — nothing else about the row list changes from toggling a
   * restriction.
   */
  async function setRestriction(id: number, patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean }) {
    setBusyId(id);
    setRestrictionErrors((prev) => withoutError(prev, id));
    try {
      await apiClient.setEmployeeRestrictions(id, patch);
      setEmployees((prev) => prev?.map((e) => (e.id === id ? { ...e, ...patch } : e)) ?? prev);
    } catch (err) {
      setRestrictionErrors((prev) =>
        withError(prev, id, err instanceof Error ? refusalText(err.message) : "Не удалось сохранить ограничение"),
      );
    } finally {
      setBusyId(null);
    }
  }

  // Та же логика, что у `setRestriction` — патчит подтверждённое значение в
  // локальный список, а не перечитывает весь экран, по той же причине (гонка
  // PATCH/GET, см. коммент выше). Ошибка ложится в ту же карту `restrictionErrors`
  // — с точки зрения строки это тот же блок карточки, что и два чекбокса под ним.
  async function setObserver(id: number, isObserver: boolean) {
    setBusyId(id);
    setRestrictionErrors((prev) => withoutError(prev, id));
    try {
      await apiClient.setEmployeeObserver(id, isObserver);
      setEmployees((prev) => prev?.map((e) => (e.id === id ? { ...e, isObserver } : e)) ?? prev);
    } catch (err) {
      setRestrictionErrors((prev) =>
        withError(prev, id, err instanceof Error ? refusalText(err.message) : "Не удалось сохранить роль"),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleAdd(name: string) {
    setAdding(true);
    setError(null);
    try {
      const result = await apiClient.createEmployee(name);
      await reload();
      setInvite(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать работника");
    } finally {
      setAdding(false);
    }
  }

  /** From the top card: the worker was created a moment ago, the card is right there. */
  async function refreshCreatedInvite(employee: Employee) {
    setError(null);
    try {
      const info = await apiClient.getEmployeeInvite(employee.id, true);
      setInvite({ employee, inviteToken: info.inviteToken, inviteLink: info.inviteLink });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось получить ссылку");
    }
  }

  /** From a row's «🔗 Ссылка»: the answer goes back into that row. Tapping it again
   *  folds it away, so the button is never a no-op in either direction. */
  async function showRowInvite(employee: Employee) {
    if (rowInvite?.employeeId === employee.id) { setRowInvite(null); return; }
    setRowError(null);
    setBusyId(employee.id);
    try {
      const info = await apiClient.getEmployeeInvite(employee.id, false);
      setRowInvite({ employeeId: employee.id, inviteToken: info.inviteToken, inviteLink: info.inviteLink });
    } catch (err) {
      setRowError({ employeeId: employee.id, message: err instanceof Error ? refusalText(err.message) : "Не удалось получить ссылку" });
    } finally {
      setBusyId(null);
    }
  }

  if (error && !employees) {
    return <Placeholder header="Не удалось загрузить" description={error} />;
  }
  if (!employees) {
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 48 }}>
        <Spinner size="l" />
      </div>
    );
  }

  const active = employees.filter((e) => e.isActive);
  const archived = employees.filter((e) => !e.isActive);
  const visibleActive = filterPeople(active, query);

  return (
    <>
      <Group header="Новый работник">
        <AddEmployeeForm busy={adding} onAdd={handleAdd} />
        {invite && (
          <InviteCard invite={invite} onRegenerate={() => void refreshCreatedInvite(invite.employee)} onDismiss={() => setInvite(null)} />
        )}
      </Group>

      {error && (
        <Card>
          <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-body)" }}>{error}</div>
        </Card>
      )}

      {/* Один поиск на экран, над обеими секциями — как в консоли: порог
          «показывать поле» считается от ПОЛНОГО ростера (активные + архив),
          а не только от активных, иначе поле пропадало бы там, где в консоли
          остаётся, стоило разделить один и тот же десяток людей на активных
          и архив. Фильтрует и активных, и (см. ниже) раскрытый архив. */}
      <PersonSearch card value={query} onChange={setQuery} count={employees.length} disabled={busyId !== null} />

      <Group header={`Активные · ${active.length}`}>
        {visibleActive.length === 0 ? (
          // `active.length`, не `visibleActive.length`: пустой РОСТЕР и пустой
          // РЕЗУЛЬТАТ поиска — разные причины, и подпись обязана называть ту,
          // что случилась, а не всегда одну и ту же.
          <Placeholder description={active.length === 0 ? "Пока нет активных работников" : "Никого с таким именем нет."} />
        ) : (
          visibleActive.map((e) => (
            <EmployeeRow
              key={e.id}
              employee={e}
              // Позиция — место в РОСТЕРЕ, а не в том, что осталось после
              // поиска: считать её по видимому индексу значило бы
              // переставлять человека не туда, стоило кому-то что-нибудь
              // набрать в поиске. Так же считает консоль (`EmployeesSection`).
              position={active.findIndex((a) => a.id === e.id) + 1}
              onReorder={(position) => withBusy(e.id, () => apiClient.reorderEmployee(e.id, position).then(() => {}))}
              onBirthDate={(birthDate) => withBusy(e.id, () => apiClient.setBirthDate(e.id, birthDate))}
              actionLabel="В архив"
              confirmQuestion={`${e.displayName} — в архив? Будущие смены станут «Не назначено», отпуска впереди удалятся, обмены и выходные снимутся.`}
              busy={busyId === e.id}
              onAction={() => withBusy(e.id, () => apiClient.archiveEmployee(e.id))}
              onToggleAdmin={() => withBusy(e.id, () => apiClient.setEmployeeAdmin(e.id, !e.isAdmin))}
              onRename={(name) => withBusy(e.id, () => apiClient.renameEmployee(e.id, name))}
              onPreferredName={(preferredName) => withBusy(e.id, () => apiClient.setEmployeePreferredName(e.id, preferredName))}
              onShowInvite={() => void showRowInvite(e)}
              invite={rowInvite?.employeeId === e.id ? rowInvite : null}
              error={rowError?.employeeId === e.id ? rowError.message : null}
              onSetRestrictions={(patch) => void setRestriction(e.id, patch)}
              onSetObserver={(isObserver) => void setObserver(e.id, isObserver)}
              restrictionError={restrictionErrors.get(e.id) ?? null}
            />
          ))
        )}
      </Group>

      {/* `items` — весь архив, не найденное: заголовок и сам факт наличия
          секции не должны мигать оттого, что поиск временно не нашёл
          архивного человека. Фильтр применяется только к строкам внутри —
          Так же делает консоль (`EmployeesScreen`). */}
      <CollapsibleArchive title="Архив" items={archived}>
        {(rows) =>
          filterPeople(rows, query).map((e) => (
            <EmployeeRow
              key={e.id}
              employee={e}
              actionLabel="Вернуть"
              busy={busyId === e.id}
              onAction={() => withBusy(e.id, () => apiClient.restoreEmployee(e.id))}
              onRename={(name) => withBusy(e.id, () => apiClient.renameEmployee(e.id, name))}
              onPreferredName={(preferredName) => withBusy(e.id, () => apiClient.setEmployeePreferredName(e.id, preferredName))}
              onShowInvite={() => void showRowInvite(e)}
              invite={rowInvite?.employeeId === e.id ? rowInvite : null}
              error={rowError?.employeeId === e.id ? rowError.message : null}
              onSetRestrictions={(patch) => void setRestriction(e.id, patch)}
              onSetObserver={(isObserver) => void setObserver(e.id, isObserver)}
              restrictionError={restrictionErrors.get(e.id) ?? null}
            />
          ))
        }
      </CollapsibleArchive>
    </>
  );
}

export function EmployeeRow({
  employee,
  invite,
  error,
  actionLabel,
  confirmQuestion,
  busy,
  onAction,
  onToggleAdmin,
  onRename,
  onPreferredName,
  onShowInvite,
  position,
  onReorder,
  onBirthDate,
  onSetRestrictions,
  onSetObserver,
  restrictionError,
}: {
  employee: Employee;
  /** The link this row asked for, shown right here — see the note on `rowInvite`. */
  invite?: { inviteToken: string; inviteLink: string | null } | null;
  /** Why this row's last action was refused, shown right here — see `rowError`. */
  error?: string | null;
  actionLabel: string;
  /** Есть — действие необратимо и спрашивает подтверждение (архивация). */
  confirmQuestion?: string;
  busy: boolean;
  onAction: () => void;
  /** 1-based place in the list, shown and editable. Absent for archived workers. */
  position?: number;
  onReorder?: (position: number) => void;
  /** When provided, the worker's birthday can be set or cleared. */
  onBirthDate?: (birthDate: string | null) => void;
  /** When provided (active roster), a linked worker can be promoted to / removed from admin. */
  onToggleAdmin?: () => void;
  /** When provided, the worker can be renamed inline. */
  onRename?: (name: string) => void;
  /** When provided, an admin can set how the bot addresses this worker. */
  onPreferredName?: (preferredName: string | null) => void;
  /** When provided, an unlinked worker's invite link can be re-shown. */
  onShowInvite?: () => void;
  /** Every row gets the «Ограничения» checkboxes — active and archived alike. */
  onSetRestrictions: (patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean }) => void;
  /** Every row gets the «Наблюдатель» toggle — active and archived alike, same
   *  as the two checkboxes below it. */
  onSetObserver: (isObserver: boolean) => void;
  /** Why this row's last restriction save was refused, shown right here — see `restrictionErrors`. */
  restrictionError?: string | null;
}) {
  const palette = personPalette(employee.id);
  const linked = employee.telegramUserId != null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(employee.displayName);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState(employee.preferredName ?? "");
  // Свёрнуты у каждого и при каждом открытии экрана: три галки на карточке из
  // тридцати занимали больше места, чем всё остальное, а нужны единицам. Состояние
  // локальное — перечитывание списка после действия не должно захлопывать карточку,
  // в которой человек как раз работает (ключ строки — id, так что она не пересоздаётся).
  const [restrictionsOpen, setRestrictionsOpen] = useState(false);

  if (editingAddress) {
    return (
      <Card>
        <Input
          header="Обращение"
          placeholder={employee.address}
          value={addressDraft}
          disabled={busy}
          onChange={(e) => setAddressDraft(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <ActionButton
            kind="primary"
            compact
            stretched
            loading={busy}
            disabled={busy}
            onClick={() => {
              const trimmed = addressDraft.trim();
              if (trimmed !== (employee.preferredName ?? "")) onPreferredName?.(trimmed || null);
              setEditingAddress(false);
            }}
          >
            Сохранить
          </ActionButton>
          <ActionButton compact disabled={busy} onClick={() => { setAddressDraft(employee.preferredName ?? ""); setEditingAddress(false); }}>
            Отмена
          </ActionButton>
        </div>
      </Card>
    );
  }

  if (editing) {
    return (
      <Card>
        <Input header="Имя" value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} />
        <div style={{ display: "flex", gap: 8 }}>
          <ActionButton
            kind="primary"
            compact
            stretched
            loading={busy}
            disabled={busy || !draft.trim()}
            onClick={() => {
              const t = draft.trim();
              if (t && t !== employee.displayName) onRename?.(t);
              setEditing(false);
            }}
          >
            Сохранить
          </ActionButton>
          <ActionButton compact disabled={busy} onClick={() => { setDraft(employee.displayName); setEditing(false); }}>
            Отмена
          </ActionButton>
        </div>
      </Card>
    );
  }

  // Карточка, а не строка со слотом `after`: на телефоне три кнопки в хвосте
  // сжимали имя до «Nekh…». Имя и статусы получают всю ширину сверху, действия
  // переносятся отдельным рядом ниже. Главной (`primary`) кнопки здесь нет:
  // все действия карточки равноправны, а необратимое спрашивает подтверждение.
  return (
    <Card>
      <div data-employee-id={employee.id} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {position !== undefined && onReorder && (
            <PositionField position={position} busy={busy} onCommit={onReorder} />
          )}
          <Avatar acronym={initialsOf(employee.displayName)} size={40} style={{ background: palette.bg, color: palette.fg, flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Длинное ФИО переносится, а не выталкивает кнопки за край на 320px. */}
            <div style={{ fontWeight: 600, fontSize: "var(--app-text-head)", minWidth: 0, overflowWrap: "anywhere" }}>
              {employee.displayName}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
              <StatusPill tone={linked ? "ok" : "wait"}>{linked ? "привязан" : "не привязан"}</StatusPill>
              {/* Метка только у отписавшихся: она про исключение, а не про норму.
                  Непривязанному не доходит вообще ничего, и об этом уже сказано
                  слева. Зеркало консольной карточки — 2026-08-28, когда трое
                  месяцами не получали напоминаний незаметно для админа. */}
              {linked && !employee.remindersEnabled && <StatusPill tone="bad">напоминания выключены</StatusPill>}
              {/* Зеркало консольной метки: «привязан», а не доходит ничего. */}
              {linked && employee.botBlockedAt && (
                <StatusPill tone="bad">🚫 заблокировал бота с {formatBlockedSince(employee.botBlockedAt)}</StatusPill>
              )}
              {employee.isAdmin && <StatusPill tone="need">админ</StatusPill>}
            </div>
          </div>
        </div>

        {/* Как бот на самом деле обратится. Показано всегда, а не «когда
            отличается от первого слова имени»: угадывать, какое слово в
            displayName — имя, значило бы вернуть то самое допущение, которое
            это изменение убирает. */}
        <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", overflowWrap: "anywhere" }}>
          Бот зовёт: {employee.address}
        </div>

        {onBirthDate && (
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>
            <span style={{ flex: "none" }}>День рождения</span>
            <BirthDateField value={employee.birthDate} busy={busy} onChange={onBirthDate} />
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {onRename && (
            <ActionButton compact disabled={busy} onClick={() => { setDraft(employee.displayName); setEditing(true); }}>
              ✎ Имя
            </ActionButton>
          )}
          {onPreferredName && (
            <ActionButton compact disabled={busy} onClick={() => { setAddressDraft(employee.preferredName ?? ""); setEditingAddress(true); }}>
              ✎ Обращение
            </ActionButton>
          )}
          {onShowInvite && !linked && (
            <ActionButton compact disabled={busy} onClick={onShowInvite}>
              🔗 Ссылка
            </ActionButton>
          )}
          {onToggleAdmin && linked && (
            <ActionButton compact loading={busy} disabled={busy} onClick={onToggleAdmin}>
              {employee.isAdmin ? "Снять админа" : "Сделать админом"}
            </ActionButton>
          )}
          {confirmQuestion ? (
            <ConfirmButton
              label={actionLabel}
              question={confirmQuestion}
              confirmLabel={`Да, ${actionLabel.toLowerCase()}`}
              loading={busy}
              disabled={busy}
              onConfirm={onAction}
            />
          ) : (
            <ActionButton compact loading={busy} disabled={busy} onClick={onAction}>
              {actionLabel}
            </ActionButton>
          )}
        </div>

        {/* Вся полоса — кнопка не ниже 44px. Сводка сверху говорит то, ради чего
            галки открывали бы: кто исключён, не раскрывая каждую карточку. */}
        <button
          type="button"
          aria-expanded={restrictionsOpen}
          onClick={() => setRestrictionsOpen((open) => !open)}
          style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: "var(--app-tap)",
            background: "transparent", border: "none", borderTop: "1px solid var(--tgui--divider, rgb(128 128 128 / 18%))",
            padding: 0, font: "inherit", fontSize: "var(--app-text-meta)",
            color: "var(--tgui--hint_color)", textAlign: "left", cursor: "pointer",
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>Ограничения: {restrictionsSummary(employee)}</span>
          <span aria-hidden="true" style={{ flex: "none" }}>{restrictionsOpen ? "▴" : "▾"}</span>
        </button>
        {restrictionsOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <CheckRow
              checked={employee.isObserver}
              disabled={busy}
              onChange={() => onSetObserver(!employee.isObserver)}
              label="Наблюдатель"
              hint="Смотрит график, ведёт свой, шлёт анонсы. Вне раздачи, обменов и передачи смен."
            />
            <CheckRow
              // Значение из базы, а не эффективное («и так вне назначений из-за
              // роли») — админ должен видеть, куда человек вернётся, когда роль
              // снимут, а не то, что происходит с ним сейчас.
              checked={employee.excludedFromAssignment}
              disabled={busy || employee.isObserver}
              onChange={() => onSetRestrictions({ excludedFromAssignment: !employee.excludedFromAssignment })}
              label="Не участвует в назначениях"
              hint={
                employee.isObserver
                  ? "управляется ролью «Наблюдатель»"
                  : "бот не зовёт его на работу в выходные и не подсказывает его в очереди дежурств; вручную поставить можно"
              }
            />
            <CheckRow
              checked={employee.excludedFromSwaps}
              disabled={busy || employee.isObserver}
              onChange={() => onSetRestrictions({ excludedFromSwaps: !employee.excludedFromSwaps })}
              label="Не участвует в обменах"
              hint={
                employee.isObserver
                  ? "управляется ролью «Наблюдатель»"
                  : "ни предложить, ни принять обмен; открытые заявки будут отменены"
              }
            />
          </div>
        )}
        {/* Отказ сохранения ограничения виден и при свёрнутой карточке: человек
            мог её закрыть, пока запрос шёл, и тогда ошибка молча пропала бы. */}
        {restrictionError && (
          <div role="alert" style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-body)", lineHeight: 1.4 }}>
            {restrictionError}
          </div>
        )}

        {/* Отказ показывается там, где был палец: сообщение над списком из
            тридцати человек никто не увидит. */}
        {error && (
          <div role="alert" style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-body)", lineHeight: 1.4 }}>
            {error}
          </div>
        )}
        {invite && !linked && <RowInviteLink invite={invite} />}
      </div>
    </Card>
  );
}

/** Ссылка-приглашение в той строке, что её запросила. Её можно выделить, а не
 *  только скопировать кнопкой: в вебвью мини-аппа нет буфера обмена без
 *  безопасного контекста, а ссылка, которую нельзя вынуть с экрана, равна
 *  отсутствию ссылки. */
function RowInviteLink({ invite }: { invite: { inviteToken: string; inviteLink: string | null } }) {
  const link = invite.inviteLink ?? invite.inviteToken;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Hint>🔗 Отправь ссылку — по ней работник привяжет Telegram.</Hint>
      <div
        style={{
          padding: "8px 10px", borderRadius: "var(--app-radius-control)", fontSize: "var(--app-text-meta)", lineHeight: 1.4,
          wordBreak: "break-all", userSelect: "all",
          background: "var(--tgui--secondary_bg_color)",
        }}
      >
        {link}
      </div>
    </div>
  );
}

function AddEmployeeForm({ busy, onAdd }: { busy: boolean; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");

  function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    onAdd(trimmed);
    setName("");
  }

  return (
    <Card>
      <Input
        header="Имя"
        placeholder="Например, Настя Волкова"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      {/* Единственная primary формы. */}
      <ActionButton kind="primary" stretched loading={busy} disabled={busy || !name.trim()} onClick={submit}>
        ＋ Добавить работника
      </ActionButton>
    </Card>
  );
}

function InviteCard({ invite, onRegenerate, onDismiss }: { invite: CreateEmployeeResult; onRegenerate?: () => void; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  // In dev the mock always synthesizes a link; in prod the server may return
  // null (no bot username configured) — fall back to the bare token then.
  const link = invite.inviteLink ?? invite.inviteToken;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context) — the text is still selectable below.
    }
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: "var(--app-text-head)", minWidth: 0, overflowWrap: "anywhere" }}>
          {invite.employee.displayName} добавлен(а)
        </div>
        <StatusPill tone="ok">готово</StatusPill>
      </div>
      <Hint>🔗 Отправь ссылку — по ней работник привяжет Telegram.</Hint>
      <div
        style={{
          fontSize: "var(--app-text-meta)",
          fontFamily: "var(--tgui--font_family_mono, monospace)",
          wordBreak: "break-all",
          background: "var(--tgui--secondary_bg_color)",
          borderRadius: "var(--app-radius-control)",
          padding: "8px 10px",
        }}
      >
        {link}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        {/* Единственная primary карточки. */}
        <ActionButton kind="primary" compact stretched onClick={() => void copy()}>
          {copied ? "Скопировано ✓" : "Копировать ссылку"}
        </ActionButton>
        <ActionButton compact onClick={onDismiss}>
          Скрыть
        </ActionButton>
      </div>
      {onRegenerate && (
        <ActionButton compact stretched onClick={onRegenerate}>
          Создать новую ссылку
        </ActionButton>
      )}
    </Card>
  );
}

/**
 * The worker's place in the list. A number you type, not arrows you tap: moving
 * somebody from 26th to 1st is one entry instead of twenty-five taps — which
 * matters far more on a phone than on the desktop console.
 */
function PositionField({
  position,
  busy,
  onCommit,
}: {
  position: number;
  busy: boolean;
  onCommit: (position: number) => void;
}) {
  const [draft, setDraft] = useState(String(position));
  // The list re-sorts under us after every move, so the field follows the row.
  useEffect(() => setDraft(String(position)), [position]);

  return (
    <input
      type="number"
      min={1}
      inputMode="numeric"
      value={draft}
      disabled={busy}
      aria-label="Номер в списке"
      style={{
        flex: "none",
        width: 44,
        minHeight: "var(--app-tap)",
        boxSizing: "border-box",
        padding: "6px 4px",
        borderRadius: "var(--app-radius-control)",
        border: "1px solid var(--tgui--divider, rgb(128 128 128 / 30%))",
        background: "var(--app-card)",
        color: "var(--tgui--hint_color)",
        font: "inherit",
        fontSize: "var(--app-text-meta)",
        fontWeight: 600,
        textAlign: "center",
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = Number(draft);
        if (!Number.isFinite(next) || Math.trunc(next) === position) {
          setDraft(String(position));
          return;
        }
        onCommit(Math.trunc(next));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(String(position));
      }}
    />
  );
}

/** February gets 29: a birthday on the 29th is real, whatever the year holds. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Day and month, as two selects rather than a date picker: a birthday has no
 * year that anyone needs here, and a native date field would force one to be
 * invented and then quietly thrown away.
 */
function BirthDateField({
  value,
  busy,
  onChange,
}: {
  value: string | null;
  busy: boolean;
  onChange: (value: string | null) => void;
}) {
  const parsed = value ? parseBirthDate(value) : null;
  const month = parsed?.month ?? 0;
  const day = parsed?.day ?? 0;

  function commit(nextMonth: number, nextDay: number) {
    if (nextMonth === 0 || nextDay === 0) {
      if (value !== null) onChange(null);
      return;
    }
    // Picking «31» and then «февраль» must not save an impossible date.
    onChange(toBirthDate(nextMonth, Math.min(nextDay, DAYS_IN_MONTH[nextMonth - 1]!)));
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
      <SelectField
        value={String(day || "")}
        disabled={busy}
        aria-label="День рождения — число"
        onChange={(next) => commit(month || 1, Number(next))}
      >
        <option value="">—</option>
        {Array.from({ length: month ? DAYS_IN_MONTH[month - 1]! : 31 }, (_, i) => i + 1).map((d) => (
          <option value={d} key={d}>{d}</option>
        ))}
      </SelectField>
      <SelectField
        value={String(month || "")}
        disabled={busy}
        aria-label="День рождения — месяц"
        onChange={(next) => commit(Number(next), day || 1)}
      >
        <option value="">не указан</option>
        {MONTH_NAMES.map((name, index) => (
          <option value={index + 1} key={name}>{name}</option>
        ))}
      </SelectField>
    </span>
  );
}

/** «12.09» — день, с которого бот не может достучаться. */
function formatBlockedSince(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}
