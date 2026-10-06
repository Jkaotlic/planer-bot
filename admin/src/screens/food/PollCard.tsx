import { useState } from "react";
import {
  POLL_CHOICE_LABEL, POLL_CHOICES, cancelPollQuestion, closePollQuestion, pollStatusLabel, pollTallyLines,
} from "@planer/shared";
import { apiClient, type PollView } from "../../api/client";
import { ConfirmButton } from "../../components/ConfirmButton";
import { failureText } from "./food-errors";

/**
 * Опрос карточкой: голос, итог поимённо, а запускающему и админу — «Закрыть» и
 * «Отменить». Поведение — как у `miniapp/src/screens/food/PollCard.tsx`, тексты — из shared.
 */
export function PollCard({ poll: initial, onAuthRequired }: { poll: PollView; onAuthRequired(): void }) {
  const [poll, setPoll] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<PollView>) {
    setBusy(true);
    setError(null);
    try {
      setPoll(await action());
    } catch (err) {
      setError(failureText(err, "Не получилось", onAuthRequired));
      // Любой отказ — повод перечитать: сервер мог закрыть опрос тиком, запускающий —
      // отменить его между рендером и кликом. Без этого кнопки голоса оставались бы
      // активными до перезагрузки списка. Отказ перечитывания не страшен: текст ошибки уже виден.
      try {
        setPoll(await apiClient.getPoll(poll.id));
      } catch {
        /* остаётся прежняя карточка */
      }
    } finally {
      setBusy(false);
    }
  }

  const tally = pollTallyLines(poll.tally);
  return (
    <article className="food-card">
      <div className="food-card-title">🗳 {poll.question}</div>
      <div className="food-meta">{poll.creatorName} · {pollStatusLabel(poll)}</div>
      {poll.open && (
        <div className="food-buttons" role="group" aria-label="Твой голос">
          {POLL_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className={`btn btn-compact ${poll.myChoice === choice ? "btn-primary" : "btn-secondary"}`}
              aria-pressed={poll.myChoice === choice}
              disabled={busy}
              onClick={() => void run(() => apiClient.votePoll(poll.id, choice))}
            >
              {POLL_CHOICE_LABEL[choice]}
            </button>
          ))}
        </div>
      )}
      {tally.length > 0 && (
        <div className="food-note">
          {tally.map((line) => <div key={line}>{line}</div>)}
        </div>
      )}
      {poll.canManage && poll.open && (
        <div className="food-buttons">
          <ConfirmButton label="Закрыть и разослать итог" question={closePollQuestion(poll)} confirmLabel="Закрыть"
            onConfirm={() => void run(() => apiClient.closePoll(poll.id))} disabled={busy} />
          <ConfirmButton label="Отменить" question={cancelPollQuestion(poll)} confirmLabel="Отменить"
            onConfirm={() => void run(() => apiClient.cancelPoll(poll.id))} disabled={busy} />
        </div>
      )}
      {error && <div className="employees-error" role="alert">{error}</div>}
    </article>
  );
}
