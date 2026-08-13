import { useEffect, useState } from "react";
import { MONTH_NAMES, parseBirthDate, toBirthDate } from "@planer/shared";
import { apiClient, type CreateEmployeeResult, type Employee } from "../api/client";
import { useCategoryPalette } from "../categories";
import { CollapsibleArchive } from "../components/CollapsibleArchive";
import { initialsOf, personPalette } from "../lib/people";

export interface EmployeesScreenProps {
  employees: readonly Employee[];
  /** Re-fetches the employee list from the API after a mutation. */
  onChanged: () => Promise<void>;
  /** Patches a just-saved restriction flag into the parent's own state — see `setRestriction`. */
  onRestrictionsSaved: (id: number, patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean }) => void;
}

/**
 * Причина отказа — человеческой фразой.
 *
 * Сервер отдаёт часть причин кодами (`last_admin`, `archived`, …), а клиент
 * кладёт их в `Error.message` как есть. Правило проекта давно записано в `App`:
 * код отказа — не то, что показывают человеку. Пока такой ответ рисовался за
 * верхним краем экрана, этого не было видно; теперь он в строке, и читать его
 * должен человек. Всё, что сервер уже написал по-русски (сторож тёзок, проверки
 * полей), проходит насквозь.
 *
 * MIRRORS `refusalText` в мини-аппе (AdminEmployeesScreen).
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
 * "Работники" screen: active/archived worker lists with archive/restore
 * actions, plus a dialog to add a new worker and hand them an invite link.
 */
export function EmployeesScreen({ employees, onChanged, onRestrictionsSaved }: EmployeesScreenProps) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [invite, setInvite] = useState<CreateEmployeeResult | null>(null);
  /**
   * A refusal earned by a row's own button, kept with that row — and the only
   * error state this screen has. A whole-screen error drawn under the title is
   * right for a failed load, but this screen never loads anything itself (the
   * list arrives as a prop), and for a row it is wrong outright: with 28 active
   * workers plus the archive the list is far taller than the window, so
   * «Архивировать» на нижней строке отвечало за пределами видимой области.
   * Same fix, and same reasoning, as the Mini App's `rowError` in
   * AdminEmployeesScreen.
   */
  const [rowError, setRowError] = useState<{ employeeId: number; message: string } | null>(null);

  const active = employees.filter((e) => e.isActive);
  const archived = employees.filter((e) => !e.isActive);

  async function withBusy(id: number, action: () => Promise<void>) {
    setBusyId(id);
    setRowError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setRowError({ employeeId: id, message: err instanceof Error ? refusalText(err.message) : "Не удалось выполнить действие" });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Deliberately does NOT go through `onChanged()`: a full re-fetch after a
   * successful save is unnecessary work — the response already told us the
   * new value took — and re-running it only reopens a stale-render window
   * between the PATCH resolving and the GET's response landing, during which
   * the checkbox could flash back to the pre-save value. Patching the
   * confirmed value straight into the parent's state avoids that window
   * entirely. Mirrors the Mini App's `AdminEmployeesScreen.setRestriction`.
   */
  async function setRestriction(id: number, patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean }) {
    setBusyId(id);
    setRowError(null);
    try {
      await apiClient.setEmployeeRestrictions(id, patch);
      onRestrictionsSaved(id, patch);
    } catch (err) {
      setRowError({ employeeId: id, message: err instanceof Error ? refusalText(err.message) : "Не удалось сохранить ограничение" });
    } finally {
      setBusyId(null);
    }
  }

  async function showInvite(employee: Employee, regenerate = false) {
    setRowError(null);
    try {
      const info = await apiClient.getEmployeeInvite(employee.id, regenerate);
      setInvite({ employee, inviteToken: info.inviteToken, inviteLink: info.inviteLink });
    } catch (err) {
      setRowError({ employeeId: employee.id, message: err instanceof Error ? refusalText(err.message) : "Не удалось получить ссылку" });
    }
  }

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Работники</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowAddDialog(true)}>
          ＋ Добавить работника
        </button>
      </div>

      <EmployeesSection
        title="Активные"
        employees={active}
        emptyLabel="Пока нет активных работников"
        actionLabel="Архивировать"
        busyId={busyId}
        rowError={rowError}
        onAction={(id) => withBusy(id, () => apiClient.archiveEmployee(id))}
        onToggleAdmin={(id, makeAdmin) => withBusy(id, () => apiClient.setEmployeeAdmin(id, makeAdmin))}
        onRename={(id, name) => withBusy(id, () => apiClient.renameEmployee(id, name))}
        onReorder={(id, position) => withBusy(id, () => apiClient.reorderEmployee(id, position).then(() => {}))}
        onBirthDate={(id, birthDate) => withBusy(id, () => apiClient.setBirthDate(id, birthDate))}
        onShowInvite={(employee) => void showInvite(employee)}
        onSetRestrictions={setRestriction}
      />

      <CollapsibleArchive title="Архив" items={archived}>
        {(rows) => (
          <div className="employees-list">
            {rows.map((employee) => (
              <EmployeeRow
                key={employee.id}
                employee={employee}
                actionLabel="Восстановить"
                busy={busyId === employee.id}
                error={rowError?.employeeId === employee.id ? rowError.message : null}
                onAction={() => withBusy(employee.id, () => apiClient.restoreEmployee(employee.id))}
                onRename={(name) => withBusy(employee.id, () => apiClient.renameEmployee(employee.id, name))}
                onSetRestrictions={(patch) => setRestriction(employee.id, patch)}
              />
            ))}
          </div>
        )}
      </CollapsibleArchive>

      {showAddDialog && (
        <AddEmployeeDialog
          onCancel={() => setShowAddDialog(false)}
          onCreated={async (result) => {
            setShowAddDialog(false);
            await onChanged();
            setInvite(result);
          }}
        />
      )}

      {invite && (
        <InviteLinkDialog invite={invite} onRegenerate={() => void showInvite(invite.employee, true)} onClose={() => setInvite(null)} />
      )}
    </div>
  );
}

