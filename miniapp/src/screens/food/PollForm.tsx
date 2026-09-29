import { useState } from "react";
import { Button, Input, Textarea, Title } from "@telegram-apps/telegram-ui";
import { POLL_QUESTION_MAX } from "@planer/shared";
import { apiClient, type TeamAudience } from "../../api/client";
import { AudiencePicker } from "../../components/AudiencePicker";

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

  const ready = question.trim().length > 0 && !(audience.kind === "picked" && audience.employeeIds.length === 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.createPoll({ question: question.trim(), closesTime: closesTime || null, audience });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить опрос");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <Title level="2" weight="2">Новый опрос</Title>
      <Textarea header="Вопрос" placeholder="Корпоратив в пятницу?" value={question} maxLength={POLL_QUESTION_MAX}
        onChange={(e) => setQuestion(e.target.value)} disabled={busy} />
      <Input header="Голосуем до (необязательно)" type="time" value={closesTime}
        onChange={(e) => setClosesTime(e.target.value)} disabled={busy} />
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>Ответы: 👍 За · 👎 Против · 🤷 Воздержался</div>
      <AudiencePicker value={audience} onChange={setAudience} disabled={busy} />
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="m" mode="filled" disabled={!ready || busy} loading={busy} onClick={submit}>Отправить</Button>
        <Button size="m" mode="plain" disabled={busy} onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  );
}
