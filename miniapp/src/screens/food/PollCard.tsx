import { useState } from "react";
import { Button } from "@telegram-apps/telegram-ui";
import { POLL_CHOICE_LABEL, POLL_CHOICES } from "@planer/shared";
import { apiClient, type PollView } from "../../api/client";
import { CardShell } from "../../components/Card";
import { ConfirmButton } from "../../components/ConfirmButton";

const TALLY_LABELS = [["for", "👍 За"], ["against", "👎 Против"], ["abstain", "🤷 Воздержались"], ["silent", "Не ответили"]] as const;

/** Опрос карточкой: голос, итог поимённо, а запускающему — «Закрыть» и «Отменить». */
export function PollCard({ poll: initial }: { poll: PollView }) {
  const [poll, setPoll] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<PollView>) {
    setBusy(true);
    setError(null);
    try {
      setPoll(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
      // Любой отказ — повод перечитать опрос, как в `OrderScreen`: сервер мог
      // закрыть его тиком, запускающий — отменить между рендером и тапом.
      // Раньше гасили кнопки только по тексту «Опрос закрыт.», и отменённый
      // опрос оставлял их активными до перезагрузки списка. Отказ
      // перечитывания не страшен: прежняя карточка и текст ошибки остаются.
      try {
        setPoll(await apiClient.getPoll(poll.id));
      } catch {
        /* оставляем прежний `poll` — хотя бы текст ошибки виден */
      }
    } finally {
      setBusy(false);
    }
  }

  const status = poll.cancelled ? "отменён" : poll.open ? (poll.closes ?? "идёт") : "закрыт";
  return (
    <CardShell>
      <div style={{ fontWeight: 600, fontSize: 15 }}>🗳 {poll.question}</div>
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>{poll.creatorName} · {status}</div>
      {poll.open && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {POLL_CHOICES.map((choice) => (
            <Button key={choice} size="s" mode={poll.myChoice === choice ? "filled" : "bezeled"} disabled={busy}
              onClick={() => run(() => apiClient.votePoll(poll.id, choice))}>{POLL_CHOICE_LABEL[choice]}</Button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 13.5 }}>
        {TALLY_LABELS.map(([key, label]) => poll.tally[key].length > 0 && (
          <div key={key}>{label} — {poll.tally[key].length}: {poll.tally[key].join(", ")}</div>
        ))}
      </div>
      {poll.canManage && poll.open && (
        <div style={{ display: "flex", gap: 8 }}>
          <ConfirmButton label="Закрыть и разослать итог" question="Закрыть опрос?" confirmLabel="Закрыть"
            onConfirm={() => run(() => apiClient.closePoll(poll.id))} disabled={busy} />
          <ConfirmButton label="Отменить" question="Отменить опрос?" confirmLabel="Отменить"
            onConfirm={() => run(() => apiClient.cancelPoll(poll.id))} disabled={busy} />
        </div>
      )}
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>}
    </CardShell>
  );
}
