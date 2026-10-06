import { useEffect, useRef, useState } from "react";
import { sickSpanWords } from "@planer/shared";
import { apiClient, type SickApprovalRow } from "../api/client";
import { ConfirmButton } from "../components/ConfirmButton";
import { routeAuthError, useAuthRequired } from "../auth-required";

/**
 * «На подтверждение» (admin): больничные, ждущие ОК любого админа.
 *
 * Те же кнопки, что под письмом в боте, и тот же сервер: кто нажал первым —
 * тот и решил, второму сервер ответит «Уже подтвердил(а) …», и это видно на
 * карточке. «Отклонить» — с переспросом: запись удаляется, а вернуть её может
 * только работник. Поведение то же, что у `AdminSickApprovals` в мини-аппе.
 */
export function SickApprovalsScreen({ onChanged }: { onChanged?: () => void }) {
  const onAuthRequired = useAuthRequired();
  const [rows, setRows] = useState<SickApprovalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by «Повторить» и после каждого решения — иначе перечитать список нечем. */
  const [attempt, setAttempt] = useState(0);
  /** Отказ сервера на решение. На экране, а не в карточке: после «Уже подтвердил(а) …»
   *  перечитанный список карточки уже не содержит, и текст пропал бы вместе с ней. */
  const [notice, setNotice] = useState<string | null>(null);
  /** После решения провал перечитывания — не «не загрузилось», а «решение принято, список старый». */
  const decided = useRef(false);
  const noticeRef = useRef<HTMLDivElement>(null);

  // Сообщение стоит над списком, а кнопку нажимали где-то внизу длинного списка —
  // без прокрутки отказ остался бы за краем экрана. `?.`: jsdom не знает scrollIntoView.
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [notice]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiClient
      .getSickApprovals()
      .then((loaded) => {
        if (cancelled) return;
        decided.current = false;
        setRows(loaded);
      })
      .catch((err: unknown) => {
        if (routeAuthError(err, onAuthRequired)) return;
        if (cancelled) return;
        setError(decided.current
          ? "Решение принято, но список не удалось обновить — нажми «Повторить»."
          : err instanceof Error ? err.message : "Не удалось загрузить больничные");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function decide(action: () => Promise<void>) {
    setNotice(null);
    try {
      await action();
      decided.current = true;
    } catch (err) {
      // Вход заменит экран: решение не принято, карточке отвечаем «нет».
      if (routeAuthError(err, onAuthRequired)) return false;
      // 409/404 — значит, решение уже есть или записи нет: перечитываем список и
      // метку, иначе карточка осталась бы с живыми кнопками, а число в сайдбаре — старым.
      setNotice(err instanceof Error ? err.message : "Не получилось — попробуй ещё раз");
      setAttempt((n) => n + 1);
      onChanged?.();
      return false;
    }
    setAttempt((n) => n + 1);
    onChanged?.();
    return true;
  }

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">На подтверждение</h2>
      </div>

      {notice && <div ref={noticeRef} className="employees-error" role="alert">{notice}</div>}

      {error && (
        <div>
          <div className="employees-error">{error}</div>
          <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
            Повторить
          </button>
        </div>
      )}

      {!error && !rows && <div className="employees-empty">Загрузка…</div>}

      {!error && rows && rows.length === 0 && <div className="empty-state">Больничных на подтверждение нет.</div>}

      {!error && rows?.map((row) => <ApprovalCard key={row.id} row={row} onDecide={decide} />)}
    </div>
  );
}

function ApprovalCard({ row, onDecide }: { row: SickApprovalRow; onDecide: (action: () => Promise<void>) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    const ok = await onDecide(action);
    // После успеха кнопки остаются выключенными, пока перечитанный список не уберёт
    // карточку: второй тап в этом окне слал бы второй запрос и получал ложное
    // «Уже подтвердил(а)». После отказа — включаем, повторить можно.
    if (!ok) setBusy(false);
  }

  return (
    <div className="approval-card">
      <div className="approval-card-name">{row.employeeName}</div>
      <div className="bug-card-meta">
        {/* Продление: подтверждённый срок уже был, спрашивают только про новые дни —
            без этой строки админ решал бы вслепую, что именно ему показывают. */}
        {row.approvedSpan ? "Продление больничного " : "Больничный "}
        {sickSpanWords(row.date, row.endDate)}
      </div>
      {row.approvedSpan && (
        <div className="bug-card-meta">Уже подтверждён {sickSpanWords(row.approvedSpan.date, row.approvedSpan.endDate)}</div>
      )}
      {row.shiftLines.map((line) => (
        <div key={line} className="approval-card-line">{line}</div>
      ))}
      {row.handoverForced && (
        <div className="approval-card-forced">⚡ передача запущена без ОК — смена была слишком близко</div>
      )}
      <div className="panel-pending-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => apiClient.approveSickLeave(row.id))}>
          ✅ ОК
        </button>
        <ConfirmButton
          label="❌ Отклонить"
          question="Отклонить больничный? Запись удалится, работнику придёт письмо."
          confirmLabel="Да, отклонить"
          className="btn btn-danger"
          disabled={busy}
          onConfirm={() => void run(() => apiClient.rejectSickLeave(row.id))}
        />
      </div>
    </div>
  );
}
