import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../api/client";
import { ActionButton } from "../ui";

/** `https://…` → `webcal://…` — так ссылка открывает подписку в приложении
 *  календаря, а не просто грузится как страница. */
function toWebcal(url: string): string {
  return url.replace(/^https?:\/\//, "webcal://");
}

// Плоский ряд кнопок, а не Cell — общая ширина без урезки шрифтом. Боковой
// отступ 24px — как у `Cell` из telegram-ui: у всех четырёх блоков «Настроек» один левый край.
const ROW: CSSProperties = { display: "flex", gap: 8, padding: "4px 24px 12px" };
const HINT: CSSProperties = { padding: "0 24px 12px", color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.4 };
const ERROR: CSSProperties = { padding: "0 24px 12px", color: "var(--tgui--destructive_text_color)", fontSize: 13 };

/**
 * «Календарь» на экране «Настройки»: личная ICS-подписка на свои смены.
 *
 * Плоские `<div>` с флексом, а не `Cell`: `Cell`/`Tappable` красит hover и
 * press собственным CSS-классом независимо от `readOnly` — тот гасит только
 * рябь от тапа (см. `Tappable.js` в `@telegram-apps/telegram-ui`), а не
 * подсветку. Обёрнутый в `Cell` блок кнопок на телефоне выглядел одной
 * большой нажимаемой строкой с серой заливкой поверх самих кнопок — то, что
 * в замере на 390px казалось «фоном скриншота», было именно этой подсветкой,
 * застрявшей от курсора headless-браузера. Тот же приём без `Cell`, что и у
 * «Записать себе» на «Сменах»: кнопки лежат в собственном
 * `<div style={{display:"flex", gap:8}}>`, без обёртки, которая давала бы кнопке шрифт-урезанную
 * ширину заголовка `Cell` (то самое «Добавить в календ…» из первой версии).
 *
 * Состояние грузится при открытии раздела своим запросом, а не приезжает с
 * bootstrap: токен нарочно не отдаётся ни там, ни в `/api/me` — тот же класс
 * утечки, что был у `inviteToken` (ledger 2026-08-11), — так что единственный
 * способ узнать «подключено ли» это спросить саму ручку. Отказ этого запроса
 * — отдельное состояние («Повторить»), а не тихий откат к «Подключить»: тап
 * по «Подключить», когда подписка на самом деле уже есть, вызвал бы тот же
 * `POST`, что и «Сменить ссылку», и молча пересоздал бы рабочий токен,
 * которого никто не просил менять.
 *
 * «Сменить ссылку» — тот же двухшаговый confirm, что у замка обменов в
 * `AdminSettings.tsx`: один тап слишком дёшево стоит для необратимого
 * действия (старая ссылка гаснет навсегда, её могли переслать).
 */
export function CalendarSection() {
  const [link, setLink] = useState<string | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingChange, setConfirmingChange] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  function load() {
    setLoadError(null);
    apiClient
      .getCalendarLink()
      .then((url) => {
        if (mounted.current) setLink(url);
      })
      .catch((err: unknown) => {
        if (mounted.current) setLoadError(err instanceof Error ? err.message : "Не удалось узнать состояние подписки");
      });
  }

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      // Незавершённый таймер «Скопировано ✓» иначе зовёт setState на
      // размонтированном компоненте — React ругается на это в консоль.
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  async function connect() {
    setBusy(true);
    setActionError(null);
    try {
      const url = await apiClient.createCalendarLink();
      setLink(url);
      setConfirmingChange(false);
      setCopyFallback(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Не удалось создать ссылку");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setActionError(null);
    try {
      await apiClient.deleteCalendarLink();
      setLink(null);
      setConfirmingDisconnect(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Не удалось отключить");
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!link) return;
    setActionError(null);
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
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopyFallback(true));
  }

  if (loadError) {
    return (
      <>
        <div style={ERROR}>{loadError}</div>
        <div style={ROW}>
          <ActionButton stretched onClick={load}>
            Повторить
          </ActionButton>
        </div>
      </>
    );
  }

  if (link === undefined) {
    return <div style={HINT}>Загружаю…</div>;
  }

  if (!link) {
    return (
      <>
        <div style={ROW}>
          <ActionButton kind="primary" stretched disabled={busy} onClick={() => void connect()}>
            {busy ? "Подключаю…" : "Подключить"}
          </ActionButton>
        </div>
        <div style={HINT}>Личная ссылка на свои смены — календарь телефона сам подтянет изменения графика.</div>
        {actionError && <div style={ERROR}>{actionError}</div>}
      </>
    );
  }

  return (
    <>
      {/* Каждая на своём ряду, не парой: замер на 390px в обеих темах показал
          `scrollWidth > clientWidth` на заголовке кнопки при паре («Добавить
          в календарь» + «Скопировать ссылку» вместе не помещаются, даже вне
          Cell) — те же самые полтора слова, обрезанные по-другому. */}
      <div style={ROW}>
        <ActionButton kind="primary" stretched href={toWebcal(link)}>
          Добавить в календарь
        </ActionButton>
      </div>
      <div style={ROW}>
        {/* Обычная (тонированная), не «тихая»: копирование работает всегда, и
            кнопка без фона читалась бы как недоступная. Главная здесь одна —
            «Добавить в календарь»; поэтому и «Да, сменить» не primary: оно
            стоит на экране вместе с ней. «Тихая» — только «Отмена». */}
        <ActionButton stretched disabled={busy} onClick={copyLink}>
          {copied ? "Скопировано ✓" : "Скопировать ссылку"}
        </ActionButton>
      </div>

      {copyFallback && (
        <div style={{ padding: "0 24px 12px" }}>
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Ссылка на календарь"
            style={{ width: "100%", fontSize: 13, boxSizing: "border-box" }}
          />
        </div>
      )}

      <div style={HINT}>
        iPhone: нажми «Добавить в календарь». Если не открылось: Настройки → Календарь → Учётные записи → Новая
        учётная запись → Другое → Подписной календарь, вставь скопированную ссылку. Android: скопируй ссылку и добавь
        её в Google Календаре на компьютере → «Добавить по URL».
      </div>

      {confirmingChange ? (
        <>
          <div style={{ padding: "0 24px 4px", fontSize: 13 }}>Старая ссылка перестанет работать.</div>
          <div style={ROW}>
            <ActionButton stretched disabled={busy} onClick={() => void connect()}>
              {busy ? "Меняю…" : "Да, сменить"}
            </ActionButton>
            <ActionButton kind="quiet" stretched disabled={busy} onClick={() => setConfirmingChange(false)}>
              Отмена
            </ActionButton>
          </div>
        </>
      ) : confirmingDisconnect ? (
        // Тот же двухшаговый confirm, что у «Сменить ссылку»: отключение здесь
        // необратимо для владельца телефона так же — подписка в его календаре
        // перестанет обновляться навсегда, а не просто отвяжется на сервере.
        <>
          <div style={{ padding: "0 24px 4px", fontSize: 13 }}>Подписка в календаре телефона перестанет обновляться.</div>
          <div style={ROW}>
            <ActionButton stretched disabled={busy} onClick={() => void disconnect()}>
              {busy ? "Отключаю…" : "Да, отключить"}
            </ActionButton>
            <ActionButton kind="quiet" stretched disabled={busy} onClick={() => setConfirmingDisconnect(false)}>
              Отмена
            </ActionButton>
          </div>
        </>
      ) : (
        <div style={ROW}>
          <ActionButton stretched disabled={busy} onClick={() => setConfirmingChange(true)}>
            Сменить ссылку
          </ActionButton>
          <ActionButton stretched disabled={busy} onClick={() => setConfirmingDisconnect(true)}>
            Отключить
          </ActionButton>
        </div>
      )}

      {actionError && <div style={ERROR}>{actionError}</div>}
    </>
  );
}
