import { useEffect, useState } from "react";
import {
  ANNOUNCEMENT_TEXT_MAX,
  apiClient,
  AuthRequiredError,
  type AnnouncementRecipient,
  type AnnouncementResult,
} from "../api/client";
import { recipientsPhrase } from "./CollectionsScreen";

/**
 * «Анонсы»: вольный текст всей команде или выбранным людям — из десктопной консоли.
 *
 * Поведение перенесено целиком из мини-апповского `AdminAnnounce`, вёрстка —
 * консольная (тот же слой карточек/классов, что у «Сборов» и «Настроек»), а не
 * компонент из `@telegram-apps/telegram-ui`, которым живёт мини-апп.
 *
 * Занудство не срезано — и вот почему: анонс единственная рассылка в системе,
 * которая проходит сквозь ВСЕ личные настройки тишины (см.
 * `announcement-service.ts`), отписаться нельзя, а отправленное в Telegram
 * сообщение не отзывается. Поэтому кнопка отправки взводится первым кликом и
 * шлёт вторым, а до того экран показывает точный поимённый список тех, кому
 * уйдёт — мышью промахнуться проще, чем пальцем, но опечатка стоит той же цены.
 *
 * Кто достижим и кому вообще можно писать (не себе, не архивным) считает
 * сервер (`GET /api/announcements/recipients`) — копию этого правила экран не
 * держит, ровно как её уже убрали из мини-аппа: сервер уже ответил на вопрос,
 * держать его здесь второй копией значило бы дать ей разъехаться.
 */
export function AnnounceScreen() {
  const [recipients, setRecipients] = useState<AnnouncementRecipient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [audienceMode, setAudienceMode] = useState<"all" | "picked">("all");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AnnouncementResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await apiClient.getAnnouncementRecipients();
        if (!cancelled) setRecipients(list);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthRequiredError) return;
        setLoadError(err instanceof Error ? err.message : "Не удалось загрузить получателей");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) return <div className="employees-error">{loadError}</div>;
  if (!recipients) return <div className="employees-empty">Загрузка…</div>;

  // Сервер уже исключил самого отправителя и архивных — здесь только выбор.
  const picked = audienceMode === "all" ? recipients : recipients.filter((e) => selectedIds.has(e.id));
  // Выбранный явно, но без телеграма, в отчёт попадёт — но не в это число:
  // сервер его тоже не отправит. Показываем заранее, а не только в отчёте
  // после отправки, чтобы «кому уйдёт» не расходилось с тем, что реально дойдёт.
  const reachable = picked.filter((e) => e.reachable);
  const overLimit = text.length > ANNOUNCEMENT_TEXT_MAX;
  const canSend = text.trim().length > 0 && !overLimit && reachable.length > 0;

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const audience = audienceMode === "all" ? "all" : [...selectedIds];
      const result = await apiClient.sendAnnouncement(text.trim(), audience);
      setReport(result);
      setConfirming(false);
      setText("");
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить");
      setConfirming(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Анонсы</h2>
      </div>

      <p className="settings-intro">
        Уходит в обход всех личных настроек уведомлений — отписаться от анонсов нельзя. Отправленное
        сообщение не отзывается, поэтому перед отправкой экран показывает точный список получателей.
      </p>

      <label className="birthday-label">
        Текст
        <textarea
          rows={5}
          aria-label="Текст анонса"
          placeholder="Что сказать команде"
          value={text}
          disabled={sending}
          onChange={(e) => {
            setText(e.target.value);
            setConfirming(false);
          }}
        />
      </label>
      <div className={`announce-counter${overLimit ? " over" : ""}`}>
        {text.length} / {ANNOUNCEMENT_TEXT_MAX}
      </div>

      <div className="announce-audience">
        <button
          type="button"
          className={`btn ${audienceMode === "all" ? "btn-primary" : "btn-secondary"}`}
          disabled={sending}
          onClick={() => {
            setAudienceMode("all");
            setConfirming(false);
          }}
        >
          Всем
        </button>
        <button
          type="button"
          className={`btn ${audienceMode === "picked" ? "btn-primary" : "btn-secondary"}`}
          disabled={sending}
          onClick={() => {
            setAudienceMode("picked");
            setConfirming(false);
          }}
        >
          Выбрать
        </button>
      </div>

      {audienceMode === "picked" && (
        <div className="announce-picker">
          {recipients.length === 0 ? (
            <div className="employees-empty">Выбирать некого.</div>
          ) : (
            recipients.map((e) => (
              <label key={e.id} className="announce-picker-row">
                <input type="checkbox" checked={selectedIds.has(e.id)} disabled={sending} onChange={() => toggle(e.id)} />
                <span>{e.displayName}</span>
                {!e.reachable && <span className="announce-unreachable">— не привязан</span>}
              </label>
            ))
          )}
        </div>
      )}

      <div className="birthday-preview-title">Уйдёт {reachable.length === 0 ? "некому" : `${reachable.length}:`}</div>
      {reachable.length > 0 && (
        <div className="birthday-recipients">
          {reachable.map((e) => (
            <span className="birthday-recipient" key={e.id}>
              {e.displayName}
            </span>
          ))}
        </div>
      )}

      {error && <div className="employees-error">{error}</div>}

      {confirming ? (
        <div className="birthday-confirm">
          <span>
            Отправить {recipientsPhrase(reachable.length)}? Отменить будет нельзя — сообщение уйдёт сразу.
          </span>
          <button type="button" className="btn btn-primary" disabled={sending} onClick={() => void handleSend()}>
            {sending ? "Отправляю…" : "Да, отправить"}
          </button>
          <button type="button" className="btn btn-secondary" disabled={sending} onClick={() => setConfirming(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <div className="journal-controls">
          <button type="button" className="btn btn-primary" disabled={!canSend} onClick={() => setConfirming(true)}>
            Отправить
          </button>
        </div>
      )}

      {report && (
        <div className="birthday-sent-note">
          Дошло {report.delivered} из {report.intended}.
          {report.unreachable.length > 0 && (
            <div>Не получили (нет телеграма или в архиве): {report.unreachable.join(", ")}</div>
          )}
        </div>
      )}
    </div>
  );
}
