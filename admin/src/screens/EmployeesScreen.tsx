import { useState } from "react";
import { apiClient, type CreateEmployeeResult, type Employee } from "../api/client";
import { useCategoryPalette } from "../categories";
import { initialsOf, personPalette } from "../lib/people";

export interface EmployeesScreenProps {
  employees: readonly Employee[];
  /** Re-fetches the employee list from the API after a mutation. */
  onChanged: () => Promise<void>;
}

/**
 * "Работники" screen: active/archived worker lists with archive/restore
 * actions, plus a dialog to add a new worker and hand them an invite link.
 */
export function EmployeesScreen({ employees, onChanged }: EmployeesScreenProps) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [invite, setInvite] = useState<CreateEmployeeResult | null>(null);

  const active = employees.filter((e) => e.isActive);
  const archived = employees.filter((e) => !e.isActive);

  async function withBusy(id: number, action: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить действие");
    } finally {
      setBusyId(null);
    }
  }

  async function showInvite(employee: Employee, regenerate = false) {
    setError(null);
    try {
      const info = await apiClient.getEmployeeInvite(employee.id, regenerate);
      setInvite({ employee, inviteToken: info.inviteToken, inviteLink: info.inviteLink });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось получить ссылку");
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

      {error && <div className="error-text">{error}</div>}

      <EmployeesSection
        title="Активные"
        employees={active}
        emptyLabel="Пока нет активных работников"
        actionLabel="Архивировать"
        busyId={busyId}
        onAction={(id) => withBusy(id, () => apiClient.archiveEmployee(id))}
        onToggleAdmin={(id, makeAdmin) => withBusy(id, () => apiClient.setEmployeeAdmin(id, makeAdmin))}
        onRename={(id, name) => withBusy(id, () => apiClient.renameEmployee(id, name))}
        onShowInvite={(employee) => void showInvite(employee)}
      />

      <EmployeesSection
        title="Архив"
        employees={archived}
        emptyLabel="Архив пуст"
        actionLabel="Восстановить"
        busyId={busyId}
        onAction={(id) => withBusy(id, () => apiClient.restoreEmployee(id))}
        onRename={(id, name) => withBusy(id, () => apiClient.renameEmployee(id, name))}
      />

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
  onAction: (id: number) => void;
  /** When provided (active section), each row gets a make-admin / remove-admin toggle. */
  onToggleAdmin?: (id: number, makeAdmin: boolean) => void;
  /** When provided, each row can rename the worker inline. */
  onRename?: (id: number, name: string) => void;
  /** When provided, an unlinked worker's row can re-show its invite link. */
  onShowInvite?: (employee: Employee) => void;
}

function EmployeesSection({ title, employees, emptyLabel, actionLabel, busyId, onAction, onToggleAdmin, onRename, onShowInvite }: EmployeesSectionProps) {
  return (
    <section className="employees-section">
      <h3 className="employees-section-title">{title}</h3>
      {employees.length === 0 ? (
        <div className="employees-empty">{emptyLabel}</div>
      ) : (
        <div className="employees-list">
          {employees.map((employee) => (
            <EmployeeRow
              key={employee.id}
              employee={employee}
              actionLabel={actionLabel}
              busy={busyId === employee.id}
              onAction={() => onAction(employee.id)}
              onToggleAdmin={onToggleAdmin ? () => onToggleAdmin(employee.id, !employee.isAdmin) : undefined}
              onRename={onRename ? (name) => onRename(employee.id, name) : undefined}
              onShowInvite={onShowInvite ? () => onShowInvite(employee) : undefined}
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
  onAction,
  onToggleAdmin,
  onRename,
  onShowInvite,
}: {
  employee: Employee;
  actionLabel: string;
  busy: boolean;
  onAction: () => void;
  onToggleAdmin?: () => void;
  onRename?: (name: string) => void;
  onShowInvite?: () => void;
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
    <div className="employee-row-card">
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
