import { useState } from "react";
import { POLL_CHOICE_LABEL, POLL_CHOICES, cancelPollQuestion, closePollQuestion, pollStatusLabel, pollTallyLines } from "@planer/shared";
import { apiClient, type PollView } from "../../api/client";
import { ActionButton, Card } from "../../ui";
import { ConfirmButton } from "../../components/ConfirmButton";

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

  const status = pollStatusLabel(poll);
  return (
    <Card>
      <div style={{ fontWeight: 600, fontSize: "var(--app-text-body)" }}>🗳 {poll.question}</div>
      <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>{poll.creatorName} · {status}</div>
      {poll.open && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {POLL_CHOICES.map((choice) => (
            <ActionButton key={choice} compact kind={poll.myChoice === choice ? "primary" : "secondary"} aria-pressed={poll.myChoice === choice} disabled={busy}
              onClick={() => run(() => apiClient.votePoll(poll.id, choice))}>{POLL_CHOICE_LABEL[choice]}</ActionButton>
          ))}
        </div>
      )}
      <div style={{ fontSize: "var(--app-text-meta)" }}>
        {pollTallyLines(poll.tally).map((line) => <div key={line}>{line}</div>)}
      </div>
      {poll.canManage && poll.open && (
        <div style={{ display: "flex", gap: 8 }}>
          <ConfirmButton label="Закрыть и разослать итог" question={closePollQuestion(poll)} confirmLabel="Закрыть"
            onConfirm={() => run(() => apiClient.closePoll(poll.id))} disabled={busy} />
          <ConfirmButton label="Отменить" question={cancelPollQuestion(poll)} confirmLabel="Отменить"
            onConfirm={() => run(() => apiClient.cancelPoll(poll.id))} disabled={busy} />
        </div>
      )}
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>}
    </Card>
  );
}
