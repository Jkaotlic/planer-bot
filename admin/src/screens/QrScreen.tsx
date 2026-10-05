import { useMemo, useState } from "react";
import {
  DEFAULT_QR_STYLE,
  QR_CAPTION_MAX,
  QR_COLOR_KEYS,
  QR_COLORS,
  QR_SHAPE_LABELS,
  QR_SHAPES,
  type QrSavedStyle,
  type QrStyle,
} from "@planer/shared";
import { qrPreview, renderQr } from "@planer/shared/qr";
import { copyPngToClipboard, downloadBlob, qrFileName, svgToPngBlob } from "../lib/qr-export";

/**
 * «QR-код» в консоли: те же поля, что в мини-аппе, но картинка остаётся здесь —
 * «Скачать PNG» и «Скопировать картинку» вместо «Прислать в бота». Стиль не
 * сохраняется: «моего» стиля у консоли нет (спека, «Паритет»).
 */
export function QrScreen() {
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [style, setStyle] = useState<QrSavedStyle>(DEFAULT_QR_STYLE);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const full: QrStyle = caption.trim() ? { ...style, caption: caption.trim() } : style;
  const preview = useMemo(() => qrPreview(text, full), [text, caption, style]);
  const ready = preview.kind === "ok";

  function png(): Promise<Blob> {
    const { svg, width, height } = renderQr(text, full);
    return svgToPngBlob(svg, width, height);
  }

  async function download() {
    setNotice(null);
    try {
      downloadBlob(await png(), qrFileName(full.caption));
    } catch {
      setNotice({ ok: false, text: "Не получилось собрать картинку — обнови страницу и попробуй ещё раз." });
    }
  }

  async function copy() {
    setNotice(null);
    const res = await copyPngToClipboard(png());
    setNotice(res.ok ? { ok: true, text: "Картинка скопирована — вставь её в чат или документ." } : { ok: false, text: res.message });
  }

  return (
    <div className="employees-screen qr-screen">
      <div className="employees-header">
        <h2 className="employees-title">QR-код</h2>
      </div>
      <div className="qr-layout">
        <div className="qr-form">
          <label className="field-group">
            <span className="field-label">Ссылка или текст</span>
            <textarea className="qr-text" rows={3} placeholder="https://…" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {preview.kind === "error" && (
            <div role="alert" className="employees-error">
              {preview.message}
            </div>
          )}
          <div className="field-group">
            <span className="field-label">Форма</span>
            <div className="qr-shapes">
              {QR_SHAPES.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  className="btn btn-secondary qr-shape"
                  aria-pressed={style.shape === shape}
                  onClick={() => setStyle((s) => ({ ...s, shape }))}
                >
                  {QR_SHAPE_LABELS[shape]}
                </button>
              ))}
            </div>
          </div>
          <div className="field-group">
            <span className="field-label">Цвет</span>
            <div className="qr-colors">
              {QR_COLOR_KEYS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="qr-color"
                  aria-label={QR_COLORS[color].label}
                  title={QR_COLORS[color].label}
                  aria-pressed={style.color === color}
                  onClick={() => setStyle((s) => ({ ...s, color }))}
                  style={{ background: QR_COLORS[color].hex }}
                />
              ))}
            </div>
          </div>
          <label className="field-group">
            <span className="field-label">
              Подпись под кодом — по желанию, до {QR_CAPTION_MAX} знаков · {caption.length}/{QR_CAPTION_MAX}
            </span>
            <input type="text" maxLength={QR_CAPTION_MAX} placeholder="Например, «Сбор на кофемашину»" value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>
        </div>
        <div className="qr-side">
          <div className="qr-preview">
            {ready ? <img src={preview.src} alt="Предпросмотр QR-кода" /> : <span className="qr-preview-empty">Здесь появится код</span>}
          </div>
          <div className="qr-actions">
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => void download()}>
              Скачать PNG
            </button>
            <button type="button" className="btn btn-secondary" disabled={!ready} onClick={() => void copy()}>
              Скопировать картинку
            </button>
          </div>
          {notice && (
            <div role="status" className={notice.ok ? "qr-notice" : "qr-notice employees-error"}>
              {notice.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
