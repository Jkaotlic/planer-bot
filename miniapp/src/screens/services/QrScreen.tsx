import { useMemo, useRef, useState } from "react";
import { Input, Textarea } from "@telegram-apps/telegram-ui";
import {
  QR_CAPTION_MAX,
  QR_COLOR_KEYS,
  QR_COLORS,
  QR_SHAPE_LABELS,
  QR_SHAPES,
  type QrSavedStyle,
  type QrStyle,
} from "@planer/shared";
import { qrDataUrl, qrPreview, renderQrSvg } from "@planer/shared/qr";
import { apiClient } from "../../api/client";
import { ActionButton, Group, Hint, Screen } from "../../ui";

function sameStyle(a: QrSavedStyle, b: QrSavedStyle): boolean {
  return a.shape === b.shape && a.color === b.color;
}

/**
 * «QR-код»: поле, живой предпросмотр, четыре формы, шесть цветов, подпись и
 * «Прислать мне в бота». Рисует в браузере тем же `renderQr`, что бот и консоль, —
 * без запроса на каждое касание. Экран грузится ленивым куском (см. `qr-bundle.test.ts`).
 */
export function QrScreen({ initialStyle, onClose }: { initialStyle: QrSavedStyle; onClose(style: QrSavedStyle): void }) {
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [style, setStyle] = useState<QrSavedStyle>(initialStyle);
  /** Что уже лежит на сервере: уход сохраняет, только если выбор от этого отличается. */
  const [saved, setSaved] = useState<QrSavedStyle>(initialStyle);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // Состояние `sending` обновляется после рендера, а второе касание приходит раньше:
  // без флага в ref быстрый двойной тап отправил бы картинку в личку дважды.
  const inFlight = useRef(false);

  // Итог отправки относится к тому коду, что был на экране в тот момент: после любой
  // правки «Отправил…» стояло бы рядом с другой картинкой, а красный отказ — залип.
  function edit(change: () => void) {
    setStatus(null);
    change();
  }

  const full: QrStyle = caption.trim() ? { ...style, caption: caption.trim() } : style;
  const preview = useMemo(() => qrPreview(text, full), [text, caption, style]);
  // Образцы — тем же рисованием, по короткому слову: так видно именно форму модуля.
  const samples = useMemo(
    () => Object.fromEntries(QR_SHAPES.map((shape) => [shape, qrDataUrl(renderQrSvg("QR", { shape, color: style.color }))])),
    [style.color],
  );

  function leave() {
    if (!sameStyle(style, saved)) {
      // Человек уже уходит: неудача значит лишь, что бот нарисует прежним стилем.
      void apiClient.setQrStyle(style).catch(() => {});
    }
    onClose(style);
  }

  async function send() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setStatus(null);
    try {
      await apiClient.sendQrToMe(text, full);
      // Сервер запомнил стиль вместе с отправкой — уход второй раз его не шлёт.
      setSaved(style);
      setStatus({ ok: true, text: "Отправил — картинка в чате с ботом." });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "Не получилось отправить — попробуй ещё раз." });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <Screen title="QR-код" onBack={leave}>
      {/* Поле у tgui со своими боковыми отступами, поэтому выходит к краям Screen. Вылет равен
          его падингу (--app-gutter, 16px): прежние -20px давали scrollWidth 394 при окне 390. */}
      <div style={{ margin: "0 calc(-1 * var(--app-gutter))" }}>
        <Textarea header="Ссылка или текст" placeholder="https://…" value={text} onChange={(e) => edit(() => setText(e.target.value))} />
      </div>
      {preview.kind === "error" && (
        <div role="alert" className="qr-error" style={{ fontSize: 13, margin: "4px 0 8px" }}>
          {preview.message}
        </div>
      )}

      {/* Белая карточка в обеих темах: код читают с белого, тёмная тема вокруг — не его фон. */}
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: "var(--app-radius-card)",
          padding: 8,
          minHeight: 236,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "8px 0 12px",
        }}
      >
        {preview.kind === "ok" ? (
          <img src={preview.src} alt="Предпросмотр QR-кода" style={{ width: "min(100%, 300px)", height: "auto", display: "block" }} />
        ) : (
          <span style={{ color: "#5F6368", fontSize: 14 }}>Здесь появится код</span>
        )}
      </div>

      <Group header="Форма">
        <div style={{ display: "flex", gap: "clamp(4px, 4.57vw - 9.8px, 8px)" }}>
          {QR_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              aria-pressed={style.shape === shape}
              onClick={() => edit(() => setStyle((s) => ({ ...s, shape })))}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                minHeight: 44,
                padding: "6px 0",
                border: `2px solid ${style.shape === shape ? "var(--tgui--accent_text_color)" : "transparent"}`,
                borderRadius: 12,
                background: "var(--tgui--secondary_bg_color)",
                color: "var(--tgui--text_color)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                // На 320 слово «Скруглённый» при 12px не влезало в кнопку (scrollWidth > clientWidth):
                // при 10px оно ещё давало 66.7px на 62px места. Поэтому кегль и зазор сжимаются
                // вместе с окном: 12px на 390 и шире, на 320 — 9px (запас ~4px), зазор 8px сжимается до 4px.
                fontSize: "clamp(9px, 4.29vw - 4.7px, 12px)",
                cursor: "pointer",
              }}
            >
              <img src={samples[shape]} alt="" aria-hidden="true" style={{ width: 48, height: 48, background: "#FFFFFF", borderRadius: 6 }} />
              {QR_SHAPE_LABELS[shape]}
            </button>
          ))}
        </div>
      </Group>

      <Group header="Цвет">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {QR_COLOR_KEYS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={QR_COLORS[color].label}
              aria-pressed={style.color === color}
              onClick={() => edit(() => setStyle((s) => ({ ...s, color })))}
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                // Выбранный: белая кромка по краю образца (на всех шести тёмных заливках ≥ 3:1, а
                // акцентная давала 2.44 на зелёном) и внешнее кольцо цвета текста через зазор —
                // оно видно на странице в обеих темах, где белая кромка сливается со светлым фоном.
                border: `3px solid ${style.color === color ? "#FFFFFF" : "transparent"}`,
                boxShadow: style.color === color ? "0 0 0 2px var(--tgui--bg_color), 0 0 0 4px var(--tgui--text_color)" : "none",
                background: QR_COLORS[color].hex,
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      </Group>

      <Group header="Подпись под кодом">
        <div style={{ margin: "0 calc(-1 * var(--app-gutter))" }}>
          <Input
            placeholder="Например, «Сбор на кофемашину»"
            value={caption}
            maxLength={QR_CAPTION_MAX}
            onChange={(e) => edit(() => setCaption(e.target.value))}
          />
        </div>
        <p className="ui-hint qr-hint">
          По желанию, до {QR_CAPTION_MAX} знаков · {caption.length}/{QR_CAPTION_MAX}
        </p>
      </Group>

      <ActionButton kind="primary" stretched loading={sending} disabled={preview.kind !== "ok" || sending} onClick={() => void send()}>
        Прислать мне в бота
      </ActionButton>
      {status && (
        <div
          role="status"
          style={{ fontSize: 13, marginTop: 8, color: status.ok ? "var(--tgui--text_color)" : "var(--tgui--destructive_text_color)" }}
        >
          {status.text}
        </div>
      )}
      <Hint>
        Бот пришлёт картинку в личку — оттуда её можно переслать или сохранить. Ссылку можно прислать боту и просто
        так: он ответит кодом в этом же стиле.
      </Hint>
    </Screen>
  );
}
