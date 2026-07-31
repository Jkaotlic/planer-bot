import { useEffect, useState } from "react";
import { MONTH_NAMES, parseBirthDate, toBirthDate } from "@planer/shared";
import { Avatar, Button, Cell, Input, List, Placeholder, Section, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type CreateEmployeeResult, type Employee } from "../../api/client";
import { CategoryChip, useCategoryPalette } from "../../categories";
import { CardShell, CardStack, MetaLine } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";
import { initialsOf, personPalette } from "../../lib/people";

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
      setRowError({ employeeId: id, message: err instanceof Error ? err.message : "Не удалось выполнить действие" });
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
      setRowError({ employeeId: employee.id, message: err instanceof Error ? err.message : "Не удалось получить ссылку" });
    } finally {
      setBusyId(null);
    }
  }

  if (error && !employees) {
    return (
      <ScreenScroll>
        <Placeholder header="Не удалось загрузить" description={error} />
      </ScreenScroll>
    );
  }
  if (!employees) {
    return (
      <ScreenScroll style={{ display: "flex", justifyContent: "center", paddingTop: 48 }}>
        <Spinner size="l" />
      </ScreenScroll>
    );
  }

  const active = employees.filter((e) => e.isActive);
  const archived = employees.filter((e) => !e.isActive);

  return (
    <ScreenScroll>
      <List>
        <Section header="Новый работник">
          <CardStack>
            <AddEmployeeForm busy={adding} onAdd={handleAdd} />
            {invite && (
              <InviteCard invite={invite} onRegenerate={() => void refreshCreatedInvite(invite.employee)} onDismiss={() => setInvite(null)} />
            )}
          </CardStack>
        </Section>

        {error && (
          <Section>
            <div style={{ padding: "8px 20px", color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{error}</div>
          </Section>
        )}

        <Section header={`Активные · ${active.length}`}>
          {active.length === 0 ? (
            <Placeholder description="Пока нет активных работников" />
          ) : (
            active.map((e, index) => (
              <EmployeeRow
                key={e.id}
                employee={e}
                position={index + 1}
                onReorder={(position) => withBusy(e.id, () => apiClient.reorderEmployee(e.id, position).then(() => {}))}
                onBirthDate={(birthDate) => withBusy(e.id, () => apiClient.setBirthDate(e.id, birthDate))}
                actionLabel="В архив"
                busy={busyId === e.id}
                onAction={() => withBusy(e.id, () => apiClient.archiveEmployee(e.id))}
                onToggleAdmin={() => withBusy(e.id, () => apiClient.setEmployeeAdmin(e.id, !e.isAdmin))}
                onRename={(name) => withBusy(e.id, () => apiClient.renameEmployee(e.id, name))}
                onPreferredName={(preferredName) => withBusy(e.id, () => apiClient.setEmployeePreferredName(e.id, preferredName))}
                onShowInvite={() => void showRowInvite(e)}
                invite={rowInvite?.employeeId === e.id ? rowInvite : null}
                error={rowError?.employeeId === e.id ? rowError.message : null}
              />
            ))
          )}
        </Section>

        <Section header={`Архив · ${archived.length}`}>
          {archived.length === 0 ? (
            <Placeholder description="Архив пуст" />
          ) : (
            archived.map((e) => (
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
              />
            ))
          )}
        </Section>
      </List>
    </ScreenScroll>
  );
}

export function EmployeeRow({
  employee,
  invite,
  error,
  actionLabel,
  busy,
  onAction,
  onToggleAdmin,
  onRename,
  onPreferredName,
  onShowInvite,
  position,
  onReorder,
  onBirthDate,
}: {
  employee: Employee;
  /** The link this row asked for, shown right here — see the note on `rowInvite`. */
  invite?: { inviteToken: string; inviteLink: string | null } | null;
  /** Why this row's last action was refused, shown right here — see `rowError`. */
  error?: string | null;
  actionLabel: string;
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
}) {
  const palette = personPalette(employee.id);
  const linked = employee.telegramUserId != null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(employee.displayName);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState(employee.preferredName ?? "");

  if (editingAddress) {
    return (
      <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <Input
          header="Обращение"
          placeholder={employee.address}
          value={addressDraft}
          disabled={busy}
          onChange={(e) => setAddressDraft(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="s"
            mode="filled"
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
          </Button>
          <Button size="s" mode="gray" disabled={busy} onClick={() => { setAddressDraft(employee.preferredName ?? ""); setEditingAddress(false); }}>
            Отмена
          </Button>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <Input header="Имя" value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} />
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="s"
            mode="filled"
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
          </Button>
          <Button size="s" mode="gray" disabled={busy} onClick={() => { setDraft(employee.displayName); setEditing(false); }}>
            Отмена
          </Button>
        </div>
      </div>
    );
  }

  // Card layout (not a Cell with an `after` slot): on a phone three buttons in the
  // trailing slot squeeze the name down to "Nekh…". Name + status get the full
  // width on top; the actions wrap onto their own row underneath.
  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {position !== undefined && onReorder && (
          <PositionField position={position} busy={busy} onCommit={onReorder} />
        )}
        <Avatar acronym={initialsOf(employee.displayName)} size={40} style={{ background: palette.bg, color: palette.fg, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {employee.displayName}
          </div>
          {/* What the bot will actually say. Shown always, not «when it differs
              from the first word of displayName» — guessing which word is the
              given name is exactly what this whole change refuses to do. */}
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5 }}>Бот зовёт: {employee.address}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2, fontSize: 13 }}>
            <span style={{ color: linked ? "var(--tgui--hint_color)" : "var(--tgui--destructive_text_color)" }}>
              {linked ? "привязан" : "не привязан"}
            </span>
            {employee.isAdmin && <CategoryChip category="shift">админ</CategoryChip>}
          </div>
        </div>
      </div>

      {onBirthDate && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: "var(--tgui--hint_color)" }}>
          <span style={{ flex: "none" }}>День рождения</span>
          <BirthDateField value={employee.birthDate} busy={busy} onChange={onBirthDate} />
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {onRename && (
          <Button size="s" mode="bezeled" disabled={busy} onClick={() => { setDraft(employee.displayName); setEditing(true); }}>
            ✎ Имя
          </Button>
        )}
        {onPreferredName && (
          <Button size="s" mode="bezeled" disabled={busy} onClick={() => { setAddressDraft(employee.preferredName ?? ""); setEditingAddress(true); }}>
            ✎ Обращение
          </Button>
        )}
        {onShowInvite && !linked && (
          <Button size="s" mode="bezeled" disabled={busy} onClick={onShowInvite}>
            🔗 Ссылка
          </Button>
        )}
        {onToggleAdmin && linked && (
          <Button size="s" mode="bezeled" loading={busy} disabled={busy} onClick={onToggleAdmin}>
            {employee.isAdmin ? "Снять админа" : "Сделать админом"}
          </Button>
        )}
        <Button size="s" mode="gray" loading={busy} disabled={busy} onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
      {/* The refusal belongs where the finger was — a message at the top of a
          list of thirty is a message nobody sees. */}
      {error && (
        <div role="alert" style={{ marginTop: 8, color: "var(--tgui--destructive_text_color)", fontSize: 13.5, lineHeight: 1.4 }}>
          {error}
        </div>
      )}
      {invite && !linked && <RowInviteLink invite={invite} />}
    </CardShell>
  );
}

