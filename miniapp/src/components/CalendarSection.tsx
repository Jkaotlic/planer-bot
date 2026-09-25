import { useEffect, useState } from "react";
import { Button, Cell, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";

/** `https://…` → `webcal://…` — так ссылка открывает подписку в приложении
 *  календаря, а не просто грузится как страница. */
function toWebcal(url: string): string {
  return url.replace(/^https?:\/\//, "webcal://");
}

/**
 * «Календарь» на «Мои смены»: личная ICS-подписка на свои смены.
 *
 * Состояние грузится при открытии раздела своим запросом, а не приезжает с
 * bootstrap: токен нарочно не отдаётся ни там, ни в `/api/me` — тот же класс
 * утечки, что был у `inviteToken` (ledger 2026-08-11), — так что единственный
 * способ узнать «подключено ли» это спросить саму ручку.
 *
 * «Сменить ссылку» — тот же двухшаговый confirm, что у замка обменов в
 * `AdminSettings.tsx`: один тап слишком дёшево стоит для необратимого
 * действия (старая ссылка гаснет навсегда, её могли переслать).
 */
export function CalendarSection() {
  const [link, setLink] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingChange, setConfirmingChange] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);

  useEffect(() => {
    let alive = true;
    apiClient
      .getCalendarLink()
      .then((url) => {
        if (alive) setLink(url);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLink(null);
        setError(err instanceof Error ? err.message : "Не удалось узнать состояние подписки");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const url = await apiClient.createCalendarLink();
      setLink(url);
      setConfirmingChange(false);
      setCopyFallback(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать ссылку");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.deleteCalendarLink();
      setLink(null);
      setConfirmingChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отключить");
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!link) return;
    setError(null);
    if (!navigator.clipboard) {
      // Небезопасный контекст или старый webview — показываем ссылку текстом,
      // который можно выделить и скопировать руками, а не молчим о неудаче.
      setCopyFallback(true);
      return;
    }
    navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopyFallback(false);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopyFallback(true));
  }

  if (link === undefined) {
    return (
      <Cell before={<Spinner size="s" />} readOnly>
        Загружаю…
      </Cell>
    );
  }

  if (!link) {
    return (
      <>
        <Cell
          Component="div"
          multiline
          description="Личная ссылка на свои смены — календарь телефона сам подтянет изменения графика."
        >
          <Button size="m" stretched mode="filled" disabled={busy} onClick={() => void connect()}>
            {busy ? "Подключаю…" : "Подключить"}
          </Button>
        </Cell>
        {error && (
          <div style={{ padding: "0 20px 10px", color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>
            {error}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <Cell
        Component="div"
        multiline
        description="iPhone: нажми «Добавить в календарь». Android: скопируй ссылку и добавь её в Google Календаре на компьютере → «Добавить по URL»."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Каждая своим рядом на всю ширину, а не парой в одной строке: два
              длинных русских текста в паре на 390px обрезались многоточием —
              «Добавить в календ…», «Скопиров…» — замер в браузере это поймал. */}
          <Button size="m" stretched mode="filled" Component="a" href={toWebcal(link)}>
            Добавить в календарь
          </Button>
          <Button size="m" stretched mode="gray" disabled={busy} onClick={copyLink}>
            {copied ? "Ссылка скопирована ✓" : "Скопировать ссылку"}
          </Button>

          {copyFallback && (
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Ссылка на календарь"
              style={{ width: "100%", fontSize: 13, boxSizing: "border-box" }}
            />
          )}

          {confirmingChange ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 13 }}>Старая ссылка перестанет работать.</div>
              {/* Свой ряд на каждую — тот же урок, что и с двумя первыми кнопками
                  выше: пара в одной строке на 390px обрезала текст многоточием. */}
              <Button size="s" stretched mode="filled" disabled={busy} onClick={() => void connect()}>
                {busy ? "Меняю…" : "Да, сменить"}
              </Button>
              <Button size="s" stretched mode="gray" disabled={busy} onClick={() => setConfirmingChange(false)}>
                Отмена
              </Button>
            </div>
          ) : (
            <>
              <Button size="s" stretched mode="bezeled" disabled={busy} onClick={() => setConfirmingChange(true)}>
                Сменить ссылку
              </Button>
              <Button size="s" stretched mode="bezeled" disabled={busy} onClick={() => void disconnect()}>
                {busy ? "Отключаю…" : "Отключить"}
              </Button>
            </>
          )}
        </div>
      </Cell>
      {error && (
        <div style={{ padding: "0 20px 10px", color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>
      )}
    </>
  );
}
