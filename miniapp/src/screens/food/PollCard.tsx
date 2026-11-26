import { useState } from "react";
import {
  POLL_CHOICE_LABEL, POLL_CHOICES, canRemindSilent, cancelPollQuestion, closePollQuestion, pollRemindResultText, pollStatusLabel, pollTallyLines, telegramPollDeliveryText,
} from "@planer/shared";
import { apiClient, type PollView } from "../../api/client";
import { ActionButton, Card } from "../../ui";
import { ConfirmButton } from "../../components/ConfirmButton";

/** Опрос карточкой: голос, итог поимённо, а запускающему — «Напомнить молчащим», «Закрыть» и «Отменить». */
export function PollCard({ poll: initial }: { poll: PollView }) {
  const [poll, setPoll] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remindResult, setRemindResult] = useState<string | null>(null);

  /** Отказ любого действия — повод перечитать опрос, как в `OrderScreen`: сервер мог
   *  закрыть его тиком, запускающий — отменить между рендером и тапом. Раньше гасили
   *  кнопки только по тексту «Опрос закрыт.», и отменённый опрос оставлял их
   *  активными до перезагрузки списка. Отказ перечитывания не страшен: прежняя
   *  карточка и текст ошибки остаются. */
  async function attempt(action: () => Promise<void>, reconcile = true) {
    setBusy(true);
    setError(null);
    // Строка «Напомнил: …» — итог прошлого нажатия; после нового действия она устарела.
    setRemindResult(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
      if (reconcile) {
        try {
          setPoll(await apiClient.getPoll(poll.id));
        } catch {
          /* оставляем прежний `poll` — хотя бы текст ошибки виден */
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const run = (action: () => Promise<PollView>) => attempt(async () => setPoll(await action()));
  /** Напоминание отдаёт не опрос, а сколько дошло — как дожим у `OrderScreen`. */
  const remind = () => attempt(async () => setRemindResult(pollRemindResultText(await apiClient.remindPollSilent(poll.id))));

  const status = pollStatusLabel(poll);
  const { telegram } = poll;
  const deliveryText = telegramPollDeliveryText(telegram?.delivery);
  const refresh = () => attempt(async () => setPoll(await apiClient.getPoll(poll.id)), false);
  return (
    <Card>
      <div style={{ fontWeight: 600, fontSize: "var(--app-text-body)" }}>🗳 {poll.question}</div>
      <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>{poll.creatorName} · {status}{telegram ? " · Telegram" : ""}</div>
      {poll.open && !telegram && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {POLL_CHOICES.map((choice) => (
            <ActionButton key={choice} compact kind={poll.myChoice === choice ? "primary" : "secondary"} aria-pressed={poll.myChoice === choice} disabled={busy}
              onClick={() => run(() => apiClient.votePoll(poll.id, choice))}>{POLL_CHOICE_LABEL[choice]}</ActionButton>
          ))}
        </div>
      )}
      {telegram ? (
        <>
          {poll.open && <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>
            {telegram.canVote ? "Проголосуй в личном чате с ботом." : "Опрос проходит в личном чате с ботом."}
            {telegram.canVote && telegram.multiple && " Можно выбрать несколько вариантов."}
          </div>}
          {deliveryText && <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", overflowWrap: "anywhere" }}>{deliveryText}</div>}
          <ul role="list" aria-label="Общий итог" style={{ display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
            {telegram.options.map(({ text, count }, index) => (
              <li key={text} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, overflowWrap: "anywhere" }}>
                <span>{text}{telegram.myOptionIds.includes(index) && <small style={{ color: "var(--tgui--hint_color)" }}> · Твой выбор</small>}</span>
                <strong>{count}</strong>
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <div role="status" style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>Ответили: {telegram.votedCount}</div>
            {poll.open && <ActionButton compact kind="quiet" disabled={busy} onClick={refresh}>Обновить итог</ActionButton>}
          </div>
        </>
      ) : (
        <div style={{ fontSize: "var(--app-text-meta)" }}>
          {pollTallyLines(poll.tally).map((line) => <div key={line}>{line}</div>)}
        </div>
      )}
      {canRemindSilent(poll) && (
        <ActionButton compact disabled={busy} onClick={remind}>🔔 Напомнить молчащим</ActionButton>
      )}
      {remindResult && <div style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>{remindResult}</div>}
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