/** The invite link, in the row that asked for it. Selectable rather than only
 *  copyable: the Mini App webview has no clipboard in an insecure context, and a
 *  link nobody can get out of the screen is the same as no link. */
function RowInviteLink({ invite }: { invite: { inviteToken: string; inviteLink: string | null } }) {
  const link = invite.inviteLink ?? invite.inviteToken;
  return (
    <div style={{ marginTop: 10 }}>
      <MetaLine icon="🔗">Отправь ссылку — по ней работник привяжет Telegram.</MetaLine>
      <div
        style={{
          marginTop: 6, padding: "8px 10px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.4,
          wordBreak: "break-all", userSelect: "all",
          background: "var(--tgui--secondary_fill, rgba(128,128,128,.12))",
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
    <CardShell>
      <Input
        header="Имя"
        placeholder="Например, Настя Волкова"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <Button size="m" mode="filled" stretched loading={busy} disabled={busy || !name.trim()} onClick={submit}>
        ＋ Добавить работника
      </Button>
    </CardShell>
  );
}

function InviteCard({ invite, onRegenerate, onDismiss }: { invite: CreateEmployeeResult; onRegenerate?: () => void; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  // In dev the mock always synthesizes a link; in prod the server may return
  // null (no bot username configured) — fall back to the bare token then.
  const link = invite.inviteLink ?? invite.inviteToken;
  const okPalette = useCategoryPalette("weekend_work");

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
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 15.5 }}>{invite.employee.displayName} добавлен(а)</div>
        <span style={{ fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: "4px 10px", background: okPalette.bg, color: okPalette.fg }}>
          готово
        </span>
      </div>
      <MetaLine icon="🔗">Отправь ссылку — по ней работник привяжет Telegram.</MetaLine>
      <div
        style={{
          fontSize: 13,
          fontFamily: "var(--tgui--font_family_mono, monospace)",
          wordBreak: "break-all",
          background: "var(--tgui--secondary_bg_color)",
          borderRadius: 10,
          padding: "8px 10px",
        }}
      >
        {link}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <Button size="s" mode="filled" stretched onClick={() => void copy()}>
          {copied ? "Скопировано ✓" : "Копировать ссылку"}
        </Button>
        <Button size="s" mode="gray" onClick={onDismiss}>
          Скрыть
        </Button>
      </div>
      {onRegenerate && (
        <Button size="s" mode="bezeled" stretched onClick={onRegenerate}>
          Создать новую ссылку
        </Button>
      )}
    </CardShell>
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
        padding: "6px 4px",
        borderRadius: 8,
        border: "1px solid var(--tgui--outline)",
        background: "var(--tgui--secondary_bg_color)",
        color: "var(--tgui--hint_color)",
        fontSize: 13,
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

const selectStyle = {
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid var(--tgui--outline)",
  background: "var(--tgui--secondary_bg_color)",
  color: "var(--tgui--text_color)",
  font: "inherit",
  fontSize: 13,
} as const;

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
    <span style={{ display: "inline-flex", gap: 6, minWidth: 0 }}>
      <select
        value={day || ""}
        disabled={busy}
        aria-label="День рождения — число"
        style={{ ...selectStyle, minWidth: 62 }}
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
        style={{ ...selectStyle, minWidth: 118 }}
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
