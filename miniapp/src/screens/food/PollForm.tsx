import { useRef, useState } from "react";
import { Input, Textarea } from "@telegram-apps/telegram-ui";
import {
  POLL_CHOICES_HINT, POLL_CLOSES_HINT, POLL_QUESTION_MAX, POLL_TELEGRAM_OPTION_LIMIT, POLL_TELEGRAM_OPTION_MAX, POLL_TELEGRAM_QUESTION_MAX,
  audienceReady, sendReportText, sendReportTitle, telegramPollConfigSchema, type FoodSendReport,
} from "@planer/shared";
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
  const [telegramMode, setTelegramMode] = useState(false);
  const [options, setOptions] = useState([{ id: 0, text: "" }, { id: 1, text: "" }]);
  const nextOptionId = useRef(2);
  const [multiple, setMultiple] = useState(false);
  const [audience, setAudience] = useState<TeamAudience>({ kind: "on_shift" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отчёт после отправки — кто не получил опрос. `AudiencePicker` уже
  // показывает недостижимых ДО отправки (та же строка «Не дойдёт»), но
  // список могло изменить состояние гонки (кого-то как раз отвязали от
  // Telegram) — точный ответ даёт только сервер, в самом ответе создания.
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
      // Недостижимых нет — закрывать нечего показывать, форма закрывается
      // сразу, как раньше. Есть — держим экран с отчётом и явным «ОК», иначе
      // «дошло не всем» проскочило бы мимо того, кто как раз это должен знать.
      // Ни до кого из коллег не дошло — тоже держим: молча закрытая форма читалась бы
      // как «опрос ушёл», а голосов не будет.
      if (result.unreachable.length > 0 || result.deliveredToNobody) {
        setSummary({ delivered: result.delivered, unreachable: result.unreachable, deliveredToNobody: result.deliveredToNobody });
      }
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
        <h1 className="ui-screen__title">{sendReportTitle(summary, "poll")}</h1>
        <div style={{ fontSize: "var(--app-text-body)", lineHeight: 1.45 }}>
          {sendReportText(summary)}
        </div>
        <ActionButton kind="primary" onClick={onDone}>ОК</ActionButton>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px var(--app-gutter) calc(24px + var(--app-inset-bottom))" }}>
      <h1 className="ui-screen__title">Новый опрос</h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="group" aria-label="Формат опроса">
        <ActionButton compact kind={telegramMode ? "secondary" : "primary"} aria-pressed={!telegramMode} disabled={busy}
          onClick={() => setTelegramMode(false)}>Быстрый опрос</ActionButton>
        <ActionButton compact kind={telegramMode ? "primary" : "secondary"} aria-pressed={telegramMode} disabled={busy}
          onClick={() => setTelegramMode(true)}>Опрос Telegram</ActionButton>
      </div>
      <Textarea header="Вопрос" placeholder="Корпоратив в пятницу?" value={question} maxLength={questionMax}
        onChange={(e) => setQuestion(e.target.value)} disabled={busy} />
      {questionLength > questionMax && <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>
        Вопрос должен быть до {questionMax} символов.
      </div>}
      {telegramMode ? (
        <div role="group" aria-label="Варианты ответа" style={{ display: "grid", gap: 8 }}>
          <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>
            Голоса открытые. Каждый адресат получит опрос в личном чате с ботом.
          </div>
          {options.map((option, index) => (
            <div key={option.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "end", gap: 4 }}>
              <Input header={`Вариант ${index + 1}`} aria-label={`Вариант ${index + 1}`}
                value={option.text} maxLength={POLL_TELEGRAM_OPTION_MAX} disabled={busy}
                onChange={(e) => setOptions(options.map((item) => item.id === option.id ? { ...item, text: e.target.value } : item))} />
              {options.length > 2 && (
                <ActionButton compact kind="quiet" aria-label={`Удалить вариант ${index + 1}`} disabled={busy}
                  onClick={() => setOptions(options.filter((item) => item.id !== option.id))}>Удалить</ActionButton>
              )}
            </div>
          ))}
          {duplicateError && <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>{duplicateError}</div>}
          <div>
            <ActionButton compact kind="secondary" disabled={busy || options.length >= POLL_TELEGRAM_OPTION_LIMIT}
              onClick={() => setOptions([...options, { id: nextOptionId.current++, text: "" }])}>Добавить вариант</ActionButton>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--app-text-meta)" }}>
            <input type="checkbox" checked={multiple} disabled={busy} onChange={(e) => setMultiple(e.target.checked)} />
            Можно выбрать несколько вариантов
          </label>
        </div>
      ) : <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>{POLL_CHOICES_HINT}</div>}
      <Input header="Голосуем до (необязательно)" type="time" value={closesTime}
        onChange={(e) => setClosesTime(e.target.value)} disabled={busy} />
      <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>{POLL_CLOSES_HINT}</div>
      <AudiencePicker value={audience} onChange={setAudience} disabled={busy} />
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton kind="primary" disabled={!ready || busy} loading={busy} onClick={submit}>Отправить</ActionButton>
        <ActionButton kind="quiet" disabled={busy} onClick={onCancel}>Отмена</ActionButton>
      </div>
    </div>
  );
}
