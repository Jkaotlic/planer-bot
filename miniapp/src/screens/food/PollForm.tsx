import { useState } from "react";
import { Input, Textarea } from "@telegram-apps/telegram-ui";
import { POLL_QUESTION_MAX } from "@planer/shared";
import { apiClient, type TeamAudience } from "../../api/client";
import { AudiencePicker } from "../../components/AudiencePicker";
import { ActionButton } from "../../ui";

/**
 * Новый опрос. «На смене» — по умолчанию: чаще всего спрашивают тех, кто
 * сегодня рядом, а позвать всех — один тап.
 */
export function PollForm({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const [question, setQuestion] = useState("");
  const [closesTime, setClosesTime] = useState("");
  const [audience, setAudience] = useState<TeamAudience>({ kind: "on_shift" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отчёт после отправки — кто не получил опрос. `AudiencePicker` уже
  // показывает недостижимых ДО отправки (та же строка «Не дойдёт»), но
  // список могло изменить состояние гонки (кого-то как раз отвязали от
  // Telegram) — точный ответ даёт только сервер, в самом ответе создания.
  const [summary, setSummary] = useState<{ delivered: number; unreachable: string[] } | null>(null);

  const ready = question.trim().length > 0 && !(audience.kind === "picked" && audience.employeeIds.length === 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.createPoll({ question: question.trim(), closesTime: closesTime || null, audience });
      // Недостижимых нет — закрывать нечего показывать, форма закрывается
      // сразу, как раньше. Есть — держим экран с отчётом и явным «ОК», иначе
      // «дошло не всем» проскочило бы мимо того, кто как раз это должен знать.
      if (result.unreachable.length > 0) setSummary({ delivered: result.delivered, unreachable: result.unreachable });
      else onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить опрос");
    } finally {
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px var(--app-gutter) calc(24px + var(--app-inset-bottom))" }}>
        <h1 className="ui-screen__title">Опрос отправлен</h1>
        <div style={{ fontSize: "var(--app-text-body)", lineHeight: 1.45 }}>
          Отправлено: {summary.delivered}. Не дошло: {summary.unreachable.join(", ")}
        </div>
        <ActionButton kind="primary" onClick={onDone}>ОК</ActionButton>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px var(--app-gutter) calc(24px + var(--app-inset-bottom))" }}>
      <h1 className="ui-screen__title">Новый опрос</h1>
      <Textarea header="Вопрос" placeholder="Корпоратив в пятницу?" value={question} maxLength={POLL_QUESTION_MAX}
        onChange={(e) => setQuestion(e.target.value)} disabled={busy} />
      <Input header="Голосуем до (необязательно)" type="time" value={closesTime}
        onChange={(e) => setClosesTime(e.target.value)} disabled={busy} />
      <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>Ответы: 👍 За · 👎 Против · 🤷 Воздержался</div>
      <AudiencePicker value={audience} onChange={setAudience} disabled={busy} />
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton kind="primary" disabled={!ready || busy} loading={busy} onClick={submit}>Отправить</ActionButton>
        <ActionButton kind="quiet" disabled={busy} onClick={onCancel}>Отмена</ActionButton>
      </div>
    </div>
  );
}
