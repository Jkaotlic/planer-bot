import { useEffect, useState } from "react";
import { Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import { sickSpanWords } from "@planer/shared";
import { apiClient, type SickApprovalRow } from "../../api/client";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ActionButton, Card, Group } from "../../ui";

/**
 * «На подтверждение»: больничные работников, ждущие ОК любого админа.
 *
 * Те же кнопки, что под письмом в боте, и тот же сервер: кто нажал первым —
 * тот и решил, второму сервер ответит «Уже подтвердил(а) …», и это видно на карточке.
 * «Отклонить» — с переспросом: запись удаляется, и вернуть её может только работник.
 */
export function AdminSickApprovals({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<SickApprovalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by «Повторить» и после каждого решения — иначе перечитать список нечем. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiClient
      .getSickApprovals()
      .then((loaded) => {
        if (!cancelled) setRows(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить больничные");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function decide(action: () => Promise<void>) {
    await action();
    setAttempt((n) => n + 1);
    onChanged?.();
  }

  return (
    <Group>
      {error && (
        <Card>
          <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>
          <ActionButton stretched onClick={() => setAttempt((n) => n + 1)}>
            Повторить
          </ActionButton>
        </Card>
      )}

      {!error && !rows && (
        <Card>
          <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
            <Spinner size="m" />
          </div>
        </Card>
      )}

      {!error && rows && rows.length === 0 && <Placeholder description="Больничных на подтверждение нет." />}

      {!error && rows?.map((row) => <SickApprovalCard key={row.id} row={row} onDecide={decide} />)}
    </Group>
  );
}

function SickApprovalCard({ row, onDecide }: { row: SickApprovalRow; onDecide: (action: () => Promise<void>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await onDecide(action);
    } catch (err) {
      // Самый частый отказ — другой админ успел раньше; карточка должна это сказать.
      setError(err instanceof Error ? err.message : "Не получилось — попробуй ещё раз");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <div style={{ fontSize: "var(--app-text-body)", fontWeight: 600 }}>{row.employeeName}</div>
      <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>
        {/* Продление: подтверждённый срок уже был, спрашивают только про новые дни —
            без этой строки админ решал бы вслепую, что именно ему показывают. */}
        {row.approvedSpan ? "Продление больничного " : "Больничный "}
        {sickSpanWords(row.date, row.endDate)}
      </div>
      {row.approvedSpan && (
        <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>
          Уже подтверждён {sickSpanWords(row.approvedSpan.date, row.approvedSpan.endDate)}
        </div>
      )}
      {row.shiftLines.map((line) => (
        <div key={line} style={{ fontSize: "var(--app-text-meta)" }}>{line}</div>
      ))}
      {row.handoverForced && (
        <div style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--destructive_text_color)" }}>
          ⚡ передача запущена без ОК — смена была слишком близко
        </div>
      )}
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <ActionButton kind="primary" stretched loading={busy} disabled={busy} onClick={() => void run(() => apiClient.approveSickLeave(row.id))}>
          ✅ ОК
        </ActionButton>
        <ConfirmButton
          label="❌ Отклонить"
          question="Отклонить больничный? Запись удалится, работнику придёт письмо."
          confirmLabel="Да, отклонить"
          compact={false}
          disabled={busy}
          onConfirm={() => void run(() => apiClient.rejectSickLeave(row.id))}
        />
      </div>
    </Card>
  );
}
