import { useState } from "react";
import { POLL_CHOICES_HINT, POLL_QUESTION_MAX, audienceReady, sendReportText, type FoodSendReport, type TeamAudience } from "@planer/shared";
import { apiClient } from "../../api/client";
import { AudiencePicker } from "./AudiencePicker";
import { useAuthRequired } from "../../auth-required";
import { failureText } from "./food-errors";

/**
 * Новый опрос — как в мини-аппе (`miniapp/src/screens/food/PollForm.tsx`). «На
 * смене» по умолчанию: чаще всего спрашивают тех, кто сегодня рядом. Ответы —
 * всегда три (решение 2026-09-29), поэтому вместо полей вариантов — подсказка.
 */
export function PollForm({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const onAuthRequired = useAuthRequired();
  const [question, setQuestion] = useState("");
  const [closesTime, setClosesTime] = useState("");
  const [audience, setAudience] = useState<TeamAudience>({ kind: "on_shift" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отчёт после отправки — точный ответ даёт только сервер: кого-то могли отвязать
  // от Telegram между выбором адресатов и отправкой.
  const [summary, setSummary] = useState<FoodSendReport | null>(null);

  const ready = question.trim().length > 0 && audienceReady(audience);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.createPoll({ question: question.trim(), closesTime: closesTime || null, audience });
      // Дошло всем — показывать нечего, форма закрывается сразу. Не всем — держим
      // отчёт с явным «ОК», иначе «дошло не всем» проскочило бы мимо.
      if (result.unreachable.length > 0) setSummary({ delivered: result.delivered, unreachable: result.unreachable });
      else onDone();
    } catch (err) {
      setError(failureText(err, "Не удалось отправить опрос", onAuthRequired));
    } finally {
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <div className="employees-screen employees-screen-form food-form">
        <h2 className="employees-title">Опрос отправлен</h2>
        <div className="food-note">{sendReportText(summary)}</div>
        <div className="food-buttons">
          <button type="button" className="btn btn-primary" onClick={onDone}>ОК</button>
        </div>
      </div>
    );
  }

  return (
    <div className="employees-screen employees-screen-form food-form">
      <h2 className="employees-title">Новый опрос</h2>
      <label className="birthday-label">
        Вопрос
        <textarea rows={3} aria-label="Вопрос" placeholder="Корпоратив в пятницу?" maxLength={POLL_QUESTION_MAX}
          value={question} disabled={busy} onChange={(e) => setQuestion(e.target.value)} />
      </label>
      <label className="birthday-label">
        Голосуем до (необязательно)
        <input type="time" className="food-time" aria-label="Голосуем до" value={closesTime} disabled={busy} onChange={(e) => setClosesTime(e.target.value)} />
      </label>
      <div className="food-meta">{POLL_CHOICES_HINT}</div>
      <AudiencePicker value={audience} onChange={setAudience} disabled={busy} />
      {error && <div className="employees-error" role="alert">{error}</div>}
      <div className="food-buttons">
        <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? "Отправляю…" : "Отправить"}
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}
