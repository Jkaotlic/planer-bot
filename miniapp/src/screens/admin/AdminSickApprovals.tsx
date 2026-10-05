import { useEffect, useRef, useState } from "react";
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
  /** Отказ последнего решения — на экране, а не на карточке: карточка после отказа
   *  («Уже подтвердил(а) …», «Больничного уже нет») исчезает вместе со строкой. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped by «Повторить» — без него после ошибки перечитать список нечем. */
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Сообщение стоит над списком, а нажимали кнопку где-то внизу длинного списка —
  // без прокрутки отказ остался бы за краем экрана, и человек решил бы, что тап пропал.
  // `?.`: jsdom не знает scrollIntoView.
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [notice]);

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

  /**
   * Решение (или отказ сервера) → перечитать список → и только потом `onChanged`.
   * По очереди, а не параллельно: до релея HTTP/1.1, и метка в `App` делает ещё
   * два запроса вслед за нашим. Отказ тоже перечитывает: «уже подтвердил(а)» и
   * «уже нет» значат, что список устарел, и карточка с живыми кнопками — враньё.
   */
  async function decide(action: () => Promise<void>) {
    setNotice(null);
    let failure: string | null = null;
    try {
      await action();
    } catch (err) {
      failure = err instanceof Error ? err.message : "Не получилось — попробуй ещё раз";
    }
    try {
      const loaded = await apiClient.getSickApprovals();
      if (alive.current) setRows(loaded);
    } catch (err) {
      // Решение уже принято сервером: «Не удалось загрузить» прозвучало бы как «ОК не прошёл»,
      // и человек нажал бы его заново.
      if (alive.current) {
        setError(failure === null
          ? "Решение принято, но список не удалось обновить — нажми «Повторить»."
          : err instanceof Error ? err.message : "Не удалось загрузить больничные");
      }
    }
    if (alive.current && failure) setNotice(failure);
    onChanged?.();
  }

  return (
    <Group>
      {notice && (
        <Card>
          <div ref={noticeRef} role="alert" style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{notice}</div>
        </Card>
      )}

      {error && (
        <Card>
          <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>
          <ActionButton stretched onClick={() => { setNotice(null); setAttempt((n) => n + 1); }}>
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
  // Реф, а не только `busy`: два тапа в одном кадре видят прежнее `busy === false`,
  // и сервер получил бы второй запрос (ответ «Уже подтвердил(а) …» самому себе).
  const inFlight = useRef(false);
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onDecide(action);
    } finally {
      inFlight.current = false;
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