interface EmployeesSectionProps {
  title: string;
  employees: readonly Employee[];
  emptyLabel: string;
  actionLabel: string;
  busyId: number | null;
  /** Why the last action failed, and on whose row — see `rowError`. */
  rowError: { employeeId: number; message: string } | null;
  onAction: (id: number) => void;
  /** When provided (active section), each row gets a make-admin / remove-admin toggle. */
  onToggleAdmin?: (id: number, makeAdmin: boolean) => void;
  /** When provided, each row can rename the worker inline. */
  onRename?: (id: number, name: string) => void;
  /** When provided, an unlinked worker's row can re-show its invite link. */
  onShowInvite?: (employee: Employee) => void;
  /** When provided (active section), each row can be moved to a position in the list. */
  onReorder?: (id: number, position: number) => void;
  /** When provided, each row can set or clear the worker's birthday. */
  onBirthDate?: (id: number, birthDate: string | null) => void;
  /** Every row gets the «Ограничения» checkboxes — active and archived alike. */
  onSetRestrictions: (id: number, patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean }) => void;
}

function EmployeesSection({ title, employees, emptyLabel, actionLabel, busyId, rowError, onAction, onToggleAdmin, onRename, onShowInvite, onReorder, onBirthDate, onSetRestrictions }: EmployeesSectionProps) {
  return (
    <section className="employees-section">
      <h3 className="employees-section-title">{title}</h3>
      {employees.length === 0 ? (
        <div className="employees-empty">{emptyLabel}</div>
      ) : (
        <div className="employees-list">
          {employees.map((employee, index) => (
            <EmployeeRow
              key={employee.id}
              employee={employee}
              position={onReorder ? index + 1 : undefined}
              onReorder={onReorder ? (position) => onReorder(employee.id, position) : undefined}
              onBirthDate={onBirthDate ? (birthDate) => onBirthDate(employee.id, birthDate) : undefined}
              actionLabel={actionLabel}
              busy={busyId === employee.id}
              error={rowError?.employeeId === employee.id ? rowError.message : null}
              onAction={() => onAction(employee.id)}
              onToggleAdmin={onToggleAdmin ? () => onToggleAdmin(employee.id, !employee.isAdmin) : undefined}
              onRename={onRename ? (name) => onRename(employee.id, name) : undefined}
              onShowInvite={onShowInvite ? () => onShowInvite(employee) : undefined}
              onSetRestrictions={(patch) => onSetRestrictions(employee.id, patch)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EmployeeRow({
  employee,
  actionLabel,
  busy,
  error,
  position,
  onAction,
  onToggleAdmin,
  onRename,
  onShowInvite,
  onReorder,
  onBirthDate,
  onSetRestrictions,
}: {
  employee: Employee;
  actionLabel: string;
  busy: boolean;
  /** Why this row's last action was refused, shown right here — see `rowError`. */
  error?: string | null;
  /** 1-based place in the list, shown and editable. Absent for archived workers. */
  position?: number;
  onAction: () => void;
  onToggleAdmin?: () => void;
  onRename?: (name: string) => void;
  onShowInvite?: () => void;
  onReorder?: (position: number) => void;
  onBirthDate?: (birthDate: string | null) => void;
  onSetRestrictions: (patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean }) => void;
}) {
  const palette = personPalette(employee.id);
  const linked = employee.telegramUserId != null;
  // "Привязан" reuses the weekend_work category's green so linked-status reads
  // as a system color rather than a one-off, and stays legible in both themes.
  const linkedPalette = useCategoryPalette("weekend_work");
  const chipStyle = linked ? { background: linkedPalette.bg, color: linkedPalette.fg } : undefined;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(employee.displayName);

  function save() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== employee.displayName) onRename?.(trimmed);
    setEditing(false);
  }
  function cancel() {
    setDraft(employee.displayName);
    setEditing(false);
  }

  return (
    <div className="employee-row-card" data-employee-id={employee.id}>
      {position !== undefined && onReorder && (
        <PositionField position={position} busy={busy} onCommit={onReorder} />
      )}
      <span className="avatar" style={{ background: palette.bg, color: palette.fg }}>
        {initialsOf(employee.displayName)}
      </span>
      {editing ? (
        <input
          className="employee-name-input"
          type="text"
          value={draft}
          autoFocus
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
        />
      ) : (
        <span className="employee-row-name">{employee.displayName}</span>
      )}
      {!editing && (
        <>
          <span className="status-chip" style={chipStyle}>
            {linked ? "привязан" : "не привязан"}
          </span>
          {employee.isAdmin && <span className="admin-badge">админ</span>}
        </>
      )}
      {!editing && onBirthDate && (
        <span className="employee-birthday" title="День рождения">
          🎂
          <BirthDateField value={employee.birthDate} busy={busy} onChange={onBirthDate} />
        </span>
      )}
      <span className="employee-row-spacer" />
      {editing ? (
        <>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? "…" : "Сохранить"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={cancel} disabled={busy}>
            Отмена
          </button>
        </>
      ) : (
        <>
          {onRename && (
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)} disabled={busy} title="Переименовать">
              ✎ Имя
            </button>
          )}
          {onShowInvite && !linked && (
            <button type="button" className="btn btn-secondary" onClick={onShowInvite} disabled={busy} title="Показать ссылку-приглашение">
              🔗 Ссылка
            </button>
          )}
          {onToggleAdmin && employee.telegramUserId != null && (
            <button type="button" className="btn btn-secondary" onClick={onToggleAdmin} disabled={busy}>
              {employee.isAdmin ? "Убрать из админов" : "Сделать админом"}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onAction} disabled={busy}>
            {busy ? "…" : actionLabel}
          </button>
        </>
      )}
      {!editing && (
        <div className="employee-restrictions">
          <span className="employee-restrictions-title">Ограничения</span>
          <label className="employee-restriction-checkbox">
            <input
              type="checkbox"
              checked={employee.excludedFromAssignment}
              disabled={busy}
              onChange={() => onSetRestrictions({ excludedFromAssignment: !employee.excludedFromAssignment })}
            />
            Не участвует в назначениях
            <span className="employee-restriction-hint">
              — бот не ставит его при распределении и не зовёт на выходные; вручную поставить можно
            </span>
          </label>
          <label className="employee-restriction-checkbox">
            <input
              type="checkbox"
              checked={employee.excludedFromSwaps}
              disabled={busy}
              onChange={() => onSetRestrictions({ excludedFromSwaps: !employee.excludedFromSwaps })}
            />
            Не участвует в обменах
            <span className="employee-restriction-hint">
              — ни предложить, ни принять обмен; открытые заявки будут отменены
            </span>
          </label>
        </div>
      )}
      {/* The refusal belongs where the click was. `flex-basis: 100%` puts it on
          its own line inside the card — the card already wraps. */}
      {error && (
        <div className="error-text" role="alert" style={{ flexBasis: "100%", marginTop: 0 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function AddEmployeeDialog({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (result: CreateEmployeeResult) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Введите имя работника");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiClient.createEmployee(trimmed);
      await onCreated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать работника");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel-overlay" onClick={onCancel}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">Добавить работника</span>
          <button type="button" className="panel-close" onClick={onCancel} aria-label="Закрыть">
            ×
          </button>
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="new-employee-name">
            Имя
          </label>
          <input
            id="new-employee-name"
            type="text"
            value={name}
            placeholder="Например, Настя Волкова"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
          />
        </div>

        {error && <div className="error-text">{error}</div>}

        <div className="panel-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "Создание…" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteLinkDialog({ invite, onRegenerate, onClose }: { invite: CreateEmployeeResult; onRegenerate?: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const { employee } = invite;
  // Use the server-built deep-link (it knows the real bot username); fall back
  // to the bare token only if the server has no bot username configured.
  const link = invite.inviteLink ?? invite.inviteToken;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the link is still
      // selectable/copyable by hand from the input below.
    }
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">Ссылка · {employee.displayName}</span>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>

        <div className="field-group">
          <span className="field-label">Ссылка-приглашение</span>
          <div className="invite-link-row">
            <input type="text" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-secondary" onClick={() => void copyLink()}>
              {copied ? "Скопировано" : "Копировать"}
            </button>
          </div>
          <p className="invite-hint">Отправь ссылку работнику — по ней он привяжет Telegram.</p>
        </div>

        <div className="panel-actions">
          {onRegenerate && (
            <button type="button" className="btn btn-secondary" onClick={onRegenerate} title="Старая ссылка перестанет работать">
              Создать новую
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The worker's place in the list, as a number you type rather than arrows you
 * click: moving somebody from 26th to 1st is one keystroke instead of 25 taps,
 * and it reads the same on a phone as on a desktop.
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

  function commit() {
    const next = Number(draft);
    if (!Number.isFinite(next) || Math.trunc(next) === position) {
      setDraft(String(position));
      return;
    }
    onCommit(Math.trunc(next));
  }

  return (
    <input
      className="employee-position"
      type="number"
      min={1}
      inputMode="numeric"
      value={draft}
      disabled={busy}
      aria-label="Номер в списке"
      title="Номер в списке — впиши другой, чтобы переставить"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(String(position));
      }}
    />
  );
}

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
    const clamped = Math.min(nextDay, DAYS_IN_MONTH[nextMonth - 1]!);
    onChange(toBirthDate(nextMonth, clamped));
  }

  return (
    <span className="birthday-field">
      <select
        value={day || ""}
        disabled={busy}
        aria-label="День рождения — число"
        onChange={(e) => commit(month || 1, Number(e.target.value))}
      >
        <option value="">—</option>
        {Array.from({ length: month ? DAYS_IN_MONTH[month - 1]! : 31 }, (_, i) => i + 1).map((d) => (
          <option value={d} key={d}>{d}</option>
        ))}
      </select>
      <select
        value={month || ""}
        disabled={busy}
        aria-label="День рождения — месяц"
        onChange={(e) => commit(Number(e.target.value), day || 1)}
      >
        <option value="">не указан</option>
        {MONTH_NAMES.map((name, index) => (
          <option value={index + 1} key={name}>{name}</option>
        ))}
      </select>
    </span>
  );
}

/** February gets 29: a birthday on the 29th is real, whatever the year holds. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
