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
      const message = err instanceof Error ? err.message : "Не получилось";
      setError(message);
      // Гонка тика и ручного действия (Review Focus №1): сервер уже закрыл
      // опрос между рендером карточки и тапом — «Опрос закрыт.» ловит именно
      // эту причину отказа голоса. Без этого кнопки голосования оставались бы
      // на карточке до следующей полной перезагрузки списка, и человек мог
      // бы тыкать в них ещё раз с тем же отказом. Простейший верный вариант:
      // погасить `open` локально по тексту отказа, а не тащить в `FoodScreen`
      // колбэк перезагрузки списка ради одной строки.
      if (message === "Опрос закрыт.") setPoll((prev) => ({ ...prev, open: false }));
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
