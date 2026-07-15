import { useEffect, useState } from "react";
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
  /** The most recently created worker's invite, shown until dismissed. */
  const [invite, setInvite] = useState<CreateEmployeeResult | null>(null);

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
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить действие");
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

  async function showInvite(employee: Employee, regenerate = false) {
    setError(null);
    try {
      const info = await apiClient.getEmployeeInvite(employee.id, regenerate);
      setInvite({ employee, inviteToken: info.inviteToken, inviteLink: info.inviteLink });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось получить ссылку");
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
              <InviteCard invite={invite} onRegenerate={() => void showInvite(invite.employee, true)} onDismiss={() => setInvite(null)} />
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
            active.map((e) => (
              <EmployeeRow
                key={e.id}
                employee={e}
                actionLabel="В архив"
                busy={busyId === e.id}
                onAction={() => withBusy(e.id, () => apiClient.archiveEmployee(e.id))}
                onToggleAdmin={() => withBusy(e.id, () => apiClient.setEmployeeAdmin(e.id, !e.isAdmin))}
                onRename={(name) => withBusy(e.id, () => apiClient.renameEmployee(e.id, name))}
                onShowInvite={() => void showInvite(e)}
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
                onShowInvite={() => void showInvite(e)}
              />
            ))
          )}
        </Section>
      </List>
    </ScreenScroll>
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
  /** When provided (active roster), a linked worker can be promoted to / removed from admin. */
  onToggleAdmin?: () => void;
  /** When provided, the worker can be renamed inline. */
  onRename?: (name: string) => void;
  /** When provided, an unlinked worker's invite link can be re-shown. */
  onShowInvite?: () => void;
}) {
  const palette = personPalette(employee.id);
  const linked = employee.telegramUserId != null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(employee.displayName);

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
        <Avatar acronym={initialsOf(employee.displayName)} size={40} style={{ background: palette.bg, color: palette.fg, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {employee.displayName}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2, fontSize: 13 }}>
            <span style={{ color: linked ? "var(--tgui--hint_color)" : "var(--tgui--destructive_text_color)" }}>
              {linked ? "привязан" : "не привязан"}
            </span>
            {employee.isAdmin && <CategoryChip category="shift">админ</CategoryChip>}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {onRename && (
          <Button size="s" mode="bezeled" disabled={busy} onClick={() => { setDraft(employee.displayName); setEditing(true); }}>
            ✎ Имя
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
    </CardShell>
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
