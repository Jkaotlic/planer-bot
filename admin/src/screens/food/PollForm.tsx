import { useRef, useState } from "react";
import {
  POLL_CHOICES_HINT, POLL_CLOSES_HINT, POLL_QUESTION_MAX, POLL_TELEGRAM_OPTION_LIMIT, POLL_TELEGRAM_OPTION_MAX, POLL_TELEGRAM_QUESTION_MAX,
  audienceReady, sendReportText, sendReportTitle, telegramPollConfigSchema, type FoodSendReport, type TeamAudience,
} from "@planer/shared";
import { apiClient } from "../../api/client";
import { AudiencePicker } from "./AudiencePicker";
import { useAuthRequired } from "../../auth-required";
import { failureText } from "./food-errors";

/**
 * Новый опрос — как в мини-аппе (`miniapp/src/screens/food/PollForm.tsx`). «На
 * смене» по умолчанию: чаще всего спрашивают тех, кто сегодня рядом.
 */
export function PollForm({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const onAuthRequired = useAuthRequired();
  const [question, setQuestion] = useState("");
  const [closesTime, setClosesTime] = useState("");
  const [telegramMode, setTelegramMode] = useState(false);
  const [options, setOptions] = useState([{ id: 0, text: "" }, { id: 1, text: "" }]);
  const nextOptionId = useRef(2);
  const [multiple, setMultiple] = useState(false);
  const [audience, setAudience] = useState<TeamAudience>({ kind: "on_shift" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отчёт после отправки — точный ответ даёт только сервер: кого-то могли отвязать
  // от Telegram между выбором адресатов и отправкой.
  const [summary, setSummary] = useState<FoodSendReport | null>(null);

  const optionTexts = options.map(({ text }) => text.trim());
  const telegram = telegramMode ? telegramPollConfigSchema.safeParse({ options: optionTexts, multiple }) : null;
  const duplicateError = telegram?.success === false && optionTexts.every(Boolean)
    ? telegram.error.issues.find((issue) => issue.path[0] === "options" && issue.code === "custom")?.message
    : null;
  const questionMax = telegramMode ? POLL_TELEGRAM_QUESTION_MAX : POLL_QUESTION_MAX;
  const questionLength = question.trim().length;
  const ready = questionLength > 0 && questionLength <= questionMax && audienceReady(audience) && (telegram == null || telegram.success);

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.createPoll({
        question: question.trim(), closesTime: closesTime || null, audience,
        ...(telegram?.success ? { telegram: telegram.data } : {}),
      });
      // Дошло всем — показывать нечего, форма закрывается сразу. Не всем или ни до кого
      // из коллег — держим отчёт с явным «ОК», иначе это проскочило бы мимо.
      if (result.unreachable.length > 0 || result.deliveredToNobody) {
        setSummary({ delivered: result.delivered, unreachable: result.unreachable, deliveredToNobody: result.deliveredToNobody });
      }
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
        <h2 className="employees-title">{sendReportTitle(summary, "poll")}</h2>
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
      <div className="food-poll-controls" role="group" aria-label="Формат опроса">
        <button type="button" className={`btn ${telegramMode ? "btn-secondary" : "btn-primary"}`} aria-pressed={!telegramMode}
          disabled={busy} onClick={() => setTelegramMode(false)}>Быстрый опрос</button>
        <button type="button" className={`btn ${telegramMode ? "btn-primary" : "btn-secondary"}`} aria-pressed={telegramMode}
          disabled={busy} onClick={() => setTelegramMode(true)}>Опрос Telegram</button>
      </div>
      <label className="birthday-label">
        Вопрос
        <textarea rows={3} aria-label="Вопрос" placeholder="Корпоратив в пятницу?" maxLength={questionMax}
          value={question} disabled={busy} onChange={(e) => setQuestion(e.target.value)} />
      </label>
      {questionLength > questionMax && <div className="food-meta">Вопрос должен быть до {questionMax} символов.</div>}
      {telegramMode ? (
        <div className="food-poll-options" role="group" aria-label="Варианты ответа">
          <div className="food-meta">Голоса открытые. Каждый адресат получит опрос в личном чате с ботом.</div>
          {options.map((option, index) => (
            <div key={option.id} className="food-poll-option">
              <label className="birthday-label">
                Вариант {index + 1}
                <input aria-label={`Вариант ${index + 1}`} value={option.text} maxLength={POLL_TELEGRAM_OPTION_MAX} disabled={busy}
                  onChange={(e) => setOptions(options.map((item) => item.id === option.id ? { ...item, text: e.target.value } : item))} />
              </label>
              {options.length > 2 && (
                <button type="button" className="btn btn-quiet" aria-label={`Удалить вариант ${index + 1}`} disabled={busy}
                  onClick={() => setOptions(options.filter((item) => item.id !== option.id))}>Удалить</button>
              )}
            </div>
          ))}
          {duplicateError && <div className="food-meta">{duplicateError}</div>}
          <div className="food-poll-controls">
            <button type="button" className="btn btn-secondary" disabled={busy || options.length >= POLL_TELEGRAM_OPTION_LIMIT}
              onClick={() => setOptions([...options, { id: nextOptionId.current++, text: "" }])}>Добавить вариант</button>
          </div>
          <label className="food-poll-multiple">
            <input type="checkbox" aria-label="Можно выбрать несколько вариантов" checked={multiple} disabled={busy} onChange={(e) => setMultiple(e.target.checked)} />
            Можно выбрать несколько вариантов
          </label>
        </div>
      ) : <div className="food-meta">{POLL_CHOICES_HINT}</div>}
      <label className="birthday-label">
        Голосуем до (необязательно)
        <input type="time" className="food-time" aria-label="Голосуем до" value={closesTime} disabled={busy} onChange={(e) => setClosesTime(e.target.value)} />
      </label>
      <div className="food-meta">{POLL_CLOSES_HINT}</div>
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
